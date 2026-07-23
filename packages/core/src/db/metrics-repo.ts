import type { MetricEvent } from "@pm/contracts";
import type { DB } from "./database.js";

/**
 * Persistência de MetricEvent — o combustível do Evolution Engine.
 * Toda chamada de modelo e resultado de tarefa passa por aqui.
 */
export class MetricsRepo {
  private readonly insert;

  constructor(private readonly db: DB) {
    this.insert = db.prepare(`
      INSERT INTO metric_events
        (ts, kind, run_id, task_id, model, prompt_id, prompt_version,
         tokens_in, tokens_out, cost_usd, duration_ms, success, meta_json)
      VALUES
        (@ts, @kind, @run_id, @task_id, @model, @prompt_id, @prompt_version,
         @tokens_in, @tokens_out, @cost_usd, @duration_ms, @success, @meta_json)
    `);
  }

  record(event: MetricEvent): void {
    this.insert.run({
      ts: event.ts,
      kind: event.kind,
      run_id: event.runId ?? null,
      task_id: event.taskId ?? null,
      model: event.model ?? null,
      prompt_id: event.promptId ?? null,
      prompt_version: event.promptVersion ?? null,
      tokens_in: event.tokensIn ?? null,
      tokens_out: event.tokensOut ?? null,
      cost_usd: event.costUsd ?? null,
      duration_ms: event.durationMs ?? null,
      success: event.success === undefined ? null : event.success ? 1 : 0,
      meta_json: JSON.stringify(event.meta ?? {}),
    });
  }

  /** Total de eventos registrados (usado por pm doctor). */
  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM metric_events")
      .get() as { c: number };
    return row.c;
  }

  /** Custo total acumulado em USD. */
  totalCostUsd(runId?: string): number {
    const sql = runId
      ? "SELECT COALESCE(SUM(cost_usd), 0) AS s FROM metric_events WHERE run_id = ?"
      : "SELECT COALESCE(SUM(cost_usd), 0) AS s FROM metric_events";
    const row = (runId ? this.db.prepare(sql).get(runId) : this.db.prepare(sql).get()) as {
      s: number;
    };
    return row.s;
  }

  // --- Agregações para o Evolution Engine (Camada 5) ---

  /** Chamadas de modelo por CAPACIDADE (via meta_json.$.capability). Vazio offline. */
  aggregateByCapability(): CapabilityStat[] {
    return this.db
      .prepare(
        `SELECT json_extract(meta_json, '$.capability') AS capability,
                COUNT(*) AS total,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
                SUM(CASE WHEN json_extract(meta_json, '$.degraded') IS NOT NULL THEN 1 ELSE 0 END) AS degraded,
                COALESCE(AVG(cost_usd), 0) AS avg_cost
           FROM metric_events
          WHERE kind = 'llm_call' AND json_extract(meta_json, '$.capability') IS NOT NULL
          GROUP BY capability
          ORDER BY capability`,
      )
      .all() as CapabilityStat[];
  }

  /** Chamadas de modelo por PROMPT (prompt_id + versão). Vazio offline. */
  aggregateByPrompt(): PromptStat[] {
    return this.db
      .prepare(
        `SELECT prompt_id AS promptId,
                COALESCE(prompt_version, 0) AS promptVersion,
                COUNT(*) AS total,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures
           FROM metric_events
          WHERE kind = 'llm_call' AND prompt_id IS NOT NULL
          GROUP BY prompt_id, prompt_version
          ORDER BY prompt_id, prompt_version`,
      )
      .all() as PromptStat[];
  }

  /** Resultados de tarefa e escalações — disponível OFFLINE (via eventos). */
  taskOutcomes(): { total: number; failures: number; escalations: number } {
    const tr = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures
           FROM metric_events WHERE kind = 'task_result'`,
      )
      .get() as { total: number; failures: number | null };
    const esc = this.db
      .prepare("SELECT COUNT(*) AS c FROM metric_events WHERE kind = 'escalation'")
      .get() as { c: number };
    return { total: tr.total, failures: tr.failures ?? 0, escalations: esc.c };
  }
}

export interface CapabilityStat {
  capability: string;
  total: number;
  failures: number;
  degraded: number;
  avg_cost: number;
}

export interface PromptStat {
  promptId: string;
  promptVersion: number;
  total: number;
  failures: number;
}
