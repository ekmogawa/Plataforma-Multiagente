import {
  detectDefaultBranch,
  detectStack,
  openDatabase,
  ProjectsRepo,
  resolvePaths,
  stableId,
} from "@pm/core";
import { ProjectTarget } from "@pm/contracts";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { emit, mark, type OutputOptions } from "../output.js";

/**
 * pm projeto add <pasta> [--nome <slug>] — registra um projeto EXISTENTE.
 * A plataforma opera sobre projetos reais do usuário (features, bugs, ajustes).
 */
export function projetoAdd(
  pasta: string,
  nome: string | undefined,
  opts: OutputOptions,
): number {
  const rootPath = isAbsolute(pasta) ? pasta : resolve(process.cwd(), pasta);

  if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    emit(
      { ok: false, error: `Pasta não encontrada: ${rootPath}` },
      () => `${mark.fail} Pasta não encontrada: ${rootPath}`,
      opts,
    );
    return 1;
  }

  // Nomes não-ASCII (ex.: pastas em japonês) podem gerar slug vazio — usa um
  // fallback determinístico derivado do caminho para não quebrar.
  let slug = slugify(nome ?? basename(rootPath));
  if (!slug) slug = `projeto-${stableId(rootPath).slice(0, 6)}`;
  // parse aplica os defaults do contrato (incl. permissions com deploy: false).
  const target = ProjectTarget.parse({
    slug,
    rootPath,
    kind: "registered",
    stack: detectStack(rootPath),
    defaultBranch: detectDefaultBranch(rootPath),
  });

  const db = openDatabase();
  new ProjectsRepo(db).upsert(target);
  db.close();

  // Nota mínima no vault (a memória rica chega na Camada 5).
  writeProjectNote(target);

  emit(
    target,
    () =>
      `${mark.ok} Projeto registrado: ${slug}\n` +
      `  pasta: ${rootPath}\n` +
      `  stack: ${target.stack ?? "(não detectada)"}\n` +
      `  branch principal: ${target.defaultBranch}`,
    opts,
  );
  return 0;
}

/** pm projeto list — lista os projetos registrados. */
export function projetoList(opts: OutputOptions): number {
  const db = openDatabase();
  const projects = new ProjectsRepo(db).list();
  db.close();

  emit(
    { projects },
    () => {
      if (projects.length === 0) return "Nenhum projeto registrado. Use: pm projeto add <pasta>";
      return [
        `${projects.length} projeto(s) registrado(s):`,
        ...projects.map(
          (p) => `  ${mark.ok} ${p.slug} — ${p.rootPath} (${p.stack ?? "?"})`,
        ),
      ].join("\n");
    },
    opts,
  );
  return 0;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function writeProjectNote(target: ProjectTarget): void {
  const paths = resolvePaths();
  const dir = join(paths.knowledge, "projetos", target.slug);
  mkdirSync(dir, { recursive: true });
  const note = `---
projeto: ${target.slug}
tipo: projeto-registrado
stack: ${target.stack ?? ""}
raiz: ${target.rootPath}
branch: ${target.defaultBranch}
---

# ${target.slug}

Projeto registrado na plataforma. As decisões, lições e relatórios de cada run
sobre este projeto serão acumulados aqui.
`;
  writeFileSync(join(dir, "README.md"), note, "utf8");
}
