import type { ChangedFile, CodeFileChange, ProjectTarget } from "@pm/contracts";
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertNoSymlinkParent, assertNotSymlink, PathEscapeError, resolveInside } from "./path-guard.js";

/**
 * applyChangeSet — o ÚNICO serviço que escreve a saída do modelo (ou do scaffold)
 * no projeto alvo. FASE 1 (all-or-nothing): valida TODOS os caminhos (confina no
 * rootPath, recusa symlink de pai OU de folha, recusa deletar diretório) SEM
 * tocar no disco. FASE 2: escreve. Se a fase 2 falhar no meio, lança
 * ApplyChangeSetError com a lista do que JÁ foi tocado (o run roda em branch git
 * própria — o backstop de rollback é descartar a branch). Reusado por worker.llm
 * e worker.scaffold.
 */
export class PermissionDeniedError extends Error {}
export class ApplyChangeSetError extends Error {
  constructor(
    message: string,
    readonly written: ChangedFile[],
  ) {
    super(message);
    this.name = "ApplyChangeSetError";
  }
}

export function applyChangeSet(files: CodeFileChange[], target: ProjectTarget): ChangedFile[] {
  if (!target.permissions.write) {
    throw new PermissionDeniedError(`Projeto "${target.slug}" sem permissão de escrita.`);
  }
  const root = target.rootPath;

  // Fase 1: valida todos os caminhos (lança antes de tocar no disco).
  const planned = files.map((f) => {
    const abs = resolveInside(root, f.path);
    assertNoSymlinkParent(root, abs);
    if (f.action === "deleted") {
      if (existsSync(abs) && lstatSync(abs).isDirectory()) {
        throw new PathEscapeError(`recusando deletar diretório via changeset: ${f.path}`);
      }
    } else {
      assertNotSymlink(abs); // não sobrescreve/segue symlink-folha
    }
    return { f, abs };
  });

  // Fase 2: aplica; em erro, anexa o que já foi escrito.
  const changed: ChangedFile[] = [];
  try {
    for (const { f, abs } of planned) {
      if (f.action === "deleted") {
        if (existsSync(abs)) {
          rmSync(abs, { force: true });
          changed.push({ path: f.path, action: "deleted" });
        }
        continue;
      }
      const existed = existsSync(abs);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content ?? "", "utf8");
      changed.push({ path: f.path, action: existed ? "modified" : "created" });
    }
  } catch (err) {
    throw new ApplyChangeSetError(
      `falha ao aplicar mudanças (${changed.length} arquivo(s) já tocados): ${err instanceof Error ? err.message : String(err)}`,
      changed,
    );
  }
  return changed;
}
