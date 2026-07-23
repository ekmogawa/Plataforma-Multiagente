import {
  ProjectMap,
  type EspecialidadesConfig,
  type ExecutionStrategy,
  type PlatformConfig,
} from "@pm/contracts";
import type { ArtifactStore } from "../../artifacts/artifact-store.js";
import type { ProjectsRepo } from "../../db/projects-repo.js";
import type { RunsRepo } from "../../db/runs-repo.js";
import type { TasksRepo } from "../../db/tasks-repo.js";
import { ContextBuilder } from "../../execution/context-builder.js";
import { StaticImportCodeGraph } from "../../execution/code-graph-port.js";
import type { ExecutorRegistry } from "../../execution/executor-registry.js";
import { log } from "../../shared/logger.js";
import { systemClock, type Clock } from "../../shared/clock.js";
import type { EventBus } from "../../shared/event-bus.js";
import { loadRunTasks } from "../run-loader.js";
import type { TaskRouter } from "../task-router.js";
import { PassThroughAcceptance, type AcceptanceGate } from "./acceptance-gate.js";
import { Dispatcher } from "./dispatcher.js";
import { RetryManager } from "./retry-manager.js";
import { Scheduler } from "./scheduler.js";
import type { OrchestratorConfig, RunFinalState, RunOutcome } from "./types.js";

/**
 * Background Orchestrator — o núcleo operacional e ÚNICO dono do estado global
 * do run. start() faz seed (fresh) ou reconcile (resume), roda o laço tick()
 * até quiescência/pausa e define o estado final do run.
 */
export interface BackgroundOrchestratorDeps {
  runs: RunsRepo;
  projects: ProjectsRepo;
  tasks: TasksRepo;
  artifacts: ArtifactStore;
  bus: EventBus;
  registry: ExecutorRegistry;
  router: TaskRouter;
  especialidades: EspecialidadesConfig;
  platform: PlatformConfig;
  clock?: Clock;
  acceptanceGate?: AcceptanceGate;
}

export interface RunStatus {
  runId: string;
  runState: string;
  counts: Record<string, number>;
  escalated: number;
  costUsd: number;
}

export class BackgroundOrchestrator {
  private readonly clock: Clock;

  constructor(private readonly d: BackgroundOrchestratorDeps) {
    this.clock = d.clock ?? systemClock;
  }

  async start(runId: string, opts: { resume?: boolean } = {}): Promise<RunOutcome> {
    const run = this.d.runs.get(runId);
    if (!run) throw new Error(`Run não encontrado: ${runId}`);
    if (!run.strategy) throw new Error(`Run ${runId} sem estratégia — rode o planejamento primeiro.`);
    if (!run.projectSlug) throw new Error(`Run ${runId} sem projeto associado.`);
    const project = this.d.projects.get(run.projectSlug);
    if (!project) throw new Error(`Projeto ${run.projectSlug} não registrado.`);

    const strategy = run.strategy;
    const projectMap = this.loadProjectMap(runId);
    const now = () => this.clock.now();

    // Seed (fresh) ou reconcile (resume).
    if (opts.resume) {
      if (!this.d.tasks.hasTasks(runId)) {
        throw new Error(`Run ${runId} não tem tarefas para retomar.`);
      }
      const rec = this.d.tasks.reconcile(runId, now());
      log.info(
        `Resume: ${rec.reverted} revertidas, ${rec.escalated} escaladas, ${rec.recomputed} deps recomputadas.`,
      );
    } else {
      if (this.d.tasks.hasTasks(runId)) {
        throw new Error(`Run ${runId} já foi iniciado. Use --resume para continuar.`);
      }
      loadRunTasks(
        { artifacts: this.d.artifacts, tasks: this.d.tasks, router: this.d.router },
        runId,
        strategy,
        now(),
      );
    }
    this.d.runs.setState(runId, "running", now());

    const config = this.buildConfig(strategy);
    const scheduler = new Scheduler({
      runId,
      strategy,
      projectMap,
      tasks: this.d.tasks,
      runs: this.d.runs,
      dispatcher: new Dispatcher(this.d.registry),
      acceptanceGate: this.d.acceptanceGate ?? new PassThroughAcceptance(),
      retryManager: new RetryManager({
        backoffBaseMs: config.backoffBaseMs,
        backoffFactor: config.backoffFactor,
        backoffMaxMs: config.backoffMaxMs,
      }),
      contextBuilder: this.buildContextBuilder(project.rootPath),
      artifacts: this.d.artifacts,
      bus: this.d.bus,
      clock: this.clock,
      config,
    });

    const ticks = await this.runToQuiescence(scheduler, runId, config);

    // Estado final do run.
    const counts = this.d.tasks.countByState(runId);
    const escalated = counts.escalated ?? 0;
    const blocked = counts.blocked ?? 0;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const terminal =
      (counts.done ?? 0) + escalated + blocked + (counts.cancelled ?? 0) + (counts.failed ?? 0);
    const incomplete = total - terminal; // pending/ready/running/validating/retrying restantes
    let finalState: RunFinalState;
    if (scheduler.isPaused()) {
      finalState = "paused";
    } else if (escalated > 0 || blocked > 0 || incomplete > 0) {
      // 'done' só quando TUDO é terminal e nada escalou/bloqueou; senão pausa (nunca
      // reportar falso sucesso com tarefas presas).
      finalState = "paused";
      this.d.runs.setState(runId, "paused", now());
      this.d.bus.publish({
        name: "RunPaused",
        ts: now(),
        runId,
        producer: "orchestration.background",
        data: {
          reason:
            incomplete > 0 && escalated === 0 && blocked === 0
              ? "run não concluído (parou sem finalizar todas as tarefas)"
              : "tarefas escaladas/bloqueadas aguardando decisão humana",
        },
      });
    } else {
      finalState = "done";
      this.d.runs.setState(runId, "done", now());
    }

    return { state: finalState, done: counts.done ?? 0, escalated, blocked, ticks };
  }

