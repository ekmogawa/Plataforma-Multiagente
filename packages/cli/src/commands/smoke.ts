import {
  loadModelsConfig,
  openDatabase,
  MetricsRepo,
  ModelResolver,
  ProviderError,
} from "@pm/core";
import type { MetricEvent } from "@pm/contracts";
import { emit, type OutputOptions } from "../output.js";

/**
 * pm smoke — hello-world que atravessa o adaptador de modelo e grava uma
 * métrica no SQLite. Se nenhum provedor tem chave, roda em modo offline
 * (ainda grava a métrica, para provar o caminho de persistência).
 */
export async function smoke(opts: OutputOptions): Promise<number> {
  const cfg = loadModelsConfig();
  const db = openDatabase();
  const metrics = new MetricsRepo(db);
  const gateway = new ModelResolver(cfg);

  // Na Fase 0 só o protocolo "openai" (OmniRouter/OpenAI) está implementado.
  // Considera utilizável o modelo cujo provedor é openai E tem chave.
  const callable = (modelKey: string): boolean => {
    const entry = cfg.models[modelKey];
    if (!entry) return false;
    const provider = cfg.providers[entry.provider];
    return provider?.protocol === "openai" && gateway.hasKeyFor(modelKey);
  };
  const preferred = ["deepseek-flash", ...gateway.listModels()];
  const usable = preferred.find(callable);

  const ts = new Date().toISOString();

  if (!usable) {
    const event: MetricEvent = {
      ts,
      kind: "llm_call",
      model: "(offline)",
      durationMs: 0,
      success: true,
      meta: { mode: "offline-smoke", note: "sem chave de API; métrica de teste" },
    };
    metrics.record(event);
    const data = { mode: "offline", metricsTotal: metrics.count() };
    emit(
      data,
      () =>
        `Modo offline (sem chave). Métrica de teste gravada. Total de métricas: ${data.metricsTotal}.`,
      opts,
    );
    db.close();
    return 0;
  }

  const started = Date.now();
  try {
    const res = await gateway.complete(usable, {
      system: "Você responde em uma única palavra.",
      messages: [{ role: "user", content: "Diga: pronto" }],
      maxTokens: 16,
    });
    const durationMs = Date.now() - started;
    const event: MetricEvent = {
      ts,
      kind: "llm_call",
      model: usable,
      tokensIn: res.usage.in,
      tokensOut: res.usage.out,
      costUsd: res.costUsd,
      durationMs,
      success: true,
      meta: { mode: "online-smoke" },
    };
    metrics.record(event);
    const data = {
      mode: "online",
      model: usable,
      response: res.text.trim(),
      tokens: res.usage,
      costUsd: res.costUsd,
      metricsTotal: metrics.count(),
    };
    emit(
      data,
      () =>
        `Modelo ${usable} respondeu: "${data.response}" ` +
        `(${res.usage.in}+${res.usage.out} tokens, US$ ${res.costUsd.toFixed(6)}). ` +
        `Métrica gravada. Total: ${data.metricsTotal}.`,
      opts,
    );
    db.close();
    return 0;
  } catch (err) {
    const durationMs = Date.now() - started;
    metrics.record({
      ts,
      kind: "llm_call",
      model: usable,
      durationMs,
      success: false,
      meta: { mode: "online-smoke", error: err instanceof Error ? err.message : String(err) },
    });
    const detail =
      err instanceof ProviderError ? err.message : err instanceof Error ? err.message : String(err);
    emit(
      { mode: "online", ok: false, error: detail },
      () => `Falha ao chamar ${usable}: ${detail}`,
      opts,
    );
    db.close();
    return 1;
  }
}
