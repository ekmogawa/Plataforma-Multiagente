import {
  EspecialidadesConfig,
  ModelsConfig,
  PlatformConfig,
  StrategiesConfig,
  type EspecialidadesConfig as EspecialidadesConfigT,
  type ModelsConfig as ModelsConfigT,
  type PlatformConfig as PlatformConfigT,
  type StrategiesConfig as StrategiesConfigT,
} from "@pm/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolvePaths } from "./paths.js";

/**
 * Carrega e valida os arquivos de configuração da plataforma.
 * Config inválida falha cedo e com mensagem clara.
 */

function loadYaml(file: string): unknown {
  const raw = readFileSync(file, "utf8");
  return parseYaml(raw);
}

/**
 * Interpola ${VAR} pelos valores de process.env em todas as strings.
 * Var ausente vira string vazia (config valida como opcional).
 */
function interpolateEnv<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) =>
      process.env[name] ?? "",
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateEnv(v)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateEnv(v);
    return out as T;
  }
  return value;
}

export function loadModelsConfig(root?: string): ModelsConfigT {
  const paths = resolvePaths(root);
  const file = join(paths.config, "models.yaml");
  const data = interpolateEnv(loadYaml(file));
  const result = ModelsConfig.safeParse(data);
  if (!result.success) {
    throw new Error(
      `config/models.yaml inválido:\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadStrategiesConfig(root?: string): StrategiesConfigT {
  const paths = resolvePaths(root);
  const file = join(paths.config, "strategies.yaml");
  const data = loadYaml(file);
  const result = StrategiesConfig.safeParse(data);
  if (!result.success) {
    throw new Error(
      `config/strategies.yaml inválido:\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadEspecialidadesConfig(root?: string): EspecialidadesConfigT {
  const paths = resolvePaths(root);
  const file = join(paths.config, "especialidades.yaml");
  const data = loadYaml(file);
  const result = EspecialidadesConfig.safeParse(data);
  if (!result.success) {
    throw new Error(
      `config/especialidades.yaml inválido:\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadPlatformConfig(root?: string): PlatformConfigT {
  const paths = resolvePaths(root);
  const file = join(paths.config, "platform.yaml");
  const data = loadYaml(file);
  const result = PlatformConfig.safeParse(data);
  if (!result.success) {
    throw new Error(
      `config/platform.yaml inválido:\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

function formatZodError(error: {
  issues: { path: (string | number)[]; message: string }[];
}): string {
  return error.issues
    .map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`)
    .join("\n");
}
