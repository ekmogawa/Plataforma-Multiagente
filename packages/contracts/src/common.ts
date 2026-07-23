import { z } from "zod";

/**
 * Primitivos compartilhados por todos os contratos.
 *
 * Mantenha aqui apenas o que é realmente transversal (ids, camadas, tiers).
 * Formas específicas de cada etapa ficam em seus próprios arquivos.
 */

/** Identificador curto e estável (ex.: "run_a1b2c3", "task_017"). */
export const Id = z.string().min(1);

/** Timestamp ISO-8601 em UTC. */
export const IsoTimestamp = z.string().datetime();

/**
 * Camadas da plataforma. As cinco primeiras são o pipeline (o plano original);
 * `infrastructure` hospeda o que é transversal (adaptadores, banco, CLI).
 * Espelha `registry/components/*.yaml`.
 */
export const Layer = z.enum([
  "cognitive",
  "orchestration",
  "execution",
  "governance",
  "knowledge",
  "infrastructure",
]);
export type Layer = z.infer<typeof Layer>;

/** Faixa de custo/capacidade de um modelo. */
export const ModelTier = z.enum(["cheap", "mid", "premium"]);
export type ModelTier = z.infer<typeof ModelTier>;

/** Referência a um modelo resolvido pelo Task Router. */
export const ModelRef = z.object({
  /** Chave em `config/models.yaml` (ex.: "deepseek-flash", "claude-code"). */
  id: Id,
  provider: z.string(),
  tier: ModelTier,
});
export type ModelRef = z.infer<typeof ModelRef>;

/** Perfil de execução derivado da complexidade. */
export const StrategyProfile = z.enum([
  "trivial",
  "standard",
  "complex",
  "critical",
]);
export type StrategyProfile = z.infer<typeof StrategyProfile>;

/** Score de complexidade de 1 (trivial) a 5 (crítico). */
export const ComplexityScore = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type ComplexityScore = z.infer<typeof ComplexityScore>;

/** Tipo de entregável que o usuário pediu. */
export const DeliverableType = z.enum([
  "webapp",
  "api",
  "script",
  "automation",
  "library",
  "other",
]);
export type DeliverableType = z.infer<typeof DeliverableType>;
