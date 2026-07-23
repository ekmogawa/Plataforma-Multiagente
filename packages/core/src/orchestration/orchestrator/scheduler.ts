import type { EventName, ExecutionResult, ExecutionStrategy, ProjectMap } from "@pm/contracts";
import type { ArtifactStore } from "../../artifacts/artifact-store.js";
import type { RunsRepo } from "../../db/runs-repo.js";
import type { TaskRow, TasksRepo } from "../../db/tasks-repo.js";
import type { ContextBuilder } from "../../execution/context-builder.js";
import { isoAdd, type Clock } from "../../shared/clock.js";
import type { EventBus } from "../../shared/event-bus.js";
import type { AcceptanceGate } from "./acceptance-gate.js";
import type { Dispatcher } from "./dispatcher.js";
import type { RetryManager } from "./retry-manager.js";
import type { OrchestratorConfig, TickReport } from "./types.js";

interface InFlight {
  attempt: number;
  settled: boolean;
  result?: ExecutionResult;
}

export interface SchedulerDeps {
  runId: string;
  strategy: ExecutionStrategy;
  projectMap: ProjectMap;
  tasks: TasksRepo;
  runs: RunsRepo;
  dispatcher: Dispatcher;
  acceptanceGate: AcceptanceGate;
  retryManager: RetryManager;
  contextBuilder: ContextBuilder;
  artifacts: ArtifactStore;
  bus: EventBus;
  clock: Clock;
  config: OrchestratorConfig;
}

/**
 * Scheduler — um passo determinístico por tick(): drena completions, varre
 * leases vencidos, promove retrys prontos, reivindica e despacha até a
 * concorrência. Sem sleep de parede; o Clock injetável governa lease/backoff.
 */
export class Scheduler {
  private readonly inFlight = new Map<string, InFlight>();
  private pending: Promise<void>[] = [];
  private paused = false;

  constructor(private readonly d: SchedulerDeps) {}

