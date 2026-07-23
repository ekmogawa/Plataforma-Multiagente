import { z } from "zod";
import { Id, IsoTimestamp } from "./common.js";

/**
 * Alvo de trabalho de um run. A plataforma opera **sobre projetos existentes**
 * (features, bugs, refatorações, ajustes) — criar do zero é o caso new-project.
 */

export const ProjectKind = z.enum(["registered", "new"]);
export type ProjectKind = z.infer<typeof ProjectKind>;

export const ProjectTarget = z.object({
  slug: Id,
  /** Caminho absoluto da raiz do projeto (onde o código já vive). */
  rootPath: z.string(),
  kind: ProjectKind,
  /** Stack detectada (ex.: "node", "python"). Preenchida pelo Project Analyzer. */
  stack: z.string().optional(),
  /** Branch principal a proteger (nunca commit direto nela). */
  defaultBranch: z.string().default("main"),
  /**
   * Permissões da plataforma sobre este projeto. `deploy` nasce falso —
   * deploy automático é futuro declarado e sempre exigirá opt-in explícito.
   */
  permissions: z
    .object({
      read: z.boolean().default(true),
      write: z.boolean().default(true),
      deploy: z.boolean().default(false),
    })
    .default({}),
});
export type ProjectTarget = z.infer<typeof ProjectTarget>;

/**
 * Tipo de intervenção. O pipeline escala pela complexidade: um ui-adjustment
 * trivial vira plano flat; uma feature grande vira DAG completo.
 */
export const WorkKind = z.enum([
  "feature",
  "bugfix",
  "refactor",
  "optimization",
  "ui-adjustment",
  "analysis", // análise/relatório sem alterar código — a rota mais barata (C0)
  "new-project",
]);
export type WorkKind = z.infer<typeof WorkKind>;

/**
 * Mapa do projeto — saída do Project Analyzer, gerado 1× por run e reutilizado.
 * v1: estrutura/dependências/framework/convenções/comando de teste.
 * (Enriquecimento futuro: arquitetura, módulos, hotspots — via histórico git.)
 */
export const ProjectMap = z.object({
  slug: Id,
  generatedAt: IsoTimestamp,
  /** Árvore de diretórios/arquivos relevante (resumida). */
  structure: z.array(z.string()).default([]),
  /** Dependências detectadas (nome -> versão, quando disponível). */
  dependencies: z.record(z.string(), z.string()).default({}),
  framework: z.string().optional(),
  /** Convenções detectadas (ex.: "ESM", "aspas duplas", "vitest"). */
  conventions: z.array(z.string()).default([]),
  /** Comando que roda os testes do projeto alvo, se detectado. */
  testCommand: z.string().optional(),
});
export type ProjectMap = z.infer<typeof ProjectMap>;
