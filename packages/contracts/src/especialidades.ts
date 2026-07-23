import { z } from "zod";

/**
 * Validador de `config/especialidades.yaml`. Cada especialidade do worker.llm
 * genérico mapeia para uma capacidade + template de prompt + convenções.
 * Config validator (fail-fast) — não entra no SCHEMA_REGISTRY.
 */
export const EspecialidadeEntry = z.object({
  capability: z.string().min(1),
  prompt: z.string().min(1),
  conventions: z.array(z.string()).default([]),
});
export type EspecialidadeEntry = z.infer<typeof EspecialidadeEntry>;

export const EspecialidadesConfig = z.object({
  especialidades: z.record(z.string(), EspecialidadeEntry),
});
export type EspecialidadesConfig = z.infer<typeof EspecialidadesConfig>;
