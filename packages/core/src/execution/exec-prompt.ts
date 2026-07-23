import type { EspecialidadesConfig, TaskContext, TaskSpec } from "@pm/contracts";
import { TASK_TYPE_TO_ESPECIALIDADE } from "../orchestration/task-router.js";

/**
 * Helpers do worker.llm: mapeiam o tipo da tarefa para a especialidade (prompt +
 * convenções) e montam as variáveis do template a partir do TaskContext.
 */
export interface Especialidade {
  capability: string;
  prompt: string;
  conventions: string[];
}

export function especialidadeFor(
  spec: TaskSpec,
  especialidades: EspecialidadesConfig,
): Especialidade | undefined {
  const key = TASK_TYPE_TO_ESPECIALIDADE[spec.type];
  if (!key) return undefined;
  return especialidades.especialidades[key];
}

export function buildExecVars(spec: TaskSpec, context: TaskContext): Record<string, string> {
  const files = context.files
    .map((f) => `--- ${f.path} (${f.mode}) ---\n${f.content}`)
    .join("\n\n");
  const criteria = spec.acceptanceCriteria.map((c) => `- ${c.text}`).join("\n");
  return {
    instructions: spec.input.instructions,
    files: files || "(nenhum arquivo de contexto)",
    conventions: context.conventions.join("; "),
    acceptanceCriteria: criteria || "(sem critérios explícitos)",
    priorFailure: context.priorFailure
      ? `A tentativa anterior FALHOU na validação:\n${context.priorFailure}\nCorrija isso.`
      : "",
  };
}
