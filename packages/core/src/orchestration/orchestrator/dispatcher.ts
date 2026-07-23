import type { ExecutionResult, TaskContext, TaskSpec } from "@pm/contracts";
import type { ExecutorRegistry } from "../../execution/executor-registry.js";

/**
 * Dispatcher — resolve o executor por executorId e o executa. SEMPRE resolve
 * para um ExecutionResult: exceções viram status 'failure' (nunca derruba o
 * loop). NUNCA ramifica por executorKind (plugabilidade da Camada 3).
 */
export class Dispatcher {
  constructor(private readonly registry: ExecutorRegistry) {}

  async dispatch(
    spec: TaskSpec,
    context: TaskContext,
    attempt: number,
    deadline: string,
  ): Promise<ExecutionResult> {
    try {
      const executor = this.registry.get(spec.executorId);
      return await executor.execute({ spec, context, attempt, deadline });
    } catch (err) {
      return {
        taskId: spec.id,
        attempt,
        status: "failure",
        changedFiles: [],
        logs: "",
        durationMs: 0,
        errorSummary: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
