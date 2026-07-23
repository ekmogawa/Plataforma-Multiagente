import { z } from "zod";
import { ComplexityScore, Id } from "./common.js";
import { AcceptanceCriterion } from "./plan.js";

/**
 * TaskSpec — a unidade que o orquestrador agenda e despacha.
 *
 * A Camada 1 produz `PlannedTask` (ver planned-task.ts) — o TaskSpec sem
 * executor. A Camada 2 (Task Router) deriva o TaskSpec: escolhe
 * executorKind/executorId/capability e recomputa timeoutMs/maxRetries.
 */

export const TaskType = z.enum([
  "backend",
  "frontend",
  "database",
  "test",
  "docs",
  "devops",
  "analysis",
]);
export type TaskType = z.infer<typeof TaskType>;

/**
 * Determinístico (scripts, zero tokens) vem primeiro por eficiência;
 * llm só quando a tarefa realmente exige raciocínio.
 */
export const ExecutorKind = z.enum(["deterministic", "llm"]);
export type ExecutorKind = z.infer<typeof ExecutorKind>;

/** Referência a um pedaço de contexto que a tarefa precisa. */
export const ContextRef = z.object({
  kind: z.enum(["file", "doc", "decision", "schema", "graph"]),
  /** Caminho ou identificador do recurso. */
  ref: z.string(),
});
export type ContextRef = z.infer<typeof ContextRef>;

export const TaskSpec = z.object({
  id: Id,
  /** Nó do plano que originou esta tarefa. */
  planNodeId: Id,
  runId: Id,
  /** Projeto alvo — a tarefa opera sobre o repo deste projeto. */
  projectSlug: Id,
  type: TaskType,
  executorKind: ExecutorKind,
  /** Id do componente executor no registro (ex.: "worker.scaffold"). */
  executorId: Id,
  /** Capacidade pedida (só para executorKind = "llm"); o resolver escolhe o modelo. */
  capability: z.string().optional(),
  complexity: ComplexityScore,
  input: z.object({
    /** Arquivos que a tarefa deve criar ou alterar. */
    files: z.array(z.string()).default([]),
    /** Instrução principal para o executor. */
    instructions: z.string().min(1),
    contextRefs: z.array(ContextRef).default([]),
  }),
  acceptanceCriteria: z.array(AcceptanceCriterion).default([]),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(1).max(4),
});
export type TaskSpec = z.infer<typeof TaskSpec>;
