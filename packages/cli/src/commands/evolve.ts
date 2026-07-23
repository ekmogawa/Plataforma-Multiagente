import { EvolutionEngine, EvolutionRepo, MetricsRepo, openDatabase, systemClock } from "@pm/core";
import { emit, mark, type OutputOptions } from "../output.js";

/**
 * pm evolve report — o Evolution Engine analisa as métricas acumuladas e propõe
 * melhorias RASTREÁVEIS (report-only; nada é aplicado sem decisão humana).
 */
export function evolveReport(opts: OutputOptions): number {
  const db = openDatabase();
  try {
    const engine = new EvolutionEngine({
      metrics: new MetricsRepo(db),
      proposals: new EvolutionRepo(db),
      clock: systemClock,
    });
    const report = engine.analyze();

    emit(
      report,
      () => {
        if (report.proposals.length === 0) {
          return `${mark.ok} Nenhuma sugestão de evolução no momento (analisadas ${report.totals.metricsAnalyzed} métrica(s)). Sem dados suficientes ou tudo dentro do esperado.`;
        }
        const lines = [
          `${mark.ok} ${report.proposals.length} sugestão(ões) de evolução (${report.totals.metricsAnalyzed} métricas analisadas):`,
          "",
        ];
        for (const p of report.proposals) {
          lines.push(`• [${p.category}] ${p.target.file} → ${p.target.locator}`);
          lines.push(`  ${p.rationale}`);
          lines.push(
            `  Evidência: ${p.evidence.metric}=${p.evidence.value} (amostra ${p.evidence.sampleSize}) | confiança: ${p.confidence} | origem: ${p.source}`,
          );
          if (p.diff) lines.push("  Diff proposto disponível.");
          lines.push("");
        }
        lines.push("Nada foi aplicado — a decisão de aplicar cada sugestão é sua.");
        return lines.join("\n");
      },
      opts,
    );
    return 0;
  } finally {
    db.close();
  }
}
