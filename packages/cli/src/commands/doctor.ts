import {
  loadModelsConfig,
  openDatabase,
  resolvePaths,
  schemaVersion,
  MetricsRepo,
} from "@pm/core";
import { validateRegistry } from "@pm/registry-tools";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { emit, mark, type OutputOptions } from "../output.js";

/**
 * pm doctor — verifica se o ambiente está pronto: config, banco, registro,
 * e quais provedores de modelo têm chave. Não falha por falta de chave
 * (modo offline é válido); falha por config/registro/banco quebrados.
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fatal: boolean;
}

interface DoctorReport {
  ok: boolean;
  node: string;
  checks: Check[];
  providers: { name: string; hasKey: boolean }[];
  capabilities: { name: string; model: string; available: boolean }[];
}

export function doctor(opts: OutputOptions): number {
  const checks: Check[] = [];
  const paths = resolvePaths();

  // 1. Node >= 20
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js >= 20",
    ok: major >= 20,
    detail: `v${process.versions.node}`,
    fatal: true,
  });

  // 2. Arquivos de config presentes
  for (const file of ["models.yaml", "strategies.yaml", "platform.yaml"]) {
    checks.push({
      name: `config/${file}`,
      ok: existsSync(join(paths.config, file)),
      detail: existsSync(join(paths.config, file)) ? "presente" : "AUSENTE",
      fatal: file === "models.yaml",
    });
  }

  // 3. models.yaml carrega e valida + provedores com chave + capacidades
  const providers: { name: string; hasKey: boolean }[] = [];
  const capabilities: { name: string; model: string; available: boolean }[] = [];
  try {
    const cfg = loadModelsConfig();
    checks.push({
      name: "models.yaml válido",
      ok: true,
      detail:
        `${Object.keys(cfg.models).length} modelos, ` +
        `${Object.keys(cfg.providers).length} provedores, ` +
        `${Object.keys(cfg.capabilities).length} capacidades`,
      fatal: true,
    });
    const providerHasKey = (providerName: string): boolean => {
      const p = cfg.providers[providerName];
      if (!p) return false;
      if (p.protocol === "claude-agent-sdk") return true;
      return !!(p.apiKeyEnv && process.env[p.apiKeyEnv]);
    };
    for (const [name, p] of Object.entries(cfg.providers)) {
      const hasKey =
        p.protocol === "claude-agent-sdk"
          ? true
          : !!(p.apiKeyEnv && process.env[p.apiKeyEnv]);
      providers.push({ name, hasKey });
    }
    // Capacidade -> modelo default -> disponível (provedor com chave)?
    for (const [name, rule] of Object.entries(cfg.capabilities)) {
      const model = rule.default ?? "(sem default)";
      const entry = cfg.models[model];
      const available = entry ? providerHasKey(entry.provider) : false;
      capabilities.push({ name, model, available });
    }
  } catch (err) {
    checks.push({
      name: "models.yaml válido",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      fatal: true,
    });
  }

  // 4. Banco de dados abre e migra
  try {
    const db = openDatabase();
    const v = schemaVersion(db);
    const metrics = new MetricsRepo(db).count();
    checks.push({
      name: "SQLite (migrações)",
      ok: v > 0,
      detail: `schema v${v}, ${metrics} métricas registradas`,
      fatal: true,
    });
    db.close();
  } catch (err) {
    checks.push({
      name: "SQLite (migrações)",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      fatal: true,
    });
  }

  // 5. Registro (Manual de Relações) válido
  const reg = validateRegistry();
  checks.push({
    name: "Registro válido",
    ok: reg.ok,
    detail: reg.ok
      ? `${reg.stats.components} componentes, ${reg.stats.relations} relações`
      : `${reg.errors.length} erro(s): ${reg.errors[0] ?? ""}`,
    fatal: true,
  });

  const ok = checks.every((c) => c.ok || !c.fatal);
  const report: DoctorReport = {
    ok,
    node: process.versions.node,
    checks,
    providers,
    capabilities,
  };

  emit(report, () => renderHuman(report), opts);
  return ok ? 0 : 1;
}

function renderHuman(r: DoctorReport): string {
  const lines: string[] = ["", "Diagnóstico da plataforma (pm doctor)", ""];
  for (const c of r.checks) {
    const symbol = c.ok ? mark.ok : c.fatal ? mark.fail : mark.warn;
    lines.push(`  ${symbol} ${c.name} — ${c.detail}`);
  }
  lines.push("");
  lines.push("  Provedores de modelo:");
  for (const p of r.providers) {
    const symbol = p.hasKey ? mark.ok : mark.warn;
    lines.push(`  ${symbol} ${p.name} — ${p.hasKey ? "com chave" : "sem chave (offline)"}`);
  }
  lines.push("");
  const availCount = r.capabilities.filter((c) => c.available).length;
  lines.push(
    `  Capacidades: ${r.capabilities.length} configuradas, ${availCount} com modelo disponível (com chave).`,
  );
  for (const c of r.capabilities) {
    const symbol = c.available ? mark.ok : mark.warn;
    lines.push(`  ${symbol} ${c.name} → ${c.model}`);
  }
  lines.push("");
  lines.push(r.ok ? "  Ambiente pronto." : "  Há problemas fatais acima.");
  return lines.join("\n");
}
