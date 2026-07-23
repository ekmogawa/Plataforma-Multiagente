import type { ArtifactKind, MetricEvent, ModelTier } from "@pm/contracts";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CapabilityResolver } from "../adapters/capability-resolver.js";
import type {
  CompletionRequest,
  CompletionResponse,
} from "../adapters/model-port.js";
import { ProviderError } from "../adapters/model-port.js";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import { CacheRepo } from "../db/cache-repo.js";
import type { MetricsRepo } from "../db/metrics-repo.js";
import { log } from "../shared/logger.js";
import type { Clock } from "../shared/clock.js";
import { loadPrompt } from "./prompt-library.js";
import { renderPrompt } from "./prompt-builder.js";
import type { CognitiveMode } from "./mode.js";

/** Subconjunto do ModelResolver de que o motor precisa (testável com fake). */
export interface StageModelGateway {
  completeWithFallback(
    modelKey: string,
    req: CompletionRequest,
  ): Promise<CompletionResponse & { attemptedModels: string[] }>;
}

/** Contexto compartilhado por todas as etapas de um run. */
export interface StageContext {
  runId: string;
  projectSlug: string;
  mode: CognitiveMode;
  complexity?: number;
  tierCeiling?: ModelTier;
  clock: Clock;
  capabilityResolver: CapabilityResolver;
  gateway: StageModelGateway;
  artifacts: ArtifactStore;
  metrics: MetricsRepo;
  cache: CacheRepo;
  /** Raiz do repo (para carregar prompts em testes/monorepo). */
  root?: string;
}

/**
 * Uma etapa cognitiva. A MESMA definição serve online e offline: `heuristic` é
 * um executor de regras de PRIMEIRA CLASSE (não stub) e `llm` é o caminho por
 * modelo (usado só quando o modo do run é "llm").
 */
export interface CognitiveStage<I, O> {
  name: string;
  capability: string;
  /** Prompt da biblioteca para o caminho LLM (ex.: "intake/traduzir"). */
  promptId?: string;
  /** Variáveis para renderizar o prompt (caminho LLM). */
  buildVars?: (input: I, ctx: StageContext) => Record<string, string>;
  /**
   * Schema de saída — valida ambos os caminhos no boundary. A posição de
   * ENTRADA é `any` porque os schemas usam `.default()` (input com opcionais
   * difere do output `O`); o que importa é que `.parse` devolve `O`.
   */
  schema: z.ZodType<O, z.ZodTypeDef, any>;
  /** Fallback determinístico (offline, sempre válido por construção). */
  heuristic: (input: I, ctx: StageContext) => O;
}

/**
 * Executa uma etapa. Modo "heuristic": roda a heurística e valida. Modo "llm":
 * resolve capacidade -> modelo, renderiza prompt, chama com jsonSchema, valida,
 * 1 retry de reparo; QUALQUER falha do caminho LLM degrada graciosamente para a
 * heurística (o run nunca quebra por causa do modelo).
 */
