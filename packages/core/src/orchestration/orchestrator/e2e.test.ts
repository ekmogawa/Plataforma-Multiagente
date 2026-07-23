import { ProjectTarget } from "@pm/contracts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CapabilityResolver } from "../../adapters/capability-resolver.js";
import { ModelResolver } from "../../adapters/model-resolver.js";
import { ArtifactStore } from "../../artifacts/artifact-store.js";
import { openDatabase } from "../../db/database.js";
import { CacheRepo } from "../../db/cache-repo.js";
import { MetricsRepo } from "../../db/metrics-repo.js";
import { ProjectsRepo } from "../../db/projects-repo.js";
import { RunsRepo } from "../../db/runs-repo.js";
import { TasksRepo } from "../../db/tasks-repo.js";
import { CognitivePipeline } from "../../cognitive/pipeline.js";
import { SAMPLE_NODE_PATH } from "../../cognitive/__fixtures__/pedidos.js";
import { EchoWorker } from "../../execution/workers/echo.js";
import { ExecutorRegistry } from "../../execution/executor-registry.js";
import {
  loadEspecialidadesConfig,
  loadModelsConfig,
  loadPlatformConfig,
  loadStrategiesConfig,
} from "../../shared/config.js";
import { fixedClock, manualClock } from "../../shared/clock.js";
import { sequentialIds } from "../../shared/ids.js";
import { EventBus } from "../../shared/event-bus.js";
import { allToExecutor, TaskRouter } from "../task-router.js";
import { BackgroundOrchestrator } from "./background-orchestrator.js";

describe("BackgroundOrchestrator (e2e: plano real -> execução)", () => {
  it("carrega os artefatos da Camada 1, executa o DAG e conclui o run", async () => {
    const root = mkdtempSync(join(tmpdir(), "pm-e2e-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const db = openDatabase(":memory:");

    const modelsConfig = loadModelsConfig();
    const especialidades = loadEspecialidadesConfig();
    const platform = loadPlatformConfig();

    // Projeto registrado (fixture).
    const projects = new ProjectsRepo(db);
    projects.upsert(
      ProjectTarget.parse({ slug: "sample-node", rootPath: SAMPLE_NODE_PATH, kind: "registered" }),
    );

    // Camada 1: planeja (produz project-map, dag, planned-tasks).
    const bus = new EventBus();
    const artifacts = new ArtifactStore(db, root);
    const plan = await new CognitivePipeline({
      runs: new RunsRepo(db),
      artifacts,
      metrics: new MetricsRepo(db),
      cache: new CacheRepo(db),
      bus,
      capabilityResolver: new CapabilityResolver(modelsConfig),
      gateway: new ModelResolver(modelsConfig),
      modelsConfig,
      strategiesConfig: loadStrategiesConfig(),
      clock: fixedClock(),
      ids: sequentialIds(),
      root,
    }).plan({
      project: projects.get("sample-node")!,
      rawPrompt: "adicionar um filtro por data na tela de relatórios com endpoint no backend",
      workKind: "feature",
      preference: "heuristic",
    });

    expect(plan.taskCount).toBeGreaterThanOrEqual(2);

    // Camada 2: executa o run planejado.
    const registry = new ExecutorRegistry();
    registry.register(new EchoWorker());
    const orchestrator = new BackgroundOrchestrator({
      runs: new RunsRepo(db),
      projects,
      tasks: new TasksRepo(db),
      artifacts,
      bus,
      registry,
      router: new TaskRouter({
        especialidades,
        capabilityResolver: new CapabilityResolver(modelsConfig),
        determinism: allToExecutor("worker.echo"),
        binding: { llmExecutorId: "worker.echo" },
      }),
      especialidades,
      platform,
      clock: manualClock(),
    });

    const outcome = await orchestrator.start(plan.runId);
    expect(outcome.state).toBe("done");
    expect(outcome.done).toBe(plan.taskCount);
    expect(new RunsRepo(db).get(plan.runId)?.state).toBe("done");

    // Idempotência: iniciar de novo sem --resume recusa.
    await expect(orchestrator.start(plan.runId)).rejects.toThrow();
    db.close();
  });
});
