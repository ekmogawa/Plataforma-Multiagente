import {
  CodeChangeSet,
  type ExecutionResult,
  type ModelsConfig,
  type ProjectTarget,
} from "@pm/contracts";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CapabilityResolver } from "../../adapters/capability-resolver.js";
import type { CompletionRequest } from "../../adapters/model-port.js";
import type { ArtifactStore } from "../../artifacts/artifact-store.js";
import { isExecutable } from "../../cognitive/mode.js";
import { renderPrompt } from "../../cognitive/prompt-builder.js";
import { loadPrompt } from "../../cognitive/prompt-library.js";
import type { StageModelGateway } from "../../cognitive/stage.js";
import { CacheRepo } from "../../db/cache-repo.js";
import type { MetricsRepo } from "../../db/metrics-repo.js";
import type { Clock } from "../../shared/clock.js";
import { log } from "../../shared/logger.js";
import { applyChangeSet } from "../apply-changeset.js";
import { buildExecVars, especialidadeFor } from "../exec-prompt.js";
import type { ExecutorInput, ExecutorPort } from "../executor-port.js";
import type { EspecialidadesConfig } from "@pm/contracts";

/**
 * worker.llm — o code-writer da v1. Especialidade -> prompt + TaskContext ->
 * modelo (OmniRouter/openai) -> CodeChangeSet {files} validado (zod + 1 reparo)
 * -> aplicado com segurança (applyChangeSet confina no projeto). OFFLINE (sem
 * chave) devolve failure imediata e HONESTA — nunca fabrica código. O
 * worker.claude-agent (Agent SDK) é v-futura.
 */
export interface LlmWorkerDeps {
  target: ProjectTarget;
  especialidades: EspecialidadesConfig;
  capabilityResolver: CapabilityResolver;
  gateway: StageModelGateway;
  modelsConfig: ModelsConfig;
  artifacts: ArtifactStore;
  metrics: MetricsRepo;
  cache: CacheRepo;
  clock: Clock;
  /** Raiz do repo (para carregar prompts). */
  root?: string;
}

export class LlmWorker implements ExecutorPort {
  readonly id = "worker.llm";
  readonly kind = "llm" as const;

  constructor(private readonly d: LlmWorkerDeps) {}

