import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { ArtifactStore } from "./artifact-store.js";

// Cria uma raiz temporária com o marcador pnpm-workspace.yaml para resolvePaths.
const root = mkdtempSync(join(tmpdir(), "pm-art-"));
writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");

describe("ArtifactStore", () => {
  const db = openDatabase(":memory:");
  const store = new ArtifactStore(db, root);

  it("grava e recupera um artefato por id", () => {
    const art = store.store({
      runId: "run_1",
      taskId: "task_1",
      kind: "log",
      name: "execucao",
      content: "linha de log",
    });
    expect(art.id).toMatch(/^art_/);
    expect(art.hash).toHaveLength(64);
    expect(store.readContent(art.id)).toBe("linha de log");
  });

  it("grava JSON e lista por run", () => {
    store.storeJson({
      runId: "run_1",
      kind: "plan",
      name: "plano",
      data: { roots: [] },
    });
    const list = store.listByRun("run_1");
    expect(list.length).toBe(2);
    expect(list.some((a) => a.kind === "plan")).toBe(true);
  });

  it("redige segredos antes de persistir", () => {
    const art = store.store({
      runId: "run_2",
      kind: "log",
      name: "com-segredo",
      content: "chamada com API_KEY=supersecreto12345 no header",
    });
    const content = store.readContent(art.id)!;
    expect(content).not.toContain("supersecreto12345");
    expect(content).toContain("[REDIGIDO]");
    expect(art.meta.redactions).toBe(1);
    expect(art.classification).toBe("project-internal");
  });

  afterAll(() => db.close());
});
