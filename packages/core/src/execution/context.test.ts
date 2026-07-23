import { ProjectMap, type TaskSpec } from "@pm/contracts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEspecialidadesConfig } from "../shared/config.js";
import { StaticImportCodeGraph } from "./code-graph-port.js";
import { ContextBuilder } from "./context-builder.js";
import { estimateTokens } from "./token-estimator.js";

const root = mkdtempSync(join(tmpdir(), "pm-cg-"));
writeFileSync(join(root, "a.ts"), 'import { b } from "./b.js";\nexport const a = b + 1;\n');
writeFileSync(join(root, "b.ts"), "export const b = 41;\n");

const projectMap = ProjectMap.parse({
  slug: "p",
  generatedAt: "2026-01-01T00:00:00.000Z",
  structure: [],
  dependencies: {},
  conventions: ["ESM", "TypeScript"],
});

function spec(files: string[]): TaskSpec {
  return {
    id: "t1",
    planNodeId: "t1",
    runId: "run_1",
    projectSlug: "p",
    type: "backend",
    executorKind: "llm",
    executorId: "worker.llm",
    capability: "coder-backend",
    complexity: 2,
    input: { files, instructions: "x", contextRefs: [] },
    acceptanceCriteria: [],
    timeoutMs: 60000,
    maxRetries: 3,
  };
}

describe("StaticImportCodeGraph", () => {
  it("resolve imports relativos como vizinhos", () => {
    const g = new StaticImportCodeGraph(root, 12);
    expect(g.neighborsOf("a.ts")).toEqual(["b.ts"]);
    expect(g.neighborsOf("b.ts")).toEqual([]);
  });
});

describe("estimateTokens", () => {
  it("aproxima ~4 chars por token", () => {
    expect(estimateTokens("12345678")).toBe(2);
  });
});

describe("ContextBuilder", () => {
  const builder = new ContextBuilder({
    root,
    codeGraph: new StaticImportCodeGraph(root, 12),
    especialidades: loadEspecialidadesConfig(),
    maxTokensPerTask: 8000,
    maxFileBytes: 32000,
    maxNeighbors: 12,
  });

  it("inclui o arquivo-semente (full) e o vizinho (summary) + convenções", () => {
    const ctx = builder.build(spec(["a.ts"]), projectMap);
    const paths = ctx.files.map((f) => f.path);
    expect(paths).toContain("a.ts");
    expect(paths).toContain("b.ts");
    expect(ctx.files.find((f) => f.path === "a.ts")?.mode).toBe("full");
    expect(ctx.files.find((f) => f.path === "b.ts")?.mode).toBe("summary");
    expect(ctx.conventions).toContain("ESM");
    // convenção da especialidade backend entra também.
    expect(ctx.conventions.some((c) => c.toLowerCase().includes("projeto"))).toBe(true);
    expect(ctx.estimatedTokens).toBeGreaterThan(0);
  });

  it("respeita o orçamento de tokens (não estoura)", () => {
    const tiny = new ContextBuilder({
      root,
      codeGraph: new StaticImportCodeGraph(root, 12),
      especialidades: loadEspecialidadesConfig(),
      maxTokensPerTask: 1, // orçamento minúsculo
      maxFileBytes: 32000,
      maxNeighbors: 12,
    });
    const ctx = tiny.build(spec(["a.ts"]), projectMap);
    expect(ctx.estimatedTokens).toBeLessThanOrEqual(1);
    expect(ctx.files.length).toBe(0); // nada coube
  });
});
