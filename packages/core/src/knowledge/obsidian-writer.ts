import type { KnowledgeKind, KnowledgeNote } from "@pm/contracts";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Clock } from "../shared/clock.js";
import { resolveInside } from "../execution/path-guard.js";
import { redactSecrets } from "../shared/redaction.js";
import { composeMarkdown, type FrontmatterValue } from "./note-format.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import { noteIdFromPath } from "./vault-paths.js";

/**
 * ObsidianWriter — a ÚNICA porta de escrita no vault (Camada 5).
 *
 * Responsabilidades: (1) REDIGIR segredos de cada valor antes de gravar (o vault
 * fica FORA de workspace/runs/, então a redação do ArtifactStore não o cobre —
 * este writer é o choke-point); (2) compor o markdown determinístico; (3) gravar
 * o .md confinado ao vault; (4) indexar no KnowledgeStore. Idempotente por hash.
 */
export interface WriteNoteInput {
  kind: KnowledgeKind;
  title: string;
  /** Markdown do corpo (sem frontmatter). */
  body: string;
  /** Caminho relativo à raiz do vault (ex.: "projetos/app/runs/run_1.md"). */
  vaultPath: string;
  tags?: string[];
  headings?: string[];
  projectSlug?: string;
  runId?: string;
  wikilinks?: string[];
  processed?: boolean;
}

export interface ObsidianWriterDeps {
  /** Raiz do vault (a pasta knowledge/). */
  vaultRoot: string;
  store: KnowledgeStore;
  clock: Clock;
}

export class ObsidianWriter {
  constructor(private readonly deps: ObsidianWriterDeps) {}

  /** Grava (ou atualiza) uma nota no vault e no índice. Idempotente por hash. */
  write(input: WriteNoteInput): KnowledgeNote {
    const noteId = noteIdFromPath(input.vaultPath);
    const title = redactSecrets(input.title).text;
    const body = redactSecrets(input.body).text;
    const tags = (input.tags ?? []).map((t) => redactSecrets(t).text);
    const headings = input.headings ?? [];
    const wikilinks = input.wikilinks ?? [];
    const processed = input.processed ?? false;

    const hash = hashNote({
      kind: input.kind,
      title,
      body,
      tags,
      headings,
      projectSlug: input.projectSlug,
      runId: input.runId,
      wikilinks,
      processed,
    });

    const abs = resolveInside(this.deps.vaultRoot, input.vaultPath);
    const existing = this.deps.store.get(noteId);
    // Idempotência: nada mudou E o arquivo já existe -> não reescreve.
    if (existing && existing.hash === hash && existsSync(abs)) return existing;

    const createdAt = existing?.createdAt ?? this.deps.clock.now();
    const updatedAt = this.deps.clock.now();

    const frontmatter: [string, FrontmatterValue][] = [
      ["noteId", noteId],
      ["kind", input.kind],
      ["title", title],
      ["tags", tags],
    ];
    if (input.projectSlug) frontmatter.push(["projectSlug", input.projectSlug]);
    if (input.runId) frontmatter.push(["runId", input.runId]);
    frontmatter.push(["processed", processed], ["createdAt", createdAt], ["updatedAt", updatedAt]);

    const md = composeMarkdown({ frontmatter, body, wikilinks });
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, md, "utf8");

    const note: KnowledgeNote = {
      noteId,
      kind: input.kind,
      title,
      body,
      tags,
      headings,
      projectSlug: input.projectSlug,
      runId: input.runId,
      vaultPath: input.vaultPath,
      wikilinks,
      processed,
      hash,
      createdAt,
      updatedAt,
    };
    this.deps.store.index(note);
    return note;
  }

  /** Caminho absoluto de uma nota (para inspeção/teste). */
  absPathOf(vaultPath: string): string {
    return join(this.deps.vaultRoot, vaultPath);
  }
}

/** Hash determinístico do conteúdo lógico (define a idempotência). */
export function hashNote(fields: {
  kind: string;
  title: string;
  body: string;
  tags: string[];
  headings: string[];
  projectSlug?: string;
  runId?: string;
  wikilinks: string[];
  processed: boolean;
}): string {
  const canonical = JSON.stringify({
    kind: fields.kind,
    title: fields.title,
    body: fields.body,
    tags: [...fields.tags].sort(),
    headings: fields.headings,
    projectSlug: fields.projectSlug ?? null,
    runId: fields.runId ?? null,
    wikilinks: [...fields.wikilinks].sort(),
    processed: fields.processed,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
