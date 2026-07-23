import { z } from "zod";
import { Id } from "./common.js";

/**
 * Saída do Understanding Engine (etapa 2).
 * Transforma a solicitação em requisitos de engenharia.
 */

export const RequirementKind = z.enum(["functional", "non-functional"]);
export type RequirementKind = z.infer<typeof RequirementKind>;

export const Priority = z.enum(["must", "should", "could", "wont"]);
export type Priority = z.infer<typeof Priority>;

export const Requirement = z.object({
  id: Id,
  kind: RequirementKind,
  /** Descrição do requisito em pt-BR. */
  text: z.string().min(1),
  priority: Priority.default("should"),
  /** De onde veio: "usuário", "inferido", "padrão do projeto". */
  source: z.string().default("inferido"),
  /** Requisitos dos quais este depende. */
  dependsOn: z.array(Id).default([]),
});
export type Requirement = z.infer<typeof Requirement>;

/** Documento consolidado do entendimento. */
export const UnderstandingReport = z.object({
  requestId: Id,
  requirements: z.array(Requirement),
  risks: z.array(z.string()).default([]),
  externalDependencies: z.array(z.string()).default([]),
  ambiguities: z.array(z.string()).default([]),
  expectedImpact: z.string().optional(),
});
export type UnderstandingReport = z.infer<typeof UnderstandingReport>;
