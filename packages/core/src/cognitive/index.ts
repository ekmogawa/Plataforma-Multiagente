// Camada 1 (Cognitiva) — do pedido ao plano.

// Determinísticos
export { analyzeProject, projectFingerprint, DEFAULT_IGNORES } from "./project-analyzer.js";
export {
  detectStack,
  detectDefaultBranch,
  detectFramework,
  detectTestCommand,
  detectConventions,
  parseDependencies,
} from "./stack-detect.js";
export { selectStrategy, selectStrategyForScore } from "./strategy-selector.js";
export {
  generateWorkflow,
  inferTaskType,
  WorkflowCycleError,
  WorkflowValidationError,
  type GenerateWorkflowInput,
  type GeneratedWorkflow,
} from "./workflow-generator.js";
export { renderPlanoMd, type RenderPlanInput } from "./plan-renderer.js";

// Motor de etapa + modo
export {
  runStage,
  type CognitiveStage,
  type StageContext,
  type StageModelGateway,
} from "./stage.js";
export {
  resolveCognitiveMode,
  isExecutable,
  CAMADA1_CAPABILITIES,
  type CognitiveMode,
  type ModePreference,
} from "./mode.js";
export { loadPrompt, PromptNotFoundError, type LoadedPrompt } from "./prompt-library.js";
export { renderPrompt, type RenderedPrompt } from "./prompt-builder.js";

// Etapas (stage + heurística)
export { intakeStage, intakeHeuristic, type IntakeInput } from "./intake.js";
export {
  understandingStage,
  understandingHeuristic,
  type UnderstandingInput,
} from "./understanding.js";
export {
  complexityStage,
  complexityHeuristic,
  type ComplexityInput,
} from "./complexity-estimator.js";
export {
  planningStage,
  planningHeuristic,
  type PlanningInput,
} from "./planning-engine.js";

// Orquestração
export {
  CognitivePipeline,
  type CognitiveDeps,
  type PlanRequestInput,
  type PipelineResult,
} from "./pipeline.js";
