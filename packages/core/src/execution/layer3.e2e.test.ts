import {
  ExecutionStrategy,
  ProjectMap,
  ProjectTarget,
  type ModelsConfig,
  type TaskSpec,
} from "@pm/contracts";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityResolver } from "../adapters/capability-resolver.js";
import type { CompletionRequest, CompletionResponse } from "../adapters/model-port.js";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { openDatabase } from "../db/database.js";
import { CacheRepo } from "../db/cache-repo.js";
import { MetricsRepo } from "../db/metrics-repo.js";
import { RunsRepo } from "../db/runs-repo.js";
import { TasksRepo, type SeedEntry } from "../db/tasks-repo.js";
import { loadEspecialidadesConfig } from "../shared/config.js";
import { manualClock } from "../shared/clock.js";
import { EventBus } from "../shared/event-bus.js";
import type { StageModelGateway } from "../cognitive/stage.js";
import { Dispatcher } from "../orchestration/orchestrator/dispatcher.js";
import { RetryManager } from "../orchestration/orchestrator/retry-manager.js";
import { Scheduler } from "../orchestration/orchestrator/scheduler.js";
import { AcceptanceEngine } from "./acceptance/acceptance-engine.js";
import { ContextBuilder } from "./context-builder.js";
import { StaticImportCodeGraph } from "./code-graph-port.js";
import { ExecutorRegistry } from "./executor-registry.js";
import { LlmWorker } from "./workers/llm.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "tiny-project");
const KEY = "TEST_LLM_KEY";
const cfg: ModelsConfig = {
  providers: { p: { protocol: "openai", apiKeyEnv: KEY } },
  models: { m: { provider: "p", model: "m", tier: "cheap" } },
  capabilities: { "coder-backend": { default: "m" }, repair: { default: "m" } },
  fallbacks: {},
};
const especialidades = loadEspecialidadesConfig();
const strategy = ExecutionStrategy.parse({
  profile: "standard",
  planningDepth: "epics",
  validationLevel: "standard",
  modelTierCeiling: "mid",
  maxRetries: 3,
  budgetTokens: 200000,
  concurrency: 1,
});

/** Gateway falso: 1ª tentativa devolve um "fix" ERRADO; ao ver o priorFailure, devolve o certo. */
class FixingGateway implements StageModelGateway {
  async completeWithFallback(
    model: string,
    req: CompletionRequest,
  ): Promise<CompletionResponse & { attemptedModels: string[] }> {
    const sawFailure = req.messages.some((m) => m.content.includes("FALHOU"));
    const content = sawFailure
      ? "export function sum(a, b) {\n  return a + b;\n}\n" // conserto correto
      : "export function sum(a, b) {\n  return a * b;\n}\n"; // ainda errado
    const payload = { files: [{ path: "src/sum.js", action: "modified", content }] };
    return {
      text: JSON.stringify(payload),
      parsed: payload,
      usage: { in: 5, out: 10, cacheRead: 0 },
      costUsd: 0,
      model,
      attemptedModels: [model],
    };
  }
}

afterEach(() => {
  delete process.env[KEY];
});

describe("Camada 3 e2e: loop execute -> accept -> retry -> done", () => {
  it("worker.llm conserta o código até os testes REAIS passarem", async () => {
    process.env[KEY] = "x";
    const root = mkdtempSync(join(tmpdir(), "pm-l3-"));
    cpSync(FIXTURE, root, { recursive: true });
    // Bug semeado: sum subtrai -> o teste de regressão falha.
    writeFileSync(join(root, "src", "sum.js"), "export function sum(a, b) {\n  return a - b;\n}\n");

    const db = openDatabase(":memory:");
    const artRoot = mkdtempSync(join(tmpdir(), "pm-l3-art-"));
    writeFileSync(join(artRoot, "pnpm-workspace.yaml"), "packages: []\n");
    const artifacts = new ArtifactStore(db, artRoot);
    const metrics = new MetricsRepo(db);
    const runs = new RunsRepo(db);
    const tasks = new TasksRepo(db);
    runs.create({ id: "run_1", state: "running", strategy, projectSlug: "tiny", workKind: "bugfix" });

    const target = ProjectTarget.parse({ slug: "tiny", rootPath: root, kind: "registered" });
    const projectMap = ProjectMap.parse({
      slug: "tiny",
      generatedAt: "2026-01-01T00:00:00.000Z",
      structure: [],
      dependencies: {},
      testCommand: "node --test",
    });

    const spec: TaskSpec = {
      id: "n1",
      planNodeId: "n1",
      runId: "run_1",
      projectSlug: "tiny",
      type: "backend",
      executorKind: "llm",
      executorId: "worker.llm",
      capability: "coder-backend",
      complexity: 2,
      input: { files: ["src/sum.js"], instructions: "corrigir sum para somar", contextRefs: [] },
      acceptanceCriteria: [],
      timeoutMs: 60000,
      maxRetries: 3,
    };
    const entries: SeedEntry[] = [{ spec, dependsRemaining: 0, initialState: "ready" }];
    tasks.seed("run_1", entries, [], "2026-01-01T00:00:00.000Z");

    const registry = new ExecutorRegistry();
    registry.register(
      new LlmWorker({
        target,
        especialidades,
        capabilityResolver: new CapabilityResolver(cfg),
        gateway: new FixingGateway(),
        modelsConfig: cfg,
        artifacts,
        metrics,
        cache: new CacheRepo(db),
        clock: manualClock(),
      }),
    );

    const scheduler = new Scheduler({
      runId: "run_1",
      strategy,
      projectMap,
      tasks,
      runs,
      dispatcher: new Dispatcher(registry),
      acceptanceGate: new AcceptanceEngine({ target, projectMap, artifacts }),
      retryManager: new RetryManager({ backoffBaseMs: 0, backoffFactor: 2, backoffMaxMs: 0 }),
      contextBuilder: new ContextBuilder({
        root,
        codeGraph: new StaticImportCodeGraph(root, 12),
        especialidades,
        maxTokensPerTask: 8000,
        maxFileBytes: 32000,
        maxNeighbors: 12,
        artifacts, // habilita priorFailure
      }),
      artifacts,
      bus: new EventBus(),
      clock: manualClock(),
      config: {
        concurrency: 1,
        backoffBaseMs: 0,
        backoffFactor: 2,
        backoffMaxMs: 0,
        leaseGraceMs: 5000,
        maxEscalations: 3,
        maxTicks: 50,
      },
    });

    for (let i = 0; i < 50 && scheduler.hasPendingWork(); i++) {
      await scheduler.tick();
      await scheduler.settle();
    }

    expect(tasks.get("run_1", "n1")?.state).toBe("done");
    expect(tasks.get("run_1", "n1")?.attempt).toBe(2); // 1ª errada, 2ª conserta
    expect(readFileSync(join(root, "src", "sum.js"), "utf8")).toContain("a + b");
    db.close();
  }, 60000);
});
