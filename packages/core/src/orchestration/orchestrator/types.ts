/** Config operacional do orquestrador (derivada de platform.yaml + strategy). */
export interface OrchestratorConfig {
  concurrency: number;
  backoffBaseMs: number;
  backoffFactor: number;
  backoffMaxMs: number;
  leaseGraceMs: number;
  maxEscalations: number;
  /** Teto de segurança de ticks (anti-loop). */
  maxTicks: number;
}

/** Resultado de um passo do scheduler. */
export interface TickReport {
  claimed: number;
  completed: number;
  failed: number;
  escalated: number;
  promoted: number;
  blocked: number;
  active: number;
  runPaused: boolean;
}

export type RunFinalState = "done" | "paused" | "failed";

export interface RunOutcome {
  state: RunFinalState;
  done: number;
  escalated: number;
  blocked: number;
  ticks: number;
}

/** Decisão do Retry Manager para uma falha. */
export type RetryDecision =
  | { kind: "retry"; notBefore: string; tierBump: boolean }
  | { kind: "escalate" };
