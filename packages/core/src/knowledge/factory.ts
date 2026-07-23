import type { DB } from "../db/database.js";
import type { Clock } from "../shared/clock.js";
import { resolvePaths } from "../shared/paths.js";
import { GraphifyWorker } from "./graphify-worker.js";
import { KnowledgeProcessor } from "./knowledge-processor.js";
import { SqliteKnowledgeStore } from "./knowledge-store.js";
import { ObsidianWriter } from "./obsidian-writer.js";

/**
 * Monta a pilha determinística de conhecimento (store + writer + processor +
 * graphify) sobre o vault do repo. O KnowledgeManager (que assina o Event Bus) é
 * montado onde o bus existe (o approve), reusando esta pilha.
 */
export interface KnowledgeStack {
  store: SqliteKnowledgeStore;
  writer: ObsidianWriter;
  processor: KnowledgeProcessor;
  graphify: GraphifyWorker;
  vaultRoot: string;
}

export function knowledgeStack(db: DB, clock: Clock, root?: string): KnowledgeStack {
  const paths = resolvePaths(root);
  const store = new SqliteKnowledgeStore(db);
  const writer = new ObsidianWriter({ vaultRoot: paths.knowledge, store, clock });
  const processor = new KnowledgeProcessor({ store, writer });
  const graphify = new GraphifyWorker({ writer, vaultRoot: paths.knowledge });
  return { store, writer, processor, graphify, vaultRoot: paths.knowledge };
}
