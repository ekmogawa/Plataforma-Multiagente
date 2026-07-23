import {
  ExecutionStrategy,
  ProjectMap,
  type TaskSpec,
  type WorkflowEdge,
} from "@pm/contracts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../artifacts/artifact-store.js";
import { openDatabase, type DB } from "../../db/database.js";
import { RunsRepo } from "../../db/runs-repo.js";
import { TasksRepo, type SeedEntry } from "../../db/tasks-repo.js";
import { ContextBuilder } from "../../execution/context-builder.js";
import { StaticImportCodeGraph } from "../../execution/code-graph-port.js";
import { ExecutorRegistry } from "../../execution/executor-registry.js";
import { EchoWorker, type EchoWorkerOptions } from "../../execution/workers/echo.js";
import { loadEspecialidadesConfig } from "../../shared/config.js";
import { manualClock } from "../../shared/clock.js";
import { EventBus } from "../../shared/event-bus.js";
import { Dispatcher } from "./dispatcher.js";
import { PassThroughAcceptance } from "./acceptance-gate.js";
import { RetryManager } from "./retry-manager.js";
import { Scheduler } from "./scheduler.js";

const especialidades = loadEspecialidadesConfig();
const strategy = ExecutionStrategy.parse({
  profile: "standard",
  planningDepth: "epics",
  validationLevel: "standard",
  modelTierCeiling: "mid",
  maxRetries: 3,
  budgetTokens: 200000,
  concurrency: 3,
});
const projectMap = ProjectMap.parse({
  slug: "p",
  generatedAt: "2026-01-01T00:00:00.000Z",
  structure: [],
  dependencies: {},
  conventions: [],
});

function makeSpec(id: string): TaskSpec {
  return {
    id,
    planNodeId: id,
    runId: "run_1",
    projectSlug: "p",
    type: "backend",
    executorKind: "deterministic",
    executorId: "worker.echo",
    complexity: 2,
    input: { files: [], instructions: id, contextRefs: [] },
    acceptanceCriteria: [],
    timeoutMs: 60000,
    maxRetries: strategy.maxRetries,
  };
}

/** Constrói entries + edges a partir de defs {id, deps}. */
function buildSeed(defs: { id: string; deps?: string[] }[]): {
  entries: SeedEntry[];
  edges: WorkflowEdge[];
} {
  const entries: SeedEntry[] = defs.map((d) => ({
    spec: makeSpec(d.id),
    dependsRemaining: d.deps?.length ?? 0,
    initialState: (d.deps?.length ?? 0) === 0 ? "ready" : "pending",
  }));
  const edges: WorkflowEdge[] = [];
  for (const d of defs) for (const dep of d.deps ?? []) edges.push({ from: dep, to: d.id });
  return { entries, edges };
}

/** 20 tarefas: 5 cadeias paralelas de 4. */
function twentyNodeDag() {
  const defs: { id: string; deps?: string[] }[] = [];
  for (let c = 0; c < 5; c++)
    for (let k = 0; k < 4; k++)
      defs.push({ id: `t${c}${k}`, deps: k > 0 ? [`t${c}${k - 1}`] : [] });
  return defs;
}

interface Harness {
  db: DB;
  tasks: TasksRepo;
  runs: RunsRepo;
  scheduler: Scheduler;
  events: string[];
}

function makeHarness(
  db: DB,
  echoOpts: EchoWorkerOptions,
  opts: { concurrency?: number; maxEscalations?: number } = {},
): Harness {
  const tmpRoot = mkdtempSync(join(tmpdir(), "pm-orch-"));
  writeFileSync(join(tmpRoot, "pnpm-workspace.yaml"), "packages: []\n");
  const tasks = new TasksRepo(db);
  const runs = new RunsRepo(db);
  const bus = new EventBus();
  const events: string[] = [];
  bus.onAny((e) => events.push(e.name));
  const registry = new ExecutorRegistry();
  registry.register(new EchoWorker(echoOpts));
  const clock = manualClock();

  const scheduler = new Scheduler({
    runId: "run_1",
    strategy,
    projectMap,
    tasks,
    runs,
    dispatcher: new Dispatcher(registry),
    acceptanceGate: new PassThroughAcceptance(),
    retryManager: new RetryManager({ backoffBaseMs: 0, backoffFactor: 2, backoffMaxMs: 0 }),
    contextBuilder: new ContextBuilder({
      root: tmpRoot,
      codeGraph: new StaticImportCodeGraph(tmpRoot, 12),
      especialidades,
      maxTokensPerTask: 8000,
      maxFileBytes: 32000,
      maxNeighbors: 12,
    }),
    artifacts: new ArtifactStore(db, tmpRoot),
    bus,
    clock,
    config: {
      concurrency: opts.concurrency ?? strategy.concurrency,
      backoffBaseMs: 0,
      backoffFactor: 2,
      backoffMaxMs: 0,
      leaseGraceMs: 5000,
      maxEscalations: opts.maxEscalations ?? 3,
      maxTicks: 10000,
    },
  });
  return { db, tasks, runs, scheduler, events };
}

