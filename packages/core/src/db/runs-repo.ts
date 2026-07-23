import type { ExecutionStrategy, WorkKind } from "@pm/contracts";
import type { DB } from "./database.js";

/**
 * Estado dos runs. A Camada 1 (pm plan) cria o run com projeto e tipo de
 * trabalho; a Camada 2 o retoma a partir do estado `planned`.
 */

export interface RunRow {
  id: string;
  requestId: string | null;
  projectSlug: string | null;
  workKind: WorkKind | null;
  state: string;
  strategy: ExecutionStrategy | null;
  budgetTokens: number;
  spentTokens: number;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
}

export class RunsRepo {
  constructor(private readonly db: DB) {}

  create(input: {
    id: string;
    requestId?: string;
    projectSlug?: string;
    workKind?: WorkKind;
    state: string;
    strategy?: ExecutionStrategy;
    budgetTokens?: number;
    now?: string;
  }): void {
    const now = input.now ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs
           (id, request_id, project_slug, work_kind, state, strategy_json, budget_tokens, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.requestId ?? null,
        input.projectSlug ?? null,
        input.workKind ?? null,
        input.state,
        input.strategy ? JSON.stringify(input.strategy) : null,
        input.budgetTokens ?? 0,
        now,
        now,
      );
  }

  get(id: string): RunRow | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return mapRow(row);
  }

  list(limit = 50): RunRow[] {
    const rows = this.db
      .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  setState(id: string, state: string, now?: string): void {
    this.db
      .prepare("UPDATE runs SET state = ?, updated_at = ? WHERE id = ?")
      .run(state, now ?? new Date().toISOString(), id);
  }

  setStrategy(id: string, strategy: ExecutionStrategy, now?: string): void {
    this.db
      .prepare("UPDATE runs SET strategy_json = ?, budget_tokens = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(strategy), strategy.budgetTokens, now ?? new Date().toISOString(), id);
  }

  addSpend(id: string, tokens: number, costUsd: number, now?: string): void {
    this.db
      .prepare(
        `UPDATE runs SET spent_tokens = spent_tokens + ?, cost_usd = cost_usd + ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(tokens, costUsd, now ?? new Date().toISOString(), id);
  }
}

function mapRow(row: Record<string, unknown>): RunRow {
  return {
    id: row.id as string,
    requestId: (row.request_id as string | null) ?? null,
    projectSlug: (row.project_slug as string | null) ?? null,
    workKind: (row.work_kind as WorkKind | null) ?? null,
    state: row.state as string,
    strategy: row.strategy_json
      ? (JSON.parse(row.strategy_json as string) as ExecutionStrategy)
      : null,
    budgetTokens: row.budget_tokens as number,
    spentTokens: row.spent_tokens as number,
    costUsd: row.cost_usd as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
