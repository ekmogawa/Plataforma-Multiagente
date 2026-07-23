import type { PlannedTask } from "@pm/contracts";
import type { DeterminismPolicy, DeterministicClaim } from "../orchestration/task-router.js";

/**
 * DeterministicFirstPolicy (Q1) — reivindica SÓ tarefas puramente OPERACIONAIS:
 * não autoram arquivos (input.files vazio) e todos os critérios são script (ex.:
 * "rodar a suíte de testes", "aplicar migração"). Todo o resto (que escreve
 * código, ou tem critério llm/manual) devolve null → worker.llm. O determinismo-
 * primeiro genuíno mora na INFRA (Acceptance/test/git rodam em torno de TODA
 * tarefa), não em reivindicar tarefas de implementação.
 */
export class DeterministicFirstPolicy implements DeterminismPolicy {
  constructor(
    private readonly opts: {
      operationalExecutorId?: string;
      /** Override explícito (ex.: scaffold em new-project). Consultado primeiro. */
      overrides?: (task: PlannedTask) => DeterministicClaim | null;
    } = {},
  ) {}

  claim(task: PlannedTask): DeterministicClaim | null {
    const override = this.opts.overrides?.(task);
    if (override) return override;

    const operational =
      task.input.files.length === 0 &&
      task.acceptanceCriteria.length > 0 &&
      task.acceptanceCriteria.every((c) => c.checkKind === "script");
    if (!operational) return null;

    return {
      executorId: this.opts.operationalExecutorId ?? "worker.test-runner",
      reason: "tarefa operacional (não autora arquivos; só critérios script)",
    };
  }
}

export function defaultDeterminismPolicy(
  opts?: ConstructorParameters<typeof DeterministicFirstPolicy>[0],
): DeterminismPolicy {
  return new DeterministicFirstPolicy(opts);
}
