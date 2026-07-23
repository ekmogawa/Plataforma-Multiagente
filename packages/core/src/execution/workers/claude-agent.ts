import type { ExecutionResult } from "@pm/contracts";
import type { ExecutorInput, ExecutorPort } from "../executor-port.js";

/**
 * worker.claude-agent — RESERVADO (planned). Integração com o Agent SDK / claude
 * -p headless (edita arquivos direto no projeto) fica para uma versão futura; é
 * pesada e inviável offline. Na v1 o code-writer é o worker.llm (OmniRouter).
 * Não é registrado por padrão; se despachado, falha honestamente.
 */
export class ClaudeAgentWorker implements ExecutorPort {
  readonly id = "worker.claude-agent";
  readonly kind = "llm" as const;

  async execute(input: ExecutorInput): Promise<ExecutionResult> {
    return {
      taskId: input.spec.id,
      attempt: input.attempt,
      status: "failure",
      changedFiles: [],
      logs: "",
      durationMs: 0,
      errorSummary: "worker.claude-agent ainda não implementado (planejado para versão futura).",
    };
  }
}
