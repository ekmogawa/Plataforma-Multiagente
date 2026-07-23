import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { MetricsRepo } from "../db/metrics-repo.js";
import { MetricsCollector } from "../orchestration/metrics-collector.js";
import { EventBus } from "./event-bus.js";

describe("EventBus", () => {
  it("entrega a assinantes específicos e wildcard", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on("TaskCompleted", () => seen.push("specific"));
    bus.onAny(() => seen.push("any"));
    bus.publish({ name: "TaskCompleted", ts: new Date().toISOString(), data: {} });
    expect(seen).toEqual(["specific", "any"]);
  });

  it("um handler que lança não derruba os demais", () => {
    const bus = new EventBus();
    let reached = false;
    bus.on("TaskFailed", () => {
      throw new Error("boom");
    });
    bus.on("TaskFailed", () => {
      reached = true;
    });
    bus.publish({ name: "TaskFailed", ts: new Date().toISOString(), data: {} });
    expect(reached).toBe(true);
  });
});

describe("MetricsCollector (métrica por assinatura)", () => {
  it("um evento publicado gera uma métrica — sem chamada direta", () => {
    const db = openDatabase(":memory:");
    const metrics = new MetricsRepo(db);
    const bus = new EventBus();
    const collector = new MetricsCollector(metrics, bus);
    collector.start();

    expect(metrics.count()).toBe(0);
    bus.publish({
      name: "TaskCompleted",
      ts: new Date().toISOString(),
      runId: "run_1",
      taskId: "task_1",
      data: { durationMs: 42 },
    });
    expect(metrics.count()).toBe(1);

    collector.stop();
    db.close();
  });
});
