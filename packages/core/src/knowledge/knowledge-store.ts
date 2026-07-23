import { KnowledgeQuery as KnowledgeQuerySchema } from "@pm/contracts";
import type { KnowledgeHit, KnowledgeKind, KnowledgeNote, KnowledgeQuery } from "@pm/contracts";
import type { DB } from "../db/database.js";
import { redactSecrets } from "../shared/redaction.js";

/**
 * KnowledgeStore — o índice de busca da memória (Camada 5).
 *
 * ABSTRATO de propósito: a assinatura fala em `KnowledgeQuery`/`KnowledgeHit`,
 * nunca em FTS5 ou Qdrant. Trocar o mecanismo de busca no futuro é só um novo
 * adaptador. A implementação v1 é SQLite FTS5 (determinística, offline).
 */
export interface KnowledgeStore {
  /** Insere/atualiza a nota no índice (idempotente por hash). */
  index(note: KnowledgeNote): void;
  /** Busca as notas mais relevantes (maior score = melhor). */
  search(query: KnowledgeQuery): KnowledgeHit[];
  /** Remove notas do índice (por projeto ou por id). */
  purge(filter?: { projectSlug?: string; noteId?: string }): void;
  get(noteId: string): KnowledgeNote | undefined;
}

/** Só a leitura — é o que o Context Builder precisa (não escreve conhecimento). */
export type KnowledgeReadPort = Pick<KnowledgeStore, "search">;

interface NoteRow {
  note_id: string;
  kind: string;
  title: string;
  body: string;
  tags: string;
  headings: string;
  project_slug: string | null;
  run_id: string | null;
  vault_path: string;
  wikilinks: string;
  processed: number;
  hash: string;
  created_at: string;
  updated_at: string;
}

export class SqliteKnowledgeStore implements KnowledgeStore {
  constructor(private readonly db: DB) {}

  index(note: KnowledgeNote): void {
    const existing = this.db
      .prepare("SELECT hash FROM knowledge_notes WHERE note_id = ?")
      .get(note.noteId) as { hash: string } | undefined;
    // Idempotência: se o hash não mudou, não reescreve (evita churn no FTS).
    if (existing && existing.hash === note.hash) return;

    // Defesa em profundidade: re-redige o que vai ao índice (o writer já redige
    // ao gravar o markdown, mas o índice não confia — segredo nunca no índice).
    const title = redactSecrets(note.title).text;
    const body = redactSecrets(note.body).text;
    const tags = redactSecrets(note.tags.join(" ")).text;
    // headings unidos por \n (simétrico ao split de get(); títulos não têm \n).
    const headings = redactSecrets(note.headings.join("\n")).text;
    const wikilinks = note.wikilinks.join(" ");

    this.db
      .prepare(
        `INSERT INTO knowledge_notes
           (note_id, kind, title, body, tags, headings, project_slug, run_id,
            vault_path, wikilinks, processed, hash, created_at, updated_at)
         VALUES
           (@note_id, @kind, @title, @body, @tags, @headings, @project_slug, @run_id,
            @vault_path, @wikilinks, @processed, @hash, @created_at, @updated_at)
         ON CONFLICT(note_id) DO UPDATE SET
           kind=excluded.kind, title=excluded.title, body=excluded.body,
           tags=excluded.tags, headings=excluded.headings,
           project_slug=excluded.project_slug, run_id=excluded.run_id,
           vault_path=excluded.vault_path, wikilinks=excluded.wikilinks,
           processed=excluded.processed, hash=excluded.hash,
           updated_at=excluded.updated_at`,
      )
      .run({
        note_id: note.noteId,
        kind: note.kind,
        title,
        body,
        tags,
        headings,
        project_slug: note.projectSlug ?? null,
        run_id: note.runId ?? null,
        vault_path: note.vaultPath,
        wikilinks,
        processed: note.processed ? 1 : 0,
        hash: note.hash,
        created_at: note.createdAt,
        updated_at: note.updatedAt,
      });
  }

