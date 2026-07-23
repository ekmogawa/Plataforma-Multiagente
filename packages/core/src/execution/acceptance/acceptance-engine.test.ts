import { ProjectMap, ProjectTarget, type ExecutionResult, type TaskSpec } from "@pm/contracts";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../artifacts/artifact-store.js";
import { openDatabase } from "../../db/database.js";
import { fixedClock } from "../../shared/clock.js";
import { AcceptanceEngine } from "./acceptance-engine.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "tiny-project");

const db = openDatabase(":memory:");
const artifactRoot = mkdtempSync(join(tmpdir(), "pm-acc-art-"));
writeFileSync(join(artifactRoot, "pnpm-workspace.yaml"), "packages: []\n");
const artifacts = new ArtifactStore(db, artifactRoot);

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-acc-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function specAndResult(): { spec: TaskSpec; result: ExecutionResult } {
  const spec: TaskSpec = {
    id: "n1",
    planNodeId: "n1",
    runId: "run_1",
    projectSlug: "tiny",
    type: "backend",
    executorKind: "llm",
    executorId: "worker.llm",
    complexity: 2,
    input: { files: [], instructions: "x", contextRefs: [] },
    acceptanceCriteria: [],
    timeoutMs: 60000,
    maxRetries: 3,
  };
  const result: ExecutionResult = {
    taskId: "n1",
    attempt: 1,
    status: "success",
    changedFiles: [{ path: "src/sum.js", action: "modified" }],
    logs: "",
    durationMs: 0,
  };
  return { spec, result };
}

function engineFor(root: string): AcceptanceEngine {
  const projectMap = ProjectMap.parse({
    slug: "tiny",
    generatedAt: "2026-01-01T00:00:00.000Z",
    structure: [],
    dependencies: {},
    testCommand: "node --test",
  });
  const target = ProjectTarget.parse({ slug: "tiny", rootPath: root, kind: "registered" });
  return new AcceptanceEngine({ target, projectMap, artifacts, clock: fixedClock() });
}

describe("AcceptanceEngine (roda testes REAIS, offline)", () => {
  it("aprova quando os testes do projeto passam", async () => {
    const root = copyFixture();
    const { spec, result } = specAndResult();
    const verdict = await engineFor(root).evaluate(spec, result);
    expect(verdict.pass).toBe(true);
  }, 30000);

  it("reprova quando os testes falham, com failureSummary", async () => {
    const root = copyFixture();
    // Quebra o código: sum passa a subtrair -> o teste falha.
    writeFileSync(join(root, "src", "sum.js"), "export function sum(a, b) {\n  return a - b;\n}\n");
    const { spec, result } = specAndResult();
    const verdict = await engineFor(root).evaluate(spec, result);
    expect(verdict.pass).toBe(false);
    expect(verdict.report).toBeTruthy();
  }, 30000);

  it("sem checks bloqueantes (projeto sem testes): passa MAS marca 'sem verificação'", async () => {
    const root = mkdtempSync(join(tmpdir(), "pm-acc-empty-"));
    writeFileSync(join(root, "readme.txt"), "sem testes aqui\n");
    const projectMap = ProjectMap.parse({
      slug: "vazio",
      generatedAt: "2026-01-01T00:00:00.000Z",
      structure: [],
      dependencies: {},
      // sem testCommand, sem tsconfig -> nenhum check bloqueante
    });
    const target = ProjectTarget.parse({ slug: "vazio", rootPath: root, kind: "registered" });
    const engine = new AcceptanceEngine({ target, projectMap, artifacts, clock: fixedClock() });
    const { spec, result } = specAndResult();
    const verdict = await engine.evaluate(spec, result);
    expect(verdict.pass).toBe(true);
    // O ValidationReport persistido deixa explícito que não houve verificação.
    const arts = artifacts.listByRun("run_1").filter((a) => a.kind === "test-result");
    const last = arts[arts.length - 1]!;
    const report = JSON.parse(artifacts.readContent(last.id)!);
    expect(report.checks.some((c: { name: string }) => c.name.includes("sem verificação"))).toBe(true);
  }, 30000);

  afterAll(() => db.close());
});
