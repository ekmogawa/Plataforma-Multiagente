import type {
  Artifact,
  ArtifactKind,
  EventName,
  ExecutionStrategy,
  ModelsConfig,
  ProjectMap,
  ProjectTarget,
  StrategiesConfig,
  WorkKind,
} from "@pm/contracts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityResolver } from "../adapters/capability-resolver.js";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { CacheRepo } from "../db/cache-repo.js";
import type { MetricsRepo } from "../db/metrics-repo.js";
import type { RunsRepo } from "../db/runs-repo.js";
import type { Clock } from "../shared/clock.js";
import type { EventBus } from "../shared/event-bus.js";
import type { IdFactory } from "../shared/ids.js";
import { resolvePaths } from "../shared/paths.js";
import { analyzeProject } from "./project-analyzer.js";
import { complexityStage } from "./complexity-estimator.js";
import { intakeStage } from "./intake.js";
import { planningHeuristic, planningStage } from "./planning-engine.js";
import { renderPlanoMd } from "./plan-renderer.js";
import { resolveCognitiveMode, type ModePreference } from "./mode.js";
import { runStage, type StageContext, type StageModelGateway } from "./stage.js";
import { selectStrategy } from "./strategy-selector.js";
import { understandingStage } from "./understanding.js";
import { generateWorkflow } from "./workflow-generator.js";

/** Dependências que o pipeline recebe (injetáveis para testes offline). */
export interface CognitiveDeps {
  runs: RunsRepo;
  artifacts: ArtifactStore;
  metrics: MetricsRepo;
  cache: CacheRepo;
  bus: EventBus;
  capabilityResolver: CapabilityResolver;
  gateway: StageModelGateway;
  modelsConfig: ModelsConfig;
  strategiesConfig: StrategiesConfig;
  clock: Clock;
  ids: IdFactory;
  /** Raiz do repo (para prompts e caminho do plano.md). */
  root?: string;
}

export interface PlanRequestInput {
  project: ProjectTarget;
  rawPrompt: string;
  workKind: WorkKind;
  preference?: ModePreference;
}

export interface PipelineResult {
  runId: string;
  mode: "llm" | "heuristic";
  projectSlug: string;
  workKind: WorkKind;
  complexity: number;
  strategyProfile: string;
  taskCount: number;
  planoPath: string;
  requiresHumanApproval: boolean;
  artifacts: { kind: ArtifactKind; id: string }[];
}

/**
 * CognitivePipeline — roda as 7 etapas da Camada 1 em sequência, persistindo o
 * artefato de cada etapa (rastreabilidade por run_id) e publicando um evento por
 * etapa. Estado do run: requested -> planning -> planned.
 */
export class CognitivePipeline {
  constructor(private readonly deps: CognitiveDeps) {}

