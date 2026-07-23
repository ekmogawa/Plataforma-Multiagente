// Camada 4 (Governança).
export { Gatekeeper, type GatekeeperDeps } from "./gatekeeper.js";
export { buildGateInput, type GateInput, type GateFileChange } from "./gate-input.js";
export {
  runDeterministicChecks,
  secretsCheck,
  largeFileCheck,
  largeDiffCheck,
  fileCountCheck,
  forbiddenPatternCheck,
  DEFAULT_GATEKEEPER_CONFIG,
  type GatekeeperConfig,
  type ForbiddenPattern,
} from "./checks.js";
export { decideVerdict } from "./verdict.js";
export { gateReviewStage, LlmReviewOutput } from "./gate-review-stage.js";
export {
  ProjectManager,
  type ProjectManagerDeps,
  type EvidenceBundle,
} from "./project-manager.js";
export { renderEvidencePtBr, type EvidenceTemplateInput } from "./evidence-template.js";
export {
  persistApprovalRecord,
  readLatestGateReview,
  readLatestEvidence,
  evidenceRefsFor,
} from "./approval.js";
