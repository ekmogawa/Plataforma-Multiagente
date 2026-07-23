/**
 * @pm/contracts — as formas de dados que fluem pelo pipeline.
 *
 * Este pacote não depende de nenhum outro pacote interno; todos dependem dele.
 * Cada schema zod é a fonte de verdade da forma; os JSON Schemas em
 * registry/schemas/ são gerados a partir daqui (pnpm gen:schemas).
 */

export * from "./common.js";
export * from "./project.js";
export * from "./artifact.js";
export * from "./event.js";
export * from "./structured-request.js";
export * from "./requirements.js";
export * from "./complexity.js";
export * from "./strategy.js";
export * from "./plan.js";
export * from "./task.js";
export * from "./planned-task.js";
export * from "./workflow.js";
export * from "./context.js";
export * from "./execution.js";
export * from "./code-change.js";
export * from "./validation.js";
export * from "./metrics.js";
export * from "./knowledge.js";
export * from "./evolution.js";
export * from "./registry.js";
export * from "./models-config.js";
export * from "./especialidades.js";
export * from "./platform-config.js";
export * from "./schema-registry.js";
