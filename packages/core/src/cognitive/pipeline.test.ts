import { ProjectTarget, type EventName } from "@pm/contracts";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CapabilityResolver } from "../adapters/capability-resolver.js";
import { ModelResolver } from "../adapters/model-resolver.js";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { openDatabase } from "../db/database.js";
import { CacheRepo } from "../db/cache-repo.js";
import { MetricsRepo } from "../db/metrics-repo.js";
import { RunsRepo } from "../db/runs-repo.js";
import { loadModelsConfig, loadStrategiesConfig } from "../shared/config.js";
import { fixedClock } from "../shared/clock.js";
import { sequentialIds } from "../shared/ids.js";
import { EventBus } from "../shared/event-bus.js";
import { CognitivePipeline, type CognitiveDeps } from "./pipeline.js";
import { SAMPLE_NODE_PATH } from "./__fixtures__/pedidos.js";

const modelsConfig = loadModelsConfig();
const strategiesConfig = loadStrategiesConfig();

const target = ProjectTarget.parse({
  slug: "sample-node",
  rootPath: SAMPLE_NODE_PATH,
  kind: "registered",
});

function buildDeps(root: string, events: EventName[]): { deps: CognitiveDeps; db: ReturnType<typeof openDatabase> } {
  const db = openDatabase(":memory:");
  const bus = new EventBus();
  bus.onAny((e) => events.push(e.name));
  const deps: CognitiveDeps = {
    runs: new RunsRepo(db),
    artifacts: new ArtifactStore(db, root),
    metrics: new MetricsRepo(db),
    cache: new CacheRepo(db),
    bus,
    capabilityResolver: new CapabilityResolver(modelsConfig),
    gateway: new ModelResolver(modelsConfig),
    modelsConfig,
    strategiesConfig,
    clock: fixedClock(),
    ids: sequentialIds(),
    root,
  };
  return { deps, db };
}

describe("CognitivePipeline (offline)", () => {
  it("roda as 7 etapas, persiste artefatos, publica eventos e escreve plano.md", async () => {
    const root = mkdtempSync(join(tmpdir(), "pm-pipe-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const events: EventName[] = [];
    const { deps, db } = buildDeps(root, events);

    const result = await new CognitivePipeline(deps).plan({
      project: target,
      rawPrompt: "adicionar um filtro por data na tela de relatórios com endpoint no backend",
      workKind: "feature",
      preference: "auto", // sem chave -> heuristic
    });

    expect(result.mode).toBe("heuristic");
    expect(result.taskCount).toBeGreaterThanOrEqual(2);
    // Um artefato por etapa (project-map, 4 reports/decision, plan, dag, planned-tasks).
    expect(result.artifacts.length).toBeGreaterThanOrEqual(8);

    // Eventos de todas as etapas foram publicados.
    for (const name of [
      "RunRequested",
      "ProjectAnalyzed",
      "IntentCreated",
      "RequirementsReady",
      "ComplexityEstimated",
      "StrategySelected",
      "PlanningCompleted",
      "WorkflowCreated",
      "RunPlanned",
    ] as EventName[]) {
      expect(events).toContain(name);
    }

    // Run chegou a "planned".
    expect(deps.runs.get(result.runId)?.state).toBe("planned");

    // plano.md legível foi escrito.
    const plano = readFileSync(result.planoPath, "utf8");
    expect(plano).toContain("# Plano:");
    expect(plano).toContain("## O plano");
    db.close();
  });

  it("é determinístico: dois runs independentes geram o mesmo plano.md", async () => {
    const runOnce = async () => {
      const root = mkdtempSync(join(tmpdir(), "pm-pipe-"));
      writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
      const { deps, db } = buildDeps(root, []);
      const result = await new CognitivePipeline(deps).plan({
        project: target,
        rawPrompt: "corrigir o bug do formulário que não salva",
        workKind: "bugfix",
        preference: "heuristic",
      });
      const plano = readFileSync(result.planoPath, "utf8");
      db.close();
      return plano;
    };
    expect(await runOnce()).toBe(await runOnce());
  });
});
