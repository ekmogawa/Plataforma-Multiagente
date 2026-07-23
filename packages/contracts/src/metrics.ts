import { z } from "zod";
import { Id, IsoTimestamp } from "./common.js";

/**
 * MetricEvent — toda chamada LLM e todo resultado de tarefa vira uma linha.
 * É o combustível do Evolution Engine (auto-evolução).
 */

export const MetricKind = z.enum([
  "llm_call",
  "task_result",
  "validation",
  "retry",
  "gate",
  "cache_hit",
  "escalation",
]);
export type MetricKind = z.infer<typeof MetricKind>;

export const MetricEvent = z.object({
  ts: IsoTimestamp,
  kind: MetricKind,
  runId: Id.optional(),
  taskId: Id.optional(),
  /** Modelo usado (para métricas por modelo). */
  model: z.string().optional(),
  promptId: Id.optional(),
  promptVersion: z.number().int().positive().optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  success: z.boolean().optional(),
  /** Campos livres específicos do evento. */
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type MetricEvent = z.infer<typeof MetricEvent>;
