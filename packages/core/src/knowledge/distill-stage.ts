import { DistilledNote, type KnowledgeNote } from "@pm/contracts";
import type { CognitiveStage } from "../cognitive/stage.js";
import { extractiveSummary, topTags } from "./text-normalize.js";

/**
 * Destilação de uma nota como CognitiveStage (capability context-refiner). A
 * heurística é de PRIMEIRA CLASSE (resumo extrativo + tags por frequência), então
 * roda OFFLINE sem inventar nada. O caminho LLM (com chave) refina o resumo; hoje
 * é dormente. Os wikilinks entre notas relacionadas são resolvidos pelo Processor
 * (precisa do corpus), não aqui.
 */
export function distill(note: KnowledgeNote): DistilledNote {
  return DistilledNote.parse({
    title: note.title,
    kind: note.kind,
    summary: extractiveSummary(note.body, 3),
    tags: topTags(`${note.title} ${note.body}`, 6),
    links: [],
    patterns: [],
  });
}

export const distillStage: CognitiveStage<KnowledgeNote, DistilledNote> = {
  name: "knowledge-distill",
  capability: "context-refiner",
  promptId: "knowledge/destilar",
  schema: DistilledNote,
  buildVars: (note) => ({
    title: note.title,
    kind: note.kind,
    body: note.body.slice(0, 8000),
  }),
  heuristic: (note) => distill(note),
};
