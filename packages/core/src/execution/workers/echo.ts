import type { ExecutionResult } from "@pm/contracts";
import type { ExecutorInput, ExecutorPort } from "../executor-port.js";

/**
 * EchoWorker — executor FALSO determinístico da Camada 2. Sucesso instantâneo
 * por padrão (durationMs=0, zero tokens); pode ser instruído a falhar/timeoutar
 * tarefas específicas, ou a falhar até uma tentativa N (para exercitar a escada
 * de retry sem tempo de parede). Nenhum LLM.
 */
export interface EchoWorkerOptions {
  /** Ids que sempre falham (exercita escalonamento). */
  failTaskIds?: Set<string>;
  /** Ids que sempre "estouram" o timeout. */
  timeoutTaskIds?: Set<string>;
  /** Id -> falha enquanto attempt < N; a partir de N tem sucesso (retry vira ok). */
  failUntilAttempt?: Map<string, number>;
}

export class EchoWorker implements ExecutorPort {
  readonly id = "worker.echo";
  readonly kind = "deterministic" as const;

  constructor(private readonly opts: EchoWorkerOptions = {}) {}

  async execute(input: ExecutorInput): Promise<ExecutionResult> {
    const { spec, attempt } = input;
    const base = {
      taskId: spec.id,
      attempt,
      changedFiles: [],
      durationMs: 0,
    };

    if (this.opts.timeoutTaskIds?.has(spec.id)) {
      return { ...base, status: "timeout", logs: "", errorSummary: "timeout forçado (echo)" };
    }
    if (this.opts.failTaskIds?.has(spec.id)) {
      return { ...base, status: "failure", logs: "", errorSummary: "falha forçada (echo)" };
    }
    const failUntil = this.opts.failUntilAttempt?.get(spec.id);
    if (failUntil !== undefined && attempt < failUntil) {
      return {
        ...base,
        status: "failure",
        logs: "",
        errorSummary: `falha até a tentativa ${failUntil} (echo)`,
      };
    }
    return { ...base, status: "success", logs: `echo ok: ${spec.id}` };
  }
}
