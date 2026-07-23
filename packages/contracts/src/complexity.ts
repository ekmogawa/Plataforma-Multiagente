import { z } from "zod";
import { ComplexityScore, Id } from "./common.js";

/**
 * Saída do Complexity Estimator (etapa 3).
 * Classifica objetivamente a complexidade de cada item.
 */

/** Fatores que empurram a complexidade para cima. */
export const ComplexityDriver = z.enum([
  "size", // tamanho esperado da alteração
  "modules", // quantidade de módulos afetados
  "architecture", // impacto arquitetural
  "external-deps", // dependências externas
  "technical-risk", // risco técnico
  "migration", // necessidade de migração de dados
  "security", // superfície de segurança
]);
export type ComplexityDriver = z.infer<typeof ComplexityDriver>;

export const ComplexityAssessment = z.object({
  /** Id do item avaliado (requisito, épico ou o request inteiro). */
  itemId: Id,
  score: ComplexityScore,
  drivers: z.array(ComplexityDriver).default([]),
  /** Justificativa em pt-BR do score atribuído. */
  rationale: z.string().min(1),
  /** Custo estimado em tokens, quando aplicável. */
  estimatedTokens: z.number().int().nonnegative().optional(),
});
export type ComplexityAssessment = z.infer<typeof ComplexityAssessment>;