export async function runStage<I, O>(
  stage: CognitiveStage<I, O>,
  input: I,
  ctx: StageContext,
): Promise<O> {
  if (ctx.mode === "heuristic") {
    return stage.schema.parse(stage.heuristic(input, ctx));
  }

  try {
    return await runLlmPath(stage, input, ctx);
  } catch (err) {
    log.warn(
      `Etapa "${stage.name}" caiu para heurística (falha no caminho LLM): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    ctx.metrics.record(metric(ctx, stage, { success: false, meta: { degraded: true } }));
    return stage.schema.parse(stage.heuristic(input, ctx));
  }
}

async function runLlmPath<I, O>(
  stage: CognitiveStage<I, O>,
  input: I,
  ctx: StageContext,
): Promise<O> {
  if (!stage.promptId || !stage.buildVars) {
    throw new Error(`Etapa "${stage.name}" sem promptId/buildVars para o caminho LLM.`);
  }
  const decision = ctx.capabilityResolver.resolve(stage.capability, {
    complexity: ctx.complexity,
    tierCeiling: ctx.tierCeiling,
  });
  const prompt = loadPrompt(stage.promptId, ctx.root);
  const rendered = renderPrompt(prompt, stage.buildVars(input, ctx));

  ctx.artifacts.store({
    runId: ctx.runId,
    kind: "prompt",
    name: `${stage.name}-prompt`,
    content: `# system\n${rendered.system}\n\n# user\n${rendered.user}`,
    meta: { stage: stage.name, promptId: rendered.promptId, promptVersion: rendered.version },
  });

  const jsonSchema = zodToJsonSchema(stage.schema, { name: stage.name }) as Record<string, unknown>;

  // Cache por hash do prompt (chaveado pelo modelo PEDIDO, não pelo que respondeu
  // via fallback) — economia direta de tokens ao repetir a mesma requisição.
  const cacheKey = CacheRepo.keyFor({
    model: decision.model,
    system: rendered.system,
    user: rendered.user,
    schema: JSON.stringify(jsonSchema),
  });
  const cached = ctx.cache.get(cacheKey);
  if (cached !== undefined) {
    const hit = stage.schema.safeParse(cached);
    if (hit.success) {
      ctx.metrics.record(metric(ctx, stage, { success: true, meta: { cacheHit: true } }));
      return hit.data;
    }
  }

  const started = ctx.clock.monotonicMs(); // relógio injetado (0 em testes)

  let usage = { in: 0, out: 0 };
  let costUsd = 0;
  let usedModel = decision.model;

  const req: CompletionRequest = {
    system: rendered.system,
    messages: [{ role: "user", content: rendered.user }],
    jsonSchema,
  };
  const res = await ctx.gateway.completeWithFallback(decision.model, req);
  let raw: unknown;
  usedModel = res.model;
  usage = { in: res.usage.in, out: res.usage.out };
  costUsd = res.costUsd;
  raw = res.parsed ?? tryParse(res.text);

  ctx.artifacts.store({
    runId: ctx.runId,
    kind: "response",
    name: `${stage.name}-response`,
    content: typeof res.text === "string" ? res.text : JSON.stringify(raw),
    meta: { stage: stage.name, model: usedModel },
  });

  let result = stage.schema.safeParse(raw);
  if (!result.success) {
    // 1 retry de reparo: pede ao modelo para corrigir a saída fora do schema.
    raw = await repair(stage, rendered, raw, result.error, ctx);
    result = stage.schema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Saída de "${stage.name}" fora do schema mesmo após reparo.`);
    }
  }

  ctx.cache.set(cacheKey, result.data);

  ctx.metrics.record(
    metric(ctx, stage, {
      model: usedModel,
      tokensIn: usage.in,
      tokensOut: usage.out,
      costUsd,
      durationMs: ctx.clock.monotonicMs() - started,
      success: true,
      promptVersion: rendered.version,
    }),
  );

  return result.data;
}

async function repair<I, O>(
  stage: CognitiveStage<I, O>,
  rendered: { system: string; user: string },
  badOutput: unknown,
  error: z.ZodError,
  ctx: StageContext,
): Promise<unknown> {
  const decision = ctx.capabilityResolver.resolve("repair", { tierCeiling: ctx.tierCeiling });
  const issues = error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
  const jsonSchema = zodToJsonSchema(stage.schema, { name: stage.name }) as Record<string, unknown>;
  const req: CompletionRequest = {
    system: "Você corrige JSON para aderir estritamente ao schema fornecido. Responda só com o JSON corrigido.",
    messages: [
      {
        role: "user",
        content:
          `A saída abaixo violou o schema. Corrija-a.\n\nSaída:\n${JSON.stringify(badOutput)}\n\nErros:\n${issues}`,
      },
    ],
    jsonSchema,
  };
  const res = await ctx.gateway.completeWithFallback(decision.model, req);
  return res.parsed ?? tryParse(res.text);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function metric<I, O>(
  ctx: StageContext,
  stage: CognitiveStage<I, O>,
  fields: Partial<MetricEvent>,
): MetricEvent {
  return {
    ts: ctx.clock.now(),
    kind: "llm_call",
    runId: ctx.runId,
    ...fields,
    // capability entra no meta (não é lógica) para o Evolution Engine agregar
    // por capacidade — a regra de roteamento mais valiosa. Metadado, não schema.
    meta: { stage: stage.name, capability: stage.capability, ...(fields.meta ?? {}) },
  };
}

export { ProviderError };
