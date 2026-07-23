import type { PlannedTask } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import { DeterministicFirstPolicy } from "./deterministic-policy.js";

function task(over: Partial<PlannedTask>): PlannedTask {
  return {
    id: "n1",
    planNodeId: "n1",
    runId: "run_1",
    projectSlug: "p",
    type: "backend",
    complexity: 2,
    input: { files: [], instructions: "x", contextRefs: [] },
    acceptanceCriteria: [],
    ...over,
  };
}

describe("DeterministicFirstPolicy", () => {
  const policy = new DeterministicFirstPolicy();

  it("reivindica tarefa operacional (sem arquivos, só critérios script)", () => {
    const t = task({
      acceptanceCriteria: [{ id: "c1", text: "testes passam", checkKind: "script", check: "npm test" }],
    });
    const claim = policy.claim(t);
    expect(claim?.executorId).toBe("worker.test-runner");
  });

  it("NÃO reivindica tarefa que autora arquivos", () => {
    const t = task({
      input: { files: ["src/app.ts"], instructions: "x", contextRefs: [] },
      acceptanceCriteria: [{ id: "c1", text: "ok", checkKind: "script", check: "npm test" }],
    });
    expect(policy.claim(t)).toBeNull();
  });

  it("NÃO reivindica quando há critério llm/manual", () => {
    expect(
      policy.claim(task({ acceptanceCriteria: [{ id: "c1", text: "bonito", checkKind: "llm" }] })),
    ).toBeNull();
    expect(policy.claim(task({ acceptanceCriteria: [] }))).toBeNull(); // sem critérios
  });
});
