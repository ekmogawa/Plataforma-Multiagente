import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../shared/logger.js";
import { resolvePaths } from "../shared/paths.js";
import { MIGRATIONS } from "./migrations.js";

export type DB = Database.Database;

/**
 * Abre o banco (criando o diretório se preciso), aplica migrações pendentes
 * e devolve a conexão. Reentrante: aplicar de novo é no-op.
 *
 * @param dbFile caminho do arquivo; omitido usa o padrão da plataforma.
 *               Passe ":memory:" para um banco efêmero (testes).
 */
export function openDatabase(dbFile?: string): DB {
  const target = dbFile ?? resolvePaths().dbFile;
  if (target !== ":memory:") {
    mkdirSync(dirname(target), { recursive: true });
  }

  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  applyMigrations(db);
  return db;
}

function applyMigrations(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRow = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
    .get() as { v: number };
  const current = appliedRow.v;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );
  if (pending.length === 0) return;

  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  const run = db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql);
      insert.run(m.version, m.name, new Date().toISOString());
      log.info(`Migração aplicada: v${m.version} (${m.name})`);
    }
  });
  run();
}

/** Versão de schema atualmente aplicada (0 se nenhuma). */
export function schemaVersion(db: DB): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
    .get() as { v: number };
  return row.v;
}
