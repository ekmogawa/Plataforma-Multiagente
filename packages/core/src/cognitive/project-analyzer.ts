import { ProjectMap, type ProjectMap as ProjectMapT, type ProjectTarget } from "@pm/contracts";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { join, sep } from "node:path";
import { systemClock, type Clock } from "../shared/clock.js";
import {
  detectConventions,
  detectFramework,
  detectTestCommand,
  parseDependencies,
} from "./stack-detect.js";

/**
 * Project Analyzer — determinístico, zero tokens. Varre o repo alvo de forma
 * Windows-safe e produz um ProjectMap. Gerado 1× por run e reutilizado.
 */

/** Diretórios ignorados (comparação por basename minúsculo — FS case-insensitive). */
export const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".idea",
  ".vscode",
]);

export interface AnalyzeOptions {
  clock?: Clock;
  maxDepth?: number;
  maxEntries?: number;
}

/** Normaliza para barras '/', a mesma convenção do ArtifactStore. */
function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function safeRealpath(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

/**
 * Varre `root` coletando caminhos relevantes (dirs primeiro, alfabético),
 * pulando ignorados e symlinks, respeitando profundidade e teto de entradas.
 * Usa realpath para pular JUNCTIONS do Windows (que reportam isSymbolicLink()
 * = false) que saiam da árvore alvo ou criem loops.
 */
function walk(root: string, maxDepth: number, maxEntries: number): string[] {
  const out: string[] = [];
  const rootReal = safeRealpath(root);
  const visited = new Set<string>([rootReal]);

  const visit = (dir: string, rel: string, depth: number): void => {
    if (depth > maxDepth || out.length >= maxEntries) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Dirs primeiro, depois arquivos; cada grupo em ordem alfabética estável.
    // Comparação binária (por code unit): determinismo independente de locale/ICU.
    const byName = (a: Dirent, b: Dirent) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .filter((e) => !DEFAULT_IGNORES.has(e.name.toLowerCase()))
      .sort(byName);
    const files = entries
      .filter((e) => e.isFile() && !e.isSymbolicLink())
      .sort(byName);

    for (const d of dirs) {
      if (out.length >= maxEntries) return;
      const abs = join(dir, d.name);
      const real = safeRealpath(abs);
      // Pula junction/reparse point que aponta para fora da árvore ou já visitado.
      if (!isInside(real, rootReal) || visited.has(real)) continue;
      visited.add(real);
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      out.push(`${childRel}/`);
      visit(abs, childRel, depth + 1);
    }
    for (const f of files) {
      if (out.length >= maxEntries) return;
      out.push(rel ? `${rel}/${f.name}` : f.name);
    }
  };

  visit(root, "", 0);
  return out;
}

export function analyzeProject(
  target: ProjectTarget,
  opts: AnalyzeOptions = {},
): ProjectMapT {
  const clock = opts.clock ?? systemClock;
  const maxDepth = opts.maxDepth ?? 4;
  const maxEntries = opts.maxEntries ?? 400;
  const root = target.rootPath;

  const structure = existsSync(root) ? walk(root, maxDepth, maxEntries).map(toPosix) : [];

  return ProjectMap.parse({
    slug: target.slug,
    generatedAt: clock.now(),
    structure,
    dependencies: parseDependencies(root),
    framework: detectFramework(root),
    conventions: detectConventions(root),
    testCommand: detectTestCommand(root),
  });
}

/**
 * Fingerprint barato do projeto (para invalidar cache do ProjectMap): hash de
 * tamanho+mtime dos manifests-chave. Muda quando as dependências/config mudam.
 */
export function projectFingerprint(root: string): string {
  const manifests = [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "requirements.txt",
    "pyproject.toml",
    "tsconfig.json",
  ];
  const h = createHash("sha256");
  for (const m of manifests) {
    const p = join(root, m);
    try {
      const s = statSync(p);
      h.update(`${m}:${s.size}:${s.mtimeMs};`);
    } catch {
      h.update(`${m}:absent;`);
    }
  }
  return h.digest("hex").slice(0, 16);
}
