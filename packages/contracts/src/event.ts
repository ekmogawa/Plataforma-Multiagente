import { z } from "zod";
import { Id, IsoTimestamp } from "./common.js";

/**
 * Event Bus em memória — desacoplamento (não distribuição; sem Redis/broker).
 * Componentes publicam eventos; Métricas e Knowledge assinam, em vez de serem
 * chamados diretamente. Todo evento também vira artefato.
 */

export const EventName = z.enum([
  // Ciclo de vida da Camada 1 (Cognitiva) — um evento por etapa.
  "RunRequested",
  "ProjectAnalyzed",
  "IntentCreated",
  "RequirementsReady",
  "ComplexityEstimated",
  "StrategySelected",
  "PlanningCompleted",
  "WorkflowCreated",
  "RunPlanned",
  // Camadas 2+ (execução, governança).
  "TaskStarted",
  "TaskCompleted",
  "TaskFailed",
  "TaskEscalated",
  "RunApproved",
  "RunPaused",
  "ArtifactStored",
  // Camada 4 (Governança).
  "GatekeeperReviewed",
  "RunAwaitingApproval",
  "RunRejected",
  "CommitCreated",
  "PullRequestCreated",
  // Camada 5 (Conhecimento).
  "KnowledgeCaptured",
]);
export type EventName = z.infer<typeof EventName>;

export const PlatformEvent = z.object({
  /** Id único do evento (idempotência/persistência). O bus preenche se ausente. */
  eventId: Id.optional(),
  name: EventName,
  ts: IsoTimestamp,
  runId: Id.optional(),
  taskId: Id.optional(),
  /** Componente que publicou (observabilidade). */
  producer: z.string().optional(),
  /** Referência ao artefato com o payload completo (rastreabilidade). */
  payloadRef: z.string().optional(),
  /** Dados leves inline (o volumoso vai para o artefato apontado por payloadRef). */
  data: z.record(z.string(), z.unknown()).default({}),
});
export type PlatformEvent = z.infer<typeof PlatformEvent>;
