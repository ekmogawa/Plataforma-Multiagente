import { z } from "zod";
import { ComplexityScore, Id } from "./common.js";
import { AcceptanceCriterion } from "./plan.js";
import { ContextRef, TaskType } from "./task.js";

/**
 * PlannedTask — a tarefa como a Camada 1 (Cognitiva) a conhece: tudo que é
 * determinístico sobre uma tarefa-folha do plano, **sem executor**.
 *
 * É o TaskSpec MENOS { executorKind, executorId, capability, timeoutMs,
 * maxRetries }. A Camada 2 (Task Router) deriva o TaskSpec a partir daqui:
 * escolhe executor/capacidade e recomputa timeoutMs (tabela por complexidade)
 * e maxRetries (strategy.maxRetries). A Camada 1 genuinamente não sabe o
 * executor — evitamos placeholders mentirosos em artefatos auditáveis.
 */
export const PlannedTask = z.object({
  id: Id,
  /** Nó do plano (folha) que originou esta tarefa. */
  planNodeId: Id,
  runId: Id,
  /** Projeto alvo — a tarefa opera sobre o repo deste projeto. */
  projectSlug: Id,
  type: TaskType,
  complexity: ComplexityScore,
  input: z.object({
    files: z.array(z.string()).default([]),
    instructions: z.string().min(1),
    contextRefs: z.array(ContextRef).default([]),
  }),
  acceptanceCriteria: z.array(AcceptanceCriterion).default([]),
});
export type PlannedTask = z.infer<typeof PlannedTask>;
