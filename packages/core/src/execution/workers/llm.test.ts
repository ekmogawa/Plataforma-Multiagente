import {
  ProjectTarget,
  type ModelsConfig,
  type TaskContext,
  type TaskSpec,
} from "@pm/contracts";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityResolver } from "../../adapters/capability-resolver.js";
import type { CompletionRequest, CompletionResponse } from "../../adapters/model-port.js";
import { ArtifactStore } from "../../artifacts/artifact-store.js";
import { openDatabase } from "../../db/database.js";
import { CacheRepo } from "../../db/cache-repo.js";
import { MetricsRepo } from "../../db/metrics-repo.js";
import { loadEspecialidadesConfig } from "../../shared/config.js";
import { fixedClock } from "../../shared/clock.js";
import type { StageModelGateway } from "../../cognitive/stage.js";
import { LlmWorker } from "./llm.js";

const KEY = "TEST_LLM_KEY";
const cfg: ModelsConfig = {
  providers: { p: { protocol: "openai", apiKeyEnv: KEY } },
  models: { m: { provider: "p", model: "m", tier: "cheap" } },
  capabilities: { "coder-backend": { default: "m" }, repair: { default: "m" } },
  fallbacks: {},
};
const especialidades = loadEspecialidadesConfig();

class FakeGateway implements StageModelGateway {
  constructor(private readonly payload: unknown) {}
  async completeWithFallback(
    model: string,
    _req: CompletionRequest,
  ): Promise<CompletionResponse & { attemptedModels: string[] }> {
    return {
      text: JSON.stringify(this.payload),
      parsed: this.payload,
      usage: { in: 10, out: 20, cacheRead: 0 },
      costUsd: 0.001,
      model,
      attemptedModels: [model],
    };
  }
}

function makeWorker(root: string, gateway: StageModelGateway): LlmWorker {
  const db = openDatabase(":memory:");
  const artRoot = mkdtempSync(join(tmpdir(), "pm-llm-art-"));
  writeFileSync(join(artRoot, "pnpm-workspace.yaml"), "packages: []\n");
  return new LlmWorker({
    target: ProjectTarget.parse({ slug: "t", rootPath: root, kind: "registered" }),
    especialidades,
    capabilityResolver: new CapabilityResolver(cfg),
    gateway,
    modelsConfig: cfg,
    artifacts: new ArtifactStore(db, artRoot),
    metrics: new MetricsRepo(db),
    cache: new CacheRepo(db),
    clock: fixedClock(),
  });
}

const spec: TaskSpec = {
  id: "n1",
  planNodeId: "n1",
  runId: "run_1",
  projectSlug: "t",
  type: "backend",
  executorKind: "llm",
  executorId: "worker.llm",
  capability: "coder-backend",
  complexity: 2,
  input: { files: [], instructions: "criar src/x.js", contextRefs: [] },
  acceptanceCriteria: [],
  timeoutMs: 60000,
  maxRetries: 3,
};
const context: TaskContext = { taskId: "n1", files: [], contracts: [], conventions: [], priorDecisions: [], estimatedTokens: 0 };
const input = { spec, context, attempt: 1, deadline: "2026-01-01T00:01:00.000Z" };

afterEach(() => {
  delete process.env[KEY];
});

describe("LlmWorker", () => {
  it("com chave: aplica o CodeChangeSet ao projeto", async () => {
    process.env[KEY] = "x";
    const root = mkdtempSync(join(tmpdir(), "pm-llm-"));
    const worker = makeWorker(root, new FakeGateway({
      files: [{ path: "src/x.js", action: "created", content: "export const x = 1;\n" }],
      notes: "criado x",
    }));
    const r = await worker.execute(input);
    expect(r.status).toBe("success");
    expect(r.changedFiles).toContainEqual({ path: "src/x.js", action: "created" });
    expect(readFileSync(join(root, "src/x.js"), "utf8")).toContain("x = 1");
  });

  it("offline (sem chave): falha HONESTA, não fabrica código", async () => {
    const root = mkdtempSync(join(tmpdir(), "pm-llm-"));
    const worker = makeWorker(root, new FakeGateway({ files: [] }));
    const r = await worker.execute(input);
    expect(r.status).toBe("failure");
    expect(r.errorSummary).toContain("offline");
    expect(existsSync(join(root, "src/x.js"))).toBe(false);
  });

  it("saída fora do schema após reparo -> failure (não aplica lixo)", async () => {
    process.env[KEY] = "x";
    const root = mkdtempSync(join(tmpdir(), "pm-llm-"));
    // payload inválido: files com item sem content em 'created'.
    const worker = makeWorker(root, new FakeGateway({ files: [{ path: "a.js", action: "created" }] }));
    const r = await worker.execute(input);
    expect(r.status).toBe("failure");
  });
});