  async plan(input: PlanRequestInput): Promise<PipelineResult> {
    const d = this.deps;
    const runId = d.ids.next("run");
    const requestId = d.ids.next("req");
    const projectSlug = input.project.slug;
    const stored: { kind: ArtifactKind; id: string }[] = [];

    const mode = resolveCognitiveMode({
      preference: input.preference ?? "auto",
      capabilityResolver: d.capabilityResolver,
      config: d.modelsConfig,
    });

    d.runs.create({
      id: runId,
      requestId,
      projectSlug,
      workKind: input.workKind,
      state: "requested",
      now: d.clock.now(),
    });
    this.emit("RunRequested", runId, { workKind: input.workKind, projectSlug });
    d.runs.setState(runId, "planning", d.clock.now());

    // Contexto base das etapas (complexity/tierCeiling são preenchidos depois).
    const ctx: StageContext = {
      runId,
      projectSlug,
      mode,
      clock: d.clock,
      capabilityResolver: d.capabilityResolver,
      gateway: d.gateway,
      artifacts: d.artifacts,
      metrics: d.metrics,
      cache: d.cache,
      root: d.root,
    };

    // 1. Project Analyzer (determinístico).
    const projectMap: ProjectMap = analyzeProject(input.project, { clock: d.clock });
    stored.push(this.persist(runId, "project-map", "project-map", projectMap));
    this.emit("ProjectAnalyzed", runId, { framework: projectMap.framework ?? null });

    // 2. Intake.
    const request = await runStage(
      intakeStage,
      { requestId, rawPrompt: input.rawPrompt, workKind: input.workKind, projectSlug, projectMap },
      ctx,
    );
    stored.push(this.persist(runId, "report", "structured-request", request));
    this.emit("IntentCreated", runId, { deliverableType: request.deliverableType });

    // 3. Understanding.
    const understanding = await runStage(understandingStage, { request, projectMap }, ctx);
    stored.push(this.persist(runId, "report", "understanding", understanding));
    this.emit("RequirementsReady", runId, {
      requirements: understanding.requirements.length,
    });

    // 4. Complexity.
    const complexity = await runStage(
      complexityStage,
      { request, understanding, projectMap },
      ctx,
    );
    stored.push(this.persist(runId, "report", "complexity", complexity));
    ctx.complexity = complexity.score;
    this.emit("ComplexityEstimated", runId, { score: complexity.score });

    // 5. Strategy Selector (determinístico).
    const strategy: ExecutionStrategy = selectStrategy(complexity, d.strategiesConfig);
    ctx.tierCeiling = strategy.modelTierCeiling;
    d.runs.setStrategy(runId, strategy, d.clock.now());
    stored.push(this.persist(runId, "decision", "strategy", strategy));
    this.emit("StrategySelected", runId, { profile: strategy.profile });

    // 6. Planning.
    const plan = await runStage(
      planningStage,
      { request, understanding, strategy, projectMap },
      ctx,
    );
    stored.push(this.persist(runId, "plan", "plan", plan));
    this.emit("PlanningCompleted", runId, { roots: plan.roots.length });

    // 7. Workflow Generator (determinístico).
    const { dag, tasks } = generateWorkflow({
      plan,
      runId,
      projectSlug,
      complexity: complexity.score,
      workKind: input.workKind,
    });
    stored.push(this.persist(runId, "dag", "workflow", dag));
    stored.push(this.persist(runId, "planned-tasks", "planned-tasks", tasks));
    this.emit("WorkflowCreated", runId, { tasks: tasks.length });

    // Plano legível para o usuário.
    const plano = renderPlanoMd({
      runId,
      request,
      understanding,
      complexity,
      strategy,
      plan,
      tasks,
      mode,
    });
    const planoPath = this.writePlano(runId, plano);

    d.runs.setState(runId, "planned", d.clock.now());
    this.emit("RunPlanned", runId, { tasks: tasks.length, profile: strategy.profile });

    return {
      runId,
      mode,
      projectSlug,
      workKind: input.workKind,
      complexity: complexity.score,
      strategyProfile: strategy.profile,
      taskCount: tasks.length,
      planoPath,
      requiresHumanApproval: strategy.requiresHumanApproval,
      artifacts: stored,
    };
  }

  private persist(
    runId: string,
    kind: ArtifactKind,
    name: string,
    data: unknown,
  ): { kind: ArtifactKind; id: string } {
    const art: Artifact = this.deps.artifacts.storeJson({ runId, kind, name, data });
    return { kind, id: art.id };
  }

  private emit(name: EventName, runId: string, data: Record<string, unknown>): void {
    this.deps.bus.publish({
      name,
      ts: this.deps.clock.now(),
      runId,
      producer: "cognitive.pipeline",
      data,
    });
  }

  private writePlano(runId: string, content: string): string {
    const paths = resolvePaths(this.deps.root);
    const dir = join(paths.runs, runId);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "plano.md");
    writeFileSync(file, content, "utf8");
    return file;
  }
}

/** Reexport útil para chamadores. */
export { planningHeuristic };
