import { z } from "zod";
import { Id, ModelRef } from "./common.js";

/**
 * Context Builder (etapa 9a) e Prompt Builder (etapa 9b).
 * O contexto é reduzido ao mínimo relevante, com orçamento de tokens.
 */

export const ContextFile = z.object({
  path: z.string(),
  /** Conteúdo completo ou resumo, conforme o modo. */
  content: z.string(),
  mode: z.enum(["full", "summary"]),
});
export type ContextFile = z.infer<typeof ContextFile>;

export const TaskContext = z.object({
  taskId: Id,
  files: z.array(ContextFile).default([]),
  /** Nomes de schemas/contratos relevantes para a tarefa. */
  contracts: z.array(z.string()).default([]),
  /** Convenções do projeto que a tarefa deve seguir. */
  conventions: z.array(z.string()).default([]),
  /** Decisões anteriores relevantes (da base de conhecimento). */
  priorDecisions: z.array(z.string()).default([]),
  /**
   * Resumo da falha da tentativa anterior (do último ValidationReport reprovado).
   * Preenchido a partir da 2ª tentativa para o executor corrigir o erro.
   */
  priorFailure: z.string().optional(),
  /** Estimativa de tokens deste contexto (enforcement de orçamento). */
  estimatedTokens: z.number().int().nonnegative(),
});
export type TaskContext = z.infer<typeof TaskContext>;

/** Pacote pronto para envio ao modelo executor. */
export const PromptPackage = z.object({
  taskId: Id,
  /** Id do prompt na biblioteca (ex.: "backend/implementar-endpoint"). */
  promptId: Id,
  /** Versão do prompt usada (rastreabilidade para o Evolution Engine). */
  promptVersion: z.number().int().positive(),
  system: z.string(),
  user: z.string(),
  model: ModelRef,
});
export type PromptPackage = z.infer<typeof PromptPackage>;
