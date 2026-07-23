/**
 * Migrações do banco. Cada entrada é aplicada em ordem, uma única vez,
 * registrada em schema_migrations. Migrações são imutáveis — para mudar o
 * schema, adicione uma nova entrada, nunca edite uma existente.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "estado-inicial",
    sql: /* sql */ `
      CREATE TABLE runs (
        id            TEXT PRIMARY KEY,
        request_id    TEXT,
        state         TEXT NOT NULL,
        strategy_json TEXT,
        budget_tokens INTEGER NOT NULL DEFAULT 0,
        spent_tokens  INTEGER NOT NULL DEFAULT 0,
        cost_usd      REAL NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id                TEXT PRIMARY KEY,
        run_id            TEXT NOT NULL,
        state             TEXT NOT NULL,
        attempt           INTEGER NOT NULL DEFAULT 0,
        depends_remaining INTEGER NOT NULL DEFAULT 0,
        spec_json         TEXT NOT NULL,
        result_json       TEXT,
        not_before        TEXT,
        lease_expires     TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );
      CREATE INDEX idx_tasks_run_state ON tasks(run_id, state);

      -- Arestas de dependência do DAG (para resume e inspeção).
      CREATE TABLE task_edges (
        run_id    TEXT NOT NULL,
        from_task TEXT NOT NULL,
        to_task   TEXT NOT NULL,
        PRIMARY KEY (run_id, from_task, to_task)
      );

      CREATE TABLE metric_events (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        ts             TEXT NOT NULL,
        kind           TEXT NOT NULL,
        run_id         TEXT,
        task_id        TEXT,
        model          TEXT,
        prompt_id      TEXT,
        prompt_version INTEGER,
        tokens_in      INTEGER,
        tokens_out     INTEGER,
        cost_usd       REAL,
        duration_ms    INTEGER,
        success        INTEGER,
        meta_json      TEXT
      );
      CREATE INDEX idx_metrics_run ON metric_events(run_id);
      CREATE INDEX idx_metrics_kind ON metric_events(kind);

      -- Cache de respostas de modelo, chaveado por hash do prompt.
      CREATE TABLE cache (
        key         TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "projetos-e-artefatos",
    sql: /* sql */ `
      -- Projetos registrados na plataforma (a plataforma opera sobre eles).
      CREATE TABLE projects (
        slug           TEXT PRIMARY KEY,
        root_path      TEXT NOT NULL,
        kind           TEXT NOT NULL,          -- registered | new
        stack          TEXT,
        default_branch TEXT NOT NULL DEFAULT 'main',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      -- Índice do Artifact Store. Conteúdo vive em workspace/runs/<run-id>/.
      -- Princípio: toda informação produzida é persistida/reproduzível.
      CREATE TABLE artifacts (
        id         TEXT PRIMARY KEY,
        run_id     TEXT NOT NULL,
        task_id    TEXT,
        kind       TEXT NOT NULL,
        path       TEXT NOT NULL,
        hash       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        meta_json  TEXT
      );
      CREATE INDEX idx_artifacts_run ON artifacts(run_id);
      CREATE INDEX idx_artifacts_task ON artifacts(task_id);
      CREATE INDEX idx_artifacts_kind ON artifacts(kind);
    `,
  },
  {
    version: 3,
    name: "eventos-persistentes-e-seguranca",
    sql: /* sql */ `
      -- Log persistente de eventos: sobrevive a reinícios e permite
      -- recuperação/replay. Idempotente por event_id (INSERT OR IGNORE).
      CREATE TABLE events (
        event_id    TEXT PRIMARY KEY,
        event_type  TEXT NOT NULL,
        run_id      TEXT,
        task_id     TEXT,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        processed   INTEGER NOT NULL DEFAULT 0,
        attempts    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_events_processed ON events(processed);
      CREATE INDEX idx_events_run ON events(run_id);

      -- Classificação de sensibilidade dos artefatos.
      ALTER TABLE artifacts ADD COLUMN classification TEXT NOT NULL DEFAULT 'project-internal';

      -- Permissões da plataforma sobre cada projeto (deploy nasce falso).
      ALTER TABLE projects ADD COLUMN permissions_json TEXT;
    `,
  },
  {
    version: 4,
    name: "runs-projeto-e-workkind",
    sql: /* sql */ `
      -- Todo run da Camada 1 opera sobre um projeto e tem um tipo de trabalho.
      -- Colunas nullable: runs legados ficam NULL (mapRow tolera).
      ALTER TABLE runs ADD COLUMN project_slug TEXT;
      ALTER TABLE runs ADD COLUMN work_kind TEXT;
      CREATE INDEX idx_runs_project ON runs(project_slug);
    `,
  },
  {
    version: 5,
    name: "tasks-pk-por-run",
    sql: /* sql */ `
      -- Ids de tarefa são POSICIONAIS (n1, n1.1...) e só são únicos DENTRO de um
      -- run. A PK precisa ser composta (run_id, id) — senão o 2º run colide.
      CREATE TABLE tasks_new (
        id                TEXT NOT NULL,
        run_id            TEXT NOT NULL,
        state             TEXT NOT NULL,
        attempt           INTEGER NOT NULL DEFAULT 0,
        depends_remaining INTEGER NOT NULL DEFAULT 0,
        spec_json         TEXT NOT NULL,
        result_json       TEXT,
        not_before        TEXT,
        lease_expires     TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (run_id, id),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );
      INSERT INTO tasks_new SELECT
        id, run_id, state, attempt, depends_remaining, spec_json, result_json,
        not_before, lease_expires, created_at, updated_at FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX idx_tasks_run_state ON tasks(run_id, state);
    `,
  },
  {
    version: 6,
    name: "conhecimento-fts5-e-evolucao",
    sql: /* sql */ `
      -- Índice da memória: tabela-fonte + FTS5 external-content sincronizada por
      -- triggers (a sincronia fica infalível; o corpo é guardado UMA vez). O
      -- markdown no vault é a verdade legível; esta tabela é o índice da IA.
      CREATE TABLE knowledge_notes (
        rowid        INTEGER PRIMARY KEY,
        note_id      TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL,            -- projeto|decisao|licao|grafo
        title        TEXT NOT NULL,
        body         TEXT NOT NULL,            -- markdown redigido, sem frontmatter
        tags         TEXT NOT NULL DEFAULT '', -- espaço-separado
        headings     TEXT NOT NULL DEFAULT '',
        project_slug TEXT,                     -- NULL = global
        run_id       TEXT,
        vault_path   TEXT NOT NULL,
        wikilinks    TEXT NOT NULL DEFAULT '',
        processed    INTEGER NOT NULL DEFAULT 0,
        hash         TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_know_project ON knowledge_notes(project_slug);
      CREATE INDEX idx_know_kind    ON knowledge_notes(kind);
      CREATE INDEX idx_know_proc    ON knowledge_notes(processed);

      -- unicode61 remove_diacritics 2 = busca acento-insensível pt-BR
      -- ("decisao" casa "decisão"). NUNCA porter (stemming inglês).
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        title, headings, body, tags,
        content='knowledge_notes',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER know_ai AFTER INSERT ON knowledge_notes BEGIN
        INSERT INTO knowledge_fts(rowid, title, headings, body, tags)
        VALUES (new.rowid, new.title, new.headings, new.body, new.tags);
      END;
      CREATE TRIGGER know_ad AFTER DELETE ON knowledge_notes BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, headings, body, tags)
        VALUES ('delete', old.rowid, old.title, old.headings, old.body, old.tags);
      END;
      CREATE TRIGGER know_au AFTER UPDATE ON knowledge_notes BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, headings, body, tags)
        VALUES ('delete', old.rowid, old.title, old.headings, old.body, old.tags);
        INSERT INTO knowledge_fts(rowid, title, headings, body, tags)
        VALUES (new.rowid, new.title, new.headings, new.body, new.tags);
      END;

      -- Propostas de auto-evolução (cross-run, por isso fora do Artifact Store).
      -- Rastreabilidade: evidence_json aponta para os metric_events que embasam.
      CREATE TABLE evolution_proposals (
        id             TEXT PRIMARY KEY,
        created_at     TEXT NOT NULL,
        target_kind    TEXT NOT NULL,
        target_file    TEXT NOT NULL,
        target_locator TEXT NOT NULL,
        category       TEXT NOT NULL,
        rationale      TEXT NOT NULL,
        diff           TEXT NOT NULL,
        evidence_json  TEXT NOT NULL,
        confidence     TEXT NOT NULL,
        source         TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'proposed'
      );
      CREATE INDEX idx_evolution_status  ON evolution_proposals(status);
      CREATE INDEX idx_evolution_locator ON evolution_proposals(target_locator);
    `,
  },
];
