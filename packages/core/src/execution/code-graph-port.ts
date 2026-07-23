import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * CodeGraphPort — vizinhança de um arquivo no grafo do código. Na Camada 2 a
 * implementação é TRIVIAL (imports relativos estáticos); a Camada 5 (Graphify)
 * troca por um grafo real SEM mudar o Context Builder.
 */
export interface CodeGraphPort {
  /** Arquivos vizinhos (dependências diretas) de `relFile`, relativos à raiz. */
  neighborsOf(relFile: string): string[];
}

const IMPORT_RE = /(?:import|export)[^"']*?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
const CANDIDATE_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js"];
const MAX_FILE_BYTES = 200_000;

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

export class StaticImportCodeGraph implements CodeGraphPort {
  constructor(
    private readonly root: string,
    private readonly maxNeighbors = 12,
  ) {}

  neighborsOf(relFile: string): string[] {
    const abs = join(this.root, relFile);
    let text: string;
    try {
      if (!existsSync(abs) || statSync(abs).size > MAX_FILE_BYTES) return [];
      text = readFileSync(abs, "utf8");
    } catch {
      return [];
    }

    const out = new Set<string>();
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec || !spec.startsWith(".")) continue; // só imports relativos
      const resolved = this.resolveImport(dirname(abs), spec);
      if (resolved) out.add(resolved);
      if (out.size >= this.maxNeighbors) break;
    }
    return [...out].sort();
  }

  private resolveImport(fromDir: string, spec: string): string | undefined {
    const bareAbs = resolve(fromDir, spec.replace(/\.js$/, ""));
    for (const ext of CANDIDATE_EXT) {
      const cand = bareAbs + ext;
      if (existsSync(cand) && statSync(cand).isFile()) {
        const rel = toPosix(cand.slice(this.root.length)).replace(/^\//, "");
        return rel;
      }
    }
    return undefined;
  }
}