  async execute(input: ExecutorInput): Promise<ExecutionResult> {
    const { spec, context, attempt } = input;
    const base = { taskId: spec.id, attempt, changedFiles: [], durationMs: 0 };

    const esp = especialidadeFor(spec, this.d.especialidades);
    if (!esp) {
      return { ...base, status: "failure", logs: "", errorSummary: `tipo "${spec.type}" sem especialidade configurada` };
    }
    const capability = spec.capability ?? esp.capability;

    // Guarda offline: sem modelo executável, falha já (sem queimar tokens).
    let model: string;
    try {
      model = this.d.capabilityResolver.resolve(capability, { complexity: spec.complexity }).model;
    } catch {
      return { ...base, status: "failure", logs: "", errorSummary: `capacidade "${capability}" não configurada` };
    }
    if (!isExecutable(model, this.d.modelsConfig)) {
      return {
        ...base,
        status: "failure",
        logs: "",
        errorSummary: `offline: sem chave/adaptador para "${capability}" (modelo ${model}). Configure a chave para gerar código.`,
      };
    }

    const started = this.d.clock.monotonicMs();
    let prompt;
    try {
      prompt = loadPrompt(esp.prompt, this.d.root);
    } catch (err) {
      return { ...base, status: "failure", logs: "", errorSummary: `prompt "${esp.prompt}" ausente: ${err instanceof Error ? err.message : String(err)}` };
    }
    const rendered = renderPrompt(prompt, buildExecVars(spec, context));

    this.d.artifacts.store({
      runId: spec.runId,
      taskId: spec.id,
      kind: "prompt",
      name: `exec-${spec.id}-prompt`,
      content: `# system\n${rendered.system}\n\n# user\n${rendered.user}`,
      meta: { promptId: rendered.promptId, promptVersion: rendered.version },
    });

    const jsonSchema = zodToJsonSchema(CodeChangeSet, { name: "CodeChangeSet" }) as Record<string, unknown>;
    // attempt entra na chave: cada TENTATIVA é uma chamada fresca (o retry precisa
    // de variação — não repetir a saída quebrada). Re-dispatch da MESMA tentativa
    // (crash/resume) ainda aproveita o cache.
    const cacheKey = CacheRepo.keyFor({
      model,
      system: rendered.system,
      user: rendered.user,
      schema: `${JSON.stringify(jsonSchema)}#attempt${attempt}`,
    });

    let raw: unknown = this.d.cache.get(cacheKey);
    let usage = { in: 0, out: 0 };
    let costUsd = 0;
    let usedModel = model;

    if (raw === undefined) {
      const req: CompletionRequest = {
        system: rendered.system,
        messages: [{ role: "user", content: rendered.user }],
        jsonSchema,
      };
      const res = await this.d.gateway.completeWithFallback(model, req);
      usedModel = res.model;
      usage = { in: res.usage.in, out: res.usage.out };
      costUsd = res.costUsd;
      raw = res.parsed ?? tryParse(res.text);
      this.d.artifacts.store({
        runId: spec.runId,
        taskId: spec.id,
        kind: "response",
        name: `exec-${spec.id}-response`,
        content: typeof res.text === "string" ? res.text : JSON.stringify(raw),
        meta: { model: usedModel },
      });
    }

    let parsed = CodeChangeSet.safeParse(raw);
    if (!parsed.success) {
      // 1 reparo (mesmo padrão do runStage cognitivo); soma o custo do reparo.
      const rep = await this.repair(
        raw,
        parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n"),
        jsonSchema,
      );
      raw = rep.value;
      usage = { in: usage.in + rep.usageIn, out: usage.out + rep.usageOut };
      costUsd += rep.costUsd;
      parsed = CodeChangeSet.safeParse(raw);
      if (!parsed.success) {
        this.d.metrics.record({
          ts: this.d.clock.now(),
          kind: "llm_call",
          runId: spec.runId,
          taskId: spec.id,
          model: usedModel,
          tokensIn: usage.in,
          tokensOut: usage.out,
          costUsd,
          durationMs: this.d.clock.monotonicMs() - started,
          success: false,
          meta: { worker: "llm", reason: "schema" },
        });
        return { ...base, status: "failure", logs: "", errorSummary: `saída do modelo fora do schema CodeChangeSet mesmo após reparo` };
      }
    }
    this.d.cache.set(cacheKey, parsed.data);

    // Aplica com segurança (confina no projeto).
    let changedFiles;
    try {
      changedFiles = applyChangeSet(parsed.data.files, this.d.target);
    } catch (err) {
      return { ...base, status: "failure", logs: "", errorSummary: `falha ao aplicar mudanças: ${err instanceof Error ? err.message : String(err)}` };
    }

    const durationMs = this.d.clock.monotonicMs() - started;
    this.d.metrics.record({
      ts: this.d.clock.now(),
      kind: "llm_call",
      runId: spec.runId,
      taskId: spec.id,
      model: usedModel,
      tokensIn: usage.in,
      tokensOut: usage.out,
      costUsd,
      durationMs,
      success: true,
      meta: { worker: "llm", files: changedFiles.length },
    });

    return {
      taskId: spec.id,
      attempt,
      status: "success",
      changedFiles,
      logs: parsed.data.notes ?? `${changedFiles.length} arquivo(s) alterados`,
      tokenUsage: { in: usage.in, out: usage.out, cacheRead: 0 },
      costUsd,
      durationMs,
    };
  }

  private async repair(
    bad: unknown,
    issues: string,
    jsonSchema: Record<string, unknown>,
  ): Promise<{ value: unknown; usageIn: number; usageOut: number; costUsd: number }> {
    try {
      const decision = this.d.capabilityResolver.resolve("repair");
      const res = await this.d.gateway.completeWithFallback(decision.model, {
        system: "Você corrige JSON para aderir ao schema CodeChangeSet. Responda só com o JSON corrigido.",
        messages: [{ role: "user", content: `Saída inválida:\n${JSON.stringify(bad)}\n\nErros:\n${issues}` }],
        jsonSchema,
      });
      return {
        value: res.parsed ?? tryParse(res.text),
        usageIn: res.usage.in,
        usageOut: res.usage.out,
        costUsd: res.costUsd,
      };
    } catch (err) {
      log.warn(`Reparo do CodeChangeSet falhou: ${err instanceof Error ? err.message : String(err)}`);
      return { value: bad, usageIn: 0, usageOut: 0, costUsd: 0 };
    }
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
