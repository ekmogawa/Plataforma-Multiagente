import { z } from "zod";
import { Id, IsoTimestamp } from "./common.js";

/**
 * Artifact Store — princípio arquitetural: toda informação produzida por um
 * componente é persistida ou reproduzível, identificável por run_id + task_id.
 * É o que torna a plataforma auditável, reproduzível (replay) e depurável.
 */

export const ArtifactKind = z.enum([
  "plan",
  "dag",
  "prompt",
  "response",
  "patch",
  "diff",
  "report",
  "log",
  "evidence",
  "test-result",
  "project-map",
  "decision", // ex.: decisão do resolver de capacidade/modelo
  "event", // eventos do Event Bus também viram artefato
  "context", // TaskContext montado pelo Context Builder (Camada 2)
  "planned-tasks", // lista de PlannedTask (saída do Workflow Generator)
  "gate-review", // GateReview do Gatekeeper (Camada 4)
  "approval", // ApprovalRecord da decisão humana (Camada 4)
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/**
 * Classificação de sensibilidade. Antes de persistir, o Artifact Store aplica
 * redação de segredos; `sensitive` marca conteúdo que não deve sair da máquina.
 */
export const ArtifactClassification = z.enum([
  "public",
  "project-internal",
  "sensitive",
]);
export type ArtifactClassification = z.infer<typeof ArtifactClassification>;

/** Índice de um artefato (o conteúdo vive em workspace/runs/<run-id>/). */
export const Artifact = z.object({
  id: Id,
  runId: Id,
  taskId: Id.optional(),
  kind: ArtifactKind,
  /** Caminho relativo à raiz do repo onde o conteúdo está gravado. */
  path: z.string(),
  /** Hash sha256 do conteúdo (integridade e deduplicação). */
  hash: z.string(),
  classification: ArtifactClassification.default("project-internal"),
  createdAt: IsoTimestamp,
  /** Metadados livres (ex.: componente de origem, nº de redações aplicadas). */
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type Artifact = z.infer<typeof Artifact>;
