import type { PlatformEvent } from "@pm/contracts";
import { randomUUID } from "node:crypto";
import type { DB } from "./database.js";
import type { EventBus } from "../shared/event-bus.js";

/**
 * Log persistente de eventos — eventos críticos sobrevivem a reinícios.
 *
 * Idempotente por event_id (INSERT OR IGNORE): o mesmo evento gravado duas
 * vezes não duplica. `unprocessed()` permite ao orquestrador retomar o que
 * ficou pendente após um crash (reconciliação na Camada 2).
 */
export class EventLog {
  private readonly insert;

  constructor(private readonly db: DB) {
    this.insert = db.prepare(`
      INSERT OR IGNORE INTO events
        (event_id, event_type, run_id, task_id, occurred_at, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
  }

  record(event: PlatformEvent): void {
    const id = event.eventId ?? `evt_${randomUUID().slice(0, 12)}`;
    this.insert.run(
      id,
      event.name,
      event.runId ?? null,
      event.taskId ?? null,
      event.ts,
      JSON.stringify(event),
      new Date().toISOString(),
    );
  }

  /** Passa a gravar todo evento publicado no bus. Retorna o cancelamento. */
  attachTo(bus: EventBus): () => void {
    return bus.onAny((event) => this.record(event));
  }

  unprocessed(): PlatformEvent[] {
    const rows = this.db
      .prepare("SELECT payload_json FROM events WHERE processed = 0 ORDER BY occurred_at")
      .all() as { payload_json: string }[];
    return rows.map((r) => JSON.parse(r.payload_json) as PlatformEvent);
  }

  markProcessed(eventId: string): void {
    this.db
      .prepare("UPDATE events SET processed = 1 WHERE event_id = ?")
      .run(eventId);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM events").get() as {
      c: number;
    };
    return row.c;
  }
}
