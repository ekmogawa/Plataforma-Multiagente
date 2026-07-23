import type { TaskState } from "@pm/contracts";

/**
 * Tabela de transições válidas de TaskState — a documentação normativa das
 * transições. As mudanças de estado atômicas são impostas pelos WHERE clauses do
 * TasksRepo (ex.: claim WHERE state='ready', promote WHERE state='pending'), que
 * são a garantia real em processo único. Esta tabela é verificada por teste e
 * disponível via assertTransition para checagens defensivas onde o estado-origem
 * é conhecido. Estados terminais (done/failed/cancelled/escalated/blocked) não têm saída.
 */
export const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending: ["ready", "blocked", "cancelled"],
  ready: ["running", "blocked", "cancelled"],
  running: ["validating", "retrying", "escalated", "failed"],
  validating: ["done", "retrying", "escalated"],
  retrying: ["ready", "blocked", "cancelled"],
  escalated: [], // aguarda decisão humana (Governança/Camada futura)
  blocked: [], // predecessor falhou
  done: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: TaskState, to: TaskState) {
    super(`Transição de tarefa ilegal: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
