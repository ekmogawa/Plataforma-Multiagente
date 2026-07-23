import type {
  EspecialidadesConfig,
  ProjectMap,
  TaskContext,
  TaskSpec,
  ValidationReport,
} from "@pm/contracts";
import { TaskContext as TaskContextSchema } from "@pm/contracts";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { KnowledgeReadPort } from "../knowledge/knowledge-store.js";
import { TASK_TYPE_TO_ESPECIALIDADE } from "../orchestration/task-router.js";
import type { CodeGraphPort } from "./code-graph-port.js";
import { estimateTokens } from "./token-estimator.js";

/**
 * Context Builder — monta o TaskContext MÍNIMO para uma tarefa: arquivos-semente
 * (input.files, modo full), vizinhança 1-hop pelo CodeGraphPort (modo summary),
 * convenções do projeto + da especialidade, tudo dentro de um orçamento de
 * tokens. Determinístico. A persistência (artefato kind="context") é do chamador.
 */
export interface ContextBuilderDeps {
  /** Raiz do projeto ALVO (ProjectTarget.rootPath). */
  root: string;
  codeGraph: CodeGraphPort;
  especialidades: EspecialidadesConfig;
  maxTokensPerTask: number;
  maxFileBytes: number;
  maxNeighbors: number;
  /** Opcional: para injetar priorFailure a partir do último test-result reprovado. */
  artifacts?: ArtifactStore;
  /** Opcional (Camada 5): conhecimento DESTILADO que realimenta o contexto. */
  knowledge?: KnowledgeReadPort;
  maxPriorDecisions?: number;
}

const SUMMARY_LINES = 40;

export class ContextBuilder {
  constructor(private readonly deps: ContextBuilderDeps) {}

  build(spec: TaskSpec, projectMap: ProjectMap): TaskContext {
    const files: { path: string; content: string; mode: "full" | "summary" }[] = [];
    let budget = this.deps.maxTokensPerTask;

    const addFile = (relPath: string, mode: "full" | "summary"): void => {
      if (budget <= 0) return;
      const text = this.readFile(relPath, mode);
      if (text === undefined) return;
      const cost = estimateTokens(text);
      if (cost > budget) return; // não estoura o orçamento
      budget -= cost;
      files.push({ path: relPath, content: text, mode });
    };

    // 1. Arquivos-semente (o que a tarefa cita explicitamente).
    const seeds = spec.input.files;
    for (const f of seeds) addFile(f, "full");

    // 2. Vizinhança 1-hop (dependências diretas), como resumo.
    const neighbors = new Set<string>();
    for (const f of seeds) {
      for (const n of this.deps.codeGraph.neighborsOf(f)) {
        if (!seeds.includes(n)) neighbors.add(n);
        if (neighbors.size >= this.deps.maxNeighbors) break;
      }
      if (neighbors.size >= this.deps.maxNeighbors) break;
    }
    for (const n of [...neighbors].sort()) addFile(n, "summary");

    // 3. Convenções: do projeto + da especialidade do tipo da tarefa.
    const conventions = [...projectMap.conventions];
    const esp = TASK_TYPE_TO_ESPECIALIDADE[spec.type];
    const espConv = esp ? this.deps.especialidades.especialidades[esp]?.conventions ?? [] : [];
    for (const c of espConv) if (!conventions.includes(c)) conventions.push(c);

    // 4. Conhecimento destilado relacionado (Camada 5) — decisões e lições. Só
    // quando o port está presente; ausente => comportamento das Camadas 1-4.
    const priorDecisions: string[] = [];
    if (this.deps.knowledge) {
      const seeds = spec.input.files.map((f) => f.split("/").pop() ?? f);
      const text = [spec.type, ...seeds].join(" ").trim();
      const limit = this.deps.maxPriorDecisions ?? 3;
      if (text) {
        try {
          const hits = this.deps.knowledge.search({
            text,
            projectSlug: spec.projectSlug,
            kinds: ["decisao", "licao"],
            processedOnly: true,
            limit,
          });
          for (const h of hits) {
            const link = h.vaultPath.replace(/\.md$/i, "");
            const line = `[[${link}]] ${h.title} — ${h.snippet}`;
            const cost = estimateTokens(line);
            if (cost > budget) break;
            budget -= cost;
            priorDecisions.push(line);
          }
        } catch {
          /* busca é best-effort: não deve quebrar a montagem do contexto */
        }
      }
    }

    const estimatedTokens = this.deps.maxTokensPerTask - budget;

    return TaskContextSchema.parse({
      taskId: spec.id,
      files,
      contracts: [],
      conventions,
      priorDecisions,
      priorFailure: this.lastFailure(spec),
      estimatedTokens,
    });
  }

  /** Resumo do ValidationReport reprovado de MAIOR tentativa (determinístico). */
  private lastFailure(spec: TaskSpec): string | undefined {
    if (!this.deps.artifacts) return undefined;
    const failed = this.deps.artifacts
      .listByRun(spec.runId)
      .filter((a) => a.kind === "test-result" && a.taskId === spec.id && a.meta?.passed === false);
    // Escolhe pela maior meta.attempt (não por created_at de relógio real).
    let best: (typeof failed)[number] | undefined;
    let bestAttempt = -1;
    for (const a of failed) {
      const at = typeof a.meta?.attempt === "number" ? a.meta.attempt : 0;
      if (at >= bestAttempt) {
        bestAttempt = at;
        best = a;
      }
    }
    if (!best) return undefined;
    const content = this.deps.artifacts.readContent(best.id);
    if (!content) return undefined;
    try {
      return (JSON.parse(content) as ValidationReport).failureSummary;
    } catch {
      return undefined;
    }
  }

  private readFile(relPath: string, mode: "full" | "summary"): string | undefined {
    const abs = join(this.deps.root, relPath);
    try {
      if (!existsSync(abs)) return undefined;
      const size = statSync(abs).size;
      // Leitura SEMPRE limitada a maxFileBytes (não carrega arquivo grande inteiro).
      let text: string;
      if (size > this.deps.maxFileBytes) {
        text = this.readBounded(abs, this.deps.maxFileBytes) + "\n… (truncado)";
      } else {
        text = readFileSync(abs, "utf8");
      }
      return mode === "summary" ? this.head(text) : text;
    } catch {
      return undefined;
    }
  }

  /** Lê no máximo `maxBytes` do início do arquivo, sem carregá-lo inteiro. */
  private readBounded(abs: string, maxBytes: number): string {
    const fd = openSync(abs, "r");
    try {
      const buf = Buffer.allocUnsafe(maxBytes);
      const n = readSync(fd, buf, 0, maxBytes, 0);
      return buf.toString("utf8", 0, n);
    } finally {
      closeSync(fd);
    }
  }

  private head(text: string): string {
    const lines = text.split(/\r?\n/);
    if (lines.length <= SUMMARY_LINES) return text;
    return lines.slice(0, SUMMARY_LINES).join("\n") + "\n… (resumido)";
  }
}
