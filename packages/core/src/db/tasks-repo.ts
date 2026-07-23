import type {
  ExecutionResult,
  TaskSpec,
  TaskState,
  WorkflowEdge,
} from "@pm/contracts";
import type { DB } from "./database.js";

/**
 * TasksRepo — estado vivo do DAG de um run, sobre tasks/task_edges (migração v1).
 * A tabela é a ÚNICA fonte de verdade (crash-safe); operações que precisam ser
 * atômicas (seed, claim, completeAndCascade) rodam em transação better-sqlite3.
 *
 * Semântica de `attempt`: começa 0; o claim faz +1 (primeira execução = 1).
 * `maxRetries` (na spec) é o nº TOTAL de tentativas; escala quando
 * attempt >= maxRetries. Um crash consome a tentativa (limite duro preservado).
 */

export interface TaskRow {
  id: string;
  runId: string;
  state: TaskState;
  attempt: number;
  dependsRemaining: number;
  spec: TaskSpec;
  result: ExecutionResult | null;
  notBefore: string | null;
  leaseExpires: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeedEntry {
  spec: TaskSpec;
  dependsRemaining: number;
  initialState: "ready" | "pending";
}

export interface ReconcileReport {
  completed: number; // órfão validating com sucesso persistido -> done
  reverted: number; // running/validating órfãos -> retrying
  escalated: number; // órfãos sem tentativa restante -> escalated
  recomputed: number; // depends_remaining recalculado
}

const TERMINAL_STATES = new Set(["done", "escalated", "blocked", "cancelled", "failed"]);

export class TasksRepo {
  constructor(private readonly db: DB) {}

  hasTasks(runId: string): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE run_id = ?")
      .get(runId) as { c: number };
    return row.c > 0;
  }

