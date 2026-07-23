import type { EvolutionProposal } from "@pm/contracts";
import type { CapabilityStat, PromptStat } from "../db/metrics-repo.js";

/**
 * Regras determinísticas do Evolution Engine (Camada 5). Puras: recebem os
 * agregados de métricas e devolvem PROPOSTAS (sem id/createdAt/status, que o
 * motor carimba). Offline as propostas são consultivas (diff vazio) — honestas:
 * apontam O QUE revisar e a evidência, sem fabricar um patch que exigiria julgar
 * o catálogo de modelos.
 */
export type ProposalDraft = Omit<EvolutionProposal, "id" | "createdAt" | "status">;

export interface EvolutionInputs {
  capabilities: CapabilityStat[];
  prompts: PromptStat[];
  tasks: { total: number; failures: number; escalations: number };
}

const MIN_SAMPLE = 5;
const FAILURE_RATE = 0.4;
const ESCALATION_RATE = 0.3;

export function runEvolutionRules(inp: EvolutionInputs): ProposalDraft[] {
  const out: ProposalDraft[] = [];

  // Regra 1 (routing): capacidade com alta taxa de falha -> revisar o modelo.
  for (const c of inp.capabilities) {
    if (c.total < MIN_SAMPLE) continue;
    const rate = c.failures / c.total;
    if (rate < FAILURE_RATE) continue;
    out.push({
      target: { kind: "capability", file: "config/models.yaml", locator: `capabilities.${c.capability}` },
      category: "routing",
      rationale: `A capacidade "${c.capability}" falhou em ${pct(rate)} de ${c.total} chamadas. Considere trocar o modelo padrão desta capacidade em config/models.yaml.`,
      diff: "",
      evidence: {
        metric: "failure_rate",
        scope: `capability=${c.capability}`,
        sampleSize: c.total,
        value: round(rate),
        window: "all-time",
        metricRefs: [`metric_events WHERE kind='llm_call' AND json_extract(meta_json,'$.capability')='${c.capability}'`],
      },
      confidence: rate >= 0.6 ? "alta" : "media",
      source: "heuristica",
    });
  }

  // Regra 2 (prompt-revision): prompt com alta taxa de saída inválida/falha.
  for (const p of inp.prompts) {
    if (p.total < MIN_SAMPLE) continue;
    const rate = p.failures / p.total;
    if (rate < FAILURE_RATE) continue;
    out.push({
      target: {
        kind: "prompt",
        file: `prompts/${p.promptId}.v${p.promptVersion}.md`,
        locator: `${p.promptId}@v${p.promptVersion}`,
      },
      category: "prompt-revision",
      rationale: `O prompt "${p.promptId}" (v${p.promptVersion}) falhou em ${pct(rate)} de ${p.total} chamadas. Considere revisar o prompt numa nova versão.`,
      diff: "",
      evidence: {
        metric: "failure_rate",
        scope: `prompt=${p.promptId}@v${p.promptVersion}`,
        sampleSize: p.total,
        value: round(rate),
        window: "all-time",
        metricRefs: [`metric_events WHERE kind='llm_call' AND prompt_id='${p.promptId}' AND prompt_version=${p.promptVersion}`],
      },
      confidence: "media",
      source: "heuristica",
    });
  }

  // Regra 3 (strategy-tuning): escalação frequente -> revisar a escada de retry.
  // Disponível OFFLINE (métricas de escalação vêm de eventos, não de LLM).
  if (inp.tasks.total >= MIN_SAMPLE) {
    const escRate = inp.tasks.escalations / inp.tasks.total;
    if (escRate >= ESCALATION_RATE) {
      out.push({
        target: { kind: "strategy", file: "config/strategies.yaml", locator: "retry-ladder" },
        category: "strategy-tuning",
        rationale: `${inp.tasks.escalations} de ${inp.tasks.total} tarefas escalaram (${pct(escRate)}). A escada de retry pode estar curta, ou o roteamento está levando tarefas ao executor errado. Revise config/strategies.yaml.`,
        diff: "",
        evidence: {
          metric: "escalation_rate",
          scope: "global",
          sampleSize: inp.tasks.total,
          value: round(escRate),
          window: "all-time",
          metricRefs: ["metric_events WHERE kind='escalation'"],
        },
        confidence: "media",
        source: "heuristica",
      });
    }
  }

  return out;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
