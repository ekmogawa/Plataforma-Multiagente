import {
  Plan,
  type ExecutionStrategy,
  type PlanNodeInput,
  type Plan as PlanT,
  type ProjectMap,
  type StructuredRequest,
  type UnderstandingReport,
} from "@pm/contracts";
import type { CognitiveStage, StageContext } from "./stage.js";
import { normalize } from "./fallbacks/heuristics.js";

export interface PlanningInput {
  request: StructuredRequest;
  understanding: UnderstandingReport;
  strategy: ExecutionStrategy;
  projectMap?: ProjectMap;
}

interface TaskDesc {
  key: string;
  title: string;
  description: string;
  criteria: { text: string; checkKind: "script" | "llm" | "manual"; check?: string }[];
  depKeys: string[];
}

/** Deriva a lista de tarefas (com dependências por chave) a partir dos sinais. */
function buildTasks(input: PlanningInput): TaskDesc[] {
  const { request, strategy, projectMap } = input;
  const text = normalize(`${request.rawPrompt} ${request.translatedIntent}`);
  const testCmd = projectMap?.testCommand ?? "npm test";

  if (request.workKind === "analysis") {
    return [
      {
        key: "analise",
        title: "Analisar e produzir relatório",
        description: `Investigar e explicar: ${request.translatedIntent}. Não altera código.`,
        criteria: [
          { text: "Relatório claro respondendo ao pedido.", checkKind: "manual" },
        ],
        depKeys: [],
      },
    ];
  }

  const touchesDb = /banco|tabela|migra|schema|\bsql\b|[ií]ndice/.test(text);
  const touchesFrontend =
    request.workKind === "ui-adjustment" ||
    /tela|bot[aã]o|interface|componente|frontend|\bcss\b|\btsx\b|estilo/.test(text) ||
    (request.deliverableType === "webapp" &&
      ["react", "vue", "svelte", "next", "angular"].includes(projectMap?.framework ?? ""));
  const explicitBackend = /endpoint|\bapi\b|servi[cç]o|backend|\brota\b|regra de neg[oó]cio/.test(text);
  // Se nada de frontend/db foi sinalizado, a implementação padrão é backend.
  const touchesBackend = explicitBackend || (!touchesFrontend && !touchesDb) || touchesDb;

  const tasks: TaskDesc[] = [];
  const implKeys: string[] = [];

  // Bugfix: teste de regressão primeiro; a correção depende dele.
  let reproKey: string | undefined;
  if (request.workKind === "bugfix") {
    reproKey = "repro";
    tasks.push({
      key: reproKey,
      title: "Escrever teste que reproduz o bug",
      description: "Teste automatizado que falha por causa do defeito (base da correção).",
      criteria: [{ text: "O teste reproduz o defeito.", checkKind: "script", check: testCmd }],
      depKeys: [],
    });
  }

  const baseDeps = reproKey ? [reproKey] : [];

  if (touchesDb) {
    tasks.push({
      key: "db",
      title: "Alterações no banco de dados",
      description: "Migrations, modelos e consultas necessárias.",
      criteria: [{ text: "Migration reversível aplicada.", checkKind: "manual" }],
      depKeys: [...baseDeps],
    });
    implKeys.push("db");
  }
  if (touchesBackend) {
    const deps = [...baseDeps, ...(touchesDb ? ["db"] : [])];
    tasks.push({
      key: "backend",
      title: "Implementar a lógica de backend",
      description: request.translatedIntent,
      criteria: [{ text: "Comportamento implementado conforme o pedido.", checkKind: "manual" }],
      depKeys: deps,
    });
    implKeys.push("backend");
  }
  if (touchesFrontend) {
    const deps = [...baseDeps, ...(touchesBackend ? ["backend"] : touchesDb ? ["db"] : [])];
    tasks.push({
      key: "frontend",
      title: "Implementar a interface (frontend)",
      description: request.translatedIntent,
      criteria: [{ text: "Interface funcional e integrada.", checkKind: "manual" }],
      depKeys: deps,
    });
    implKeys.push("frontend");
  }

  // Testes (quando a validação não é apenas smoke).
  if (strategy.validationLevel !== "smoke" && request.workKind !== "bugfix") {
    tasks.push({
      key: "tests",
      title: "Testes automatizados",
      description: "Cobrir o caminho principal e as bordas introduzidas pela mudança.",
      criteria: [{ text: "Os testes passam.", checkKind: "script", check: testCmd }],
      depKeys: implKeys.length ? implKeys : [...baseDeps],
    });
  }

  // Documentação (só no planejamento completo).
  if (strategy.planningDepth === "full") {
    tasks.push({
      key: "docs",
      title: "Atualizar a documentação",
      description: "Registrar o que mudou, em linguagem clara.",
      criteria: [{ text: "Documentação reflete a mudança.", checkKind: "manual" }],
      depKeys: implKeys.length ? implKeys : [...baseDeps],
    });
  }

  return tasks.length ? tasks : [
    {
      key: "impl",
      title: "Implementar a mudança",
      description: request.translatedIntent,
      criteria: [{ text: "Mudança implementada conforme o pedido.", checkKind: "manual" }],
      depKeys: [],
    },
  ];
}

/** Monta a árvore com ids POSICIONAIS conforme a profundidade da estratégia. */
function assemble(tasks: TaskDesc[], input: PlanningInput): PlanT {
  const depth = input.strategy.planningDepth;
  const keyToId = new Map<string, string>();

  const taskPrefix = depth === "flat" ? "n" : depth === "epics" ? "n1." : "n1.1.";
  tasks.forEach((t, i) => keyToId.set(t.key, `${taskPrefix}${i + 1}`));

  const taskNode = (t: TaskDesc): PlanNodeInput => {
    const id = keyToId.get(t.key)!;
    return {
      id,
      kind: "task",
      title: t.title,
      description: t.description,
      acceptanceCriteria: t.criteria.map((c, ci) => ({
        id: `${id}-c${ci + 1}`,
        text: c.text,
        checkKind: c.checkKind,
        check: c.check,
      })),
      dependsOn: t.depKeys.map((k) => keyToId.get(k)!),
      children: [],
    };
  };

  const taskNodes = tasks.map(taskNode);
  const title = input.request.translatedIntent;

  let roots: PlanNodeInput[];
  if (depth === "flat") {
    roots = taskNodes;
  } else if (depth === "epics") {
    roots = [{ id: "n1", kind: "epic", title, description: "", children: taskNodes, dependsOn: [], acceptanceCriteria: [] }];
  } else {
    roots = [
      {
        id: "n1",
        kind: "epic",
        title,
        description: "",
        dependsOn: [],
        acceptanceCriteria: [],
        children: [
          { id: "n1.1", kind: "feature", title, description: "", children: taskNodes, dependsOn: [], acceptanceCriteria: [] },
        ],
      },
    ];
  }

  return Plan.parse({ requestId: input.request.id, roots });
}

/** Fallback determinístico do Planning — plano proporcional à profundidade. */
export function planningHeuristic(input: PlanningInput, _ctx: StageContext): PlanT {
  return assemble(buildTasks(input), input);
}

export const planningStage: CognitiveStage<PlanningInput, PlanT> = {
  name: "planning",
  capability: "planner",
  promptId: "planning/gerar-plano",
  schema: Plan,
  buildVars: (input) => ({
    intent: input.request.translatedIntent,
    requirements: input.understanding.requirements.map((r) => `- ${r.text}`).join("\n"),
    planningDepth: input.strategy.planningDepth,
  }),
  heuristic: planningHeuristic,
};
