import { StructuredRequest, type GateFinding, type GateReview } from "@pm/contracts";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { ProjectsRepo } from "../db/projects-repo.js";
import type { RunRow, RunsRepo } from "../db/runs-repo.js";
import type { Clock } from "../shared/clock.js";
import type { EventBus } from "../shared/event-bus.js";
import { readLatestEvidence, readLatestGateReview } from "../governance/approval.js";
import type { GraphifyWorker } from "./graphify-worker.js";
import type { KnowledgeProcessor } from "./knowledge-processor.js";
import type { SqliteKnowledgeStore } from "./knowledge-store.js";
import type { ObsidianWriter } from "./obsidian-writer.js";
import { lessonPath, projectIndexPath, runNotePath } from "./vault-paths.js";

/**
 * Knowledge Manager (Camada 5) — ASSINA o Event Bus (não é chamado direto,
 * espelha o MetricsCollector). Ao aprovar um run (RunApproved), registra o
 * conhecimento no vault: nota do run, lições dos achados do Gatekeeper, ADR das
 * restrições, índice do projeto; depois DESTILA (Processor) e desenha o grafo
 * (Graphify). Determinístico e best-effort — se algo falhar, o approve não cai
 * (o EventBus engole a exceção do handler).
 */
export interface KnowledgeManagerDeps {
  bus: EventBus;
  runs: RunsRepo;
  projects: ProjectsRepo;
  artifacts: ArtifactStore;
  store: SqliteKnowledgeStore;
  writer: ObsidianWriter;
  processor: KnowledgeProcessor;
  graphify?: GraphifyWorker;
  clock: Clock;
}

export interface CaptureResult {
  captured: boolean;
  notes: number;
  lessons: number;
}

export class KnowledgeManager {
  private unsub?: () => void;

  constructor(private readonly deps: KnowledgeManagerDeps) {}

