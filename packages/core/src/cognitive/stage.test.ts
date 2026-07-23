import type { ModelsConfig } from "@pm/contracts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityResolver } from "../adapters/capability-resolver.js";
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
} from "../adapters/model-port.js";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { openDatabase } from "../db/database.js";
import { CacheRepo } from "../db/cache-repo.js";
import { MetricsRepo } from "../db/metrics-repo.js";
import { fixedClock } from "../shared/clock.js";
import { CAMADA1_CAPABILITIES, resolveCognitiveMode } from "./mode.js";
import { runStage, type CognitiveStage, type StageContext, type StageModelGateway } from "./stage.js";

const KEY = "STAGE_TEST_KEY";

const cfg: ModelsConfig = {
  providers: { p: { protocol: "openai", apiKeyEnv: KEY } },
  models: { m: { provider: "p", model: "m", tier: "cheap" } },
  capabilities: { "intake-translator": { default: "m" }, repair: { default: "m" } },
  fallbacks: {},
};

const tmpRoot = mkdtempSync(join(tmpdir(), "pm-stage-"));
writeFileSync(join(tmpRoot, "pnpm-workspace.yaml"), "packages: []\n");

class FakeGateway implements StageModelGateway {
  calls = 0;
  constructor(private readonly responses: unknown[]) {}
  async completeWithFallback(
    model: string,
    _req: CompletionRequest,
  ): Promise<CompletionResponse & { attemptedModels: string[] }> {
    const idx = Math.min(this.calls, this.responses.length - 1);
    const r = this.responses[idx];
    this.calls++;
    if (r instanceof Error) throw r;
    return {
      text: JSON.stringify(r),
      parsed: r,
      usage: { in: 1, out: 1, cacheRead: 0 },
      costUsd: 0,
      model,
      attemptedModels: [model],
    };
  }
}

const schema = z.object({ ok: z.boolean() });
const stage: CognitiveStage<Record<string, never>, { ok: boolean }> = {
  name: "t",
  capability: "intake-translator",
  promptId: "intake/traduzir", // existe na biblioteca (usa o repo root real)
  schema,
  buildVars: () => ({}),
  heuristic: () => ({ ok: true }),
};

function makeCtx(mode: "llm" | "heuristic", gateway: StageModelGateway): StageContext {
  const db = openDatabase(":memory:");
  return {
    runId: "run_1",
    projectSlug: "p",
    mode,
    clock: fixedClock(),
    capabilityResolver: new CapabilityResolver(cfg),
    gateway,
    artifacts: new ArtifactStore(db, tmpRoot),
    metrics: new MetricsRepo(db),
    cache: new CacheRepo(db),
    // root undefined -> usa o repo real para carregar prompts.
  };
}

afterEach(() => {
  delete process.env[KEY];
});

describe("resolveCognitiveMode", () => {
  const capabilityResolver = new CapabilityResolver(cfg);
  const opts = (preference: "auto" | "llm" | "heuristic") => ({
    preference,
    capabilityResolver,
    config: cfg,
    capabilities: ["intake-translator"],
  });

  it("auto sem chave -> heuristic", () => {
    expect(resolveCognitiveMode(opts("auto"))).toBe("heuristic");
  });
  it("offline sempre -> heuristic", () => {
    process.env[KEY] = "x";
    expect(resolveCognitiveMode(opts("heuristic"))).toBe("heuristic");
  });
  it("auto com chave + protocolo openai -> llm", () => {
    process.env[KEY] = "x";
    expect(resolveCognitiveMode(opts("auto"))).toBe("llm");
  });
  it("llm sem chave -> lança", () => {
    expect(() => resolveCognitiveMode(opts("llm"))).toThrow();
  });

  it("exige a capacidade 'repair' para o modo llm (nunca falha no reparo)", () => {
    expect(CAMADA1_CAPABILITIES).toContain("repair");
  });
});

describe("runStage", () => {
  it("modo heuristic roda a heurística e valida", async () => {
    const out = await runStage(stage, {}, makeCtx("heuristic", new FakeGateway([])));
    expect(out).toEqual({ ok: true });
  });

  it("modo llm usa o gateway e devolve a saída parseada", async () => {
    const gw = new FakeGateway([{ ok: true }]);
    const out = await runStage(stage, {}, makeCtx("llm", gw));
    expect(out).toEqual({ ok: true });
    expect(gw.calls).toBe(1);
  });

  it("degrada para heurística em ProviderError não-retriável", async () => {
    const gw = new FakeGateway([new ProviderError("indisponível", false)]);
    const out = await runStage(stage, {}, makeCtx("llm", gw));
    expect(out).toEqual({ ok: true });
  });

  it("faz 1 reparo quando a saída sai fora do schema", async () => {
    const gw = new FakeGateway([{ ok: "não é bool" }, { ok: true }]);
    const out = await runStage(stage, {}, makeCtx("llm", gw));
    expect(out).toEqual({ ok: true });
    expect(gw.calls).toBe(2); // 1 principal + 1 reparo
  });

  it("cacheia: a segunda chamada idêntica não reatinge o gateway", async () => {
    const gw = new FakeGateway([{ ok: true }]);
    const ctx = makeCtx("llm", gw); // mesmo db/cache nas duas chamadas
    const a = await runStage(stage, {}, ctx);
    const b = await runStage(stage, {}, ctx);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(gw.calls).toBe(1); // segunda veio do cache
  });
});
