import type { AcceptanceCriterion, CheckResult, ProjectMap, ProjectTarget } from "@pm/contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveNodeBin, runCommand, tokenizeCommand } from "../command-runner.js";

/**
 * Checks individuais do Acceptance Engine. Cada um roda um comando do projeto
 * alvo (Windows-safe) e vira um CheckResult. Ferramenta ausente => check PULADO
 * (nunca reprova por falta de ferramenta). Bloqueantes: compile/test/criterion-script.
 */
export interface EvaluatedCheck {
  result: CheckResult;
  blocking: boolean;
  skipped: boolean;
}

export interface CheckDeps {
  target: ProjectTarget;
  projectMap: ProjectMap;
  changedFiles: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  evidenceTailBytes: number;
}

function tail(s: string, n: number): string {
  return s.length <= n ? s : "…\n" + s.slice(-n);
}

/** compile: tsc --noEmit (só em projeto TypeScript com typescript instalado). */
export async function compileCheck(d: CheckDeps): Promise<EvaluatedCheck | null> {
  if (!existsSync(join(d.target.rootPath, "tsconfig.json"))) return null;
  const tsc = resolveNodeBin(d.target.rootPath, "typescript/bin/tsc");
  if (!tsc) {
    return {
      result: { name: "compile (tsc)", kind: "compile", passed: true, evidence: "typescript não instalado — check pulado" },
      blocking: false,
      skipped: true,
    };
  }
  const res = await runCommand(process.execPath, [tsc, "--noEmit"], {
    cwd: d.target.rootPath,
    timeoutMs: d.timeoutMs,
    maxOutputBytes: d.maxOutputBytes,
  });
  return {
    result: { name: "compile (tsc)", kind: "compile", passed: res.code === 0 && !res.timedOut, evidence: tail(res.output, d.evidenceTailBytes) },
    blocking: true,
    skipped: false,
  };
}

/** test: roda ProjectMap.testCommand. */
export async function testCheck(d: CheckDeps): Promise<EvaluatedCheck | null> {
  if (!d.projectMap.testCommand) return null;
  const argv = tokenizeCommand(d.projectMap.testCommand);
  const res = await runCommand(argv[0]!, argv.slice(1), {
    cwd: d.target.rootPath,
    timeoutMs: d.timeoutMs,
    maxOutputBytes: d.maxOutputBytes,
  });
  if (res.toolMissing) {
    return {
      result: { name: `test (${d.projectMap.testCommand})`, kind: "test", passed: true, evidence: "ferramenta de teste ausente — check pulado" },
      blocking: false,
      skipped: true,
    };
  }
  return {
    result: { name: `test (${d.projectMap.testCommand})`, kind: "test", passed: res.code === 0 && !res.timedOut, evidence: tail(res.output, d.evidenceTailBytes) },
    blocking: true,
    skipped: false,
  };
}

/** lint: eslint --fix nos arquivos mudados (não-bloqueante na v1). */
export async function lintCheck(d: CheckDeps): Promise<EvaluatedCheck | null> {
  if (d.changedFiles.length === 0) return null;
  const eslint = resolveNodeBin(d.target.rootPath, "eslint/bin/eslint.js");
  if (!eslint) return null;
  const res = await runCommand(process.execPath, [eslint, ...d.changedFiles], {
    cwd: d.target.rootPath,
    timeoutMs: d.timeoutMs,
    maxOutputBytes: d.maxOutputBytes,
  });
  return {
    result: { name: "lint (eslint)", kind: "lint", passed: res.code === 0, evidence: tail(res.output, d.evidenceTailBytes) },
    blocking: false, // v1: lint informa, não reprova
    skipped: false,
  };
}

/** critérios: script -> roda o comando (bloqueante); llm -> adiado; manual -> ignora aqui. */
export async function criterionChecks(
  d: CheckDeps,
  criteria: AcceptanceCriterion[],
): Promise<EvaluatedCheck[]> {
  const out: EvaluatedCheck[] = [];
  for (const c of criteria) {
    if (c.checkKind === "script" && c.check) {
      const argv = tokenizeCommand(c.check);
      const res = await runCommand(argv[0]!, argv.slice(1), {
        cwd: d.target.rootPath,
        timeoutMs: d.timeoutMs,
        maxOutputBytes: d.maxOutputBytes,
      });
      out.push({
        result: { name: `critério: ${c.text}`, kind: "criterion", passed: res.code === 0 && !res.timedOut, evidence: tail(res.output, d.evidenceTailBytes) },
        blocking: true,
        skipped: false,
      });
    } else if (c.checkKind === "llm") {
      out.push({
        result: { name: `critério (qualitativo): ${c.text}`, kind: "criterion", passed: true, evidence: "adiado para o Gatekeeper (Camada 4)" },
        blocking: false,
        skipped: true,
      });
    }
    // manual: não é um check aqui — vai para o resumo de aprovação.
  }
  return out;
}
