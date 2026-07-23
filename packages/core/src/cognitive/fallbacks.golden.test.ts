import { ProjectTarget } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import { loadStrategiesConfig } from "../shared/config.js";
import { fixedClock } from "../shared/clock.js";
import { analyzeProject } from "./project-analyzer.js";
import { intakeHeuristic } from "./intake.js";
import { understandingHeuristic } from "./understanding.js";
import { complexityHeuristic } from "./complexity-estimator.js";
import { planningHeuristic } from "./planning-engine.js";
import { selectStrategyForScore } from "./strategy-selector.js";
import { generateWorkflow } from "./workflow-generator.js";
import type { StageContext } from "./stage.js";
import { PEDIDOS, SAMPLE_NODE_PATH } from "./__fixtures__/pedidos.js";

const ctx = { clock: fixedClock() } as unknown as StageContext;
const strategies = loadStrategiesConfig();
const target = ProjectTarget.parse({
  slug: "sample-node",
  rootPath: SAMPLE_NODE_PATH,
  kind: "registered",
});
const projectMap = analyzeProject(target, { clock: fixedClock() });

/** Roda a cadeia cognitiva heurística inteira para um pedido. */
function runChain(pedido: (typeof PEDIDOS)[number]) {
  const request = intakeHeuristic(
    {
      requestId: "req_1",
      rawPrompt: pedido.rawPrompt,
      workKind: pedido.workKind,
      projectSlug: "sample-node",
      projectMap,
    },
    ctx,
  );
  const understanding = understandingHeuristic({ request, projectMap }, ctx);
  const complexity = complexityHeuristic({ request, understanding, projectMap }, ctx);
  const strategy = selectStrategyForScore(complexity.score, strategies);
  const plan = planningHeuristic({ request, understanding, strategy, projectMap }, ctx);
  const wf = generateWorkflow({
    plan,
    runId: "run_1",
    projectSlug: "sample-node",
    complexity: complexity.score,
    workKind: pedido.workKind,
  });
  return { request, understanding, complexity, strategy, plan, wf };
}

describe("golden: cadeia cognitiva offline", () => {
  for (const pedido of PEDIDOS) {
    describe(pedido.name, () => {
      const out = runChain(pedido);

      it("produz artefatos zod-válidos com invariantes coerentes", () => {
        expect(out.request.id).toBe("req_1");
        expect(out.request.workKind).toBe(pedido.workKind);
        expect(out.complexity.score).toBeGreaterThanOrEqual(1);
        expect(out.complexity.score).toBeLessThanOrEqual(5);
        if (pedido.expect.minComplexity) {
          expect(out.complexity.score).toBeGreaterThanOrEqual(pedido.expect.minComplexity);
        }
        if (pedido.expect.maxComplexity) {
          expect(out.complexity.score).toBeLessThanOrEqual(pedido.expect.maxComplexity);
        }
        expect(out.wf.tasks.length).toBeGreaterThanOrEqual(pedido.expect.minTasks);
        // DAG acíclico: a ordem cobre todas as tarefas.
        expect(out.wf.order).toHaveLength(out.wf.tasks.length);
      });

      it("é determinístico (mesma entrada -> mesma saída)", () => {
        const again = runChain(pedido);
        expect(again.plan).toEqual(out.plan);
        expect(again.wf.dag).toEqual(out.wf.dag);
        expect(again.complexity).toEqual(out.complexity);
      });
    });
  }
});
