import type { ProjectMap, ProjectTarget } from "@pm/contracts";
import type { ExecutorRegistry } from "./executor-registry.js";
import type { GitManager } from "./git-manager.js";
import { ScaffoldWorker } from "./workers/scaffold.js";
import { TestRunnerWorker } from "./workers/test-runner.js";
import { GitWorker } from "./workers/git.js";

/**
 * Deterministic Engine — na v1 é um BUNDLE (não um ExecutorPort próprio): uma
 * função que constrói e registra os workers determinísticos sob os ids que a
 * DeterminismPolicy emite. Ponto único de wiring; o dispatcher continua sem
 * ramificar por kind.
 */
export interface DeterministicWorkerDeps {
  target: ProjectTarget;
  projectMap: ProjectMap;
  git: GitManager;
}

export function registerDeterministicWorkers(
  registry: ExecutorRegistry,
  deps: DeterministicWorkerDeps,
): void {
  registry.register(new TestRunnerWorker(deps.target, deps.projectMap));
  registry.register(new ScaffoldWorker(deps.target));
  registry.register(new GitWorker(deps.git));
}
