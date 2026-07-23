import {
  ProjectTarget,
  type ExecutionResult,
  type GateFinding,
  type TaskSpec,
} from "@pm/contracts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { openDatabase } from "../db/database.js";
import { RunsRepo } from "../db/runs-repo.js";
import { TasksRepo, type SeedEntry } from "../db/tasks-repo.js";
import { buildGateInput } from "./gate-input.js";
import { runDeterministicChecks, DEFAULT_GATEKEEPER_CONFIG } from "./checks.js";
import { decideVerdict } from "./verdict.js";
import { Gatekeeper } from "./gatekeeper.js";

function spec(id: string): TaskSpec {
  return {
    id,
    planNodeId: id,
    runId: "run_1",
    projectSlug: "p",
    type: "backend",
    executorKind: "llm",
    executorId: "worker.llm",
    complexity: 2,
    input: { files: [], instructions: "x", contextRefs: [] },
    acceptanceCriteria: [],
    timeoutMs: 60000,
    maxRetries: 3,
  };
}

function setup(files: { path: string; content: string }[]): {
  root: string;
  tasks: TasksRepo;
  artifacts: ArtifactStore;
  target: ProjectTarget;
  db: ReturnType<typeof openDatabase>;
} {
  const root = mkdtempSync(join(tmpdir(), "pm-gov-"));
  const artRoot = mkdtempSync(join(tmpdir(), "pm-gov-art-"));
  writeFileSync(join(artRoot, "pnpm-workspace.yaml"), "packages: []\n");
  for (const f of files) {
    const abs = join(root, f.path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, f.content);
  }
  const db = openDatabase(":memory:");
  new RunsRepo(db).create({ id: "run_1", state: "running", projectSlug: "p", workKind: "feature" });
  const tasks = new TasksRepo(db);
  const entries: SeedEntry[] = [{ spec: spec("n1"), dependsRemaining: 0, initialState: "ready" }];
  tasks.seed("run_1", entries, [], "2026-01-01T00:00:00.000Z");
  const result: ExecutionResult = {
    taskId: "n1",
    attempt: 1,
    status: "success",
    changedFiles: files.map((f) => ({ path: f.path, action: "created" as const })),
    logs: "",
    durationMs: 0,
  };
  tasks.setResult("run_1", "n1", result, "2026-01-01T00:00:00.000Z");
  const artifacts = new ArtifactStore(db, artRoot);
  const target = ProjectTarget.parse({ slug: "p", rootPath: root, kind: "registered" });
  return { root, tasks, artifacts, target, db };
}

describe("buildGateInput", () => {
  it("agrega changedFiles e lê o conteúdo do disco", () => {
    const { tasks, root, db } = setup([{ path: "src/a.js", content: "export const a=1;\n" }]);
    const input = buildGateInput(tasks, "run_1", root);
    expect(input.files).toHaveLength(1);
    expect(input.files[0]?.content).toContain("a=1");
    db.close();
  });

  it("arquivo deletado-e-recriado é escaneado pelo conteúdo do disco (não some do gate)", () => {
    // A verdade é o disco: se o arquivo existe, o segredo tem que ser visto —
    // mesmo que uma task anterior o tenha marcado como 'deleted'.
    const root = mkdtempSync(join(tmpdir(), "pm-gov-recreate-"));
    const artRoot = mkdtempSync(join(tmpdir(), "pm-gov-recreate-art-"));
    writeFileSync(join(artRoot, "pnpm-workspace.yaml"), "packages: []\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/config.js"), 'const API_KEY = "sk-abc123def456ghi789jkl";\n');

    const db = openDatabase(":memory:");
    new RunsRepo(db).create({ id: "run_1", state: "running", projectSlug: "p", workKind: "feature" });
    const tasks = new TasksRepo(db);
    const entries: SeedEntry[] = [
      { spec: spec("n1"), dependsRemaining: 0, initialState: "ready" },
      { spec: spec("n2"), dependsRemaining: 0, initialState: "ready" },
    ];
    tasks.seed("run_1", entries, [], "2026-01-01T00:00:00.000Z");
    // n1 apaga; n2 (posterior) recria o mesmo path com um segredo.
    tasks.setResult("run_1", "n1", {
      taskId: "n1", attempt: 1, status: "success",
      changedFiles: [{ path: "src/config.js", action: "deleted" }], logs: "", durationMs: 0,
    }, "2026-01-01T00:00:01.000Z");
    tasks.setResult("run_1", "n2", {
      taskId: "n2", attempt: 1, status: "success",
      changedFiles: [{ path: "src/config.js", action: "created" }], logs: "", durationMs: 0,
    }, "2026-01-01T00:00:02.000Z");

    const input = buildGateInput(tasks, "run_1", root);
    const f = input.files.find((x) => x.path === "src/config.js");
    expect(f?.action).not.toBe("deleted"); // existe no disco -> não é 'deleted'
    expect(f?.content).toContain("sk-abc"); // conteúdo lido, disponível ao scan
    const findings = runDeterministicChecks(input, DEFAULT_GATEKEEPER_CONFIG);
    expect(findings.some((x) => x.category === "security")).toBe(true); // segredo detectado
    db.close();
  });
});

