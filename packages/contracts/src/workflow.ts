import { z } from "zod";
import { Id } from "./common.js";

/**
 * Saída do Workflow Generator (etapa 6) e estado vivo do orquestrador.
 * Um DAG: tarefas independentes podem rodar em paralelo.
 */

export const TaskState = z.enum([
  "pending", // aguardando dependências
  "ready", // dependências satisfeitas, pronta para despacho
  "running", // em execução
  "validating", // executada, em validação pelo Acceptance Engine
  "done", // concluída e aprovada
  "failed", // falhou dentro do limite de retries
  "retrying", // aguardando nova tentativa (backoff)
  "escalated", // esgotou retries, aguardando decisão do Project Manager
  "blocked", // dependência falhou; não pode executar
  "cancelled", // cancelada (ex.: run pausado por orçamento)
]);
export type TaskState = z.infer<typeof TaskState>;

export const WorkflowNode = z.object({
  taskId: Id,
  state: TaskState,
  /** Contador de dependências ainda não concluídas. Chega a 0 → ready. */
  dependsRemaining: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative().default(0),
});
export type WorkflowNode = z.infer<typeof WorkflowNode>;

export const WorkflowEdge = z.object({
  /** Tarefa que precisa terminar antes de `to`. */
  from: Id,
  to: Id,
});
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

export const WorkflowDAG = z.object({
  runId: Id,
  nodes: z.array(WorkflowNode),
  edges: z.array(WorkflowEdge),
});
export type WorkflowDAG = z.infer<typeof WorkflowDAG>;
