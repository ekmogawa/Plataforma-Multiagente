import type { ModelsConfig } from "@pm/contracts";
import type { CapabilityResolver } from "../adapters/capability-resolver.js";

/**
 * Resolve o MODO da Camada 1 para um run inteiro (all-or-nothing).
 *
 * - "heuristic": tudo por regras determinísticas (offline). Sempre disponível.
 * - "llm": usa modelos. Só é escolhido no modo "auto" se TODAS as capacidades da
 *   Camada 1 resolverem para um modelo executável (com chave E protocolo
 *   implementado — hoje só "openai"). Isso fecha a armadilha de hasKeyFor
 *   retornar true para claude-agent-sdk (assinatura) sem adaptador implementado.
 */
export type CognitiveMode = "llm" | "heuristic";
export type ModePreference = "auto" | "llm" | "heuristic";

/**
 * Capacidades exigidas para o modo "llm": as 4 etapas + "repair" (usada quando
 * a saída sai fora do schema). Se qualquer uma não for executável, o run vai
 * para heurística desde o início — nunca falha no meio por causa do reparo.
 */
export const CAMADA1_CAPABILITIES = [
  "intake-translator",
  "understanding",
  "complexity-estimator",
  "planner",
  "repair",
];

export function isExecutable(modelKey: string, config: ModelsConfig): boolean {
  const entry = config.models[modelKey];
  if (!entry) return false;
  const provider = config.providers[entry.provider];
  if (!provider) return false;
  // Único protocolo com adaptador real hoje.
  if (provider.protocol !== "openai") return false;
  return !!(provider.apiKeyEnv && process.env[provider.apiKeyEnv]);
}

export function resolveCognitiveMode(opts: {
  preference: ModePreference;
  capabilityResolver: CapabilityResolver;
  config: ModelsConfig;
  capabilities?: string[];
}): CognitiveMode {
  if (opts.preference === "heuristic") return "heuristic";

  const caps = opts.capabilities ?? CAMADA1_CAPABILITIES;
  const allExecutable = caps.every((cap) => {
    if (!opts.capabilityResolver.has(cap)) return false;
    const decision = opts.capabilityResolver.resolve(cap);
    return isExecutable(decision.model, opts.config);
  });

  if (opts.preference === "llm") {
    if (!allExecutable) {
      const offenders = caps
        .filter((cap) => !opts.capabilityResolver.has(cap) || !isExecutable(opts.capabilityResolver.resolve(cap).model, opts.config))
        .join(", ");
      throw new Error(
        `--llm exigido, mas nem todas as capacidades da Camada 1 têm modelo executável ` +
          `(chave + protocolo openai). Pendências: ${offenders}. Use --offline ou configure as chaves.`,
      );
    }
    return "llm";
  }

  // auto
  return allExecutable ? "llm" : "heuristic";
}
