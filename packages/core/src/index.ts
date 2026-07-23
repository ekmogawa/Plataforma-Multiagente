/**
 * @pm/core — tudo que executa na plataforma.
 * Organizado por camada (cognitive/orchestration/execution/governance/knowledge),
 * mais adaptadores de modelo, banco (SQLite) e utilitários compartilhados.
 *
 * Na Fase 0 exportamos a base: paths, config, env, banco e adaptadores.
 */

export * from "./shared/index.js";
export * from "./db/index.js";
export * from "./adapters/index.js";
export * from "./orchestration/index.js";
export * from "./execution/index.js";
export { ContextBuilder, type ContextBuilderDeps } from "./execution/context-builder.js";
export * from "./cognitive/index.js";
export * from "./governance/index.js";
export * from "./knowledge/index.js";
export { ArtifactStore } from "./artifacts/artifact-store.js";
