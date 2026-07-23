import type { ModelsConfig } from "@pm/contracts";
import type {
  CompletionRequest,
  CompletionResponse,
  ModelPort,
} from "./model-port.js";
import { ProviderError } from "./model-port.js";
import { OmniRouterAdapter } from "./omnirouter.js";

/**
 * Model Resolver — resolve um nome do catálogo (ex.: "deepseek-flash") para o
 * adaptador do provedor e executa a completion, aplicando a cadeia de fallback
 * em erros retriáveis do provedor. Cria um adaptador por provedor e reaproveita.
 *
 * A escolha de QUAL modelo usar por capacidade é do Capability Resolver; aqui
 * cuidamos de modelo → adaptador → execução. Os dois são trocáveis em separado.
 */
export class ModelResolver {
  private readonly adapters = new Map<string, ModelPort>();

  constructor(private readonly config: ModelsConfig) {}

  /** Nomes de modelo disponíveis no catálogo. */
  listModels(): string[] {
    return Object.keys(this.config.models);
  }

  /** True se o provedor do modelo tem chave de API configurada. */
  hasKeyFor(modelKey: string): boolean {
    const entry = this.config.models[modelKey];
    if (!entry) return false;
    const provider = this.config.providers[entry.provider];
    if (!provider) return false;
    if (provider.protocol === "claude-agent-sdk") return true; // usa assinatura
    const env = provider.apiKeyEnv;
    return !!(env && process.env[env]);
  }

  async complete(
    modelKey: string,
    req: CompletionRequest,
  ): Promise<CompletionResponse> {
    const entry = this.config.models[modelKey];
    if (!entry) {
      throw new ProviderError(`Modelo "${modelKey}" não está no catálogo.`, false);
    }
    const adapter = this.adapterFor(entry.provider);
    return adapter.complete(entry.model, req);
  }

  /**
   * Executa com fallback: tenta o modelo; em erro retriável do provedor, segue
   * a cadeia `fallbacks[modelKey]`. Erros não-retriáveis (config, 4xx) sobem já.
   */
  async completeWithFallback(
    modelKey: string,
    req: CompletionRequest,
  ): Promise<CompletionResponse & { attemptedModels: string[] }> {
    const chain = [modelKey, ...(this.config.fallbacks[modelKey] ?? [])];
    const attempted: string[] = [];
    let lastError: unknown;

    for (const candidate of chain) {
      attempted.push(candidate);
      try {
        const res = await this.complete(candidate, req);
        return { ...res, attemptedModels: attempted };
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderError && !err.retriable) throw err;
        // retriável: tenta o próximo da cadeia
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ProviderError(`Todos os fallbacks falharam para "${modelKey}".`, false);
  }

  private adapterFor(providerName: string): ModelPort {
    const existing = this.adapters.get(providerName);
    if (existing) return existing;

    const provider = this.config.providers[providerName];
    if (!provider) {
      throw new ProviderError(
        `Provedor "${providerName}" não está definido em models.yaml.`,
        false,
      );
    }

    let adapter: ModelPort;
    switch (provider.protocol) {
      case "openai": {
        // Preços por nome-de-modelo-no-provedor, para custo.
        const pricing = new Map<string, { inPer1M?: number; outPer1M?: number }>();
        for (const m of Object.values(this.config.models)) {
          if (m.provider === providerName) {
            pricing.set(m.model, { inPer1M: m.inPer1M, outPer1M: m.outPer1M });
          }
        }
        adapter = new OmniRouterAdapter({ id: providerName, provider, pricing });
        break;
      }
      case "anthropic":
      case "claude-agent-sdk":
      case "google":
        // Chega na Camada 3 (claude-agent) e conforme necessidade.
        throw new ProviderError(
          `Protocolo "${provider.protocol}" ainda não implementado na Fase 0.`,
          false,
        );
      default:
        throw new ProviderError(
          `Protocolo desconhecido: ${String(provider.protocol)}`,
          false,
        );
    }

    this.adapters.set(providerName, adapter);
    return adapter;
  }
}