  isPaused(): boolean {
    return this.paused;
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Aguarda os dispatches disparados assentarem (determinístico; echo é instantâneo). */
  async settle(): Promise<void> {
    const ps = this.pending;
    this.pending = [];
    await Promise.allSettled(ps);
  }

  /** Ainda há trabalho não-terminal (para o laço de quiescência). */
  hasPendingWork(): boolean {
    if (this.inFlight.size > 0) return true;
    const c = this.d.tasks.countByState(this.d.runId);
    return (
      (c.ready ?? 0) + (c.running ?? 0) + (c.validating ?? 0) + (c.pending ?? 0) + (c.retrying ?? 0) > 0
    );
  }

  async tick(): Promise<TickReport> {
    const report: TickReport = {
      claimed: 0,
      completed: 0,
      failed: 0,
      escalated: 0,
      promoted: 0,
      blocked: 0,
      active: 0,
      runPaused: false,
    };
    const now = () => this.d.clock.now();

    // 1. Drena completions que já assentaram.
    for (const [taskId, entry] of [...this.inFlight]) {
      if (!entry.settled) continue;
      this.inFlight.delete(taskId);
      const row = this.d.tasks.get(this.d.runId, taskId);
      // Descarta resultado obsoleto (tentativa/estado não batem).
      if (!row || row.attempt !== entry.attempt) continue;
      if (row.state !== "running" && row.state !== "validating") continue;
      await this.applyResult(row, entry.result!, report, now());
    }

    // 2. Varre leases vencidos (órfãos no mesmo processo = timeout).
    for (const row of this.d.tasks.sweepExpiredLeases(this.d.runId, now())) {
      this.inFlight.delete(row.id);
      const timeout: ExecutionResult = {
        taskId: row.id,
        attempt: row.attempt,
        status: "timeout",
        changedFiles: [],
        logs: "",
        durationMs: 0,
        errorSummary: "lease expirado (timeout)",
      };
      this.handleFailure(row, timeout, report, now());
    }

    // 3. Promove retrys cujo backoff venceu.
    report.promoted += this.d.tasks.promoteRetryable(this.d.runId, now());

    // 4. Reivindica e despacha (a menos que pausado).
    if (!this.paused) {
      const active = this.d.tasks.activeCount(this.d.runId);
      const slots = this.d.config.concurrency - active;
      if (slots > 0) {
        const candidates = this.d.tasks.getReady(this.d.runId, slots);
        const claimed = this.d.tasks.claim(
          candidates,
          (r) => isoAdd(now(), r.spec.timeoutMs + this.d.config.leaseGraceMs),
          now(),
        );
        for (const row of claimed) {
          report.claimed++;
          this.emit("TaskStarted", row.id, { attempt: row.attempt });
          const context = this.d.contextBuilder.build(row.spec, this.d.projectMap);
          this.d.artifacts.storeJson({
            runId: this.d.runId,
            taskId: row.id,
            kind: "context",
            name: `context-${row.id}`,
            data: context,
          });
          const entry: InFlight = { attempt: row.attempt, settled: false };
          this.inFlight.set(row.id, entry);
          const deadline = row.leaseExpires ?? isoAdd(now(), row.spec.timeoutMs);
          this.pending.push(
            this.d.dispatcher
              .dispatch(row.spec, context, row.attempt, deadline)
              .then((result) => {
                entry.settled = true;
                entry.result = result;
              }),
          );
        }
      }
    }

    report.active = this.d.tasks.activeCount(this.d.runId);
    report.runPaused = this.paused;
    return report;
  }

  private async applyResult(
    row: TaskRow,
    result: ExecutionResult,
    report: TickReport,
    now: string,
  ): Promise<void> {
    this.d.tasks.setResult(this.d.runId, row.id, result, now);
    if (result.status === "success") {
      this.d.tasks.markValidating(this.d.runId, row.id, now);
      const gate = await this.d.acceptanceGate.evaluate(row.spec, result);
      if (gate.pass) {
        const promoted = this.d.tasks.completeAndCascade(this.d.runId, row.id, result, now);
        report.completed++;
        report.promoted += promoted.length;
        this.emit("TaskCompleted", row.id, { attempt: row.attempt });
        return;
      }
      // Reprovado no Acceptance: persiste o resultado como falha (result_json
      // coerente) antes de tratar como falha na escada.
      const rejected = {
        ...result,
        status: "failure" as const,
        errorSummary: gate.report ?? "reprovado no Acceptance",
      };
      this.d.tasks.setResult(this.d.runId, row.id, rejected, now);
      this.handleFailure(row, rejected, report, now);
      return;
    }
    this.handleFailure(row, result, report, now);
  }

  private handleFailure(
    row: TaskRow,
    result: ExecutionResult,
    report: TickReport,
    now: string,
  ): void {
    const decision = this.d.retryManager.onFailure(row, this.d.clock);
    if (decision.kind === "retry") {
      this.d.tasks.markRetrying(this.d.runId, row.id, decision.notBefore, now);
      report.failed++;
      this.emit("TaskFailed", row.id, {
        attempt: row.attempt,
        willRetry: true,
        errorSummary: result.errorSummary,
      });
      return;
    }
    // Escalonamento: marca escalated, bloqueia downstream, conta e talvez pausa.
    this.d.tasks.markEscalated(this.d.runId, row.id, now);
    report.escalated++;
    this.emit("TaskEscalated", row.id, {
      attempt: row.attempt,
      errorSummary: result.errorSummary,
    });
    const blocked = this.d.tasks.blockDownstream(this.d.runId, row.id, now);
    report.blocked += blocked.length;
    if (this.d.tasks.escalatedCount(this.d.runId) >= this.d.config.maxEscalations) {
      this.pause(now);
      report.runPaused = true;
    }
  }

  private pause(now: string): void {
    if (this.paused) return;
    this.paused = true;
    this.d.runs.setState(this.d.runId, "paused", now);
    this.emit("RunPaused", undefined, { reason: "limite de escalações atingido" });
  }

  private emit(name: EventName, taskId: string | undefined, data: Record<string, unknown>): void {
    this.d.bus.publish({
      name,
      ts: this.d.clock.now(),
      runId: this.d.runId,
      taskId,
      producer: "orchestration.scheduler",
      data,
    });
  }
}
