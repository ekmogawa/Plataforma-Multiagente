import { z } from "zod";
import { Id, Layer } from "./common.js";

/**
 * Schemas do Manual de Relações (registry/).
 * Fonte única de verdade da topologia da plataforma.
 * A fábrica de componentes só instancia o que está registrado aqui.
 */

export const ComponentKind = z.enum([
  "llm-stage", // etapa cognitiva/governança que chama modelo
  "deterministic", // roda sem LLM (scripts, git, fs)
  "service", // processo de coordenação (orquestrador, scheduler)
  "adapter", // ponte para um modelo/ferramenta externa
  "store", // persistência (SQLite, vault, banco vetorial)
]);
export type ComponentKind = z.infer<typeof ComponentKind>;

export const ComponentStatus = z.enum(["planned", "active", "deprecated"]);
export type ComponentStatus = z.infer<typeof ComponentStatus>;

/** Um componente do sistema — arquivo registry/components/<id>.yaml. */
export const ComponentSpec = z.object({
  /** Id no formato "camada.nome" (ex.: "cognitive.intake"). */
  id: Id,
  name: z.string().min(1),
  layer: Layer,
  kind: ComponentKind,
  status: ComponentStatus,
  /** Propósito em pt-BR — uma frase. */
  purpose_ptbr: z.string().min(1),
  /** Caminho do código que implementa o componente. */
  entrypoint: z.string().optional(),
  contract: z
    .object({
      /** Nome do schema de entrada (resolve em registry/schemas/). */
      input: z.string().optional(),
      output: z.string().optional(),
    })
    .default({}),
  /** Capacidade que o componente pede ao resolver (ex.: "planner", "coder-backend"). */
  capability: z.string().optional(),
  /** Chaves de config que o componente lê (ex.: "capabilities.planner"). */
  config_keys: z.array(z.string()).default([]),
  /** Prompts que o componente usa (ex.: "intake/traduzir-pedido"). */
  prompts: z.array(z.string()).default([]),
  /** Como trocar este componente — instrução legível (requisito de trocabilidade). */
  swappable_via: z.string().optional(),
});
export type ComponentSpec = z.infer<typeof ComponentSpec>;

export const RelationType = z.enum([
  "data-flow", // passa um payload adiante
  "invokes", // chama/aciona outro componente
  "reads", // lê de um store
  "writes", // escreve em um store
  "feedback", // devolve resultado para reprocessamento
]);
export type RelationType = z.infer<typeof RelationType>;

export const Relation = z.object({
  from: Id,
  to: Id,
  type: RelationType,
  /** Nome do payload trafegado (resolve em registry/schemas/), quando aplicável. */
  payload: z.string().optional(),
  note_ptbr: z.string().optional(),
});
export type Relation = z.infer<typeof Relation>;

/** Conteúdo de registry/relations.yaml. */
export const RelationsFile = z.object({
  relations: z.array(Relation),
});
export type RelationsFile = z.infer<typeof RelationsFile>;

/** Uma etapa do pipeline — item de registry/pipelines.yaml. */
export const PipelineStep = z.object({
  order: z.number().int().positive(),
  component: Id,
});
export type PipelineStep = z.infer<typeof PipelineStep>;

export const Pipeline = z.object({
  name: z.string(),
  description_ptbr: z.string().optional(),
  steps: z.array(PipelineStep),
});
export type Pipeline = z.infer<typeof Pipeline>;

/** Conteúdo de registry/pipelines.yaml. */
export const PipelinesFile = z.object({
  pipelines: z.array(Pipeline),
});
export type PipelinesFile = z.infer<typeof PipelinesFile>;
