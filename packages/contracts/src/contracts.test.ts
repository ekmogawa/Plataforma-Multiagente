import { describe, expect, it } from "vitest";
import {
  EventName,
  PlanNode,
  PlannedTask,
  StrategiesConfig,
  StructuredRequest,
  isKnownSchema,
} from "./index.js";

describe("StructuredRequest", () => {
  it("aceita um pedido válido e aplica defaults", () => {
    const parsed = StructuredRequest.parse({
      id: "req_1",
      createdAt: new Date().toISOString(),
      rawPrompt: "conserta o bug do botão de salvar",
      translatedIntent: "corrigir falha no handler de submit do formulário",
      workKind: "bugfix",
      projectSlug: "gera-laudo-eda",
      domain: "saúde",
      deliverableType: "webapp",
    });
    expect(parsed.constraints).toEqual([]);
    expect(parsed.openQuestions).toEqual([]);
    expect(parsed.workKind).toBe("bugfix");
  });

  it("rejeita deliverableType inválido", () => {
    const r = StructuredRequest.safeParse({
      id: "req_1",
      createdAt: new Date().toISOString(),
      rawPrompt: "x",
      translatedIntent: "y",
      domain: "z",
      deliverableType: "quantum-computer",
    });
    expect(r.success).toBe(false);
  });
});

describe("PlanNode (recursivo)", () => {
  it("parseia uma árvore aninhada e preenche defaults", () => {
    const node = PlanNode.parse({
      id: "epic_1",
      kind: "epic",
      title: "Autenticação",
      children: [{ id: "task_1", kind: "task", title: "Login" }],
    });
    expect(node.children[0]?.acceptanceCriteria).toEqual([]);
    expect(node.description).toBe("");
  });
});

describe("schema-registry", () => {
  it("reconhece schemas conhecidos e rejeita desconhecidos", () => {
    expect(isKnownSchema("StructuredRequest")).toBe(true);
    expect(isKnownSchema("PlannedTask")).toBe(true);
    expect(isKnownSchema("Inexistente")).toBe(false);
  });
});

describe("PlannedTask", () => {
  it("aceita uma tarefa planejada sem executor e aplica defaults", () => {
    const t = PlannedTask.parse({
      id: "n1",
      planNodeId: "n1",
      runId: "run_1",
      projectSlug: "gera-laudo-eda",
      type: "backend",
      complexity: 3,
      input: { instructions: "corrigir o handler de submit" },
    });
    expect(t.input.files).toEqual([]);
    expect(t.acceptanceCriteria).toEqual([]);
    // não tem campo de executor (é a projeção da Camada 1)
    expect("executorKind" in t).toBe(false);
  });
});

describe("EventName", () => {
  it("inclui os eventos de etapa da Camada 1", () => {
    for (const name of [
      "RunRequested",
      "ProjectAnalyzed",
      "IntentCreated",
      "RequirementsReady",
      "ComplexityEstimated",
      "StrategySelected",
      "RunPlanned",
    ]) {
      expect(EventName.safeParse(name).success).toBe(true);
    }
  });
});

describe("StrategiesConfig", () => {
  it("rejeita config que não mapeia todos os scores 1..5", () => {
    const r = StrategiesConfig.safeParse({
      scoreToProfile: { "1": "trivial" },
      profiles: {
        trivial: {
          planningDepth: "flat",
          validationLevel: "smoke",
          modelTierCeiling: "cheap",
          maxRetries: 2,
          budgetTokens: 1000,
        },
      },
    });
    expect(r.success).toBe(false);
  });
});
