/**
 * Camada 5 — Conhecimento & Evolução. A memória da plataforma (vault Obsidian +
 * índice FTS5) e a auto-melhoria (Evolution Engine, report-only na v1).
 */
export { SqliteKnowledgeStore, toMatchExpr } from "./knowledge-store.js";
export type { KnowledgeStore, KnowledgeReadPort } from "./knowledge-store.js";
export { ObsidianWriter, hashNote } from "./obsidian-writer.js";
export type { WriteNoteInput, ObsidianWriterDeps } from "./obsidian-writer.js";
export { composeMarkdown } from "./note-format.js";
export { KnowledgeProcessor } from "./knowledge-processor.js";
export type { ProcessResult } from "./knowledge-processor.js";
export { distill, distillStage } from "./distill-stage.js";
export { contentTokens, jaccard, topTags, extractiveSummary } from "./text-normalize.js";
export { GraphifyWorker, PersistedCodeGraph, collectFiles } from "./graphify-worker.js";
export type { GraphifyResult } from "./graphify-worker.js";
export { KnowledgeManager } from "./knowledge-manager.js";
export type { KnowledgeManagerDeps, CaptureResult } from "./knowledge-manager.js";
export { knowledgeStack, type KnowledgeStack } from "./factory.js";
export { EvolutionEngine } from "./evolution-engine.js";
export { runEvolutionRules } from "./evolution-rules.js";
export type { EvolutionInputs, ProposalDraft } from "./evolution-rules.js";
export {
  KIND_SUBDIR,
  slugify,
  noteIdFromPath,
  projectIndexPath,
  runNotePath,
  lessonPath,
  adrPath,
  graphPath,
} from "./vault-paths.js";
