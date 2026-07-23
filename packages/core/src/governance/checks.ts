import type { GateFinding } from "@pm/contracts";
import { redactSecrets } from "../shared/redaction.js";
import type { GateInput } from "./gate-input.js";

/**
 * Checks determinísticos do Gatekeeper (Camada 4) — revisão ARQUITETURAL do diff
 * agregado (NÃO roda tsc/testes; isso é o Acceptance da Camada 3). Cada check
 * mapeia para category/severity do GateFinding. Segredos JAMAIS aparecem no
 * finding (só tipo + arquivo + contagem).
 */
export interface ForbiddenPattern {
  re: RegExp;
  category: GateFinding["category"];
  severity: GateFinding["severity"];
  label: string;
}

export interface GatekeeperConfig {
  maxFileBytes: number;
  maxFileLines: number;
  maxTotalBytes: number;
  maxTotalLines: number;
  maxFileCount: number;
  warnFileCount: number;
  forbidden: ForbiddenPattern[];
}

export const DEFAULT_GATEKEEPER_CONFIG: GatekeeperConfig = {
  maxFileBytes: 500_000,
  maxFileLines: 1_500,
  maxTotalBytes: 2_000_000,
  maxTotalLines: 6_000,
  maxFileCount: 60,
  warnFileCount: 30,
  forbidden: [
    { re: /\beval\s*\(/, category: "security", severity: "high", label: "uso de eval()" },
    { re: /\bchild_process\b|\bexecSync\s*\(/, category: "security", severity: "warn", label: "execução de processo" },
    { re: /\bdebugger\b/, category: "debt", severity: "warn", label: "debugger" },
    { re: /\bconsole\.log\s*\(/, category: "debt", severity: "warn", label: "console.log" },
    { re: /\b(TODO|FIXME|XXX)\b/, category: "debt", severity: "info", label: "TODO/FIXME" },
  ],
};

/** Segredos: reporta tipo+arquivo+contagem, NUNCA o segredo. PEM privado -> critical. */
export function secretsCheck(input: GateInput): GateFinding[] {
  const out: GateFinding[] = [];
  for (const f of input.files) {
    if (!f.content) continue;
    const r = redactSecrets(f.content);
    if (r.count > 0) {
      const isPem = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(f.content);
      out.push({
        category: "security",
        severity: isPem ? "critical" : "high",
        text: `${r.count} possível(is) segredo(s)${isPem ? " (chave privada PEM)" : ""} — não deve ser commitado`,
        file: f.path,
      });
    }
  }
  return out;
}

export function largeFileCheck(input: GateInput, cfg: GatekeeperConfig): GateFinding[] {
  const out: GateFinding[] = [];
  for (const f of input.files) {
    if (f.oversize || f.sizeBytes > cfg.maxFileBytes || f.lineCount > cfg.maxFileLines) {
      out.push({
        category: "debt",
        severity: "warn",
        text: `arquivo grande (${f.sizeBytes} bytes${f.lineCount ? `, ${f.lineCount} linhas` : ""})`,
        file: f.path,
      });
    }
  }
  return out;
}

export function largeDiffCheck(input: GateInput, cfg: GatekeeperConfig): GateFinding[] {
  const out: GateFinding[] = [];
  if (input.totalBytes > cfg.maxTotalBytes || input.totalLines > cfg.maxTotalLines) {
    out.push({
      category: "debt",
      severity: "warn",
      text: `mudança muito grande no total (${input.totalBytes} bytes, ${input.totalLines} linhas) — considere dividir`,
    });
  }
  return out;
}

export function fileCountCheck(input: GateInput, cfg: GatekeeperConfig): GateFinding[] {
  const n = input.files.length;
  if (n > cfg.maxFileCount) {
    return [{ category: "debt", severity: "warn", text: `${n} arquivos alterados (muitos para uma revisão)` }];
  }
  if (n > cfg.warnFileCount) {
    return [{ category: "debt", severity: "info", text: `${n} arquivos alterados` }];
  }
  return [];
}

export function forbiddenPatternCheck(input: GateInput, cfg: GatekeeperConfig): GateFinding[] {
  const out: GateFinding[] = [];
  for (const f of input.files) {
    if (!f.content) continue;
    for (const p of cfg.forbidden) {
      if (p.re.test(f.content)) {
        out.push({ category: p.category, severity: p.severity, text: p.label, file: f.path });
      }
    }
  }
  return out;
}

export function runDeterministicChecks(input: GateInput, cfg: GatekeeperConfig): GateFinding[] {
  return [
    ...secretsCheck(input),
    ...largeFileCheck(input, cfg),
    ...largeDiffCheck(input, cfg),
    ...fileCountCheck(input, cfg),
    ...forbiddenPatternCheck(input, cfg),
  ];
}
