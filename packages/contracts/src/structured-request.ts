import { z } from "zod";
import { DeliverableType, Id, IsoTimestamp } from "./common.js";
import { WorkKind } from "./project.js";

/**
 * Saída do Intake Engine (etapa 1).
 * Converte o texto leigo do usuário em uma solicitação estruturada.
 */

/** Uma dúvida que o sistema pode devolver ao usuário antes de prosseguir. */
export const Question = z.object({
  id: Id,
  /** Pergunta em pt-BR, linguagem acessível ao leigo. */
  text: z.string().min(1),
  /** Por que a resposta importa (ajuda o usuário a decidir). */
  why: z.string().optional(),
  /** Opções sugeridas, se a pergunta for de múltipla escolha. */
  options: z.array(z.string()).optional(),
  /** Se true, o pipeline não avança sem resposta. */
  blocking: z.boolean().default(false),
});
export type Question = z.infer<typeof Question>;

export const StructuredRequest = z.object({
  id: Id,
  createdAt: IsoTimestamp,
  /** Texto original do usuário, preservado sem alteração. */
  rawPrompt: z.string().min(1),
  /** Reescrita técnica da intenção (o que o usuário quer, em termos de engenharia). */
  translatedIntent: z.string().min(1),
  /** Tipo de intervenção (feature, bugfix, refactor, ui-adjustment...). */
  workKind: WorkKind,
  /** Projeto alvo do trabalho. Ausente só em new-project sem slug ainda. */
  projectSlug: Id.optional(),
  /** Domínio de negócio (ex.: "saúde", "financeiro", "educação"). */
  domain: z.string(),
  deliverableType: DeliverableType,
  /** Restrições explícitas ou inferidas (ex.: "precisa rodar offline"). */
  constraints: z.array(z.string()).default([]),
  /** Suposições assumidas para resolver ambiguidades. */
  assumptions: z.array(z.string()).default([]),
  /** Artefatos citados pelo usuário (arquivos, sistemas, integrações). */
  mentionedArtifacts: z.array(z.string()).default([]),
  /** Dúvidas a devolver ao usuário. */
  openQuestions: z.array(Question).default([]),
});
export type StructuredRequest = z.infer<typeof StructuredRequest>;
