import { z } from "zod";

/**
 * CodeChangeSet — a saída ESTRUTURADA do worker.llm (Camada 3). O modelo devolve
 * arquivos completos (não diff), validados por zod e aplicados por um único
 * serviço atômico (applyChangeSet) que confina os caminhos no projeto alvo.
 */

export const CodeFileAction = z.enum(["created", "modified", "deleted"]);
export type CodeFileAction = z.infer<typeof CodeFileAction>;

/** Rejeita caminhos obviamente perigosos já no schema (a guarda real é o path-guard). */
const RelPath = z
  .string()
  .min(1)
  .refine((p) => !/\0/.test(p), "caminho não pode conter NUL")
  .refine((p) => !/^([a-zA-Z]:[\\/]|[\\/]{1,2})/.test(p), "caminho deve ser relativo (sem raiz/drive/UNC)")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "caminho não pode conter '..'");

export const CodeFileChange = z
  .object({
    path: RelPath,
    action: CodeFileAction,
    /** Conteúdo completo do arquivo (obrigatório em created/modified). */
    content: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if ((c.action === "created" || c.action === "modified") && c.content === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `action "${c.action}" exige "content".`,
        path: ["content"],
      });
    }
    if (c.action === "deleted" && c.content !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'action "deleted" não deve trazer "content".',
        path: ["content"],
      });
    }
  });
export type CodeFileChange = z.infer<typeof CodeFileChange>;

export const CodeChangeSet = z.object({
  files: z.array(CodeFileChange).default([]),
  /** Notas do modelo (o que mudou e por quê) — vão para os artefatos. */
  notes: z.string().optional(),
});
export type CodeChangeSet = z.infer<typeof CodeChangeSet>;
