import { EvolutionProposal, EvolutionReport } from "@pm/contracts";
import { createHash } from "node:crypto";
import type { EvolutionRepo } from "../db/evolution-repo.js";
import type { MetricsRepo } from "../db/metrics-repo.js";
import type { Clock } from "../shared/clock.js";
import { runEvolutionRules } from "./evolution-rules.js";

/**
 * Evolution Engine (Camada 5) — lê as métricas acumuladas e PROPÕE melhorias.
 *
 * GUARDRAIL DURO: analyze() NUNCA escreve em config/, prompts/ ou strategies.yaml.
 * Só persiste propostas na tabela evolution_proposals e devolve um relatório. A
 * aplicação (pm evolve apply) é humana e fica PLANNED na v1. Offline as propostas
 * saem com source="heuristica" (mecânicas, não fabricadas por IA).
 */
export interface EvolutionEngineDeps {
  metrics: MetricsRepo;
  proposals: EvolutionRepo;
  clock: Clock;
}

export class EvolutionEngine {
  constructor(private readonly deps: EvolutionEngineDeps) {}

  /** Analisa as métricas e devolve o relatório (persistindo as propostas novas). */
  analyze(opts: { window?: string } = {}): EvolutionReport {
    const capabilities = this.deps.metrics.aggregateByCapability();
    const prompts = this.deps.metrics.aggregateByPrompt();
    const tasks = this.deps.metrics.taskOutcomes();

    const drafts = runEvolutionRules({ capabilities, prompts, tasks });
    const resolved = this.deps.proposals.resolvedLocators();

    const now = this.deps.clock.now();
    const proposals: EvolutionProposal[] = [];
    for (const d of drafts) {
      // Não re-propõe um locator que o usuário já aplicou/descartou.
      if (resolved.has(d.target.locator)) continue;
      const id = `evo_${hash8(`${d.target.locator}|${d.category}`)}`;
      const proposal = EvolutionProposal.parse({ ...d, id, createdAt: now, status: "proposed" });
      this.deps.proposals.upsert(proposal);
      proposals.push(proposal);
    }

    return EvolutionReport.parse({
      generatedAt: now,
      window: opts.window ?? "all-time",
      totals: { metricsAnalyzed: this.deps.metrics.count(), proposals: proposals.length },
      proposals,
    });
  }
}

function hash8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}
