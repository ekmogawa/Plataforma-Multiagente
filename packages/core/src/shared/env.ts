import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "./paths.js";

/**
 * Carregador mínimo de .env (sem dependência externa).
 * Lê KEY=VALUE, ignora comentários e linhas vazias, não sobrescreve o que já
 * existe em process.env. Deve ser chamado uma vez no início do CLI.
 */
export function loadEnv(root?: string): void {
  const paths = resolvePaths(root);
  const file = join(paths.root, ".env");
  if (!existsSync(file)) return;

  const raw = readFileSync(file, "utf8");
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Remove aspas envolventes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
