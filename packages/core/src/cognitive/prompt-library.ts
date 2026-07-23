import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolvePaths } from "../shared/paths.js";

/**
 * Biblioteca de prompts versionada. Cada prompt é um arquivo
 * prompts/<etapa>/<nome>.v<N>.md com frontmatter (id, version, capability,
 * system, active?) + corpo (template do user com {{placeholders}}).
 * Melhorar um prompt = novo arquivo v(N+1); o de maior versão ativa vence.
 */

export interface LoadedPrompt {
  id: string;
  version: number;
  capability: string;
  system: string;
  template: string;
}

export class PromptNotFoundError extends Error {}

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = (parseYaml(m[1] ?? "") as Record<string, unknown>) ?? {};
  return { meta, body: (m[2] ?? "").trim() };
}

/** Carrega a maior versão ativa de um promptId (ex.: "intake/traduzir"). */
export function loadPrompt(promptId: string, root?: string): LoadedPrompt {
  const paths = resolvePaths(root);
  const dir = join(paths.prompts, dirname(promptId));
  const base = basename(promptId);
  if (!existsSync(dir)) {
    throw new PromptNotFoundError(`Prompt não encontrado: ${promptId} (dir ${dir}).`);
  }
  const re = new RegExp(`^${escapeRegex(base)}\\.v(\\d+)\\.md$`);
  const candidates: { version: number; file: string }[] = [];
  for (const f of readdirSync(dir)) {
    const mm = f.match(re);
    if (mm) candidates.push({ version: Number(mm[1]), file: join(dir, f) });
  }
  if (candidates.length === 0) {
    throw new PromptNotFoundError(`Nenhuma versão do prompt ${promptId} em ${dir}.`);
  }
  candidates.sort((a, b) => b.version - a.version);
  const chosen = candidates[0]!;
  const { meta, body } = parseFrontmatter(readFileSync(chosen.file, "utf8"));

  return {
    id: promptId,
    version: typeof meta.version === "number" ? meta.version : chosen.version,
    capability: String(meta.capability ?? ""),
    system: String(meta.system ?? ""),
    template: body,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
