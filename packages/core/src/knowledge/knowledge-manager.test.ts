import { GateReview, StructuredRequest } from "@pm/contracts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { openDatabase } from "../db/database.js";
import { ProjectsRepo } from "../db/projects-repo.js";
import { RunsRepo } from "../db/runs-repo.js";
import { manualClock } from "../shared/clock.js";
import { EventBus } from "../shared/event-bus.js";
import { KnowledgeManager } from "./knowledge-manager.js";
import { KnowledgeProcessor } from "./knowledge-processor.js";
import { SqliteKnowledgeStore } from "./knowledge-store.js";
import { ObsidianWriter } from "./obsidian-writer.js";

function setup() {
  const db = openDatabase(":memory:");
  const artRoot = mkdtempSync(join(tmpdir(), "pm-km-art-"));
  writeFileSync(join(artRoot, "pnpm-workspace.yaml"), "packages: []\n");
  const artifacts = new ArtifactStore(db, artRoot);
  const runs = new RunsRepo(db);
  const projects = new ProjectsRepo(db);
  const store = new SqliteKnowledgeStore(db);
  const vault = mkdtempSync(join(tmpdir(), "pm-km-vault-"));
  const clock = manualClock();
  const writer = new ObsidianWriter({ vaultRoot: vault, store, clock });
  const processor = new KnowledgeProcessor({ store, writer });
  const bus = new EventBus();
  const manager = new KnowledgeManager({ bus, runs, projects, artifacts, store, writer, processor, clock });
  return { db, artifacts, runs, projects, store, writer, bus, manager };
}

function seedApprovedRun(artifacts: ArtifactStore, runs: RunsRepo, runId = "run_1"): void {
  runs.create({ id: runId, state: "approved", projectSlug: "app", workKind: "feature" });
  artifacts.storeJson({
    runId,
    kind: "report",
    name: "structured-request",
    data: StructuredRequest.parse({
      id: "req_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      rawPrompt: "adicionar botão de exportar CSV",
      translatedIntent: "Adiciona exportação CSV na tela de relatórios",
      workKind: "feature",
      domain: "geral",
      deliverableType: "other",
      constraints: ["precisa rodar offline"],
    }),
  });
  artifacts.storeJson({
    runId,
    kind: "gate-review",
    name: "gate-review",
    data: GateReview.parse({
      runId,
      verdict: "revise",
      findings: [{ category: "debt", severity: "warn", text: "console.log encontrado", file: "src/exp.js" }],
    }),
  });
  artifacts.store({ runId, kind: "evidence", name: "resumo", content: "## Resumo\nExportação CSV adicionada." });
}

describe("KnowledgeManager (aprovar run -> vault ganha nota)", () => {
  it("registra nota do run, lição e índice; a busca encontra", () => {
    const { db, artifacts, runs, store, manager } = setup();
    seedApprovedRun(artifacts, runs);

    const res = manager.onRunApproved("run_1");
    expect(res.captured).toBe(true);
    expect(res.notes).toBeGreaterThanOrEqual(2); // nota do run + índice (+ ADR pela constraint)
    expect(res.lessons).toBe(1); // um achado do Gatekeeper

    // a nota do run existe no índice e é encontrável
    const runNote = store.get("projetos:app:runs:run_1");
    expect(runNote).toBeTruthy();
    expect(runNote?.body).toContain("Exportação CSV"); // veio da evidência
    const hits = store.search({ text: "exportar CSV", projectSlug: "app", processedOnly: false });
    expect(hits.some((h) => h.noteId === "projetos:app:runs:run_1")).toBe(true);

    // a lição do achado foi registrada
    expect(store.listByProject("app", "licao").length).toBe(1);
    // ADR pela constraint "precisa rodar offline"
    expect(store.listByProject("app", "decisao").length).toBe(1);
    db.close();
  });

  it("é NO-OP quando o run não está aprovado", () => {
    const { db, artifacts, runs, store, manager } = setup();
    runs.create({ id: "run_x", state: "done", projectSlug: "app", workKind: "feature" });
    const res = manager.onRunApproved("run_x");
    expect(res.captured).toBe(false);
    expect(store.listByProject("app").length).toBe(0);
    db.close();
  });

  it("reage ao evento RunApproved publicado no bus", () => {
    const { db, artifacts, runs, store, bus, manager } = setup();
    seedApprovedRun(artifacts, runs, "run_2");
    manager.start();
    bus.publish({ name: "RunApproved", ts: "2026-01-01T00:00:00.000Z", runId: "run_2", producer: "test", data: {} });
    expect(store.get("projetos:app:runs:run_2")).toBeTruthy();
    db.close();
  });
});
