import { existsSync, lstatSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { StaticImportCodeGraph } from "../execution/code-graph-port.js";
import type { CodeGraphPort } from "../execution/code-graph-port.js";
import type { ObsidianWriter } from "./obsidian-writer.js";
import { graphPath } from "./vault-paths.js";

/**
 * Graphify (Camada 5) — a memória ESTRUTURAL do código. Varre o projeto (com
 * teto), monta o grafo de imports com o StaticImportCodeGraph (fallback embutido,
 * zero token) e escreve um relatório navegável no Obsidian (grafos/<slug>/index.md,
 * com bloco mermaid + hubs em wikilink) + um graph.json para troca futura do
 * Context Builder. Se estourar o teto, escreve o grafo PARCIAL e narra o corte.
 */
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".obsidian", "coverage", ".next"]);
const DEFAULT_MAX_FILES = 400;
const MERMAID_MAX_EDGES = 60;
const HUBS_SHOWN = 15;

export interface GraphifyDeps {
  writer: ObsidianWriter;
  /** Raiz do vault (para gravar o graph.json ao lado do index.md). */
  vaultRoot: string;
  maxFiles?: number;
}

export interface GraphifyResult {
  slug: string;
  files: number;
  edges: number;
  truncated: boolean;
  vaultPath: string;
}

export class GraphifyWorker {
  constructor(private readonly deps: GraphifyDeps) {}

  run(input: { slug: string; projectRoot: string }): GraphifyResult {
    const maxFiles = this.deps.maxFiles ?? DEFAULT_MAX_FILES;
    const { files, truncated } = collectFiles(input.projectRoot, maxFiles);
    const graph = new StaticImportCodeGraph(input.projectRoot);

    const adjacency: Record<string, string[]> = {};
    const inDegree = new Map<string, number>();
    let edges = 0;
    for (const rel of files) {
      const neighbors = graph.neighborsOf(rel);
      adjacency[rel] = neighbors;
      edges += neighbors.length;
      for (const n of neighbors) inDegree.set(n, (inDegree.get(n) ?? 0) + 1);
    }

    const hubs = [...inDegree.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
      .slice(0, HUBS_SHOWN);

    const body = renderReport({ slug: input.slug, files: files.length, edges, truncated, hubs, adjacency });
    const note = this.deps.writer.write({
      kind: "grafo",
      title: `Grafo do código — ${input.slug}`,
      body,
      vaultPath: graphPath(input.slug),
      projectSlug: input.slug,
      tags: ["grafo", "codigo", "estrutura"],
      processed: true, // grafo é derivado; já é "processado"
    });

    // graph.json ao lado (dado para o PersistedCodeGraph; não é uma nota).
    const jsonAbs = join(this.deps.vaultRoot, `grafos/${input.slug}/graph.json`);
    mkdirSync(join(this.deps.vaultRoot, `grafos/${input.slug}`), { recursive: true });
    writeFileSync(jsonAbs, JSON.stringify({ slug: input.slug, adjacency }, null, 2), "utf8");

    return { slug: input.slug, files: files.length, edges, truncated, vaultPath: note.vaultPath };
  }
}

/** CodeGraphPort que lê um graph.json persistido (troca futura no Context Builder). */
export class PersistedCodeGraph implements CodeGraphPort {
  constructor(private readonly adjacency: Record<string, string[]>) {}
  neighborsOf(relFile: string): string[] {
    return this.adjacency[relFile] ?? [];
  }
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Varre o projeto por arquivos de código, com teto (determinístico, ordenado). */
export function collectFiles(root: string, maxFiles: number): { files: string[]; truncated: boolean } {
  const out: string[] = [];
  let truncated = false;

  const walk = (dir: string): void => {
    if (out.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = lstatSync(abs); // lstat: NÃO segue symlink (evita ciclos de diretório)
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue; // symlinks/junctions são ignorados
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile() && CODE_EXT.has(extOf(name)) && !name.endsWith(".d.ts")) {
        out.push(toPosix(relative(root, abs)));
      }
    }
  };

  if (existsSync(root)) walk(root);
  return { files: out.sort(), truncated };
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function renderReport(input: {
  slug: string;
  files: number;
  edges: number;
  truncated: boolean;
  hubs: [string, number][];
  adjacency: Record<string, string[]>;
}): string {
  const lines: string[] = [];
  lines.push(`Grafo estrutural do projeto **${input.slug}** (imports relativos).`);
  lines.push("");
  lines.push(`- Arquivos analisados: ${input.files}`);
  lines.push(`- Dependências (arestas): ${input.edges}`);
  if (input.truncated) {
    lines.push(`- ⚠️ Análise PARCIAL: o teto de arquivos foi atingido — o grafo não cobre o projeto inteiro.`);
  }
  lines.push("");

  if (input.hubs.length > 0) {
    lines.push("## Módulos mais dependidos (hubs)");
    for (const [file, deg] of input.hubs) {
      lines.push(`- \`${file}\` — ${deg} dependente(s)`);
    }
    lines.push("");
  }

  // Mermaid: só as primeiras MERMAID_MAX_EDGES arestas (legibilidade).
  const ids = new Map<string, string>();
  const idOf = (f: string): string => {
    let id = ids.get(f);
    if (!id) {
      id = `n${ids.size}`;
      ids.set(f, id);
    }
    return id;
  };
  const edgeLines: string[] = [];
  let shown = 0;
  for (const [from, tos] of Object.entries(input.adjacency).sort()) {
    for (const to of tos) {
      if (shown >= MERMAID_MAX_EDGES) break;
      edgeLines.push(`  ${idOf(from)}["${from}"] --> ${idOf(to)}["${to}"]`);
      shown++;
    }
    if (shown >= MERMAID_MAX_EDGES) break;
  }
  if (edgeLines.length > 0) {
    lines.push("## Diagrama");
    if (shown >= MERMAID_MAX_EDGES) lines.push(`(mostrando as primeiras ${MERMAID_MAX_EDGES} arestas)`);
    lines.push("```mermaid");
    lines.push("graph LR");
    lines.push(...edgeLines);
    lines.push("```");
  }
  return lines.join("\n");
}
