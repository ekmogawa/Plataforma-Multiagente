import { z } from "zod";

/**
 * Validador de `config/platform.yaml` — parâmetros operacionais do orquestrador,
 * orçamento, escalonamento e construção de contexto. Config validator (fail-fast),
 * fora do SCHEMA_REGISTRY.
 */
export const PlatformConfig = z.object({
  orchestrator: z.object({
    tickMs: z.number().int().positive().default(500),
    defaultConcurrency: z.number().int().min(1).max(16).default(3),
    defaultTaskTimeoutMs: z.number().int().positive().default(300000),
    retryBackoff: z.object({
      baseMs: z.number().int().nonnegative().default(2000),
      factor: z.number().positive().default(2),
      maxMs: z.number().int().positive().default(60000),
    }),
    /** Folga somada ao timeout para o lease (detecção de órfãos). */
    leaseGraceMs: z.number().int().nonnegative().default(5000),
  }),
  budget: z.object({
    warnAtFraction: z.number().min(0).max(1).default(0.6),
    pauseAtFraction: z.number().min(0).max(1).default(0.8),
  }),
  escalation: z.object({
    maxPerRun: z.number().int().positive().default(3),
  }),
  context: z
    .object({
      maxTokensPerTask: z.number().int().positive().default(8000),
      maxFileBytes: z.number().int().positive().default(32000),
      maxNeighbors: z.number().int().nonnegative().default(12),
    })
    .default({}),
});
export type PlatformConfig = z.infer<typeof PlatformConfig>;
