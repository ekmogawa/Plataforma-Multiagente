import {
  GateReview,
  StructuredRequest,
  ValidationReport,
  type ExecutionResult,
  type TaskSpec,
} from "@pm/contracts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { openDatabase } from "../db/database.js";
import { RunsRepo } from "../db/runs-repo.js";
import { TasksRepo, type SeedEntry } from "../db/tasks-repo.js";
import { renderEvidencePtBr } from "./evidence-template.js";
import { ProjectManager } from "./project-manager.js";

describe("renderEvidencePtBr", () => {
  it("monta um resumo pt-BR com as seções e as instruções de aprovação", () => {
    const md = renderEvidencePtBr({
      runId: "run_1",
      rawPrompt: "corrigir o login",
      translatedIntent: "Corrigir: login",
      workKind: "bugfix",
      projectSlug: "app",
      changedFiles: [{ path: "src/login.ts", action: "modified" }],
      validations: { passed: 2, failed: 0 },
      gateReview: GateReview.parse({ runId: "run_1", verdict: "approve", findings: [] }),
      costUsd: 0.01,
      spentTokens: 1234,
    });
    expect(md).toContain("O que você pediu");
    expect(md).toContain("src/login.ts");
    expect(md).toContain("pm approve run_1");
    expect(md).toContain("pm reject run_1");
  });
});

describe("ProjectManager.assembleEvidence", () => {
  it("reúne pedido, mudanças, validações e gate; persiste o resumo", () => {
    const db = openDatabase(":memory:");
    const artRoot = mkdtempSync(join(tmpdir(), "pm-ev-"));
    writeFileSync(join(artRoot, "pnpm-workspace.yaml"), "packages: []\n");
    const artifacts = new ArtifactStore(db, artRoot);
    const runs = new RunsRepo(db);
    runs.create({ id: "run_1", state: "done", projectSlug: "app", workKind: "bugfix" });
    runs.addSpend("run_1", 500, 0.02);

    const tasks = new TasksRepo(db);
    const spec: TaskSpec = {
      id: "n1", planNodeId: "n1", runId: "run_1", projectSlug: "app", type: "backend",
      executorKind: "llm", executorId: "worker.llm", complexity: 2,
      input: { files: [], instructions: "x", contextRefs: [] }, acceptanceCriteria: [], timeoutMs: 60000, maxRetries: 3,
    };
    const entries: SeedEntry[] = [{ spec, dependsRemaining: 0, initialState: "ready" }];
    tasks.seed("run_1", entries, [], "2026-01-01T00:00:00.000Z");
    const result: ExecutionResult = {
      taskId: "n1", attempt: 1, status: "success",
      changedFiles: [{ path: "src/login.ts", action: "modified" }], logs: "", durationMs: 0,
    };
    tasks.setResult("run_1", "n1", result, "2026-01-01T00:00:00.000Z");

    // Artefatos: pedido, validação, gate.
    artifacts.storeJson({
      runId: "run_1", kind: "report", name: "structured-request",
      data: StructuredRequest.parse({ id: "req_1", createdAt: "2026-01-01T00:00:00.000Z", rawPrompt: "corrigir o login", translatedIntent: "Corrigir: login", workKind: "bugfix", domain: "geral", deliverableType: "other" }),
    });
    artifacts.storeJson({
      runId: "run_1", taskId: "n1", kind: "test-result", name: "acc",
      data: ValidationReport.parse({ taskId: "n1", passed: true, checks: [] }), meta: { attempt: 1, passed: true },
    });
    artifacts.storeJson({
      runId: "run_1", kind: "gate-review", name: "gate-review",
      data: GateReview.parse({ runId: "run_1", verdict: "approve", findings: [] }),
    });

    const bundle = new ProjectManager({ artifacts, runs, tasks }).assembleEvidence("run_1");
    expect(bundle.verdict).toBe("approve");
    expect(bundle.changedFiles).toContainEqual({ path: "src/login.ts", action: "modified" });
    expect(bundle.validations).toEqual({ passed: 1, failed: 0 });
    expect(bundle.summaryPtBr).toContain("corrigir o login");
    // o resumo foi persistido como artefato 'evidence'
    expect(artifacts.listByRun("run_1").some((a) => a.kind === "evidence")).toBe(true);
    db.close();
  });
});
