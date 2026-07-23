import type { ProviderConfig } from "@pm/contracts";
import {
  costFromUsage,
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type ModelPort,
} from "./model-port.js";

/**
 * Adaptador para gateways compatíveis com a API OpenAI (OmniRouter, OpenAI).
 * Cobre DeepSeek, Qwen, GLM e Gemini quando roteados pelo OmniRouter.
 */
export class OmniRouterAdapter implements ModelPort {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  /** Preços por modelo, para calcular custo (in/out por 1M de tokens). */
  private readonly pricing: Map<string, { inPer1M?: number; outPer1M?: number }>;

  constructor(opts: {
    id: string;
    provider: ProviderConfig;
    pricing?: Map<string, { inPer1M?: number; outPer1M?: number }>;
  }) {
    this.id = opts.id;
    this.baseUrl = (opts.provider.baseUrl ?? "https://openrouter.ai/api/v1").replace(
      /\/$/,
      "",
    );
    const keyEnv = opts.provider.apiKeyEnv;
    this.apiKey = (keyEnv ? process.env[keyEnv] : undefined) ?? "";
    this.pricing = opts.pricing ?? new Map();
  }

  hasKey(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(
    modelName: string,
    req: CompletionRequest,
  ): Promise<CompletionResponse> {
    if (!this.apiKey) {
      throw new ProviderError(
        `Sem chave de API para o adaptador "${this.id}". Preencha o .env.`,
        false,
      );
    }

    const messages = [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      ...req.messages,
    ];

    const body: Record<string, unknown> = {
      model: modelName,
      messages,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.2,
    };
    if (req.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "resposta", strict: true, schema: req.jsonSchema },
      };
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(`Falha de rede ao chamar ${this.id}`, true, err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 429/5xx são retriáveis (vale o fallback); 4xx de request não.
      const retriable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        `${this.id} retornou ${res.status}: ${text.slice(0, 400)}`,
        retriable,
      );
    }

    const data = (await res.json()) as OpenAIChatResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = {
      in: data.usage?.prompt_tokens ?? 0,
      out: data.usage?.completion_tokens ?? 0,
      cacheRead: 0,
    };
    const price = this.pricing.get(modelName);
    const costUsd = costFromUsage(usage, price?.inPer1M, price?.outPer1M);

    let parsed: unknown;
    if (req.jsonSchema && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    return { text, parsed, usage, costUsd, model: modelName };
  }
}

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
