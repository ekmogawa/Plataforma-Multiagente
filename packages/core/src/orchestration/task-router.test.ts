import { ExecutionStrategy, type PlannedTask, type TaskType } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import { CapabilityResolver } from "../adapters/capability-resolver.js";
import { loadEspecialidadesConfig, loadModelsConfig } from "../shared/config.js";
import {
  allToExecutor,
  neverDeterministic,
  TaskRouter,
} from "./task-router.js";

const especialidades = loadEspecialidadesConfig();
const capabilityResolver = new CapabilityResolver(loadModelsConfig());
const strategy = ExecutionStrategy.parse({
  profile: "standard",
  planningDepth: "epics",
  validationLevel: "standard",
  modelTierCeiling: "mid",
  maxRetries: 3,
  budgetTokens: 200000,
});

function task(type: TaskType, complexity: 1 | 2 | 3 | 4 | 5 = 2): PlannedTask {
  return {
    id: "n1",
    planNodeId: "n1",
    runId: "run_1",
    projectSlug: "p",
    type,
    complexity,
    input: { files: [], instructions: "x", contextRefs: [] },
    acceptanceCriteria: [],
  };
}

describe("TaskRouter", () => {
  const llmRouter = new TaskRouter({
    especialidades,
    capabilityResolver,
    determinism: neverDeterministic,
    binding: { llmExecutorId: "worker.llm" },
  });

  it("mapeia type -> capability via especialidades", () => {
    expect(llmRouter.route(task("backend"), strategy).spec.capability).toBe("coder-backend");
    expect(llmRouter.route(task("frontend"), strategy).spec.capability).toBe("coder-frontend");
    expect(llmRouter.route(task("database"), strategy).spec.capability).toBe("coder-backend");
    expect(llmRouter.route(task("test"), strategy).spec.capability).toBe("qa-analyst");
  });

  it("analysis (sem especialidade) usa a capability de fallback", () => {
    expect(llmRouter.route(task("analysis"), strategy).spec.capability).toBe("coder-general");
  });

  it("tarefa LLM tem executorKind llm, executorId do binding e modelo resolvido", () => {
    const r = llmRouter.route(task("backend"), strategy);
    expect(r.spec.executorKind).toBe("llm");
    expect(r.spec.executorId).toBe("worker.llm");
    expect(r.decision.resolvedModel).toBeTruthy();
  });

  it("timeoutMs vem da tabela por complexidade; maxRetries da estratégia", () => {
    expect(llmRouter.route(task("backend", 1), strategy).spec.timeoutMs).toBe(60000);
    expect(llmRouter.route(task("backend", 5), strategy).spec.timeoutMs).toBe(900000);
    expect(llmRouter.route(task("backend", 3), strategy).spec.maxRetries).toBe(3);
  });

  it("determinístico-primeiro: policy que reivindica -> deterministic, sem capability", () => {
    const detRouter = new TaskRouter({
      especialidades,
      capabilityResolver,
      determinism: allToExecutor("worker.echo"),
      binding: { llmExecutorId: "worker.llm" },
    });
    const r = detRouter.route(task("backend"), strategy);
    expect(r.spec.executorKind).toBe("deterministic");
    expect(r.spec.executorId).toBe("worker.echo");
    expect(r.spec.capability).toBeUndefined();
  });

  it("preserva o id do PlannedTask (Camada 1 <-> Camada 2)", () => {
    expect(llmRouter.route(task("backend"), strategy).spec.id).toBe("n1");
  });
});
