import type { z } from "zod";
import { ProjectTarget, ProjectMap } from "./project.js";
import { Artifact } from "./artifact.js";
import { PlatformEvent } from "./event.js";
import { StructuredRequest, Question } from "./structured-request.js";
import { Requirement, UnderstandingReport } from "./requirements.js";
import { ComplexityAssessment } from "./complexity.js";
import { ExecutionStrategy } from "./strategy.js";
import { Plan, PlanNode, AcceptanceCriterion } from "./plan.js";
import { TaskSpec } from "./task.js";
import { PlannedTask } from "./planned-task.js";
import { WorkflowDAG } from "./workflow.js";
import { TaskContext, PromptPackage } from "./context.js";
import { ExecutionResult } from "./execution.js";
import { CodeChangeSet } from "./code-change.js";
import { ValidationReport, GateReview, ApprovalRecord } from "./validation.js";
import { MetricEvent } from "./metrics.js";
import { KnowledgeNote, KnowledgeQuery, KnowledgeHit, DistilledNote } from "./knowledge.js";
import { EvolutionProposal, EvolutionReport } from "./evolution.js";
import { ComponentSpec, RelationsFile, PipelinesFile } from "./registry.js";
import { ModelsConfig } from "./models-config.js";

/**
 * Mapa nome-canônico → schema zod.
 *
 * Estes são os nomes que o registro (`registry/`) usa nos campos `contract`,
 * `payload`, `input` e `output`. A geração de JSON Schema e a validação do
 * registro consultam este mapa — assim "o nome existe" tem uma única fonte.
 */
export const SCHEMA_REGISTRY = {
  ProjectTarget,
  ProjectMap,
  Artifact,
  PlatformEvent,
  StructuredRequest,
  Question,
  Requirement,
  UnderstandingReport,
  ComplexityAssessment,
  ExecutionStrategy,
  Plan,
  PlanNode,
  AcceptanceCriterion,
  TaskSpec,
  PlannedTask,
  WorkflowDAG,
  TaskContext,
  PromptPackage,
  ExecutionResult,
  CodeChangeSet,
  ValidationReport,
  GateReview,
  ApprovalRecord,
  MetricEvent,
  KnowledgeNote,
  KnowledgeQuery,
  KnowledgeHit,
  DistilledNote,
  EvolutionProposal,
  EvolutionReport,
  ComponentSpec,
  RelationsFile,
  PipelinesFile,
  ModelsConfig,
} satisfies Record<string, z.ZodTypeAny>;

/** Nomes de schema conhecidos (para validação do registro). */
export type SchemaName = keyof typeof SCHEMA_REGISTRY;

export function isKnownSchema(name: string): name is SchemaName {
  return Object.prototype.hasOwnProperty.call(SCHEMA_REGISTRY, name);
}
