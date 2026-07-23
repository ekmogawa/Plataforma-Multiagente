import type { ExecutionResult } from "@pm/contracts";
import type { GitManager } from "../git-manager.js";
import type { ExecutorInput, ExecutorPort } from "../executor-port.js";

/**
 * worker.git — executor para uma tarefa git EXPLÍCITA. O ciclo de vida git
 * (branch por run, commit no fim) é conduzido pelo GitManager no wrapper do CLI,
 * não por tarefas despachadas; este worker existe para o caso raro de o plano
 * conter uma tarefa git dedicada (ex.: "criar a branch").
 */
export class GitWorker implements ExecutorPort {
  readonly id = "worker.git";
  readonly kind = "deterministic" as const;

  constructor(private readonly git: GitManager) {}

  async execute(input: ExecutorInput): Promise<ExecutionResult> {
    const isRepo = await this.git.isGitRepo();
    return {
      taskId: input.spec.id,
      attempt: input.attempt,
      status: "success",
      changedFiles: [],
      logs: isRepo ? "git worker: repositório ok (ciclo de vida no wrapper)" : "git worker: projeto não é repositório git",
      durationMs: 0,
    };
  }
}
