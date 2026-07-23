import type { KnowledgeNote } from "@pm/contracts";
import type { ObsidianWriter } from "./obsidian-writer.js";
import type { SqliteKnowledgeStore } from "./knowledge-store.js";
import { distill } from "./distill-stage.js";
import { contentTokens, jaccard } from "./text-normalize.js";

/**
 * Knowledge Processor (Camada 5) — destila o conhecimento bruto em útil, OFFLINE
 * e de forma NÃO-DESTRUTIVA: enriquece cada nota com tags derivadas e liga notas
 * relacionadas por wikilinks (Jaccard), sem apagar nem reescrever o conteúdo do
 * usuário. Marca `processado: true`. Idempotente (re-rodar não muda nada).
 *
 * Escolha deliberada: notas quase-duplicadas são LIGADAS, não fundidas/apagadas —
 * destruir memória automaticamente violaria o guardrail de aprovação humana.
 */
const LINK_THRESHOLD = 0.6;
const MAX_CANDIDATES = 12;
const MAX_LINKS = 6;

export interface KnowledgeProcessorDeps {
  store: SqliteKnowledgeStore;
  writer: ObsidianWriter;
}

export interface ProcessResult {
  processed: number;
  linked: number;
}

export class KnowledgeProcessor {
  constructor(private readonly deps: KnowledgeProcessorDeps) {}

  /** Destila as notas ainda não processadas (de um run, ou todas). */
  process(opts: { runId?: string } = {}): ProcessResult {
    const pending = this.deps.store.listUnprocessed(opts.runId);
    let linked = 0;

    for (const note of pending) {
      const d = distill(note);
      const links = this.relatedLinks(note);
      if (links.length > 0) linked += links.length;

      const tags = [...new Set([...note.tags, ...d.tags])].sort();
      const wikilinks = [...new Set([...note.wikilinks, ...links])];

      this.deps.writer.write({
        kind: note.kind,
        title: note.title,
        body: note.body,
        vaultPath: note.vaultPath,
        tags,
        headings: note.headings,
        projectSlug: note.projectSlug,
        runId: note.runId,
        wikilinks,
        processed: true,
      });
    }

    return { processed: pending.length, linked };
  }

  /**
   * Notas relacionadas (Jaccard do corpo ≥ limiar), como alvos de wikilink.
   * Candidatos vêm da busca FTS (O(n·k), não O(n²)); confirma por Jaccard real.
   */
  private relatedLinks(note: KnowledgeNote): string[] {
    const queryText = `${note.title} ${note.tags.join(" ")}`.trim();
    if (!queryText) return [];
    const hits = this.deps.store.search({
      text: queryText,
      projectSlug: note.projectSlug,
      processedOnly: false,
      limit: MAX_CANDIDATES,
    });
    const mine = contentTokens(note.body);
    const out: string[] = [];
    for (const hit of hits) {
      if (hit.noteId === note.noteId) continue;
      const other = this.deps.store.get(hit.noteId);
      if (!other) continue;
      if (jaccard(mine, contentTokens(other.body)) < LINK_THRESHOLD) continue;
      out.push(other.vaultPath.replace(/\.md$/i, ""));
      if (out.length >= MAX_LINKS) break;
    }
    return out.sort();
  }
}
