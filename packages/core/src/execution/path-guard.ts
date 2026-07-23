import { existsSync, lstatSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";

/**
 * path-guard — confinamento de caminhos no projeto alvo. Impede que a saída do
 * modelo (ou um scaffold) escreva fora do rootPath. Windows-safe.
 */
export class PathEscapeError extends Error {}

/** Resolve `rel` sob `root`, lançando se escapar. Não toca no disco. */
export function resolveInside(root: string, rel: string): string {
  if (rel.includes("\0")) throw new PathEscapeError(`NUL no caminho: ${JSON.stringify(rel)}`);
  if (isAbsolute(rel) || /^[a-zA-Z]:[\\/]/.test(rel) || /^[\\/]{2}/.test(rel)) {
    throw new PathEscapeError(`caminho deve ser relativo (sem raiz/drive/UNC): ${rel}`);
  }
  if (rel.split(/[\\/]/).includes("..")) {
    throw new PathEscapeError(`'..' não permitido: ${rel}`);
  }
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new PathEscapeError(`caminho escapa do projeto: ${rel}`);
  }
  return abs;
}

export function isInside(root: string, rel: string): boolean {
  try {
    resolveInside(root, rel);
    return true;
  } catch {
    return false;
  }
}

export function assertInside(root: string, rel: string): void {
  resolveInside(root, rel);
}

/**
 * Recusa se o ALVO já existe e é um symlink (escrever seguiria o link para fora
 * do projeto). Se não existe, ok (será criado). Complementa assertNoSymlinkParent.
 */
export function assertNotSymlink(abs: string): void {
  try {
    if (lstatSync(abs).isSymbolicLink()) {
      throw new PathEscapeError(`o alvo é um symlink: ${abs}`);
    }
  } catch (err) {
    if (err instanceof PathEscapeError) throw err;
    // ENOENT (não existe) → tudo bem.
  }
}

/**
 * Recusa se algum diretório-pai EXISTENTE (de root até o alvo) for symlink —
 * evita um symlink pré-existente redirecionar a escrita para fora do projeto.
 */
export function assertNoSymlinkParent(root: string, absTarget: string): void {
  const rootAbs = resolve(root);
  let cur = dirname(absTarget);
  while (cur.startsWith(rootAbs)) {
    if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) {
      throw new PathEscapeError(`diretório-pai é symlink: ${cur}`);
    }
    if (cur === rootAbs) break;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
}
