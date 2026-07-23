import type { ExecutionResult, TaskContext, TaskSpec } from "@pm/contracts";

/**
 * ExecutorPort — a interface ÚNICA de execução. worker.echo (Camada 2) e o
 * Deterministic/LLM Engine (Camada 3) a implementam. O dispatcher SEMPRE faz
 * registry.get(spec.executorId).execute(input) e NUNCA ramifica por `kind`
 * (kind é só metadado/observabilidade). É o que deixa a Camada 3 plugável sem
 * tocar no orquestrador.
 */
export interface ExecutorInput {
  spec: TaskSpec;
  /** Contexto mínimo montado pelo Context Builder. echo ignora. */
  context: TaskContext;
  /** 1-based; ecoado em ExecutionResult.attempt. */
  attempt: number;
  /** Prazo (ISO = lease_expires). Engines reais abortam ao ultrapassá-lo. */
  deadline: string;
  signal?: AbortSignal;
}

export type ExecutorKind = "deterministic" | "llm";

export interface ExecutorPort {
  /** Casa com TaskSpec.executorId (ex.: "worker.echo"). */
  readonly id: string;
  /** Metadado; o dispatch nunca decide por isto. */
  readonly kind: ExecutorKind;
  execute(input: ExecutorInput): Promise<ExecutionResult>;
}

export class UnknownExecutorError extends Error {}
