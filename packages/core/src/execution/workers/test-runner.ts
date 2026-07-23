import type { ExecutionResult, ProjectMap, ProjectTarget } from "@pm/contracts";
import { runCommand, tokenizeCommand } from "../command-runner.js";
import type { ExecutorInput, ExecutorPort } from "../executor-port.js";

/**
 * worker.test-runner — executor determinístico (zero tokens) para tarefas
 * puramente operacionais: roda os comandos de teste do projeto (os critérios
 * checkKind='script', ou ProjectMap.testCommand). Sucesso iff todos saem com 0.
 */
export class TestRunnerWorker implements ExecutorPort {
  readonly id = "worker.test-runner";
  readonly kind = "deterministic" as const;

  constructor(
    private readonly target: ProjectTarget,
    private readonly projectMap: ProjectMap,
  ) {}

  async execute(input: ExecutorInput): Promise<ExecutionResult> {
    const { spec, attempt } = input;
    const cmds = spec.acceptanceCriteria
      .filter((c) => c.checkKind === "script" && c.check)
      .map((c) => c.check!);
    if (cmds.length === 0 && this.projectMap.testCommand) {
      cmds.push(this.projectMap.testCommand);
    }
    if (cmds.length === 0) {
      return {
        taskId: spec.id,
        attempt,
        status: "success",
        changedFiles: [],
        logs: "Nenhum comando de teste — nada a executar.",
        durationMs: 0,
      };
    }

    let logs = "";
    let total = 0;
    for (const cmd of cmds) {
      const argv = tokenizeCommand(cmd);
      const res = await runCommand(argv[0]!, argv.slice(1), {
        cwd: this.target.rootPath,
        timeoutMs: spec.timeoutMs,
      });
      total += res.durationMs;
      logs += `$ ${cmd}\n${res.output}\n`;
      if (res.timedOut) {
        return { taskId: spec.id, attempt, status: "timeout", changedFiles: [], logs, durationMs: total, errorSummary: `timeout: ${cmd}` };
      }
      if (res.code !== 0) {
        return {
          taskId: spec.id,
          attempt,
          status: "failure",
          changedFiles: [],
          logs,
          durationMs: total,
          errorSummary: `comando falhou (código ${res.code}): ${cmd}`,
        };
      }
    }
    return { taskId: spec.id, attempt, status: "success", changedFiles: [], logs, durationMs: total };
  }
}
