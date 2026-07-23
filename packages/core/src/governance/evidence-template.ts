import type { ChangedFile, GateReview } from "@pm/contracts";

/**
 * renderEvidencePtBr — o resumo de evidências para o usuário LEIGO decidir
 * (pm approve/reject). Função PURA (sem I/O), determinística. O Project Manager
 * coleta os dados; aqui só renderiza pt-BR simples.
 */
export interface EvidenceTemplateInput {
  runId: string;
  rawPrompt: string;
  translatedIntent: string;
  workKind: string;
  projectSlug: string;
  changedFiles: ChangedFile[];
  validations: { passed: number; failed: number };
  gateReview?: GateReview;
  costUsd: number;
  spentTokens: number;
}

const VERDICT_PTBR: Record<string, string> = {
  approve: "✓ sem ressalvas",
  revise: "⚠️ com ressalvas — revise antes de aprovar",
  escalate: "⛔ problema sério — recomendo NÃO aprovar sem corrigir",
};

export function renderEvidencePtBr(i: EvidenceTemplateInput): string {
  const lines: string[] = [];
  lines.push(`# Evidências do run ${i.runId}`);
  lines.push("");
  lines.push("## O que você pediu");
  lines.push(`> ${i.rawPrompt}`);
  lines.push(`Em termos técnicos: ${i.translatedIntent} (${i.workKind}, projeto ${i.projectSlug}).`);
  lines.push("");

  lines.push("## O que mudou");
  if (i.changedFiles.length === 0) {
    lines.push("Nenhum arquivo foi alterado.");
  } else {
    const verb: Record<string, string> = { created: "criado", modified: "alterado", deleted: "removido" };
    for (const c of i.changedFiles) lines.push(`- ${verb[c.action] ?? c.action}: ${c.path}`);
  }
  lines.push("");

  lines.push("## Testes");
  lines.push(
    i.validations.failed === 0
      ? `Todas as ${i.validations.passed} tarefa(s) passaram na validação automática.`
      : `${i.validations.passed} passaram, ${i.validations.failed} falharam na validação.`,
  );
  lines.push("");

  lines.push("## Revisão de qualidade (Gatekeeper)");
  if (!i.gateReview) {
    lines.push("Sem revisão de qualidade disponível.");
  } else {
    lines.push(`Veredito: ${VERDICT_PTBR[i.gateReview.verdict] ?? i.gateReview.verdict}`);
    const important = i.gateReview.findings.filter((f) => f.severity !== "info");
    if (important.length > 0) {
      lines.push("");
      lines.push("**Pontos de atenção:**");
      for (const f of important) {
        lines.push(`- [${f.severity}] ${f.text}${f.file ? ` (${f.file})` : ""}`);
      }
    }
  }
  lines.push("");

  lines.push("## Custo");
  lines.push(`US$ ${i.costUsd.toFixed(4)} · ${i.spentTokens} tokens.`);
  lines.push("");

  lines.push("## Como prosseguir");
  lines.push(`- Para integrar: \`pm approve ${i.runId}\``);
  lines.push(`- Para descartar: \`pm reject ${i.runId}\``);
  lines.push("");

  return lines.join("\n");
}
