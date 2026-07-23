import {
  ComponentSpec,
  PipelinesFile,
  RelationsFile,
  type ComponentSpec as ComponentSpecT,
  type Pipeline,
  type Relation,
} from "@pm/contracts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { registryPaths } from "./paths.js";

/**
 * Carrega e valida (contra os schemas zod) todo o registro.
 * Erros de forma nos arquivos YAML aparecem aqui, com o arquivo de origem.
 */

export interface Registry {
  components: ComponentSpecT[];
  relations: Relation[];
  pipelines: Pipeline[];
}

export class RegistryLoadError extends Error {}

function parseFile<T>(
  file: string,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
): T {
  const raw = readFileSync(file, "utf8");
  const data = parseYaml(raw);
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new RegistryLoadError(
      `Arquivo inválido: ${file}\n${formatIssues(result.error)}`,
    );
  }
  return result.data as T;
}

function formatIssues(error: unknown): string {
  const issues = (error as { issues?: { path: (string | number)[]; message: string }[] })
    .issues;
  if (!issues) return String(error);
  return issues
    .map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`)
    .join("\n");
}

export function loadRegistry(root?: string): Registry {
  const paths = registryPaths(root);

  const componentFiles = readdirSync(paths.components).filter((f) =>
    f.endsWith(".yaml"),
  );
  const components = componentFiles.map((f) =>
    parseFile<ComponentSpecT>(join(paths.components, f), ComponentSpec),
  );

  const relations = parseFile<{ relations: Relation[] }>(
    paths.relations,
    RelationsFile,
  ).relations;

  const pipelines = parseFile<{ pipelines: Pipeline[] }>(
    paths.pipelines,
    PipelinesFile,
  ).pipelines;

  return { components, relations, pipelines };
}
