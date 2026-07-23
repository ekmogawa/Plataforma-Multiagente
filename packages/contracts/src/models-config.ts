import { z } from "zod";
import { ModelTier } from "./common.js";

/**
 * Schema de config/models.yaml — o único lugar onde nomes de modelo aparecem.
 * Trocar um modelo é editar este arquivo, nunca código (requisito de trocabilidade).
 */

export const ProviderProtocol = z.enum([
  "openai", // HTTP compatível com a API OpenAI (OmniRouter, OpenAI direto)
  "google", // API Google Generative AI
  "claude-agent-sdk", // Claude via Agent SDK / claude -p
  "anthropic", // API Anthropic direta
]);
export type ProviderProtocol = z.infer<typeof ProviderProtocol>;

export const ProviderConfig = z.object({
  baseUrl: z.string().optional(),
  /** Nome da variável de ambiente com a chave (a chave nunca fica no yaml). */
  apiKeyEnv: z.string().optional(),
  protocol: ProviderProtocol,
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const ModelCatalogEntry = z.object({
  provider: z.string(),
  /** Nome do modelo no provedor (ex.: "deepseek-v4-flash"). */
  model: z.string(),
  tier: ModelTier,
  /** Papel especial, quando houver (ex.: "coding-agent", "escalation"). */
  role: z.string().optional(),
  inPer1M: z.number().nonnegative().optional(),
  outPer1M: z.number().nonnegative().optional(),
});
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntry>;

/**
 * Regra de resolução de uma capacidade. `default` é obrigatório; as demais
 * chaves são condições por complexidade (ex.: "complexity>=4", "complexity<=2").
 * Os módulos pedem uma capacidade; o Capability Resolver aplica esta regra.
 */
export const CapabilityRule = z.record(z.string(), z.string());
export type CapabilityRule = z.infer<typeof CapabilityRule>;

export const ModelsConfig = z.object({
  providers: z.record(z.string(), ProviderConfig),
  models: z.record(z.string(), ModelCatalogEntry),
  /** Capacidade nomeada → modelo(s). Os componentes nunca citam modelos. */
  capabilities: z.record(z.string(), CapabilityRule),
  /** Cadeia de fallback: modelo → alternativas em ordem. */
  fallbacks: z.record(z.string(), z.array(z.string())).default({}),
});
export type ModelsConfig = z.infer<typeof ModelsConfig>;