  status(runId: string): RunStatus {
    const run = this.d.runs.get(runId);
    if (!run) throw new Error(`Run não encontrado: ${runId}`);
    return {
      runId,
      runState: run.state,
      counts: this.d.tasks.countByState(runId),
      escalated: this.d.tasks.escalatedCount(runId),
      costUsd: run.costUsd,
    };
  }

  private async runToQuiescence(
    scheduler: Scheduler,
    runId: string,
    config: OrchestratorConfig,
  ): Promise<number> {
    let ticks = 0;
    while (ticks < config.maxTicks) {
      const report = await scheduler.tick();
      await scheduler.settle();
      ticks++;
      if (scheduler.isPaused() && scheduler.inFlightCount() === 0) break;
      if (!scheduler.hasPendingWork()) break;
      const progressed =
        report.claimed + report.completed + report.failed + report.escalated + report.promoted > 0;
      if (!progressed && scheduler.inFlightCount() === 0) {
        // Só restam retrys futuros: aguarda o menor not_before (produção).
        const next = this.d.tasks.nextRetryAt(runId);
        if (next === null) break;
        const waitMs = new Date(next).getTime() - new Date(this.clock.now()).getTime();
        if (waitMs <= 0) continue;
        // sleep COERENTE com o clock (manual avança o tempo; parede dorme de verdade).
        await this.clock.sleep(waitMs);
      }
    }
    return ticks;
  }

  private buildConfig(strategy: ExecutionStrategy): OrchestratorConfig {
    const o = this.d.platform.orchestrator;
    return {
      concurrency: strategy.concurrency,
      backoffBaseMs: o.retryBackoff.baseMs,
      backoffFactor: o.retryBackoff.factor,
      backoffMaxMs: o.retryBackoff.maxMs,
      leaseGraceMs: o.leaseGraceMs,
      maxEscalations: this.d.platform.escalation.maxPerRun,
      maxTicks: 10000,
    };
  }

  private buildContextBuilder(rootPath: string): ContextBuilder {
    const ctx = this.d.platform.context;
    return new ContextBuilder({
      root: rootPath,
      codeGraph: new StaticImportCodeGraph(rootPath, ctx.maxNeighbors),
      especialidades: this.d.especialidades,
      maxTokensPerTask: ctx.maxTokensPerTask,
      maxFileBytes: ctx.maxFileBytes,
      maxNeighbors: ctx.maxNeighbors,
      artifacts: this.d.artifacts, // habilita priorFailure no retry (Camada 3)
    });
  }

  private loadProjectMap(runId: string): ProjectMap {
    const arts = this.d.artifacts.listByRun(runId).filter((a) => a.kind === "project-map");
    const art = arts[arts.length - 1];
    if (!art) throw new Error(`Run ${runId} sem project-map (planeje primeiro).`);
    const content = this.d.artifacts.readContent(art.id);
    if (content === undefined) throw new Error(`project-map sem conteúdo no run ${runId}.`);
    return ProjectMap.parse(JSON.parse(content));
  }
}
