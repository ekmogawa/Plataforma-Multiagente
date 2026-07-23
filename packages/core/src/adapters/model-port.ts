import type { ModelRef, TokenUsage } from "@pm/contracts";

/**
 * Port de modelo — a interface que todo adaptador implementa.
 * Trocar de provedor é escolher outro adaptador; o restante do código não muda.
 */

export interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  system?: string;
  messages: CompletionMessage[];
  maxTokens?: number;
  temperature?: number;
  /**
   * Quando presente, pede saída aderente a este JSON Schema.
   * O adaptador tenta usar o modo JSON/structured do provedor.
   */
  jsonSchema?: Record<string, unknown>;
}

export interface CompletionResponse {
  text: string;
  /** Objeto já parseado, quando jsonSchema foi pedido e o parse funcionou. */
  parsed?: unknown;
  usage: TokenUsage;
  costUsd: number;
  /** Modelo efetivamente usado (após fallback, se houve). */
  model: string;
}

export interface ModelPort {
  /** Id do adaptador (ex.: "omnirouter", "anthropic"). */
  readonly id: string;
  /**
   * Executa uma completion.
   * @param modelName nome do modelo no provedor (ex.: "deepseek-v4-flash").
   */
  complete(
    modelName: string,
    req: CompletionRequest,
  ): Promise<CompletionResponse>;
}

/** Erro que sinaliza ao Task Router que vale tentar o próximo fallback. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retriable: boolean,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Calcula custo em USD a partir do uso e dos preços por 1M de tokens. */
export function costFromUsage(
  usage: TokenUsage,
  inPer1M?: number,
  outPer1M?: number,
): number {
  const inCost = ((inPer1M ?? 0) * usage.in) / 1_000_000;
  const outCost = ((outPer1M ?? 0) * usage.out) / 1_000_000;
  return inCost + outCost;
}

export type { ModelRef };
