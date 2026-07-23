import {
  ApprovalRecord,
  GateReview,
  type Artifact,
} from "@pm/contracts";
import type { ArtifactStore } from "../artifacts/artifact-store.js";

/**
 * Leitura/gravação dos artefatos de governança (gate-review, evidence, approval),
 * compartilhada entre o Project Manager e os comandos pm approve/reject.
 */

export function persistApprovalRecord(artifacts: ArtifactStore, record: ApprovalRecord): Artifact {
  return artifacts.storeJson({
    runId: record.runId,
    kind: "approval",
    name: "approval",
    data: record,
    meta: { decision: record.decision, approvedBy: record.approvedBy },
  });
}

export function readLatestGateReview(artifacts: ArtifactStore, runId: string): GateReview | undefined {
  const arts = artifacts.listByRun(runId).filter((a) => a.kind === "gate-review");
  const last = arts[arts.length - 1];
  if (!last) return undefined;
  const content = artifacts.readContent(last.id);
  if (!content) return undefined;
  try {
    return GateReview.parse(JSON.parse(content));
  } catch {
    return undefined;
  }
}

/** Conteúdo do último resumo de evidências (kind 'evidence'). */
export function readLatestEvidence(artifacts: ArtifactStore, runId: string): string | undefined {
  const arts = artifacts.listByRun(runId).filter((a) => a.kind === "evidence");
  const last = arts[arts.length - 1];
  if (!last) return undefined;
  return artifacts.readContent(last.id);
}

/** Ids dos artefatos de evidência de um run (para ApprovalRecord.evidenceRefs). */
export function evidenceRefsFor(artifacts: ArtifactStore, runId: string): string[] {
  return artifacts
    .listByRun(runId)
    .filter((a) => ["gate-review", "evidence", "test-result"].includes(a.kind))
    .map((a) => a.id);
}
