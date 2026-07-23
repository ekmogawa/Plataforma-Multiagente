import type {
  ComplexityAssessment,
  ExecutionStrategy,
  Plan,
  PlanNode,
  PlannedTask,
  StructuredRequest,
  UnderstandingReport,
} from "@pm/contracts";

/**
 * Renderiza o plano.md — a visão humana, em pt-BR simples, para o usuário leigo.
 * Função pura e determinística (recebe tudo pronto; nenhum timestamp volátil).
 */

export interface RenderPlanInput {
  runId: string;
  request: StructuredRequest;
  understanding: UnderstandingReport;
  complexity: ComplexityAssessment;
  strategy: ExecutionStrategy;
  plan: Plan;
  tasks: PlannedTask[];
  mode: "llm" | "heuristic";
}

const PROFILE_PTBR: Record<string, string> = {
  trivial: "trivial",
  standard: "moderada",
  complex: "complexa",
  critical: "crítica",
};

const WORKKIND_PTBR: Record<string, string> = {
  feature: "nova funcionalidade",
  bugfix: "correção de bug",
  refactor: "refatoração",
  optimization: "otimização",
  "ui-adjustment": "ajuste de interface",
  analysis: "análise (sem alterar código)",
  "new-project": "projeto novo",
};

function renderNode(node: PlanNode, depth: number, lines: string[]): void {
  const bullet = "  ".repeat(depth) + "-";
  lines.push(`${bullet} **${node.title}**`);
  if (node.description) {
    lines.push(`${"  ".repeat(depth)}  ${node.description}`);
  }
  for (const c of node.acceptanceCriteria) {
    lines.push(`${"  ".repeat(depth + 1)}- ✔️ ${c.text}`);
  }
  for (const child of node.children) renderNode(child, depth + 1, lines);
}

export function renderPlanoMd(input: RenderPlanInput): string {
  const { request, understanding, complexity, strategy, plan, tasks } = input;
  const lines: string[] = [];

  lines.push(`# Plano: ${request.translatedIntent}`);
  lines.push("");
  if (input.mode === "heuristic") {
    lines.push(
      "> ℹ️ Plano gerado em **modo offline** (por regras determinísticas, sem IA). " +
        "Com uma chave de API configurada, a qualidade do entendimento e do plano melhora.",
    );
    lines.push("");
  }

  lines.push("## O que você pediu");
  lines.push("");
  lines.push(`> ${request.rawPrompt}`);
  lines.push("");
  lines.push(`- **Tipo de trabalho:** ${WORKKIND_PTBR[request.workKind] ?? request.workKind}`);
  if (request.projectSlug) lines.push(`- **Projeto:** ${request.projectSlug}`);
  lines.push(`- **Em termos técnicos:** ${request.translatedIntent}`);
  lines.push("");

  lines.push("## Entendimento");
  lines.push("");
  const functional = understanding.requirements.filter((r) => r.kind === "functional");
  const nonFunctional = understanding.requirements.filter((r) => r.kind === "non-functional");
  if (functional.length) {
    lines.push("**Requisitos funcionais:**");
    for (const r of functional) lines.push(`- ${r.text}`);
    lines.push("");
  }
  if (nonFunctional.length) {
    lines.push("**Requisitos não-funcionais:**");
    for (const r of nonFunctional) lines.push(`- ${r.text}`);
    lines.push("");
  }
  if (understanding.risks.length) {
    lines.push("**Riscos identificados:**");
    for (const r of understanding.risks) lines.push(`- ⚠️ ${r}`);
    lines.push("");
  }
  if (understanding.ambiguities.length) {
    lines.push("**Pontos a confirmar:**");
    for (const a of understanding.ambiguities) lines.push(`- ❓ ${a}`);
    lines.push("");
  }

  lines.push("## Complexidade e estratégia");
  lines.push("");
  lines.push(
    `- **Complexidade:** ${complexity.score}/5 (${PROFILE_PTBR[strategy.profile] ?? strategy.profile}) — ${complexity.rationale}`,
  );
  lines.push(
    `- **Como será conduzido:** validação ${strategy.validationLevel}, até ${strategy.maxRetries} tentativas por tarefa` +
      `${strategy.requiresHumanApproval ? ", com aprovação sua antes de integrar" : ", sem exigir aprovação (trabalho trivial)"}.`,
  );
  lines.push("");

  lines.push("## O plano");
  lines.push("");
  lines.push(`Dividido em **${tasks.length} tarefa(s)**:`);
  lines.push("");
  for (const root of plan.roots) renderNode(root, 0, lines);
  lines.push("");

  lines.push("## Próximos passos");
  lines.push("");
  lines.push(
    strategy.requiresHumanApproval
      ? "Revise o plano acima. Se aprovar, a plataforma executará as tarefas na ordem de dependência. Se algo estiver errado, me diga o que ajustar."
      : "Por ser um trabalho trivial, a plataforma pode seguir direto para a execução.",
  );
  lines.push("");

  return lines.join("\n") + "\n";
}
