import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Encontra a raiz do repositório subindo até o marcador pnpm-workspace.yaml.
 * (registry-tools não depende de @pm/core para permanecer leve.)
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function registryPaths(root: string = findRepoRoot()) {
  return {
    root,
    registry: join(root, "registry"),
    components: join(root, "registry", "components"),
    schemas: join(root, "registry", "schemas"),
    relations: join(root, "registry", "relations.yaml"),
    pipelines: join(root, "registry", "pipelines.yaml"),
    docs: join(root, "docs"),
    diagramas: join(root, "docs", "diagramas"),
    manual: join(root, "docs", "manual-de-relacoes.md"),
  };
}
