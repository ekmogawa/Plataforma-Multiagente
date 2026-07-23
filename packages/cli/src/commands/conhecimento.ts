import {
  KnowledgeQuery,
  type KnowledgeHit,
} from "@pm/contracts";
import {
  ProjectsRepo,
  knowledgeStack,
  openDatabase,
  systemClock,
} from "@pm/core";
import { emit, mark, type OutputOptions } from "../output.js";

/** pm conhecimento processar — destila o conhecimento bruto ainda não processado. */
export function conhecimentoProcessar(opts: OutputOptions): number {
  const db = openDatabase();
  try {
    const kn = knowledgeStack(db, systemClock);
    const result = kn.processor.process({});
    emit(
      result,
      () =>
        `${mark.ok} Conhecimento processado: ${result.processed} nota(s) destilada(s), ${result.linked} ligação(ões) criada(s).`,
      opts,
    );
    return 0;
  } finally {
    db.close();
  }
}

/** pm conhecimento buscar "<texto>" — busca no vault (FTS5). */
export function conhecimentoBuscar(text: string, projectSlug: string | undefined, opts: OutputOptions): number {
  const db = openDatabase();
  try {
    const kn = knowledgeStack(db, systemClock);
    const query = KnowledgeQuery.parse({
      text,
      projectSlug,
      processedOnly: false, // busca abrange bruto e destilado
      limit: 10,
    });
    const hits: KnowledgeHit[] = kn.store.search(query);
    emit(
      { query: text, hits },
      () => {
        if (hits.length === 0) return `Nada encontrado para "${text}".`;
        const lines = [`${hits.length} resultado(s) para "${text}":`, ""];
        for (const h of hits) {
          lines.push(`• [${h.kind}] ${h.title}  (${h.vaultPath})`);
          lines.push(`  ${h.snippet}`);
        }
        return lines.join("\n");
      },
      opts,
    );
    return 0;
  } finally {
    db.close();
  }
}

/** pm graphify <slug> — desenha o grafo estrutural do código do projeto no vault. */
export function graphifyCommand(slug: string, opts: OutputOptions): number {
  const db = openDatabase();
  try {
    const project = new ProjectsRepo(db).get(slug);
    if (!project) {
      emit(
        { ok: false, error: `projeto não registrado: ${slug}` },
        () => `${mark.fail} Projeto "${slug}" não está registrado.`,
        opts,
      );
      return 1;
    }
    const kn = knowledgeStack(db, systemClock);
    let result;
    try {
      result = kn.graphify.run({ slug, projectRoot: project.rootPath });
    } catch (err) {
      emit(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        () => `${mark.fail} Não foi possível gerar o grafo de "${slug}": ${err instanceof Error ? err.message : String(err)}`,
        opts,
      );
      return 1;
    }
    emit(
      result,
      () =>
        [
          `${mark.ok} Grafo do projeto "${slug}" gerado em ${result.vaultPath}.`,
          `  Arquivos: ${result.files}  |  Dependências: ${result.edges}`,
          result.truncated ? `  ${mark.warn} Análise parcial (teto de arquivos atingido).` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      opts,
    );
    return 0;
  } finally {
    db.close();
  }
}
