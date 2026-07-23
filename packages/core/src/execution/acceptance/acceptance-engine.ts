import {
  ValidationReport,
  type ExecutionResult,
  type ProjectMap,
  type ProjectTarget,
  type TaskSpec,
} from "@pm/contracts";
import type { ArtifactStore } from "../../artifacts/artifact-store.js";
import type { Clock } from "../../shared/clock.js";
import { systemClock } from "../../shared/clock.js";
import type { AcceptanceGate } from "../../orchestration/orchestrator/acceptance-gate.js";
import {
  compileCheck,
  criterionChecks,
  lintCheck,
  testCheck,
  type EvaluatedCheck,
} from "./checks.js";

/**
 * Acceptance Engine (Camada 3) — implementa AcceptanceGate rodando checks
 * DETERMINÍSTICOS no projeto alvo: compile (tsc), test (testCommand), lint e os
 * critérios script. Produz um ValidationReport (persistido como artefato
 * test-result). `passed` = E-lógico dos checks BLOQUEANTES (pulados não contam).
 * Em falha, o failureSummary alimenta o contexto do retry (via Context Builder).
 */
export interface AcceptanceEngineConfig {
  perCommandTimeoutMs: number;
  maxOutputBytes: number;
  evidenceTailBytes: number;
}

const DEFAULT_CONFIG: AcceptanceEngineConfig = {
  perCommandTimeoutMs: 120_000,
  maxOutputBytes: 200_000,
  evidenceTailBytes: 4_000,
};

export interface AcceptanceEngineDeps {
  target: ProjectTarget;
  projectMap: ProjectMap;
  artifacts: ArtifactStore;
  clock?: Clock;
  config?: Partial<AcceptanceEngineConfig>;
}

export class AcceptanceEngine implements AcceptanceGate {
  private readonly config: AcceptanceEngineConfig;
  private readonly clock: Clock;

  constructor(private readonly deps: AcceptanceEngineDeps) {
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
    this.clock = deps.clock ?? systemClock;
  }

  async evaluate(
    spec: TaskSpec,
    result: ExecutionResult,
  ): Promise<{ pass: boolean; report?: string }> {
    const changedFiles = result.changedFiles.map((c) => c.path);
    const checkDeps = {
      target: this.deps.target,
      projectMap: this.deps.projectMap,
      changedFiles,
      timeoutMs: this.config.perCommandTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      evidenceTailBytes: this.config.evidenceTailBytes,
    };

    const evaluated: EvaluatedCheck[] = [];
    const compile = await compileCheck(checkDeps);
    if (compile) evaluated.push(compile);
    const test = await testCheck(checkDeps);
    if (test) evaluated.push(test);
    const lint = await lintCheck(checkDeps);
    if (lint) evaluated.push(lint);
    evaluated.push(...(await criterionChecks(checkDeps, spec.acceptanceCriteria)));

    const blocking = evaluated.filter((e) => e.blocking && !e.skipped);
    const failed = blocking.filter((e) => !e.result.passed);
    const passed = failed.length === 0;

    const checks = evaluated.map((e) => e.result);
    // Nenhum check bloqueante rodou (projeto sem compile/test/critério-script):
    // NÃO houve verificação automática. Passa (não dá para bloquear), mas marca
    // explicitamente para a revisão humana (Camada 4) — nunca um "ok" silencioso.
    if (blocking.length === 0) {
      checks.push({
        name: "sem verificação automática",
        kind: "criterion",
        passed: true,
        evidence:
          "o projeto não tem compile/test/critério-script aplicável — a mudança NÃO foi verificada automaticamente; requer revisão humana.",
      });
    }

    const failureSummary = passed
      ? undefined
      : failed.map((e) => `✗ ${e.result.name}\n${e.result.evidence}`).join("\n\n");

    const report = ValidationReport.parse({
      taskId: spec.id,
      passed,
      checks,
      failureSummary,
    });

    this.deps.artifacts.storeJson({
      runId: spec.runId,
      taskId: spec.id,
      kind: "test-result",
      name: `acceptance-${spec.id}`,
      data: report,
      meta: { passed, attempt: result.attempt },
    });

    return { pass: passed, report: failureSummary };
  }
}
