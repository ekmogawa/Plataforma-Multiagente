import type {
  Artifact,
  ArtifactClassification,
  ArtifactKind,
} from "@pm/contracts";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { DB } from "../db/database.js";
import { resolvePaths } from "../shared/paths.js";
import { redactSecrets } from "../shared/redaction.js";

/**
 * Artifact Store — materializa o princípio "toda informação produzida é
 * persistida ou reproduzível". Grava o conteúdo em
 * workspace/runs/<run-id>/artifacts/ e indexa no banco, identificável por
 * run_id + task_id. O Knowledge Manager e o modo replay leem daqui.
 */
export class ArtifactStore {
  private readonly runsDir: string;
  private readonly root: string;

  constructor(
    private readonly db: DB,
    root?: string,
  ) {
    const paths = resolvePaths(root);
    this.runsDir = paths.runs;
    this.root = paths.root;
  }

  /**
   * Grava um artefato de texto. Segredos são redigidos ANTES da persistência
   * (princípio: segredos nunca entram em artefatos ou logs).
   */
  store(input: {
    runId: string;
    taskId?: string;
    kind: ArtifactKind;
    /** Nome-base do arquivo (com ou sem extensão). */
    name: string;
    content: string;
    classification?: ArtifactClassification;
    meta?: Record<string, unknown>;
  }): Artifact {
    const id = `art_${randomUUID().slice(0, 8)}`;
    const fileName = input.name.includes(".")
      ? `${id}-${input.name}`
      : `${id}-${input.name}.${extFor(input.kind)}`;
    const absPath = join(this.runsDir, input.runId, "artifacts", fileName);
    mkdirSync(dirname(absPath), { recursive: true });

    const redaction = redactSecrets(input.content);
    writeFileSync(absPath, redaction.text, "utf8");

    const hash = createHash("sha256").update(redaction.text).digest("hex");
    const relPath = relative(this.root, absPath).split("\\").join("/");
    const createdAt = new Date().toISOString();
    const classification = input.classification ?? "project-internal";
    const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
    if (redaction.count > 0) meta.redactions = redaction.count;

    this.db
      .prepare(
        `INSERT INTO artifacts (id, run_id, task_id, kind, path, hash, classification, created_at, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.taskId ?? null,
        input.kind,
        relPath,
        hash,
        classification,
        createdAt,
        JSON.stringify(meta),
      );

    return {
      id,
      runId: input.runId,
      taskId: input.taskId,
      kind: input.kind,
      path: relPath,
      hash,
      classification,
      createdAt,
      meta,
    };
  }

  /** Conveniência: grava um objeto como JSON. */
  storeJson(input: {
    runId: string;
    taskId?: string;
    kind: ArtifactKind;
    name: string;
    data: unknown;
    meta?: Record<string, unknown>;
  }): Artifact {
    return this.store({
      ...input,
      name: input.name.endsWith(".json") ? input.name : `${input.name}.json`,
      content: JSON.stringify(input.data, null, 2),
    });
  }

  get(id: string): Artifact | undefined {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** Lê o conteúdo bruto de um artefato pelo id. */
  readContent(id: string): string | undefined {
    const art = this.get(id);
    if (!art) return undefined;
    return readFileSync(join(this.root, art.path), "utf8");
  }

  listByRun(runId: string): Artifact[] {
    const rows = this.db
      .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at")
      .all(runId) as Record<string, unknown>[];
    return rows.map(mapRow);
  }
}

function extFor(kind: ArtifactKind): string {
  switch (kind) {
    case "plan":
    case "dag":
    case "response":
    case "report":
    case "test-result":
    case "project-map":
    case "decision":
    case "event":
    case "context":
    case "planned-tasks":
    case "gate-review":
    case "approval":
      return "json";
    case "diff":
    case "patch":
      return "diff";
    case "prompt":
      return "md";
    case "log":
    case "evidence":
    default:
      return "txt";
  }
}

function mapRow(row: Record<string, unknown>): Artifact {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    taskId: (row.task_id as string | null) ?? undefined,
    kind: row.kind as ArtifactKind,
    path: row.path as string,
    hash: row.hash as string,
    classification:
      (row.classification as ArtifactClassification | null) ?? "project-internal",
    createdAt: row.created_at as string,
    meta: row.meta_json ? (JSON.parse(row.meta_json as string) as Record<string, unknown>) : {},
  };
}
