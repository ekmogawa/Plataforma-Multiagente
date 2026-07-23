import type { FileAction } from "@pm/contracts";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { TasksRepo } from "../db/tasks-repo.js";
import { resolveInside } from "../execution/path-guard.js";

/**
 * Monta o diff AGREGADO do run para o Gatekeeper: a união dos changedFiles de
 * todas as tarefas + o conteúdo atual do disco (a working tree ainda está suja,
 * antes do WIP commit). Fonte de verdade igual à do commit final. Windows-safe.
 */
export interface GateFileChange {
  path: string;
  action: FileAction;
  content?: string; // ausente em deleted e em arquivos oversize
  sizeBytes: number;
  lineCount: number;
  oversize: boolean;
}

export interface GateInput {
  files: GateFileChange[];
  totalBytes: number;
  totalLines: number;
}

const DEFAULT_READ_CAP = 2_000_000; // 2MB por arquivo

export function buildGateInput(
  tasks: TasksRepo,
  runId: string,
  projectRoot: string,
  readCapBytes = DEFAULT_READ_CAP,
): GateInput {
  // Reúne todos os paths tocados + a última action declarada (só rótulo de apoio).
  // A VERDADE do que será commitado é o DISCO — não a sequência de actions.
  // Isso evita que um arquivo deletado-e-recriado escape do scan (o disco tem o
  // conteúdo recriado, então o `git add` o commita; o gate precisa vê-lo).
  const byPath = new Map<string, FileAction>();
  for (const t of tasks.byRun(runId)) {
    for (const c of t.result?.changedFiles ?? []) {
      byPath.set(c.path, c.action); // ordem = ordem de criação das tasks
    }
  }

  const files: GateFileChange[] = [];
  let totalBytes = 0;
  let totalLines = 0;

  for (const [path, lastAction] of [...byPath.entries()].sort()) {
    let abs: string;
    try {
      abs = resolveInside(projectRoot, path);
    } catch {
      continue; // path suspeito — ignora (o path-guard já barra na escrita)
    }
    // Ausente no disco = de fato deletado (independente da action declarada).
    if (!existsSync(abs)) {
      files.push({ path, action: "deleted", sizeBytes: 0, lineCount: 0, oversize: false });
      continue;
    }
    // Existe no disco: será commitado, então escaneia o conteúdo. Se a última
    // action dizia 'deleted' mas o arquivo existe, foi recriado -> 'modified'.
    const action: FileAction = lastAction === "deleted" ? "modified" : lastAction;
    const sizeBytes = statSync(abs).size;
    totalBytes += sizeBytes;
    if (sizeBytes > readCapBytes) {
      files.push({ path, action, sizeBytes, lineCount: 0, oversize: true });
      continue;
    }
    const content = readFileSync(abs, "utf8");
    const lineCount = content.split("\n").length;
    totalLines += lineCount;
    files.push({ path, action, content, sizeBytes, lineCount, oversize: false });
  }

  return { files, totalBytes, totalLines };
}
