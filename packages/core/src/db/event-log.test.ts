import { describe, expect, it } from "vitest";
import { EventBus } from "../shared/event-bus.js";
import { openDatabase } from "./database.js";
import { EventLog } from "./event-log.js";

describe("EventLog", () => {
  it("persiste eventos publicados no bus (via assinatura)", () => {
    const db = openDatabase(":memory:");
    const bus = new EventBus();
    const log = new EventLog(db);
    log.attachTo(bus);

    bus.publish({
      name: "TaskCompleted",
      ts: new Date().toISOString(),
      runId: "run_1",
      data: {},
    });

    expect(log.count()).toBe(1);
    const pending = log.unprocessed();
    expect(pending.length).toBe(1);
    expect(pending[0]?.name).toBe("TaskCompleted");
    expect(pending[0]?.eventId).toMatch(/^evt_/); // bus preencheu o id
    db.close();
  });

  it("é idempotente por eventId (mesmo evento não duplica)", () => {
    const db = openDatabase(":memory:");
    const log = new EventLog(db);
    const event = {
      eventId: "evt_fixo",
      name: "TaskFailed" as const,
      ts: new Date().toISOString(),
      data: {},
    };
    log.record(event);
    log.record(event);
    expect(log.count()).toBe(1);
    db.close();
  });

  it("markProcessed remove da fila de pendentes", () => {
    const db = openDatabase(":memory:");
    const log = new EventLog(db);
    log.record({
      eventId: "evt_1",
      name: "RunApproved",
      ts: new Date().toISOString(),
      data: {},
    });
    expect(log.unprocessed().length).toBe(1);
    log.markProcessed("evt_1");
    expect(log.unprocessed().length).toBe(0);
    db.close();
  });
});
