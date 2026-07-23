import { EvolutionProposal } from "@pm/contracts";
import type { DB } from "./database.js";

/**
 * Persistência das propostas de auto-evolução (Camada 5). Cross-run — por isso
 * não usa o Artifact Store (que é por run_id). A rastreabilidade fecha via
 * evidence_json (aponta para os critérios/ids em metric_events).
 */
export class EvolutionRepo {
  constructor(private readonly db: DB) {}

  /** Insere ou atualiza (por id determinístico) uma proposta 'proposed'. */
  upsert(p: EvolutionProposal): void {
    this.db
      .prepare(
        `INSERT INTO evolution_proposals
           (id, created_at, target_kind, target_file, target_locator, category,
            rationale, diff, evidence_json, confidence, source, status)
         VALUES
           (@id, @created_at, @target_kind, @target_file, @target_locator, @category,
            @rationale, @diff, @evidence_json, @confidence, @source, @status)
         ON CONFLICT(id) DO UPDATE SET
           created_at=excluded.created_at, rationale=excluded.rationale,
           diff=excluded.diff, evidence_json=excluded.evidence_json,
           confidence=excluded.confidence, source=excluded.source
         WHERE evolution_proposals.status = 'proposed'`,
      )
      .run({
        id: p.id,
        created_at: p.createdAt,
        target_kind: p.target.kind,
        target_file: p.target.file,
        target_locator: p.target.locator,
        category: p.category,
        rationale: p.rationale,
        diff: p.diff,
        evidence_json: JSON.stringify(p.evidence),
        confidence: p.confidence,
        source: p.source,
        status: p.status,
      });
  }

  /** Marca uma proposta como aplicada ou descartada (decisão humana). */
  setStatus(id: string, status: "applied" | "dismissed"): void {
    this.db.prepare("UPDATE evolution_proposals SET status = ? WHERE id = ?").run(status, id);
  }

  /** Locators já resolvidos (aplicados/descartados) — não re-propor. */
  resolvedLocators(): Set<string> {
    const rows = this.db
      .prepare("SELECT DISTINCT target_locator FROM evolution_proposals WHERE status IN ('applied','dismissed')")
      .all() as { target_locator: string }[];
    return new Set(rows.map((r) => r.target_locator));
  }

  listByStatus(status: "proposed" | "applied" | "dismissed"): EvolutionProposal[] {
    const rows = this.db
      .prepare("SELECT * FROM evolution_proposals WHERE status = ? ORDER BY id")
      .all(status) as Record<string, unknown>[];
    return rows.map(rowToProposal);
  }
}

function rowToProposal(r: Record<string, unknown>): EvolutionProposal {
  return EvolutionProposal.parse({
    id: r.id,
    createdAt: r.created_at,
    target: { kind: r.target_kind, file: r.target_file, locator: r.target_locator },
    category: r.category,
    rationale: r.rationale,
    diff: r.diff,
    evidence: JSON.parse(String(r.evidence_json)),
    confidence: r.confidence,
    source: r.source,
    status: r.status,
  });
}
