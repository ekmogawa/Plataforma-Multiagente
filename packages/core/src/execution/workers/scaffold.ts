import type {
  ChangedFile,
  CodeFileChange,
  ExecutionResult,
  ProjectTarget,
} from "@pm/contracts";
import { readdirSync } from "node:fs";
import { applyChangeSet } from "../apply-changeset.js";
import type { ExecutorInput, ExecutorPort } from "../executor-port.js";

/**
 * worker.scaffold — cria o esqueleto de um projeto novo (Node ESM + TypeScript)
 * num diretório vazio, via applyChangeSet (mesmo caminho seguro do worker.llm).
 * Zero tokens, offline. Recusa sobrescrever um diretório não-vazio.
 */
const TEMPLATE: CodeFileChange[] = [
  {
    path: "package.json",
    action: "created",
    content: JSON.stringify(
      {
        name: "novo-projeto",
        version: "0.1.0",
        type: "module",
        scripts: { test: "node --test", build: "tsc" },
      },
      null,
      2,
    ) + "\n",
  },
  {
    path: "tsconfig.json",
    action: "created",
    content: JSON.stringify(
      { compilerOptions: { module: "NodeNext", target: "ES2022", strict: true, outDir: "dist" } },
      null,
      2,
    ) + "\n",
  },
  { path: "src/index.js", action: "created", content: "export const ok = true;\n" },
];

export function scaffoldProject(target: ProjectTarget): ChangedFile[] {
  const entries = readdirSync(target.rootPath).filter((e) => e !== ".git");
  if (entries.length > 0) {
    throw new Error(`scaffold recusado: ${target.rootPath} não está vazio.`);
  }
  return applyChangeSet(TEMPLATE, target);
}

export class ScaffoldWorker implements ExecutorPort {
  readonly id = "worker.scaffold";
  readonly kind = "deterministic" as const;

  constructor(private readonly target: ProjectTarget) {}

  async execute(input: ExecutorInput): Promise<ExecutionResult> {
    const changed = scaffoldProject(this.target);
    return {
      taskId: input.spec.id,
      attempt: input.attempt,
      status: "success",
      changedFiles: changed,
      logs: `scaffold: ${changed.length} arquivo(s) criados`,
      durationMs: 0,
    };
  }
}
