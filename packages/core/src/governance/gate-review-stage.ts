import { GateFinding } from "@pm/contracts";
import { z } from "zod";
import { redactSecrets } from "../shared/redaction.js";
import type { CognitiveStage, StageContext } from "../cognitive/stage.js";
import type { GateInput } from "./gate-input.js";

/**
 * Revisão LLM OPCIONAL do Gatekeeper (capability reviewer-code), como
 * CognitiveStage reutilizando runStage. Offline (modo heurístico) é NO-OP
 * (devolve {findings:[]}); com chave, o modelo aponta padrões arquiteturais e
 * duplicação. O diff enviado ao provedor é REDIGIDO e truncado — segredos nunca saem.
 */
export const LlmReviewOutput = z.object({ findings: z.array(GateFinding).default([]) });
export type LlmReviewOutput = z.infer<typeof LlmReviewOutput>;

const MAX_DIFF_CHARS = 24_000;

function renderRedactedDiff(input: GateInput): string {
  const parts: string[] = [];
  let budget = MAX_DIFF_CHARS;
  for (const f of input.files) {
    if (budget <= 0) break;
    const head = `### ${f.path} (${f.action})`;
    if (!f.content) {
      parts.push(`${head} — ${f.oversize ? "arquivo grande, omitido" : "sem conteúdo"}`);
      continue;
    }
    const redacted = redactSecrets(f.content).text.slice(0, Math.min(budget, 4_000));
    budget -= redacted.length;
    parts.push(`${head}\n${redacted}`);
  }
  return parts.join("\n\n");
}

export const gateReviewStage: CognitiveStage<GateInput, LlmReviewOutput> = {
  name: "gate-review",
  capability: "reviewer-code",
  promptId: "gatekeeper/revisar-run",
  schema: LlmReviewOutput,
  buildVars: (input: GateInput) => ({ diff: renderRedactedDiff(input) }),
  heuristic: (): LlmReviewOutput => ({ findings: [] }),
};
