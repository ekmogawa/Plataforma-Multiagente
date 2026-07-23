// Camada de Execução — ports e executores.
export {
  type ExecutorPort,
  type ExecutorInput,
  type ExecutorKind,
  UnknownExecutorError,
} from "./executor-port.js";
export { ExecutorRegistry } from "./executor-registry.js";
export { EchoWorker, type EchoWorkerOptions } from "./workers/echo.js";
export { estimateTokens } from "./token-estimator.js";
export {
  type CodeGraphPort,
  StaticImportCodeGraph,
} from "./code-graph-port.js";

// Camada 3 — primitivos seguros
export {
  resolveInside,
  isInside,
  assertInside,
  assertNoSymlinkParent,
  assertNotSymlink,
  PathEscapeError,
} from "./path-guard.js";
export {
  runCommand,
  tokenizeCommand,
  filterEnv,
  resolveNodeBin,
  resolveExecutable,
  CommandRunError,
  type CommandResult,
  type RunOptions,
} from "./command-runner.js";
export {
  applyChangeSet,
  PermissionDeniedError,
  ApplyChangeSetError,
} from "./apply-changeset.js";
export { GitManager, GitSafetyError } from "./git-manager.js";
export { GitDelivery, type DeliveryResult } from "./git-delivery.js";

// Camada 3 — workers determinísticos + policy + bundle
export { TestRunnerWorker } from "./workers/test-runner.js";
export { ScaffoldWorker, scaffoldProject } from "./workers/scaffold.js";
export { GitWorker } from "./workers/git.js";
export {
  DeterministicFirstPolicy,
  defaultDeterminismPolicy,
} from "./deterministic-policy.js";
export {
  registerDeterministicWorkers,
  type DeterministicWorkerDeps,
} from "./deterministic-workers.js";

// Camada 3 — LLM Engine
export { LlmWorker, type LlmWorkerDeps } from "./workers/llm.js";
export { ClaudeAgentWorker } from "./workers/claude-agent.js";
export { especialidadeFor, buildExecVars, type Especialidade } from "./exec-prompt.js";

// Camada 3 — Acceptance Engine
export {
  AcceptanceEngine,
  type AcceptanceEngineDeps,
  type AcceptanceEngineConfig,
} from "./acceptance/index.js";
