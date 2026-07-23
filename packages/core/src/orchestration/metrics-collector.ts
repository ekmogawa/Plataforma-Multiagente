import type { EventName, MetricEvent, MetricKind } from "@pm/contracts";
import type { MetricsRepo } from "../db/metrics-repo.js";
import type { EventBus } from "../shared/event-bus.js";

/**
 * Metrics Collector — assina o Event Bus e transforma eventos relevantes em
 * MetricEvent. Módulo do Background Orchestrator (Camada 2), mas já aqui para
 * validar o padrão: nada chama as métricas diretamente; elas reagem a eventos.
 */

const EVENT_TO_KIND: Partial<Record<EventName, MetricKind>> = {
  TaskCompleted: "task_result",
  TaskFailed: "task_result",
  TaskEscalated: "escalation",
  GatekeeperReviewed: "gate",
};

const SUCCESS_BY_EVENT: Partial<Record<EventName, boolean>> = {
  TaskCompleted: true,
  TaskFailed: false,
};

export class MetricsCollector {
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly metrics: MetricsRepo,
    private readonly bus: EventBus,
  ) {}

  /** Passa a escutar os eventos que viram métrica. */
  start(): void {
    for (const name of Object.keys(EVENT_TO_KIND) as EventName[]) {
      this.unsubscribers.push(
        this.bus.on(name, (event) => {
          const kind = EVENT_TO_KIND[event.name];
          if (!kind) return;
          const metric: MetricEvent = {
            ts: event.ts,
            kind,
            runId: event.runId,
            taskId: event.taskId,
            success: SUCCESS_BY_EVENT[event.name],
            durationMs:
              typeof event.data.durationMs === "number"
                ? event.data.durationMs
                : undefined,
            meta: { event: event.name, ...event.data },
          };
          this.metrics.record(metric);
        }),
      );
    }
  }

  /** Cancela as assinaturas. */
  stop(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}
