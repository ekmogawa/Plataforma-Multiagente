import type { LoadedPrompt } from "./prompt-library.js";

/**
 * Prompt Builder — renderiza o template de um prompt com as variáveis da tarefa.
 * Substitui {{chave}} pelos valores; variáveis ausentes viram string vazia.
 */

export interface RenderedPrompt {
  promptId: string;
  version: number;
  capability: string;
  system: string;
  user: string;
}

export function renderPrompt(
  prompt: LoadedPrompt,
  vars: Record<string, string>,
): RenderedPrompt {
  const user = prompt.template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) =>
    key in vars ? vars[key]! : "",
  );
  return {
    promptId: prompt.id,
    version: prompt.version,
    capability: prompt.capability,
    system: prompt.system,
    user,
  };
}
