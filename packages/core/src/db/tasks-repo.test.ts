import type { ExecutionResult, TaskSpec, WorkflowEdge } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { RunsRepo } from "./runs-repo.js";
import { TasksRepo, type SeedEntry } from "./tasks-repo.js";

const NOW = "2026-01-01T00:00:00.000Z";

function spec(id: string, maxRetries = 3): TaskSpec {
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
    maxRetries,
  };
}

function result(id: string, attempt = 1): ExecutionResult {
  return { taskId: id, attempt, status: "success", changedFiles: [], logs: "", durationMs: 0 };
}

function setup(): { db: ReturnType<typeof openDatabase>; tasks: TasksRepo } {
  const db = openDatabase(":memory:");
  new RunsRepo(db).create({ id: "run_1", state: "running" });
  return { db, tasks: new TasksRepo(db) };
}

// n1 -> n2 -> n3 (cadeia)
function seedChain(tasks: TasksRepo): void {
  const entries: SeedEntry[] = [
    { spec: spec("n1"), dependsRemaining: 0, initialState: "ready" },
    { spec: spec("n2"), dependsRemaining: 1, initialState: "pending" },
    { spec: spec("n3"), dependsRemaining: 1, initialState: "pending" },
  ];
  const edges: WorkflowEdge[] = [
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3" },
  ];
  tasks.seed("run_1", entries, edges, NOW);
}

