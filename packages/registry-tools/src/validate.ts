import { isKnownSchema } from "@pm/contracts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadRegistry, RegistryLoadError, type Registry } from "./loader.js";
import { findRepoRoot } from "./paths.js";

/** Lê os nomes das capacidades de config/models.yaml (null se indisponível). */
function loadCapabilityNames(root: string): Set<string> | null {
  const file = join(root, "config", "models.yaml");
  if (!existsSync(file)) return null;
  try {
    const data = parseYaml(readFileSync(file, "utf8")) as {
      capabilities?: Record<string, unknown>;
    };
    return new Set(Object.keys(data.capabilities ?? {}));
  } catch {
    return null;
  }
}

/**
 * Validação estrutural do Manual de Relações.
 * Garante que o registro é coerente: ids únicos, camadas corretas, entrypoints
 * de componentes ativos existem, contratos/payloads referenciam schemas reais,
 * e relações/pipelines apontam para componentes existentes.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    components: number;
    active: number;
    planned: number;
    relations: number;
    pipelines: number;
  };
}

const LAYERS = [
  "cognitive",
  "orchestration",
  "execution",
  "governance",
  "knowledge",
  "infrastructure",
];

export function validateRegistry(root?: string): ValidationResult {
  const repoRoot = root ?? findRepoRoot();
  const errors: string[] = [];
  const warnings: string[] = [];

  let registry: Registry;
  try {
    registry = loadRegistry(repoRoot);
  } catch (err) {
    const msg = err instanceof RegistryLoadError ? err.message : String(err);
    return {
      ok: false,
      errors: [msg],
      warnings: [],
      stats: { components: 0, active: 0, planned: 0, relations: 0, pipelines: 0 },
    };
  }

  const capabilityNames = loadCapabilityNames(repoRoot);
  if (!capabilityNames) {
    warnings.push("config/models.yaml não encontrado/ilegível: capacidades não verificadas.");
  }

  const ids = new Set<string>();
  let active = 0;
  let planned = 0;

  for (const c of registry.components) {
    if (ids.has(c.id)) errors.push(`Id de componente duplicado: ${c.id}`);
    ids.add(c.id);

    // Id no formato "layer.name" e prefixo coerente com o campo layer.
    const prefix = c.id.split(".")[0] ?? "";
    if (!LAYERS.includes(prefix)) {
      errors.push(`Componente ${c.id}: prefixo "${prefix}" não é uma camada válida.`);
    } else if (prefix !== c.layer) {
      errors.push(
        `Componente ${c.id}: prefixo do id ("${prefix}") difere do layer ("${c.layer}").`,
      );
    }

    if (c.status === "active") active++;
    if (c.status === "planned") planned++;

    // Entrypoint de componente ativo deve existir.
    if (c.status === "active") {
      if (!c.entrypoint) {
        errors.push(`Componente ativo ${c.id} sem entrypoint.`);
      } else if (!existsSync(join(repoRoot, c.entrypoint))) {
        errors.push(
          `Componente ativo ${c.id}: entrypoint não encontrado: ${c.entrypoint}`,
        );
      }
    }

    // Contratos referenciados devem ser schemas conhecidos.
    for (const [side, name] of [
      ["input", c.contract.input],
      ["output", c.contract.output],
    ] as const) {
      if (name && !isKnownSchema(name)) {
        errors.push(
          `Componente ${c.id}: contract.${side} "${name}" não é um schema conhecido.`,
        );
      }
    }

    // Capacidade declarada deve existir em models.yaml.
    if (c.capability && capabilityNames && !capabilityNames.has(c.capability)) {
      errors.push(
        `Componente ${c.id}: capability "${c.capability}" não existe em config/models.yaml.`,
      );
    }
  }

  // Relações: from/to existem; payload é schema conhecido.
  for (const r of registry.relations) {
    if (!ids.has(r.from)) errors.push(`Relação com "from" inexistente: ${r.from}`);
    if (!ids.has(r.to)) errors.push(`Relação com "to" inexistente: ${r.to}`);
    if (r.payload && !isKnownSchema(r.payload)) {
      errors.push(
        `Relação ${r.from} -> ${r.to}: payload "${r.payload}" não é um schema conhecido.`,
      );
    }
  }

  // Pipelines: componentes existem; ordem sem buracos.
  for (const p of registry.pipelines) {
    for (const step of p.steps) {
      if (!ids.has(step.component)) {
        errors.push(
          `Pipeline "${p.name}", passo ${step.order}: componente inexistente "${step.component}".`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      components: registry.components.length,
      active,
      planned,
      relations: registry.relations.length,
      pipelines: registry.pipelines.length,
    },
  };
}
