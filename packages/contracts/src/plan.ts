import { z } from "zod";
import { Id } from "./common.js";

/**
 * Saída do Planning Engine (etapa 5).
 * Árvore épico → funcionalidade → tarefa → subtarefa.
 */

/** Como um critério de aceite é verificado. */
export const CheckKind = z.enum([
  "script", // execução determinística (preferido)
  "llm", // avaliação qualitativa por modelo
  "manual", // vai para o resumo de aprovação do usuário
]);
export type CheckKind = z.infer<typeof CheckKind>;

export const AcceptanceCriterion = z.object({
  id: Id,
  /** Critério em pt-BR, verificável. */
  text: z.string().min(1),
  checkKind: CheckKind,
  /** Comando ou expressão a executar, quando checkKind = "script". */
  check: z.string().optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const PlanNodeKind = z.enum(["epic", "feature", "task", "subtask"]);
export type PlanNodeKind = z.infer<typeof PlanNodeKind>;

/**
 * Nó do plano. Auto-recursivo (children são PlanNode).
 * zod precisa de tipos explícitos para recursão. Como usamos `.default()`,
 * entrada e saída diferem (campos opcionais na entrada, preenchidos na saída),
 * então declaramos os dois lados.
 */
export type PlanNode = {
  id: string;
  kind: PlanNodeKind;
  title: string;
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
  dependsOn: string[];
  children: PlanNode[];
};

export type PlanNodeInput = {
  id: string;
  kind: PlanNodeKind;
  title: string;
  description?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  dependsOn?: string[];
  children?: PlanNodeInput[];
};

export const PlanNode: z.ZodType<PlanNode, z.ZodTypeDef, PlanNodeInput> = z.lazy(
  () =>
    z.object({
      id: Id,
      kind: PlanNodeKind,
      title: z.string().min(1),
      description: z.string().default(""),
      acceptanceCriteria: z.array(AcceptanceCriterion).default([]),
      dependsOn: z.array(Id).default([]),
      children: z.array(PlanNode).default([]),
    }),
);

/** Plano completo de um run. */
export const Plan = z.object({
  requestId: Id,
  /** Raízes da árvore (normalmente épicos, ou tarefas se planningDepth = flat). */
  roots: z.array(PlanNode),
});
export type Plan = z.infer<typeof Plan>;