describe("checks determinísticos", () => {
  it("detecta segredo (sem vazá-lo) e escala", () => {
    const { tasks, root, db } = setup([
      { path: "src/config.js", content: 'const API_KEY = "sk-abc123def456ghi789jkl";\n' },
    ]);
    const input = buildGateInput(tasks, "run_1", root);
    const findings = runDeterministicChecks(input, DEFAULT_GATEKEEPER_CONFIG);
    const secret = findings.find((f) => f.category === "security");
    expect(secret).toBeTruthy();
    expect(secret!.severity).toBe("high");
    expect(secret!.text).not.toContain("sk-abc"); // NUNCA o segredo
    expect(decideVerdict(findings)).toBe("escalate");
    db.close();
  });

  it("padrão proibido eval() vira finding de segurança", () => {
    const { tasks, root, db } = setup([{ path: "src/x.js", content: "eval(userInput);\n" }]);
    const findings = runDeterministicChecks(buildGateInput(tasks, "run_1", root), DEFAULT_GATEKEEPER_CONFIG);
    expect(findings.some((f) => f.text.includes("eval"))).toBe(true);
    db.close();
  });

  it("código limpo -> approve", () => {
    const { tasks, root, db } = setup([{ path: "src/ok.js", content: "export const soma = (a,b) => a+b;\n" }]);
    const findings = runDeterministicChecks(buildGateInput(tasks, "run_1", root), DEFAULT_GATEKEEPER_CONFIG);
    expect(decideVerdict(findings)).toBe("approve");
    db.close();
  });
});

describe("decideVerdict", () => {
  const f = (over: Partial<GateFinding>): GateFinding => ({ category: "debt", severity: "info", text: "x", ...over });
  it("critical/high-security -> escalate; warn/high -> revise; info -> approve", () => {
    expect(decideVerdict([f({ severity: "critical" })])).toBe("escalate");
    expect(decideVerdict([f({ severity: "high", category: "security" })])).toBe("escalate");
    expect(decideVerdict([f({ severity: "high", category: "debt" })])).toBe("revise");
    expect(decideVerdict([f({ severity: "warn" })])).toBe("revise");
    expect(decideVerdict([f({ severity: "info" })])).toBe("approve");
    expect(decideVerdict([])).toBe("approve");
  });
});

describe("Gatekeeper.review (offline, determinístico)", () => {
  it("produz GateReview, decide o verdict e persiste o artefato", async () => {
    const { tasks, artifacts, target, db } = setup([
      { path: "src/config.js", content: '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n' },
    ]);
    const review = await new Gatekeeper({ tasks, artifacts, target }).review("run_1");
    expect(review.verdict).toBe("escalate"); // PEM privado = critical
    expect(review.findings.some((f) => f.severity === "critical")).toBe(true);
    const persisted = artifacts.listByRun("run_1").filter((a) => a.kind === "gate-review");
    expect(persisted).toHaveLength(1);
    db.close();
  });
});
