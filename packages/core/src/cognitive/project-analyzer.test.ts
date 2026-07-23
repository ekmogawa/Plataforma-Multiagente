import { ProjectTarget } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../shared/clock.js";
import { analyzeProject } from "./project-analyzer.js";
import { SAMPLE_NODE_PATH } from "./__fixtures__/pedidos.js";

const target = ProjectTarget.parse({
  slug: "sample-node",
  rootPath: SAMPLE_NODE_PATH,
  kind: "registered",
});

describe("analyzeProject", () => {
  const map = analyzeProject(target, { clock: fixedClock() });

  it("detecta framework, comando de teste e convenções", () => {
    expect(map.framework).toBe("react");
    expect(map.testCommand).toBe("npm test");
    expect(map.conventions).toContain("ESM");
    expect(map.conventions).toContain("TypeScript");
    expect(map.conventions).toContain("vitest");
  });

  it("lista dependências diretas", () => {
    expect(map.dependencies.react).toBeDefined();
    expect(map.dependencies.express).toBeDefined();
  });

  it("ignora node_modules e dist na estrutura", () => {
    expect(map.structure.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(map.structure.some((p) => p.startsWith("dist"))).toBe(false);
    expect(map.structure).toContain("package.json");
    expect(map.structure).toContain("src/");
  });

  it("usa o clock injetado e é determinístico", () => {
    expect(map.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    const again = analyzeProject(target, { clock: fixedClock() });
    expect(again).toEqual(map);
  });
});