  search(rawQuery: KnowledgeQuery): KnowledgeHit[] {
    // Aplica defaults (limit/processedOnly) — chamadores podem passar parcial.
    const query = KnowledgeQuerySchema.parse(rawQuery);
    const match = toMatchExpr(query.text);
    if (!match) return [];

    const where: string[] = ["knowledge_fts MATCH @match"];
    const params: Record<string, unknown> = { match, limit: query.limit };
    if (query.projectSlug) {
      // Filtro por projeto SEMPRE inclui o conhecimento global (NULL).
      where.push("(n.project_slug = @slug OR n.project_slug IS NULL)");
      params.slug = query.projectSlug;
    }
    if (query.processedOnly) where.push("n.processed = 1");
    if (query.kinds && query.kinds.length > 0) {
      const placeholders = query.kinds.map((_, i) => `@k${i}`);
      where.push(`n.kind IN (${placeholders.join(", ")})`);
      query.kinds.forEach((k, i) => (params[`k${i}`] = k));
    }

    // bm25 com pesos por coluna (title 8, headings 4, body 1, tags 2). rank é
    // negativo (menor = melhor); score = -rank (maior = melhor). Desempate estável.
    const rows = this.db
      .prepare(
        `SELECT n.note_id, n.kind, n.title, n.project_slug, n.vault_path, n.tags,
                n.updated_at,
                snippet(knowledge_fts, 2, '[', ']', '…', 12) AS snip,
                bm25(knowledge_fts, 8.0, 4.0, 1.0, 2.0) AS rank
           FROM knowledge_fts
           JOIN knowledge_notes n ON n.rowid = knowledge_fts.rowid
          WHERE ${where.join(" AND ")}
          ORDER BY rank ASC, n.note_id ASC
          LIMIT @limit`,
      )
      .all(params) as (NoteRow & { snip: string; rank: number })[];

    let hits: KnowledgeHit[] = rows.map((r) => ({
      noteId: r.note_id,
      kind: r.kind as KnowledgeHit["kind"],
      title: r.title,
      projectSlug: r.project_slug ?? undefined,
      vaultPath: r.vault_path,
      snippet: r.snip,
      score: -r.rank,
      tags: r.tags ? r.tags.split(/\s+/).filter(Boolean) : [],
      updatedAt: r.updated_at,
    }));

    // Filtro de tags é pós-consulta (tags são poucas; simples e determinístico).
    if (query.tags && query.tags.length > 0) {
      const want = new Set(query.tags);
      hits = hits.filter((h) => h.tags.some((t) => want.has(t)));
    }
    return hits;
  }

  purge(filter?: { projectSlug?: string; noteId?: string }): void {
    if (filter?.noteId) {
      this.db.prepare("DELETE FROM knowledge_notes WHERE note_id = ?").run(filter.noteId);
      return;
    }
    if (filter?.projectSlug) {
      this.db.prepare("DELETE FROM knowledge_notes WHERE project_slug = ?").run(filter.projectSlug);
      return;
    }
    this.db.prepare("DELETE FROM knowledge_notes").run();
  }

  get(noteId: string): KnowledgeNote | undefined {
    const r = this.db
      .prepare("SELECT * FROM knowledge_notes WHERE note_id = ?")
      .get(noteId) as NoteRow | undefined;
    if (!r) return undefined;
    return {
      noteId: r.note_id,
      kind: r.kind as KnowledgeNote["kind"],
      title: r.title,
      body: r.body,
      tags: r.tags ? r.tags.split(/\s+/).filter(Boolean) : [],
      headings: r.headings ? r.headings.split("\n").filter(Boolean) : [],
      projectSlug: r.project_slug ?? undefined,
      runId: r.run_id ?? undefined,
      vaultPath: r.vault_path,
      wikilinks: r.wikilinks ? r.wikilinks.split(/\s+/).filter(Boolean) : [],
      processed: r.processed === 1,
      hash: r.hash,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /** Notas de um projeto (opcionalmente de um kind), ordenadas por note_id. */
  listByProject(projectSlug: string, kind?: KnowledgeKind): KnowledgeNote[] {
    const sql = kind
      ? "SELECT note_id FROM knowledge_notes WHERE project_slug = ? AND kind = ? ORDER BY note_id"
      : "SELECT note_id FROM knowledge_notes WHERE project_slug = ? ORDER BY note_id";
    const ids = (kind
      ? this.db.prepare(sql).all(projectSlug, kind)
      : this.db.prepare(sql).all(projectSlug)) as { note_id: string }[];
    return ids.map((r) => this.get(r.note_id)).filter((n): n is KnowledgeNote => n !== undefined);
  }

  /** Todas as notas de um run (para o processor destilar). */
  listUnprocessed(runId?: string): KnowledgeNote[] {
    const sql = runId
      ? "SELECT note_id FROM knowledge_notes WHERE processed = 0 AND run_id = ? ORDER BY note_id"
      : "SELECT note_id FROM knowledge_notes WHERE processed = 0 ORDER BY note_id";
    const ids = (runId ? this.db.prepare(sql).all(runId) : this.db.prepare(sql).all()) as {
      note_id: string;
    }[];
    return ids.map((r) => this.get(r.note_id)).filter((n): n is KnowledgeNote => n !== undefined);
  }
}

/**
 * Converte texto livre num MATCH seguro de FTS5. Tokeniza em palavras (Unicode),
 * descarta o resto (aspas, `-`, `*`, `:` quebrariam a sintaxe do FTS5) e une por
 * OR — recall alto, zero risco de erro de sintaxe/"injeção" de operador.
 */
export function toMatchExpr(text: string): string | undefined {
  const tokens = text.match(/[\p{L}\p{N}_]{2,}/gu);
  if (!tokens || tokens.length === 0) return undefined;
  const uniq = [...new Set(tokens.map((t) => t.toLowerCase()))].slice(0, 24);
  return uniq.map((t) => `"${t}"`).join(" OR ");
}
