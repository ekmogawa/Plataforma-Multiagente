import type { ExecutionResult, TaskSpec } from "@pm/contracts";

/**
 * AcceptanceGate — decide se uma execução bem-sucedida é ACEITA (transição
 * validating -> done) ou volta para a escada de falha. Na Camada 2 o default
 * apenas confirma o status de sucesso; o Acceptance Engine da Camada 3 (compile/
 * lint/testes/critérios) pluga aqui SEM tocar no scheduler.
 */
export interface AcceptanceGate {
  evaluate(spec: TaskSpec, result: ExecutionResult): Promise<{ pass: boolean; report?: string }>;
}

export class PassThroughAcceptance implements AcceptanceGate {
  async evaluate(
    _spec: TaskSpec,
    result: ExecutionResult,
  ): Promise<{ pass: boolean; report?: string }> {
    return { pass: result.status === "success" };
  }
}
