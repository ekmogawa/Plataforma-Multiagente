import { z } from "zod";
import { Id } from "./common.js";

/**
 * Camada de Governança:
 * - Acceptance Engine (etapa 11) → ValidationReport
 * - Gatekeeper (etapa 12) → GateReview
 * - Project Manager (etapa 13) → ApprovalRecord
 */

export const CheckResult = z.object({
  name: z.string(),
  kind: z.enum(["compile", "lint", "test", "criterion"]),
  passed: z.boolean(),
  /** Evidência: saída do comando, diff, mensagem. */
  evidence: z.string().default(""),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const ValidationReport = z.object({
  taskId: Id,
  passed: z.boolean(),
  checks: z.array(CheckResult).default([]),
  /** Preenchido quando passed = false; alimenta o contexto do retry. */
  failureSummary: z.string().optional(),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

export const GateFinding = z.object({
  category: z.enum(["pattern", "duplication", "security", "debt"]),
  severity: z.enum(["info", "warn", "high", "critical"]),
  text: z.string(),
  file: z.string().optional(),
});
export type GateFinding = z.infer<typeof GateFinding>;

export const GateVerdict = z.enum(["approve", "revise", "escalate"]);
export type GateVerdict = z.infer<typeof GateVerdict>;

export const GateReview = z.object({
  runId: Id,
  verdict: GateVerdict,
  findings: z.array(GateFinding).default([]),
});
export type GateReview = z.infer<typeof GateReview>;

export const ApprovalRecord = z.object({
  runId: Id,
  approvedBy: z.enum(["pm-agent", "human"]),
  /** Referências às evidências consideradas (caminhos em workspace/runs). */
  evidenceRefs: z.array(z.string()).default([]),
  /** Resumo em pt-BR apresentado ao usuário na decisão. */
  summaryPtBr: z.string(),
  decision: z.enum(["approved", "rejected"]),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecord>;
