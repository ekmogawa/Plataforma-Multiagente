import {
  StructuredRequest,
  type ProjectMap,
  type StructuredRequest as StructuredRequestT,
  type WorkKind,
} from "@pm/contracts";
import type { CognitiveStage, StageContext } from "./stage.js";
import {
  DELIVERABLE_HINTS,
  DOMAIN_HINTS,
} from "./fallbacks/keywords.js";
import { extractMentionedArtifacts, firstHint } from "./fallbacks/heuristics.js";

export interface IntakeInput {
  requestId: string;
  rawPrompt: string;
  workKind: WorkKind;
  projectSlug?: string;
  projectMap?: ProjectMap;
}

const WORKKIND_VERB: Record<WorkKind, string> = {
  feature: "Implementar",
  bugfix: "Corrigir",
  refactor: "Refatorar",
  optimization: "Otimizar",
  "ui-adjustment": "Ajustar a interface de",
  analysis: "Analisar",
  "new-project": "Criar",
};

function deliverableFromProject(map?: ProjectMap): string | undefined {
  const fw = map?.framework;
  if (!fw) return undefined;
  if (["react", "vue", "svelte", "next", "angular"].includes(fw)) return "webapp";
  if (["express", "fastify", "nestjs"].includes(fw)) return "api";
  return undefined;
}

/** Fallback determinístico do Intake — normaliza o pedido em StructuredRequest. */
export function intakeHeuristic(input: IntakeInput, ctx: StageContext): StructuredRequestT {
  const prompt = input.rawPrompt.trim();
  const oneLine = prompt.replace(/\s+/g, " ").slice(0, 160);
  const translatedIntent = `${WORKKIND_VERB[input.workKind]}: ${oneLine}`;

  const deliverableType = firstHint(
    prompt,
    DELIVERABLE_HINTS,
    (h) => h.type,
    deliverableFromProject(input.projectMap) ?? "other",
  ) as StructuredRequestT["deliverableType"];

  const domain = firstHint(prompt, DOMAIN_HINTS, (h) => h.domain, "geral");

  const constraints: string[] = [];
  if (input.projectMap?.conventions.length) {
    constraints.push(
      `Respeitar as convenções do projeto: ${input.projectMap.conventions.join(", ")}.`,
    );
  }

  return StructuredRequest.parse({
    id: input.requestId,
    createdAt: ctx.clock.now(),
    rawPrompt: input.rawPrompt,
    translatedIntent,
    workKind: input.workKind,
    projectSlug: input.projectSlug,
    domain,
    deliverableType,
    constraints,
    assumptions: [],
    mentionedArtifacts: extractMentionedArtifacts(prompt),
    openQuestions: [],
  });
}

export const intakeStage: CognitiveStage<IntakeInput, StructuredRequestT> = {
  name: "intake",
  capability: "intake-translator",
  promptId: "intake/traduzir",
  schema: StructuredRequest,
  buildVars: (input) => ({
    rawPrompt: input.rawPrompt,
    workKind: input.workKind,
    projectSummary: input.projectMap
      ? `${input.projectMap.framework ?? "?"} — ${input.projectMap.conventions.join(", ")}`
      : "(sem projeto)",
  }),
  heuristic: intakeHeuristic,
};
