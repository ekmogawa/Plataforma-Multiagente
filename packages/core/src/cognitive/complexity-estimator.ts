import {
  ComplexityAssessment,
  type ComplexityAssessment as ComplexityAssessmentT,
  type ComplexityDriver,
  type ComplexityScore,
  type ProjectMap,
  type StructuredRequest,
  type UnderstandingReport,
  type WorkKind,
} from "@pm/contracts";
import type { CognitiveStage, StageContext } from "./stage.js";
import { HIGH_COMPLEXITY_KEYWORDS, MEDIUM_COMPLEXITY_KEYWORDS } from "./fallbacks/keywords.js";
import { anyMatch, clamp, countMatches } from "./fallbacks/heuristics.js";

export interface ComplexityInput {
  request: StructuredRequest;
  understanding: UnderstandingReport;
  projectMap?: ProjectMap;
}

const BASE_BY_WORKKIND: Record<WorkKind, number> = {
  analysis: 1,
  "ui-adjustment": 1,
  bugfix: 2,
  optimization: 2,
  feature: 3,
  refactor: 3,
  "new-project": 4,
};

/** Fallback determinístico da Complexidade — score 1..5 por sinais explicáveis. */
export function complexityHeuristic(
  input: ComplexityInput,
  _ctx: StageContext,
): ComplexityAssessmentT {
  const { request, understanding } = input;
  const text = `${request.rawPrompt} ${request.translatedIntent}`;

  const high = countMatches(text, HIGH_COMPLEXITY_KEYWORDS);
  const medium = countMatches(text, MEDIUM_COMPLEXITY_KEYWORDS);
  // Só requisitos FUNCIONAIS contam como "tamanho" — os não-funcionais
  // (testes, convenções) são sempre adicionados e não indicam complexidade.
  const functionalCount = understanding.requirements.filter(
    (r) => r.kind === "functional",
  ).length;

  let score = BASE_BY_WORKKIND[request.workKind];
  score += Math.min(high, 2); // sinais de alto risco
  if (medium >= 2) score += 1;
  if (functionalCount > 2) score += 1;
  score = clamp(score, 1, 5);

  const drivers: ComplexityDriver[] = [];
  if (high > 0) drivers.push("technical-risk");
  if (anyMatch(text, ["migra", "migration"])) drivers.push("migration");
  if (anyMatch(text, ["auth", "autentica", "seguran", "senha", "login"]))
    drivers.push("security");
  if (anyMatch(text, ["arquitetura", "architecture"])) drivers.push("architecture");
  if (functionalCount > 2) drivers.push("size");
  if (drivers.length === 0) drivers.push("size");

  const rationale =
    `Base ${BASE_BY_WORKKIND[request.workKind]} pelo tipo "${request.workKind}"` +
    (high > 0 ? `, +${Math.min(high, 2)} por sinais de risco técnico` : "") +
    (medium >= 2 ? ", +1 por múltiplos sinais de média complexidade" : "") +
    (functionalCount > 2 ? ", +1 por muitos requisitos funcionais" : "") +
    `. Resultado ${score}/5.`;

  return ComplexityAssessment.parse({
    itemId: request.id,
    score: score as ComplexityScore,
    drivers,
    rationale,
    estimatedTokens: score * 20000,
  });
}

export const complexityStage: CognitiveStage<ComplexityInput, ComplexityAssessmentT> = {
  name: "complexity-estimator",
  capability: "complexity-estimator",
  promptId: "complexity/estimar",
  schema: ComplexityAssessment,
  buildVars: (input) => ({
    intent: input.request.translatedIntent,
    workKind: input.request.workKind,
    requirements: input.understanding.requirements.map((r) => `- ${r.text}`).join("\n"),
  }),
  heuristic: complexityHeuristic,
};
