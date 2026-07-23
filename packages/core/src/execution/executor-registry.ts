import { UnknownExecutorError, type ExecutorPort } from "./executor-port.js";

/**
 * ExecutorRegistry — mapa executorId -> ExecutorPort. Ponto de plugagem da
 * Camada 3: registrar Deterministic/LLM Engine sob os ids que o Task Router
 * produz, sem mudar o orquestrador (que só faz get(id).execute(...)).
 */
export class ExecutorRegistry {
  private readonly executors = new Map<string, ExecutorPort>();

  register(executor: ExecutorPort): void {
    if (this.executors.has(executor.id)) {
      throw new Error(`Executor já registrado: ${executor.id}`);
    }
    this.executors.set(executor.id, executor);
  }

  get(executorId: string): ExecutorPort {
    const e = this.executors.get(executorId);
    if (!e) throw new UnknownExecutorError(`Executor não registrado: ${executorId}`);
    return e;
  }

  has(executorId: string): boolean {
    return this.executors.has(executorId);
  }

  list(): ExecutorPort[] {
    return [...this.executors.values()];
  }
}
