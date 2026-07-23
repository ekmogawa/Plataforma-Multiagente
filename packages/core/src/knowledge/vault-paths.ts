import type { KnowledgeKind } from "@pm/contracts";

/**
 * Caminhos e slugs do vault (Camada 5). Determinísticos — o mesmo conteúdo lógico
 * sempre gera o mesmo caminho e o mesmo noteId (idempotência da escrita).
 * Os subdiretórios já existem em knowledge/ (projetos/ decisoes/ licoes/ grafos/).
 */

export const KIND_SUBDIR: Record<KnowledgeKind, string> = {
  projeto: "projetos",
  decisao: "decisoes",
  licao: "licoes",
  grafo: "grafos",
};

/** Slug ASCII estável: sem acento, minúsculo, só [a-z0-9-]. */
export function slugify(input: string): string {
  const ascii = input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // remove diacríticos
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii || "nota";
}

/** noteId estável derivado do caminho no vault (sem extensão). */
export function noteIdFromPath(vaultPath: string): string {
  return vaultPath.replace(/\.md$/i, "").replace(/[\\/]+/g, ":");
}

/** Índice do projeto: projetos/<slug>/index.md */
export function projectIndexPath(slug: string): string {
  return `projetos/${slug}/index.md`;
}

/** Nota de um run específico: projetos/<slug>/runs/<runId>.md */
export function runNotePath(slug: string, runId: string): string {
  return `projetos/${slug}/runs/${runId}.md`;
}

/** Lição: licoes/<slug>/<chave>.md (global se slug ausente). */
export function lessonPath(slug: string | undefined, key: string): string {
  const base = slug ? `licoes/${slug}` : "licoes";
  return `${base}/${slugify(key)}.md`;
}

/** ADR numerado: decisoes/<slug>/NNN-<titulo>.md */
export function adrPath(slug: string | undefined, n: number, title: string): string {
  const base = slug ? `decisoes/${slug}` : "decisoes";
  const num = String(n).padStart(3, "0");
  return `${base}/${num}-${slugify(title)}.md`;
}

/** Relatório do Graphify: grafos/<slug>/index.md */
export function graphPath(slug: string): string {
  return `grafos/${slug}/index.md`;
}
