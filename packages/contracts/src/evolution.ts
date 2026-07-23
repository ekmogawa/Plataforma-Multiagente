import { z } from "zod";
import { Id, IsoTimestamp } from "./common.js";

/**
 * Evolução (Camada 5) — a auto-melhoria da plataforma.
 *
 * O Evolution Engine lê as métricas acumuladas e propõe melhorias como DIFFS
 * PRONTOS para alvos concretos (uma capacidade em models.yaml, um prompt, uma
 * estratégia). GUARDRAIL v1: nada é aplicado sem aprovação humana — o motor só
 * propõe. `source` deixa explícito se a proposta é mecânica (offline) ou refinada
 * por modelo (honestidade: offline nunca "inventa" uma justificativa de IA).
 */

/** O que a proposta muda. */
export const EvolutionTargetKind = z.enum(["capability", "prompt", "strategy", "especialidade"]);
export type EvolutionTargetKind = z.infer<typeof EvolutionTargetKind>;

export const EvolutionCategory = z.enum([
  "routing",
  "prompt-revision",
  "strategy-tuning",
  "cost-optimization",
]);
export type EvolutionCategory = z.infer<typeof EvolutionCategory>;

export const Confidence = z.enum(["baixa", "media", "alta"]);
export type Confidence = z.infer<typeof Confidence>;

/** De onde veio a proposta — mecânica (determinística) ou refinada por modelo. */
export const ProposalSource = z.enum(["heuristica", "llm"]);
export type ProposalSource = z.infer<typeof ProposalSource>;

/** A evidência métrica que sustenta a proposta (rastreável até metric_events). */
export const EvolutionEvidence = z.object({
  metric: z.string(),
  scope: z.string(),
  sampleSize: z.number().int().nonnegative(),
  value: z.number(),
  baseline: z.number().optional(),
  window: z.string().default("all-time"),
  /** Ids/critério dos metric_events que embasam (rastreabilidade). */
  metricRefs: z.array(z.string()).default([]),
});
export type EvolutionEvidence = z.infer<typeof EvolutionEvidence>;

export const EvolutionProposal = z.object({
  id: Id,
  createdAt: IsoTimestamp,
  target: z.object({
    kind: EvolutionTargetKind,
    file: z.string(),
    /** Âncora dentro do arquivo (ex.: nome da capacidade, id do prompt). */
    locator: z.string(),
  }),
  category: EvolutionCategory,
  /** Justificativa em pt-BR. */
  rationale: z.string(),
  /** Diff unificado PRONTO ("" = proposta consultiva, sem patch automático). */
  diff: z.string().default(""),
  evidence: EvolutionEvidence,
  confidence: Confidence,
  source: ProposalSource,
  status: z.enum(["proposed", "applied", "dismissed"]).default("proposed"),
});
export type EvolutionProposal = z.infer<typeof EvolutionProposal>;

export const EvolutionReport = z.object({
  generatedAt: IsoTimestamp,
  window: z.string(),
  totals: z.object({
    metricsAnalyzed: z.number().int().nonnegative(),
    proposals: z.number().int().nonnegative(),
  }),
  proposals: z.array(EvolutionProposal).default([]),
});
export type EvolutionReport = z.infer<typeof EvolutionReport>;