async function drive(scheduler: Scheduler, maxTicks = 2000): Promise<number> {
  let ticks = 0;
  while (ticks < maxTicks) {
    await scheduler.tick();
    await scheduler.settle();
    ticks++;
    if (scheduler.isPaused() && scheduler.inFlightCount() === 0) break;
    if (!scheduler.hasPendingWork()) break;
  }
  return ticks;
}

function seedRun(db: DB, defs: { id: string; deps?: string[] }[]): void {
  new RunsRepo(db).create({ id: "run_1", state: "running", strategy, projectSlug: "p", workKind: "feature" });
  const { entries, edges } = buildSeed(defs);
  new TasksRepo(db).seed("run_1", entries, edges, "2026-01-01T00:00:00.000Z");
}

describe("orquestrador (harness determinístico)", () => {
  it("DAG de 20 nós conclui respeitando as dependências", async () => {
    const db = openDatabase(":memory:");
    seedRun(db, twentyNodeDag());
    const h = makeHarness(db, {});
    await drive(h.scheduler);
    const c = h.tasks.countByState("run_1");
    expect(c.done).toBe(20);
    expect(h.events.filter((e) => e === "TaskCompleted").length).toBe(20);
    db.close();
  });

  it("respeita a concorrência (nunca mais de N ativas)", async () => {
    const db = openDatabase(":memory:");
    seedRun(db, twentyNodeDag());
    const h = makeHarness(db, {}, { concurrency: 3 });
    let maxActive = 0;
    for (let i = 0; i < 2000 && h.scheduler.hasPendingWork(); i++) {
      const r = await h.scheduler.tick();
      await h.scheduler.settle();
      maxActive = Math.max(maxActive, r.active);
    }
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(h.tasks.countByState("run_1").done).toBe(20);
    db.close();
  });

  it("retry: tarefa que falha 1x se recupera e o run conclui", async () => {
    const db = openDatabase(":memory:");
    seedRun(db, twentyNodeDag());
    // t00 falha na tentativa 1, sucesso na 2.
    const h = makeHarness(db, { failUntilAttempt: new Map([["t00", 2]]) });
    await drive(h.scheduler);
    expect(h.tasks.countByState("run_1").done).toBe(20);
    expect(h.tasks.get("run_1", "t00")?.attempt).toBe(2);
    expect(h.events).toContain("TaskFailed");
    db.close();
  });

  it("escalonamento: falha permanente -> escalated -> downstream blocked -> RunPaused", async () => {
    const db = openDatabase(":memory:");
    seedRun(db, twentyNodeDag());
    // t00 sempre falha; maxEscalations=1 -> pausa após a 1ª escalação.
    const h = makeHarness(db, { failTaskIds: new Set(["t00"]) }, { maxEscalations: 1 });
    await drive(h.scheduler);
    expect(h.scheduler.isPaused()).toBe(true);
    expect(h.tasks.get("run_1", "t00")?.state).toBe("escalated");
    expect(h.tasks.get("run_1", "t00")?.attempt).toBe(3); // esgotou maxRetries
    // downstream da cadeia 0 bloqueada.
    expect(h.tasks.get("run_1", "t01")?.state).toBe("blocked");
    expect(h.tasks.get("run_1", "t03")?.state).toBe("blocked");
    expect(h.runs.get("run_1")?.state).toBe("paused");
    expect(h.events).toContain("TaskEscalated");
    expect(h.events).toContain("RunPaused");
    db.close();
  });

  it("kill/resume: retomar após interrupção converge ao mesmo estado terminal", async () => {
    const dbFile = join(mkdtempSync(join(tmpdir(), "pm-resume-")), "platform.db");
    const db1 = openDatabase(dbFile);
    seedRun(db1, twentyNodeDag());
    const h1 = makeHarness(db1, {});
    // Roda só alguns ticks (interrupção no meio).
    for (let i = 0; i < 3; i++) {
      await h1.scheduler.tick();
      await h1.scheduler.settle();
    }
    const partial = h1.tasks.countByState("run_1").done ?? 0;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(20);
    db1.close(); // "crash"

    // Novo processo: reabre, reconcilia, continua. O reconcile usa o MESMO
    // instante do relógio do novo scheduler (em produção o systemClock é
    // consistente), para os retrys reconciliados promoverem imediatamente.
    const db2 = openDatabase(dbFile);
    const tasks2 = new TasksRepo(db2);
    tasks2.reconcile("run_1", "2026-01-01T00:00:00.000Z");
    const h2 = makeHarness(db2, {});
    await drive(h2.scheduler);
    expect(tasks2.countByState("run_1").done).toBe(20);
    db2.close();
  });
});
