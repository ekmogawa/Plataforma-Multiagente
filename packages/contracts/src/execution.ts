import { z } from "zod";
import { Id } from "./common.js";

/**
 * ExecutionResult — o que um worker devolve após executar uma tarefa.
 */

export const FileAction = z.enum(["created", "modified", "deleted"]);
export type FileAction = z.infer<typeof FileAction>;

/** Um arquivo alterado por uma tarefa (não confundir com Artifact do Artifact Store). */
export const ChangedFile = z.object({
  path: z.string(),
  action: FileAction,
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const TokenUsage = z.object({
  in: z.number().int().nonnegative(),
  out: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export const ExecutionStatus = z.enum(["success", "failure", "timeout"]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const ExecutionResult = z.object({
  taskId: Id,
  attempt: z.number().int().positive(),
  status: ExecutionStatus,
  changedFiles: z.array(ChangedFile).default([]),
  logs: z.string().default(""),
  /** Ausente para executores determinísticos (zero tokens). */
  tokenUsage: TokenUsage.optional(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().int().nonnegative(),
  /** Preenchido em falha: resumo do erro para injetar no retry. */
  errorSummary: z.string().optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResult>;
