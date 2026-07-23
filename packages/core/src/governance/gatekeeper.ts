import { GateReview, type GateFinding, type ProjectTarget } from "@pm/contracts";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { TasksRepo } from "../db/tasks-repo.js";
import { runStage, type StageContext } from "../cognitive/stage.js";
import { runDeterministicChecks, DEFAULT_GATEKEEPER_CONFIG, type GatekeeperConfig } from "./checks.js";
import { buildGateInput } from "./gate-input.js";
import { gateReviewStage } from "./gate-review-stage.js";
import { decideVerdict } from "./verdict.js";

/**
 * Gatekeeper (Camada 4) — revisão ARQUITETURAL run-level, DEPOIS que a execução
 * chega a 'done' e ANTES de qualquer commit. Roda os checks determinísticos +
 * (opcional) uma revisão LLM, decide o verdict determinísticamente e persiste um
 * GateReview. NÃO commita, NÃO muda run.state, NÃO emite eventos — devolve o
 * GateReview para o ciclo de vida (CLI) decidir.
 */
export interface GatekeeperDeps {
  tasks: TasksRepo;
  artifacts: ArtifactStore;
  target: ProjectTarget;
  config?: GatekeeperConfig;
  /** Contexto de etapa para a revisão LLM (opcional; sem ele, só determinístico). */
  llm?: StageContext;
}

export class Gatekeeper {
  constructor(private readonly deps: GatekeeperDeps) {}

  async review(runId: string): Promise<GateReview> {
    const cfg = this.deps.config ?? DEFAULT_GATEKEEPER_CONFIG;
    const input = buildGateInput(this.deps.tasks, runId, this.deps.target.rootPath);

    const findings: GateFinding[] = runDeterministicChecks(input, cfg);

    // Revisão LLM opcional (no-op offline: heurística devolve {findings:[]}).
    if (this.deps.llm) {
      try {
        const out = await runStage(gateReviewStage, input, this.deps.llm);
        findings.push(...out.findings);
      } catch {
        /* falha da revisão LLM não bloqueia o gate determinístico */
      }
    }

    const review = GateReview.parse({
      runId,
      verdict: decideVerdict(findings),
      findings,
    });

    this.deps.artifacts.storeJson({
      runId,
      kind: "gate-review",
      name: "gate-review",
      data: review,
      meta: { verdict: review.verdict, findings: findings.length },
    });

    return review;
  }
}
