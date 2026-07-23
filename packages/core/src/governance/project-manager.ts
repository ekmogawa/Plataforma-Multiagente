import {
  StructuredRequest,
  type ChangedFile,
  type GateVerdict,
  type ValidationReport,
} from "@pm/contracts";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { RunsRepo } from "../db/runs-repo.js";
import type { TasksRepo } from "../db/tasks-repo.js";
import { readLatestGateReview } from "./approval.js";
import { renderEvidencePtBr } from "./evidence-template.js";

/**
 * Project Manager (Camada 4) — reúne as evidências do run e as apresenta em pt-BR
 * leigo para a decisão HUMANA. Template determinístico (offline); final-auditor
 * (Opus) é opcional e futuro. Persiste o resumo como artefato 'evidence'.
 */
export interface EvidenceBundle {
  runId: string;
  summaryPtBr: string;
  evidenceArtifactId: string;
  verdict: GateVerdict | "none";
  findingsCount: number;
  changedFiles: ChangedFile[];
  costUsd: number;
  spentTokens: number;
  validations: { passed: number; failed: number };
}

export interface ProjectManagerDeps {
  artifacts: ArtifactStore;
  runs: RunsRepo;
  tasks: TasksRepo;
}

export class ProjectManager {
  constructor(private readonly deps: ProjectManagerDeps) {}

  assembleEvidence(runId: string): EvidenceBundle {
    const run = this.deps.runs.get(runId);
    if (!run) throw new Error(`Run não encontrado: ${runId}`);

    const request = this.loadRequest(runId);
    const changedFiles = this.aggregateChangedFiles(runId);
    const validations = this.aggregateValidations(runId);
    const gateReview = readLatestGateReview(this.deps.artifacts, runId);

    const summaryPtBr = renderEvidencePtBr({
      runId,
      rawPrompt: request?.rawPrompt ?? "(pedido não encontrado)",
      translatedIntent: request?.translatedIntent ?? "",
      workKind: run.workKind ?? "-",
      projectSlug: run.projectSlug ?? "-",
      changedFiles,
      validations,
      gateReview,
      costUsd: run.costUsd,
      spentTokens: run.spentTokens,
    });

    const art = this.deps.artifacts.store({
      runId,
      kind: "evidence",
      name: "resumo",
      content: summaryPtBr,
      meta: { verdict: gateReview?.verdict ?? "none" },
    });

    return {
      runId,
      summaryPtBr,
      evidenceArtifactId: art.id,
      verdict: gateReview?.verdict ?? "none",
      findingsCount: gateReview?.findings.length ?? 0,
      changedFiles,
      costUsd: run.costUsd,
      spentTokens: run.spentTokens,
      validations,
    };
  }

  private loadRequest(runId: string): StructuredRequest | undefined {
    const art = this.deps.artifacts
      .listByRun(runId)
      .filter((a) => a.kind === "report" && a.path.endsWith("-structured-request.json"))
      .at(-1);
    if (!art) return undefined;
    const content = this.deps.artifacts.readContent(art.id);
    if (!content) return undefined;
    try {
      return StructuredRequest.parse(JSON.parse(content));
    } catch {
      return undefined;
    }
  }

  private aggregateChangedFiles(runId: string): ChangedFile[] {
    const byPath = new Map<string, ChangedFile["action"]>();
    for (const t of this.deps.tasks.byRun(runId)) {
      for (const c of t.result?.changedFiles ?? []) {
        if (byPath.get(c.path) === "deleted") continue;
        byPath.set(c.path, c.action);
      }
    }
    return [...byPath.entries()].sort().map(([path, action]) => ({ path, action }));
  }

  private aggregateValidations(runId: string): { passed: number; failed: number } {
    // Último test-result por tarefa (maior attempt).
    const latest = new Map<string, { passed: boolean; attempt: number }>();
    for (const a of this.deps.artifacts.listByRun(runId)) {
      if (a.kind !== "test-result" || !a.taskId) continue;
      const attempt = typeof a.meta?.attempt === "number" ? a.meta.attempt : 0;
      const cur = latest.get(a.taskId);
      if (cur && cur.attempt >= attempt) continue;
      const content = this.deps.artifacts.readContent(a.id);
      if (!content) continue;
      try {
        const report = JSON.parse(content) as ValidationReport;
        latest.set(a.taskId, { passed: report.passed, attempt });
      } catch {
        /* ignora */
      }
    }
    let passed = 0;
    let failed = 0;
    for (const v of latest.values()) v.passed ? passed++ : failed++;
    return { passed, failed };
  }
}
