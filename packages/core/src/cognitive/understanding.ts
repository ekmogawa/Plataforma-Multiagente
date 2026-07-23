import {
  UnderstandingReport,
  type ProjectMap,
  type StructuredRequest,
  type UnderstandingReport as UnderstandingReportT,
  type WorkKind,
} from "@pm/contracts";
import type { CognitiveStage, StageContext } from "./stage.js";

export interface UnderstandingInput {
  request: StructuredRequest;
  projectMap?: ProjectMap;
}

const RISK_BY_WORKKIND: Partial<Record<WorkKind, string>> = {
  bugfix: "Risco de regressão em funcionalidades relacionadas ao corrigir o defeito.",
  refactor: "Risco de alterar o comportamento existente durante a refatoração.",
  optimization: "Risco de a otimização introduzir comportamento sutil diferente.",
  "new-project": "Escopo inicial amplo; decisões de arquitetura afetam todo o projeto.",
};

/** Fallback determinístico do Understanding — deriva requisitos do pedido + mapa. */
export function understandingHeuristic(
  input: UnderstandingInput,
  _ctx: StageContext,
): UnderstandingReportT {
  const { request, projectMap } = input;

  const requirements: UnderstandingReportT["requirements"] = [
    {
      id: "r1",
      kind: "functional",
      text: request.translatedIntent,
      priority: "must",
      source: "usuário",
      dependsOn: [],
    },
  ];

  // Não-funcionais derivados do projeto alvo.
  let rn = 1;
  if (projectMap?.testCommand) {
    requirements.push({
      id: `nf${rn++}`,
      kind: "non-functional",
      text: `Manter os testes do projeto passando (\`${projectMap.testCommand}\`).`,
      priority: "must",
      source: "inferido",
      dependsOn: [],
    });
  }
  if (projectMap?.conventions.length) {
    requirements.push({
      id: `nf${rn++}`,
      kind: "non-functional",
      text: `Seguir as convenções do projeto (${projectMap.conventions.join(", ")}).`,
      priority: "should",
      source: "inferido",
      dependsOn: [],
    });
  }

  const risks: string[] = [];
  const workKindRisk = RISK_BY_WORKKIND[request.workKind];
  if (workKindRisk) risks.push(workKindRisk);

  const ambiguities: string[] = [];
  if (request.rawPrompt.trim().length < 40) {
    ambiguities.push(
      "Pedido curto: alguns detalhes foram assumidos; confirme se o escopo está correto.",
    );
  }

  return UnderstandingReport.parse({
    requestId: request.id,
    requirements,
    risks,
    externalDependencies: [],
    ambiguities,
    expectedImpact:
      request.workKind === "analysis"
        ? "Produz um relatório; não altera o código."
        : `Alteração de escopo ${requirements.length > 3 ? "moderado" : "localizado"} no projeto ${request.projectSlug ?? ""}.`.trim(),
  });
}

export const understandingStage: CognitiveStage<UnderstandingInput, UnderstandingReportT> = {
  name: "understanding",
  capability: "understanding",
  promptId: "understanding/extrair-requisitos",
  schema: UnderstandingReport,
  buildVars: (input) => ({
    intent: input.request.translatedIntent,
    rawPrompt: input.request.rawPrompt,
    conventions: input.projectMap?.conventions.join(", ") ?? "",
    testCommand: input.projectMap?.testCommand ?? "",
  }),
  heuristic: understandingHeuristic,
};
