import { Plan } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import {
  generateWorkflow,
  inferTaskType,
  WorkflowCycleError,
  WorkflowValidationError,
} from "./workflow-generator.js";

function flatPlan(tasks: { id: string; title: string; dependsOn?: string[] }[]) {
  return Plan.parse({
    requestId: "req_1",
    roots: tasks.map((t) => ({
      id: t.id,
      kind: "task",
      title: t.title,
      dependsOn: t.dependsOn ?? [],
    })),
  });
}

const base = { runId: "run_1", projectSlug: "p", complexity: 2 as const, workKind: "feature" as const };

describe("generateWorkflow", () => {
  it("ordena topologicamente e produz tarefas sem executor", () => {
    const plan = flatPlan([
      { id: "n1", title: "Banco" },
      { id: "n2", title: "Backend", dependsOn: ["n1"] },
      { id: "n3", title: "Frontend", dependsOn: ["n2"] },
    ]);
    const { dag, tasks, order } = generateWorkflow({ ...base, plan });
    expect(order).toEqual(["n1", "n2", "n3"]);
    expect(dag.edges).toHaveLength(2);
    expect(dag.nodes.find((n) => n.taskId === "n1")?.state).toBe("ready");
    expect(dag.nodes.find((n) => n.taskId === "n3")?.dependsRemaining).toBe(1);
    // PlannedTask não tem executor.
    expect(tasks.every((t) => !("executorKind" in t))).toBe(true);
  });

  it("detecta ciclo", () => {
    const plan = flatPlan([
      { id: "n1", title: "A", dependsOn: ["n2"] },
      { id: "n2", title: "B", dependsOn: ["n1"] },
    ]);
    expect(() => generateWorkflow({ ...base, plan })).toThrow(WorkflowCycleError);
  });

  it("rejeita dependência para id inexistente", () => {
    const plan = flatPlan([{ id: "n1", title: "A", dependsOn: ["naoexiste"] }]);
    expect(() => generateWorkflow({ ...base, plan })).toThrow(WorkflowValidationError);
  });

  it("expande dependência em nó-pai para as folhas", () => {
    const plan = Plan.parse({
      requestId: "req_1",
      roots: [
        {
          id: "n1",
          kind: "epic",
          title: "Épico",
          children: [
            { id: "n1.1", kind: "task", title: "Parte A" },
            { id: "n1.2", kind: "task", title: "Parte B" },
          ],
        },
        { id: "n2", kind: "task", title: "Depois", dependsOn: ["n1"] },
      ],
    });
    const { dag, order } = generateWorkflow({ ...base, plan });
    // n2 depende do épico n1 -> arestas de n1.1 e n1.2 para n2.
    expect(dag.edges).toContainEqual({ from: "n1.1", to: "n2" });
    expect(dag.edges).toContainEqual({ from: "n1.2", to: "n2" });
    expect(order.indexOf("n2")).toBeGreaterThan(order.indexOf("n1.1"));
  });

  it("rejeita dependência de um nó no seu próprio ancestral", () => {
    const plan = Plan.parse({
      requestId: "req_1",
      roots: [
        {
          id: "n1",
          kind: "epic",
          title: "Épico",
          children: [{ id: "n1.1", kind: "task", title: "Tarefa", dependsOn: ["n1"] }],
        },
      ],
    });
    expect(() => generateWorkflow({ ...base, plan })).toThrow(WorkflowValidationError);
  });

  it("workKind analysis força tipo analysis", () => {
    const plan = flatPlan([{ id: "n1", title: "Investigar o erro" }]);
    const { tasks } = generateWorkflow({ ...base, plan, workKind: "analysis" });
    expect(tasks[0]?.type).toBe("analysis");
  });
});

describe("inferTaskType", () => {
  const node = (title: string) => ({
    id: "x",
    kind: "task" as const,
    title,
    description: "",
    acceptanceCriteria: [],
    dependsOn: [],
    children: [],
  });
  it("classifica por sinais do título", () => {
    expect(inferTaskType(node("Testes automatizados"))).toBe("test");
    expect(inferTaskType(node("Alterações no banco de dados"))).toBe("database");
    expect(inferTaskType(node("Atualizar a documentação"))).toBe("docs");
    expect(inferTaskType(node("Implementar a interface (frontend)"))).toBe("frontend");
    expect(inferTaskType(node("Implementar a lógica de negócio"))).toBe("backend");
  });
});