  /** Insere todas as tarefas + arestas de um run numa transação. */
  seed(runId: string, entries: SeedEntry[], edges: WorkflowEdge[], now: string): void {
    const insTask = this.db.prepare(
      `INSERT INTO tasks (id, run_id, state, attempt, depends_remaining, spec_json, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    );
    const insEdge = this.db.prepare(
      `INSERT OR IGNORE INTO task_edges (run_id, from_task, to_task) VALUES (?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const e of entries) {
        insTask.run(
          e.spec.id,
          runId,
          e.initialState,
          e.dependsRemaining,
          JSON.stringify(e.spec),
          now,
          now,
        );
      }
      for (const edge of edges) insEdge.run(runId, edge.from, edge.to);
    })();
  }

  get(runId: string, id: string): TaskRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE run_id = ? AND id = ?")
      .get(runId, id) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  byRun(runId: string): TaskRow[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY id")
      .all(runId) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  countByState(runId: string): Record<string, number> {
    const rows = this.db
      .prepare("SELECT state, COUNT(*) AS c FROM tasks WHERE run_id = ? GROUP BY state")
      .all(runId) as { state: string; c: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.state] = r.c;
    return out;
  }

  escalatedCount(runId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE run_id = ? AND state = 'escalated'")
      .get(runId) as { c: number };
    return row.c;
  }

  /** Tarefas prontas para despacho (state='ready'), ordenadas por id (determinístico). */
  getReady(runId: string, limit: number): TaskRow[] {
    if (limit <= 0) return [];
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE run_id = ? AND state = 'ready' ORDER BY id LIMIT ?")
      .all(runId, limit) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  activeCount(runId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS c FROM tasks WHERE run_id = ? AND state IN ('running','validating')",
      )
      .get(runId) as { c: number };
    return row.c;
  }

  /**
   * Reivindica candidatos: UPDATE condicional WHERE state='ready' (atômico e
   * idempotente). Só entram os que mudaram (changes===1), já com attempt+1.
   */
  claim(candidates: TaskRow[], leaseOf: (t: TaskRow) => string, now: string): TaskRow[] {
    const upd = this.db.prepare(
      `UPDATE tasks SET state='running', attempt=attempt+1, lease_expires=?, not_before=NULL, updated_at=?
       WHERE run_id=? AND id=? AND state='ready'`,
    );
    const claimed: TaskRow[] = [];
    this.db.transaction(() => {
      for (const c of candidates) {
        const lease = leaseOf(c);
        const info = upd.run(lease, now, c.runId, c.id);
        if (info.changes === 1) {
          claimed.push({
            ...c,
            state: "running",
            attempt: c.attempt + 1,
            leaseExpires: lease,
            notBefore: null,
            updatedAt: now,
          });
        }
      }
    })();
    return claimed;
  }

  markValidating(runId: string, id: string, now: string): void {
    this.db
      .prepare("UPDATE tasks SET state='validating', updated_at=? WHERE run_id=? AND id=?")
      .run(now, runId, id);
  }

  setResult(runId: string, id: string, result: ExecutionResult, now: string): void {
    this.db
      .prepare("UPDATE tasks SET result_json=?, updated_at=? WHERE run_id=? AND id=?")
      .run(JSON.stringify(result), now, runId, id);
  }

  markRetrying(runId: string, id: string, notBefore: string, now: string): void {
    this.db
      .prepare(
        "UPDATE tasks SET state='retrying', not_before=?, lease_expires=NULL, updated_at=? WHERE run_id=? AND id=?",
      )
      .run(notBefore, now, runId, id);
  }

  markEscalated(runId: string, id: string, now: string): void {
    this.db
      .prepare(
        "UPDATE tasks SET state='escalated', lease_expires=NULL, updated_at=? WHERE run_id=? AND id=?",
      )
      .run(now, runId, id);
  }

  setState(runId: string, id: string, state: TaskState, now: string): void {
    this.db
      .prepare("UPDATE tasks SET state=?, updated_at=? WHERE run_id=? AND id=?")
      .run(state, now, runId, id);
  }

  /**
   * Conclui uma tarefa e propaga: grava result + state='done', decrementa
   * depends_remaining dos sucessores e promove pending->ready quando chega a 0.
   * Tudo numa transação. Devolve os ids promovidos.
   */
  completeAndCascade(runId: string, id: string, result: ExecutionResult, now: string): string[] {
    const promoted: string[] = [];
    const done = this.db.prepare(
      "UPDATE tasks SET state='done', result_json=?, lease_expires=NULL, updated_at=? WHERE run_id=? AND id=?",
    );
    const succ = this.db.prepare(
      "SELECT to_task FROM task_edges WHERE run_id=? AND from_task=? ORDER BY to_task",
    );
    const dec = this.db.prepare(
      "UPDATE tasks SET depends_remaining=depends_remaining-1, updated_at=? WHERE run_id=? AND id=?",
    );
    const readState = this.db.prepare(
      "SELECT state, depends_remaining FROM tasks WHERE run_id=? AND id=?",
    );
    const promote = this.db.prepare(
      "UPDATE tasks SET state='ready', updated_at=? WHERE run_id=? AND id=? AND state='pending'",
    );
    this.db.transaction(() => {
      done.run(JSON.stringify(result), now, runId, id);
      const tos = succ.all(runId, id) as { to_task: string }[];
      for (const { to_task } of tos) {
        dec.run(now, runId, to_task);
        const st = readState.get(runId, to_task) as { state: string; depends_remaining: number };
        if (st.depends_remaining <= 0 && st.state === "pending") {
          const info = promote.run(now, runId, to_task);
          if (info.changes === 1) promoted.push(to_task);
        }
      }
    })();
    return promoted;
  }

  /** Menor not_before entre as tarefas retrying (ou null se nenhuma). */
  nextRetryAt(runId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT MIN(not_before) AS m FROM tasks WHERE run_id=? AND state='retrying' AND not_before IS NOT NULL",
      )
      .get(runId) as { m: string | null };
    return row.m ?? null;
  }

  /** retrying -> ready quando now >= not_before (comparação ISO lexicográfica). */
  promoteRetryable(runId: string, now: string): number {
    const info = this.db
      .prepare(
        `UPDATE tasks SET state='ready', not_before=NULL, updated_at=?
         WHERE run_id=? AND state='retrying' AND (not_before IS NULL OR not_before <= ?)`,
      )
      .run(now, runId, now);
    return info.changes;
  }

  /** running/validating com lease vencido — órfãos (timeout no mesmo processo). */
  sweepExpiredLeases(runId: string, now: string): TaskRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks WHERE run_id=? AND state IN ('running','validating')
         AND lease_expires IS NOT NULL AND lease_expires <= ? ORDER BY id`,
      )
      .all(runId, now) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  /** Marca como blocked todos os sucessores transitivos de uma tarefa. */
  blockDownstream(runId: string, taskId: string, now: string): string[] {
    const succ = this.db.prepare(
      "SELECT to_task FROM task_edges WHERE run_id=? AND from_task=?",
    );
    const block = this.db.prepare(
      `UPDATE tasks SET state='blocked', lease_expires=NULL, not_before=NULL, updated_at=?
       WHERE run_id=? AND id=? AND state IN ('pending','ready','retrying')`,
    );
    const blocked: string[] = [];
    const seen = new Set<string>();
    const queue = [taskId];
    this.db.transaction(() => {
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const tos = succ.all(runId, cur) as { to_task: string }[];
        for (const { to_task } of tos) {
          if (seen.has(to_task)) continue;
          seen.add(to_task);
          const info = block.run(now, runId, to_task);
          if (info.changes === 1) blocked.push(to_task);
          queue.push(to_task); // propaga mesmo se já terminal (para alcançar netos)
        }
      }
    })();
    return blocked;
  }

  /**
   * Reconciliação pós-crash: converge o estado ao MESMO terminal do caminho sem
   * crash. Órfãos (running/validating):
   *  - 'validating' com resultado de SUCESSO persistido -> completa (done + cascade);
   *  - tentativa restante -> retrying (imediato);
   *  - esgotado o limite -> escalated + bloqueia downstream (como no caminho normal).
   * Por fim recomputa depends_remaining e promove pending->ready coerentemente.
   *
   * Sem transação externa: chama completeAndCascade/blockDownstream (que abrem as
   * próprias transações; better-sqlite3 não aninha). É startup single-thread e
   * re-executável — idempotente por construção (o SELECT só pega running/validating).
   */
  reconcile(runId: string, now: string): ReconcileReport {
    let completed = 0;
    let reverted = 0;
    let escalated = 0;
    let recomputed = 0;

    const orphans = this.db
      .prepare(
        "SELECT * FROM tasks WHERE run_id=? AND state IN ('running','validating') ORDER BY id",
      )
      .all(runId) as Record<string, unknown>[];

    for (const raw of orphans) {
      const row = mapRow(raw);
      if (row.state === "validating" && row.result?.status === "success") {
        // Sucesso persistido antes do commit final: conclui (não re-executa nem escala).
        this.completeAndCascade(runId, row.id, row.result, now);
        completed++;
      } else if (row.attempt < row.spec.maxRetries) {
        this.markRetrying(runId, row.id, now, now); // not_before=now: retry imediato
        reverted++;
      } else {
        this.markEscalated(runId, row.id, now);
        this.blockDownstream(runId, row.id, now); // mesma semântica do caminho normal
        escalated++;
      }
    }

    // Recomputa depends_remaining (rede de segurança) e promove pending->ready.
    const tasks = this.db
      .prepare("SELECT id, state, depends_remaining FROM tasks WHERE run_id=? ORDER BY id")
      .all(runId) as { id: string; state: string; depends_remaining: number }[];
    const preds = this.db.prepare(
      "SELECT from_task FROM task_edges WHERE run_id=? AND to_task=?",
    );
    const doneState = this.db.prepare("SELECT state FROM tasks WHERE run_id=? AND id=?");
    const setDeps = this.db.prepare(
      "UPDATE tasks SET depends_remaining=?, updated_at=? WHERE run_id=? AND id=?",
    );
    const promote = this.db.prepare(
      "UPDATE tasks SET state='ready', updated_at=? WHERE run_id=? AND id=? AND state='pending'",
    );
    this.db.transaction(() => {
      for (const t of tasks) {
        if (TERMINAL_STATES.has(t.state)) continue;
        const froms = preds.all(runId, t.id) as { from_task: string }[];
        let remaining = 0;
        for (const { from_task } of froms) {
          const st = doneState.get(runId, from_task) as { state: string } | undefined;
          if (!st || st.state !== "done") remaining++;
        }
        if (remaining !== t.depends_remaining) {
          setDeps.run(remaining, now, runId, t.id);
          recomputed++;
        }
        if (remaining === 0 && t.state === "pending") promote.run(now, runId, t.id);
      }
    })();

    return { completed, reverted, escalated, recomputed };
  }
}

function mapRow(row: Record<string, unknown>): TaskRow {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    state: row.state as TaskState,
    attempt: row.attempt as number,
    dependsRemaining: row.depends_remaining as number,
    spec: JSON.parse(row.spec_json as string) as TaskSpec,
    result: row.result_json
      ? (JSON.parse(row.result_json as string) as ExecutionResult)
      : null,
    notBefore: (row.not_before as string | null) ?? null,
    leaseExpires: (row.lease_expires as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
