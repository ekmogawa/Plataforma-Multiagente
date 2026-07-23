import type { MetricEvent } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { EvolutionRepo } from "../db/evolution-repo.js";
import { MetricsRepo } from "../db/metrics-repo.js";
import { manualClock } from "../shared/clock.js";
import { EvolutionEngine } from "./evolution-engine.js";
import { runEvolutionRules } from "./evolution-rules.js";

function metric(over: Partial<MetricEvent>): MetricEvent {
  return { ts: "2026-01-01T00:00:00.000Z", kind: "task_result", meta: {}, ...over };
}

describe("EvolutionEngine.analyze (offline, heurística)", () => {
  it("escalação frequente -> proposta rastreável com source=heuristica", () => {
    const db = openDatabase(":memory:");
    const metrics = new MetricsRepo(db);
    // 6 tarefas, 3 escalações (50% > 30%)
    for (let i = 0; i < 6; i++) metrics.record(metric({ kind: "task_result", success: i % 2 === 0 }));
    for (let i = 0; i < 3; i++) metrics.record(metric({ kind: "escalation" }));

    const report = new EvolutionEngine({ metrics, proposals: new EvolutionRepo(db), clock: manualClock() }).analyze();
    expect(report.proposals.length).toBeGreaterThanOrEqual(1);
    const p = report.proposals.find((x) => x.category === "strategy-tuning");
    expect(p).toBeTruthy();
    expect(p!.source).toBe("heuristica");
    expect(p!.evidence.metricRefs.length).toBeGreaterThan(0); // rastreável
    // persistida na tabela
    expect(new EvolutionRepo(db).listByStatus("proposed").length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("amostra insuficiente -> zero propostas (honesto)", () => {
    const db = openDatabase(":memory:");
    const metrics = new MetricsRepo(db);
    metrics.record(metric({ kind: "escalation" }));
    const report = new EvolutionEngine({ metrics, proposals: new EvolutionRepo(db), clock: manualClock() }).analyze();
    expect(report.proposals.length).toBe(0);
    db.close();
  });

  it("não re-propõe um locator já aplicado/descartado", () => {
    const db = openDatabase(":memory:");
    const metrics = new MetricsRepo(db);
    for (let i = 0; i < 6; i++) metrics.record(metric({ kind: "task_result", success: true }));
    for (let i = 0; i < 3; i++) metrics.record(metric({ kind: "escalation" }));
    const proposals = new EvolutionRepo(db);
    const clock = manualClock();

    const first = new EvolutionEngine({ metrics, proposals, clock }).analyze();
    const p = first.proposals[0]!;
    // usuário descarta a proposta (decisão humana)
    proposals.setStatus(p.id, "dismissed");
    const second = new EvolutionEngine({ metrics, proposals, clock }).analyze();
    expect(second.proposals.some((x) => x.target.locator === p.target.locator)).toBe(false);
    db.close();
  });
});

describe("runEvolutionRules (regras puras)", () => {
  it("capacidade com alta taxa de falha vira proposta de routing", () => {
    const drafts = runEvolutionRules({
      capabilities: [{ capability: "coder-backend", total: 10, failures: 6, degraded: 0, avg_cost: 0.01 }],
      prompts: [],
      tasks: { total: 0, failures: 0, escalations: 0 },
    });
    expect(drafts.length).toBe(1);
    expect(drafts[0]?.category).toBe("routing");
    expect(drafts[0]?.target.locator).toBe("capabilities.coder-backend");
    expect(drafts[0]?.confidence).toBe("alta"); // 60% falha
  });

  it("amostra abaixo do mínimo não gera proposta", () => {
    const drafts = runEvolutionRules({
      capabilities: [{ capability: "x", total: 3, failures: 3, degraded: 0, avg_cost: 0 }],
      prompts: [],
      tasks: { total: 0, failures: 0, escalations: 0 },
    });
    expect(drafts.length).toBe(0);
  });

  it("proposta de prompt-revision é rastreável À VERSÃO (metricRef inclui prompt_version)", () => {
    const drafts = runEvolutionRules({
      capabilities: [],
      prompts: [{ promptId: "planner", promptVersion: 2, total: 5, failures: 3 }],
      tasks: { total: 0, failures: 0, escalations: 0 },
    });
    expect(drafts.length).toBe(1);
    const ref = drafts[0]?.evidence.metricRefs[0] ?? "";
    expect(ref).toContain("prompt_id='planner'");
    expect(ref).toContain("prompt_version=2"); // escopado à versão, como o sampleSize
  });
});