  start(): void {
    this.unsub = this.deps.bus.on("RunApproved", (e) => {
      if (e.runId) this.onRunApproved(e.runId);
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = undefined;
  }

  /** Público para teste: registra o conhecimento de um run aprovado. */
  onRunApproved(runId: string): CaptureResult {
    const run = this.deps.runs.get(runId);
    if (!run || run.state !== "approved" || !run.projectSlug) {
      return { captured: false, notes: 0, lessons: 0 };
    }
    const slug = run.projectSlug;
    const project = this.deps.projects.get(slug);
    const request = this.loadRequest(runId);
    const gate = readLatestGateReview(this.deps.artifacts, runId);
    const evidence = readLatestEvidence(this.deps.artifacts, runId);
    const runLink = runNotePath(slug, runId).replace(/\.md$/i, "");

    let notes = 0;
    let lessons = 0;

    // 1. Nota do run (o núcleo: "aprovar um run -> o vault ganha uma nota").
    this.deps.writer.write({
      kind: "projeto",
      title: `Run ${runId} — ${run.workKind ?? "trabalho"}`,
      body: this.runNoteBody(runId, run, request, gate, evidence),
      vaultPath: runNotePath(slug, runId),
      projectSlug: slug,
      runId,
      tags: ["run", run.workKind ?? "trabalho", gate?.verdict ?? "sem-revisao"],
      processed: false,
    });
    notes++;

    // 2. Lições dos achados do Gatekeeper (alimentam o Evolution Engine no futuro).
    const findings = gate?.findings ?? [];
    findings.forEach((f, i) => {
      this.deps.writer.write({
        kind: "licao",
        title: `${f.category}/${f.severity}: ${truncate(f.text, 60)}`,
        body: lessonBody(f, runId),
        vaultPath: lessonPath(slug, `${runId}-${i}-${f.category}`),
        projectSlug: slug,
        runId,
        tags: ["licao", f.category, f.severity],
        wikilinks: [runLink],
        processed: false,
      });
      lessons++;
    });

    // 3. ADR quando o pedido trouxe restrições/premissas (decisões do run).
    const constraints = request?.constraints ?? [];
    const assumptions = request?.assumptions ?? [];
    if (constraints.length > 0 || assumptions.length > 0) {
      this.deps.writer.write({
        kind: "decisao",
        title: `Decisões do run ${runId}`,
        body: adrBody(runId, constraints, assumptions),
        vaultPath: `decisoes/${slug}/${runId}.md`,
        projectSlug: slug,
        runId,
        tags: ["decisao", run.workKind ?? "trabalho"],
        wikilinks: [runLink],
        processed: false,
      });
      notes++;
    }

    // 4. Índice do projeto (regenerado a cada aprovação — lista os runs).
    this.writeProjectIndex(slug);
    notes++;

    // 5. Destila as notas deste run (dedup->wikilinks, tags, marca processado).
    this.deps.processor.process({ runId });

    // 6. Grafo do código (best-effort; nunca derruba o fluxo).
    if (this.deps.graphify && project) {
      try {
        this.deps.graphify.run({ slug, projectRoot: project.rootPath });
      } catch {
        /* grafo é best-effort */
      }
    }

    // 7. Evento (persistido no EventLog para observabilidade/replay).
    this.deps.bus.publish({
      name: "KnowledgeCaptured",
      ts: this.deps.clock.now(),
      runId,
      producer: "knowledge.knowledge-manager",
      data: { notes, lessons },
    });

    return { captured: true, notes, lessons };
  }

  private writeProjectIndex(slug: string): void {
    const runNotes = this.deps.store.listByProject(slug, "projeto").filter((n) => n.runId);
    const lines = [
      `Índice do projeto **${slug}** — a memória acumulada dos runs aprovados.`,
      "",
      `## Runs aprovados (${runNotes.length})`,
      ...runNotes.map((n) => `- [[${n.vaultPath.replace(/\.md$/i, "")}]] — ${n.title}`),
    ];
    this.deps.writer.write({
      kind: "projeto",
      title: `Projeto ${slug}`,
      body: lines.join("\n"),
      vaultPath: projectIndexPath(slug),
      projectSlug: slug,
      tags: ["projeto", "indice"],
      processed: true, // o índice é derivado; já é "processado"
    });
  }

  private runNoteBody(
    runId: string,
    run: RunRow,
    request: StructuredRequest | undefined,
    gate: GateReview | undefined,
    evidence: string | undefined,
  ): string {
    const lines: string[] = [];
    lines.push(`- Tipo de trabalho: ${run.workKind ?? "-"}`);
    lines.push(`- Estratégia: ${run.strategy?.profile ?? "-"}`);
    lines.push(`- Custo: US$ ${run.costUsd.toFixed(4)}`);
    lines.push(`- Revisão do Gatekeeper: ${gate?.verdict ?? "sem revisão"}`);
    lines.push("");
    if (request) {
      lines.push("## O que foi pedido");
      lines.push(`> ${request.rawPrompt}`);
      lines.push("");
      lines.push(`**Intenção técnica:** ${request.translatedIntent}`);
      lines.push("");
    }
    if (evidence) {
      lines.push("## Evidências apresentadas na aprovação");
      lines.push(evidence.trim());
    }
    return lines.join("\n");
  }

  private loadRequest(runId: string): StructuredRequest | undefined {
    const art = this.deps.artifacts
      .listByRun(runId)
      .filter((a) => a.kind === "report" && a.path.endsWith("-structured-request.json"))
      .at(-1);
    if (!art) return undefined;
    const content = this.deps.artifacts.readContent(art.id);
    if (!content) return undefined;
    try {
      return StructuredRequest.parse(JSON.parse(content));
    } catch {
      return undefined;
    }
  }
}

function lessonBody(f: GateFinding, runId: string): string {
  const lines = [
    `**Categoria:** ${f.category}  |  **Severidade:** ${f.severity}`,
    "",
    f.text,
  ];
  if (f.file) lines.push("", `Arquivo: \`${f.file}\``);
  lines.push("", `Origem: run \`${runId}\`.`);
  return lines.join("\n");
}

function adrBody(runId: string, constraints: string[], assumptions: string[]): string {
  const lines = [`Decisões e premissas registradas no run \`${runId}\`.`, ""];
  if (constraints.length > 0) {
    lines.push("## Restrições");
    for (const c of constraints) lines.push(`- ${c}`);
    lines.push("");
  }
  if (assumptions.length > 0) {
    lines.push("## Premissas assumidas");
    for (const a of assumptions) lines.push(`- ${a}`);
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
