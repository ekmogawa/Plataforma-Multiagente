import { z } from "zod";
import { Id, IsoTimestamp } from "./common.js";

/**
 * Conhecimento (Camada 5) — a memória da plataforma.
 *
 * Uma NOTA vive em dois lugares que são a mesma verdade: um arquivo markdown no
 * vault Obsidian (knowledge/) e uma linha indexada em FTS5 (para a IA buscar). O
 * frontmatter do markdown é a fonte; o índice é derivado e reconstruível.
 *
 * `KnowledgeQuery`/`KnowledgeHit` são ABSTRATOS de propósito: trocar FTS5 por
 * Qdrant (busca semântica) no futuro é só um novo adaptador — a assinatura não
 * menciona o mecanismo.
 */

/** Tipo de nota — mapeia 1:1 aos subdiretórios do vault. */
export const KnowledgeKind = z.enum(["projeto", "decisao", "licao", "grafo"]);
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;

export const KnowledgeNote = z.object({
  /** Slug estável derivado do vaultPath (o frontmatter é a verdade). */
  noteId: Id,
  kind: KnowledgeKind,
  title: z.string().min(1),
  /** Markdown SEM frontmatter, já REDIGIDO (segredo nunca entra no vault). */
  body: z.string().default(""),
  tags: z.array(z.string()).default([]),
  headings: z.array(z.string()).default([]),
  /** Ausente = conhecimento global (não atado a um projeto). */
  projectSlug: Id.optional(),
  runId: Id.optional(),
  /** Caminho relativo à raiz do repo (para o Obsidian e para citação). */
  vaultPath: z.string(),
  wikilinks: z.array(z.string()).default([]),
  /** true depois que o Knowledge Processor destilou a nota. */
  processed: z.boolean().default(false),
  /** Hash do conteúdo — idempotência da escrita e da indexação. */
  hash: z.string(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type KnowledgeNote = z.infer<typeof KnowledgeNote>;

/** Consulta abstrata ao conhecimento (troca p/ Qdrant = só adaptador). */
export const KnowledgeQuery = z.object({
  text: z.string().min(1),
  /** Filtro por projeto; sempre inclui o conhecimento global. */
  projectSlug: Id.optional(),
  kinds: z.array(KnowledgeKind).optional(),
  tags: z.array(z.string()).optional(),
  /** Por padrão só o conhecimento DESTILADO alimenta o contexto. */
  processedOnly: z.boolean().default(true),
  limit: z.number().int().positive().max(50).default(8),
});
export type KnowledgeQuery = z.infer<typeof KnowledgeQuery>;

export const KnowledgeHit = z.object({
  noteId: Id,
  kind: KnowledgeKind,
  title: z.string(),
  projectSlug: Id.optional(),
  vaultPath: z.string(),
  snippet: z.string(),
  /** MAIOR = melhor (agnóstico do backend de busca). */
  score: z.number(),
  tags: z.array(z.string()).default([]),
  updatedAt: IsoTimestamp,
});
export type KnowledgeHit = z.infer<typeof KnowledgeHit>;

/** Saída do distill-stage (pré-markdown) — o que a destilação produz. */
export const DistilledNote = z.object({
  title: z.string(),
  kind: KnowledgeKind,
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
  patterns: z.array(z.string()).default([]),
});
export type DistilledNote = z.infer<typeof DistilledNote>;
