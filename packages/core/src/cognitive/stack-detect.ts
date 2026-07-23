import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Detecção determinística de stack/framework/testes/convenções/dependências.
 * Extraído da CLI (pm projeto add) para o core e ampliado. Puro, Windows-safe
 * (node:path, guarda de tamanho antes de ler), table-driven.
 */

const MAX_MANIFEST_BYTES = 512 * 1024;

function readTextSafe(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  try {
    if (statSync(file).size > MAX_MANIFEST_BYTES) return undefined;
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function readJsonSafe(file: string): Record<string, unknown> | undefined {
  const text = readTextSafe(file);
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Stack de alto nível por arquivos-marcador. */
export function detectStack(root: string): string | undefined {
  const has = (f: string) => existsSync(join(root, f));
  if (has("package.json")) return "node";
  if (has("pyproject.toml") || has("requirements.txt")) return "python";
  if (has("Cargo.toml")) return "rust";
  if (has("go.mod")) return "go";
  if (has("pom.xml") || has("build.gradle")) return "java";
  if (has("pubspec.yaml")) return "flutter";
  return undefined;
}

/** Branch principal do repo git, se houver. */
export function detectDefaultBranch(root: string): string {
  const head = readTextSafe(join(root, ".git", "HEAD"));
  if (head) {
    const m = head.trim().match(/ref:\s*refs\/heads\/(.+)$/);
    if (m && m[1]) return m[1];
  }
  return "main";
}

function allDeps(pkg: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const section = pkg[key];
    if (section && typeof section === "object") {
      for (const [name, version] of Object.entries(section)) {
        out[name] = String(version);
      }
    }
  }
  return out;
}

const NODE_FRAMEWORKS: { dep: string; name: string }[] = [
  { dep: "next", name: "next" },
  { dep: "@nestjs/core", name: "nestjs" },
  { dep: "react", name: "react" },
  { dep: "vue", name: "vue" },
  { dep: "svelte", name: "svelte" },
  { dep: "@angular/core", name: "angular" },
  { dep: "express", name: "express" },
  { dep: "fastify", name: "fastify" },
  { dep: "vite", name: "vite" },
];

const PY_FRAMEWORKS: { needle: string; name: string }[] = [
  { needle: "django", name: "django" },
  { needle: "flask", name: "flask" },
  { needle: "fastapi", name: "fastapi" },
];

/** Framework principal detectado (o primeiro marcador que casar vence). */
export function detectFramework(root: string): string | undefined {
  const pkg = readJsonSafe(join(root, "package.json"));
  if (pkg) {
    const deps = allDeps(pkg);
    for (const { dep, name } of NODE_FRAMEWORKS) {
      if (dep in deps) return name;
    }
  }
  const reqs = (
    readTextSafe(join(root, "requirements.txt")) ??
    readTextSafe(join(root, "pyproject.toml")) ??
    ""
  ).toLowerCase();
  for (const { needle, name } of PY_FRAMEWORKS) {
    if (reqs.includes(needle)) return name;
  }
  return undefined;
}

const NPM_TEST_PLACEHOLDER = 'echo "Error: no test specified" && exit 1';

/** Comando que roda os testes do projeto, se detectável. */
export function detectTestCommand(root: string): string | undefined {
  const pkg = readJsonSafe(join(root, "package.json"));
  if (pkg) {
    const scripts = pkg.scripts;
    if (scripts && typeof scripts === "object") {
      const test = (scripts as Record<string, unknown>).test;
      if (typeof test === "string" && test.trim() && test.trim() !== NPM_TEST_PLACEHOLDER) {
        return "npm test";
      }
    }
    const deps = allDeps(pkg);
    if ("vitest" in deps) return "npx vitest run";
    if ("jest" in deps) return "npx jest";
  }
  const reqs = readTextSafe(join(root, "requirements.txt"))?.toLowerCase() ?? "";
  if (reqs.includes("pytest") || existsSync(join(root, "pytest.ini"))) return "pytest";
  return undefined;
}

/** Convenções detectadas (ESM/CommonJS, TypeScript, gerenciador, testes). */
export function detectConventions(root: string): string[] {
  const conventions: string[] = [];
  const pkg = readJsonSafe(join(root, "package.json"));
  if (pkg) {
    conventions.push(pkg.type === "module" ? "ESM" : "CommonJS");
    if (existsSync(join(root, "tsconfig.json"))) conventions.push("TypeScript");
    if (existsSync(join(root, "pnpm-lock.yaml"))) conventions.push("pnpm");
    else if (existsSync(join(root, "yarn.lock"))) conventions.push("yarn");
    else if (existsSync(join(root, "package-lock.json"))) conventions.push("npm");
    const deps = allDeps(pkg);
    if ("vitest" in deps) conventions.push("vitest");
    else if ("jest" in deps) conventions.push("jest");
    if ("prettier" in deps) conventions.push("prettier");
    if ("eslint" in deps) conventions.push("eslint");
  }
  return conventions;
}

/**
 * Dependências diretas (nome -> versão). Limitado para não inchar o ProjectMap;
 * inclui a nota de truncamento quando estoura o teto.
 */
export function parseDependencies(root: string, cap = 60): Record<string, string> {
  const out: Record<string, string> = {};
  const pkg = readJsonSafe(join(root, "package.json"));
  if (pkg) {
    const deps = allDeps(pkg);
    const names = Object.keys(deps).sort();
    for (const name of names.slice(0, cap)) out[name] = deps[name]!;
    if (names.length > cap) out["…"] = `+${names.length - cap} outras`;
    return out;
  }
  const reqs = readTextSafe(join(root, "requirements.txt"));
  if (reqs) {
    const lines = reqs
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    let n = 0;
    for (const line of lines) {
      if (n >= cap) {
        out["…"] = `+${lines.length - cap} outras`;
        break;
      }
      const m = line.match(/^([A-Za-z0-9._-]+)\s*([=<>!~].*)?$/);
      if (m && m[1]) {
        out[m[1]] = (m[2] ?? "").trim() || "*";
        n++;
      }
    }
  }
  return out;
}