describe("TasksRepo", () => {
  it("seed insere tarefas e arestas; getReady traz só as prontas", () => {
    const { db, tasks } = setup();
    seedChain(tasks);
    expect(tasks.hasTasks("run_1")).toBe(true);
    const ready = tasks.getReady("run_1", 10);
    expect(ready.map((t) => t.id)).toEqual(["n1"]);
    db.close();
  });

  it("claim é atômico e idempotente (WHERE state='ready')", () => {
    const { db, tasks } = setup();
    seedChain(tasks);
    const cands = tasks.getReady("run_1", 10);
    const first = tasks.claim(cands, () => "2026-01-01T00:02:00.000Z", NOW);
    expect(first.map((t) => t.id)).toEqual(["n1"]);
    expect(first[0]?.attempt).toBe(1);
    // Segundo claim dos MESMOS candidatos (estado já não é 'ready') -> vazio.
    const second = tasks.claim(cands, () => "2026-01-01T00:02:00.000Z", NOW);
    expect(second).toEqual([]);
    db.close();
  });

  it("completeAndCascade decrementa dependents e promove pending->ready", () => {
    const { db, tasks } = setup();
    seedChain(tasks);
    tasks.claim(tasks.getReady("run_1", 10), () => "L", NOW);
    const promoted = tasks.completeAndCascade("run_1", "n1", result("n1"), NOW);
    expect(promoted).toEqual(["n2"]);
    expect(tasks.get("run_1", "n2")?.state).toBe("ready");
    expect(tasks.get("run_1", "n1")?.state).toBe("done");
    expect(tasks.get("run_1", "n3")?.state).toBe("pending"); // ainda depende de n2
    db.close();
  });

  it("blockDownstream marca sucessores transitivos como blocked", () => {
    const { db, tasks } = setup();
    seedChain(tasks);
    const blocked = tasks.blockDownstream("run_1", "n1", NOW);
    expect(blocked.sort()).toEqual(["n2", "n3"]);
    db.close();
  });

  it("promoteRetryable respeita not_before (ISO lexicográfico)", () => {
    const { db, tasks } = setup();
    seedChain(tasks);
    tasks.claim(tasks.getReady("run_1", 10), () => "L", NOW);
    tasks.markRetrying("run_1", "n1", "2026-01-01T00:05:00.000Z", NOW);
    // Antes do not_before: não promove.
    expect(tasks.promoteRetryable("run_1", "2026-01-01T00:01:00.000Z")).toBe(0);
    // Depois: promove.
    expect(tasks.promoteRetryable("run_1", "2026-01-01T00:06:00.000Z")).toBe(1);
    expect(tasks.get("run_1", "n1")?.state).toBe("ready");
    db.close();
  });

  it("reconcile escala órfão que esgotou retries E bloqueia downstream (#1)", () => {
    const { db, tasks } = setup();
    // a -> b, a com maxRetries=1.
    tasks.seed(
      "run_1",
      [
        { spec: spec("a", 1), dependsRemaining: 0, initialState: "ready" },
        { spec: spec("b", 3), dependsRemaining: 1, initialState: "pending" },
      ],
      [{ from: "a", to: "b" }],
      NOW,
    );
    tasks.claim(tasks.getReady("run_1", 10), () => "L", NOW); // a: attempt 1 (== maxRetries)
    const rep = tasks.reconcile("run_1", NOW);
    expect(rep.escalated).toBe(1);
    expect(tasks.get("run_1", "a")?.state).toBe("escalated");
    // Downstream bloqueado — igual ao caminho sem crash.
    expect(tasks.get("run_1", "b")?.state).toBe("blocked");
    db.close();
  });

  it("reconcile conclui órfão 'validating' com sucesso persistido (#2)", () => {
    const { db, tasks } = setup();
    tasks.seed(
      "run_1",
      [
        { spec: spec("a", 1), dependsRemaining: 0, initialState: "ready" },
        { spec: spec("b", 3), dependsRemaining: 1, initialState: "pending" },
      ],
      [{ from: "a", to: "b" }],
      NOW,
    );
    tasks.claim(tasks.getReady("run_1", 10), () => "L", NOW); // a attempt 1
    tasks.setResult("run_1", "a", result("a"), NOW); // sucesso persistido
    tasks.markValidating("run_1", "a", NOW); // crash entre validating e completeAndCascade
    const rep = tasks.reconcile("run_1", NOW);
    expect(rep.completed).toBe(1);
    expect(tasks.get("run_1", "a")?.state).toBe("done"); // concluída, não escalada
    expect(tasks.get("run_1", "b")?.state).toBe("ready"); // dependente promovido
    db.close();
  });

  it("ids posicionais iguais NÃO colidem entre runs (PK composta run_id,id)", () => {
    const db = openDatabase(":memory:");
    const runs = new RunsRepo(db);
    runs.create({ id: "run_1", state: "running" });
    runs.create({ id: "run_2", state: "running" });
    const tasks = new TasksRepo(db);
    const entry = (rid: string) => {
      const s = spec("n1");
      s.runId = rid;
      return [{ spec: s, dependsRemaining: 0, initialState: "ready" as const }];
    };
    // Mesmo id "n1" em runs diferentes — não deve lançar.
    tasks.seed("run_1", entry("run_1"), [], NOW);
    tasks.seed("run_2", entry("run_2"), [], NOW);
    // Operações são escopadas por run: concluir n1 do run_1 não afeta o run_2.
    tasks.completeAndCascade("run_1", "n1", result("n1"), NOW);
    expect(tasks.get("run_1", "n1")?.state).toBe("done");
    expect(tasks.get("run_2", "n1")?.state).toBe("ready");
    db.close();
  });

  it("reconcile reverte órfãos (running) e preserva o limite duro", () => {
    const { db, tasks } = setup();
    // n1 running com attempt no limite -> escalated; outra com folga -> retrying.
    tasks.seed(
      "run_1",
      [
        { spec: spec("a", 1), dependsRemaining: 0, initialState: "ready" },
        { spec: spec("b", 3), dependsRemaining: 0, initialState: "ready" },
      ],
      [],
      NOW,
    );
    // "a": 1 tentativa (== maxRetries 1); "b": 1 tentativa (< 3).
    tasks.claim(tasks.getReady("run_1", 10), () => "L", NOW);
    const rep = tasks.reconcile("run_1", NOW);
    expect(rep.escalated).toBe(1); // a
    expect(rep.reverted).toBe(1); // b
    expect(tasks.get("run_1", "a")?.state).toBe("escalated");
    expect(tasks.get("run_1", "b")?.state).toBe("retrying");
    db.close();
  });
});
