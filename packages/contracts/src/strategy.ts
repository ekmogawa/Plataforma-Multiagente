import { z } from "zod";
import { ModelTier, StrategyProfile } from "./common.js";

/**
 * Saída do Strategy Selector (etapa 4).
 * Determinístico: um lookup em `config/strategies.yaml` a partir da complexidade.
 * Define como o restante do pipeline se comporta.
 */

export const PlanningDepth = z.enum(["flat", "epics", "full"]);
export type PlanningDepth = z.infer<typeof PlanningDepth>;

export const ValidationLevel = z.enum(["smoke", "standard", "strict"]);
export type ValidationLevel = z.infer<typeof ValidationLevel>;

export const ExecutionStrategy = z.object({
  profile: StrategyProfile,
  /** Profundidade do plano: só tarefas, épicos, ou hierarquia completa. */
  planningDepth: PlanningDepth,
  /** Rigor da validação aplicada aos artefatos gerados. */
  validationLevel: ValidationLevel,
  /** Teto de custo de modelo que o Task Router não pode ultrapassar. */
  modelTierCeiling: ModelTier,
  /** Máximo de tentativas por tarefa antes de escalar ao Project Manager. */
  maxRetries: z.number().int().min(1).max(4),
  /** Orçamento de tokens do run inteiro. */
  budgetTokens: z.number().int().positive(),
  /** Concorrência de tarefas dentro do run. */
  concurrency: z.number().int().min(1).max(8).default(3),
  /** Se true, exige aprovação humana antes do merge. */
  requiresHumanApproval: z.boolean().default(true),
});
export type ExecutionStrategy = z.infer<typeof ExecutionStrategy>;

/**
 * Validador de `config/strategies.yaml`. Config inválida falha cedo, com
 * mensagem clara — não em runtime no meio de um plano.
 */
const StrategyScore = z.enum(["1", "2", "3", "4", "5"]);

const ProfileEntry = z.object({
  planningDepth: PlanningDepth,
  validationLevel: ValidationLevel,
  modelTierCeiling: ModelTier,
  maxRetries: z.number().int().min(1).max(4),
  budgetTokens: z.number().int().positive(),
  concurrency: z.number().int().min(1).max(8).optional(),
  requiresHumanApproval: z.boolean().optional(),
});

export const StrategiesConfig = z
  .object({
    scoreToProfile: z.record(StrategyScore, StrategyProfile),
    profiles: z.record(StrategyProfile, ProfileEntry),
  })
  .superRefine((cfg, ctx) => {
    // Todo score 1..5 precisa de mapeamento...
    for (const score of ["1", "2", "3", "4", "5"] as const) {
      if (!(score in cfg.scoreToProfile)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `scoreToProfile não mapeia o score ${score}.`,
        });
      }
    }
    // ...e todo perfil referenciado precisa existir.
    for (const [score, profile] of Object.entries(cfg.scoreToProfile)) {
      if (!(profile in cfg.profiles)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `score ${score} referencia o perfil inexistente "${profile}".`,
        });
      }
    }
  });
export type StrategiesConfig = z.infer<typeof StrategiesConfig>;
