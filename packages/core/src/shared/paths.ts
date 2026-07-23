import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Resolução dos caminhos da plataforma.
 *
 * A raiz do repositório é encontrada subindo a partir do cwd até achar o
 * marcador `pnpm-workspace.yaml`. Pode ser sobrescrita por PM_HOME (útil em
 * testes). O modelo de operação é o Claude Code aberto na raiz do repo.
 */

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      // Não achou o marcador: cai no cwd para não travar.
      return resolve(start);
    }
    dir = parent;
  }
}

export interface PlatformPaths {
  root: string;
  config: string;
  registry: string;
  registrySchemas: string;
  prompts: string;
  docs: string;
  knowledge: string;
  workspace: string;
  projects: string;
  runs: string;
  db: string;
  dbFile: string;
}

export function resolvePaths(overrideRoot?: string): PlatformPaths {
  const root = overrideRoot ?? process.env.PM_HOME ?? findRepoRoot(process.cwd());
  return {
    root,
    config: join(root, "config"),
    registry: join(root, "registry"),
    registrySchemas: join(root, "registry", "schemas"),
    prompts: join(root, "prompts"),
    docs: join(root, "docs"),
    knowledge: join(root, "knowledge"),
    workspace: join(root, "workspace"),
    projects: join(root, "workspace", "projects"),
    runs: join(root, "workspace", "runs"),
    db: join(root, "workspace", "db"),
    dbFile: join(root, "workspace", "db", "platform.db"),
  };
}
