import type {
  ComplexityScore,
  EspecialidadesConfig,
  ExecutionStrategy,
  PlannedTask,
  TaskSpec,
  TaskType,
} from "@pm/contracts";
import type { CapabilityResolver } from "../adapters/capability-resolver.js";
import type { ExecutorKind } from "../execution/executor-port.js";

/**
 * Task Router — rota PURA e determinística: PlannedTask + ExecutionStrategy ->
 * TaskSpec. Aplica "determinístico-primeiro" consultando uma DeterminismPolicy
 * injetável; se ninguém reivindicar, é uma tarefa de LLM e a capacidade é
 * resolvida (type -> especialidade -> capability). Preserva o id (Camada 1<->2).
 */

export class RoutingError extends Error {}

/** O executor determinístico que assume a tarefa (ou null se exige LLM). */
export interface DeterministicClaim {
  executorId: string;
  reason: string;
}

export interface DeterminismPolicy {
  claim(task: PlannedTask): DeterministicClaim | null;
}

/** Binding do ramo LLM (o determinístico vem do claim). */
export interface ExecutorBinding {
  llmExecutorId: string;
}

/** Decisão de roteamento (vira artefato kind="decision" para auditoria). */
export interface RoutingDecision {
  taskId: string;
  executorKind: ExecutorKind;
  executorId: string;
  capability?: string;
  /** Só para auditoria; NÃO entra no TaskSpec. */
  resolvedModel?: string;
  timeoutMs: number;
  maxRetries: number;
  reason: string;
}

export interface RoutedTask {
  spec: TaskSpec;
  decision: RoutingDecision;
}

export const DEFAULT_TIMEOUT_TABLE: Record<ComplexityScore, number> = {
  1: 60_000,
  2: 120_000,
  3: 300_000,
  4: 600_000,
  5: 900_000,
};

/** TaskType -> chave em especialidades.yaml. analysis não tem especialidade. */
export const TASK_TYPE_TO_ESPECIALIDADE: Record<TaskType, string | null> = {
  backend: "backend",
  frontend: "frontend",
  database: "sql",
  test: "qa",
  docs: "docs",
  devops: "devops",
  analysis: null,
};

export interface TaskRouterDeps {
  especialidades: EspecialidadesConfig;
  capabilityResolver: CapabilityResolver;
  determinism: DeterminismPolicy;
  binding: ExecutorBinding;
  fallbackCapability?: string;
  timeoutTable?: Record<ComplexityScore, number>;
}

export class TaskRouter {
  private readonly fallbackCapability: string;
  private readonly timeoutTable: Record<ComplexityScore, number>;

  constructor(private readonly deps: TaskRouterDeps) {
    this.fallbackCapability = deps.fallbackCapability ?? "coder-general";
    this.timeoutTable = deps.timeoutTable ?? DEFAULT_TIMEOUT_TABLE;
  }

  route(task: PlannedTask, strategy: ExecutionStrategy): RoutedTask {
    const timeoutMs = this.timeoutTable[task.complexity];
    const maxRetries = strategy.maxRetries;

    const claim = this.deps.determinism.claim(task);

    let executorKind: ExecutorKind;
    let executorId: string;
    let capability: string | undefined;
    let resolvedModel: string | undefined;
    let reason: string;

    if (claim) {
      executorKind = "deterministic";
      executorId = claim.executorId;
      reason = claim.reason;
    } else {
      executorKind = "llm";
      executorId = this.deps.binding.llmExecutorId;
      const esp = TASK_TYPE_TO_ESPECIALIDADE[task.type];
      const fromEsp = esp ? this.deps.especialidades.especialidades[esp]?.capability : undefined;
      capability = fromEsp ?? this.fallbackCapability;
      if (!this.deps.capabilityResolver.has(capability)) {
        throw new RoutingError(
          `Capacidade "${capability}" (tarefa ${task.id}, tipo ${task.type}) não existe em models.yaml.`,
        );
      }
      const dec = this.deps.capabilityResolver.resolve(capability, {
        complexity: task.complexity,
        tierCeiling: strategy.modelTierCeiling,
      });
      resolvedModel = dec.model;
      reason = `capacidade ${capability} → ${dec.model} (${dec.reason})`;
    }

    const spec: TaskSpec = {
      id: task.id,
      planNodeId: task.planNodeId,
      runId: task.runId,
      projectSlug: task.projectSlug,
      type: task.type,
      executorKind,
      executorId,
      capability,
      complexity: task.complexity,
      input: task.input,
      acceptanceCriteria: task.acceptanceCriteria,
      timeoutMs,
      maxRetries,
    };

    const decision: RoutingDecision = {
      taskId: task.id,
      executorKind,
      executorId,
      capability,
      resolvedModel,
      timeoutMs,
      maxRetries,
      reason,
    };

    return { spec, decision };
  }

  routeAll(tasks: PlannedTask[], strategy: ExecutionStrategy): RoutedTask[] {
    return tasks.map((t) => this.route(t, strategy));
  }
}

/**
 * Policy da Camada 2: reivindica TUDO para um único executor (worker.echo).
 * A Camada 3 substitui por uma policy que consulta o Deterministic Engine real.
 */
export function allToExecutor(executorId: string, reason = "Camada 2: execução via echo"): DeterminismPolicy {
  return { claim: () => ({ executorId, reason }) };
}

/** Policy que nunca reivindica — tudo vira tarefa de LLM (para testes do router). */
export const neverDeterministic: DeterminismPolicy = { claim: () => null };
