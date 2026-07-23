import type { ProjectTarget } from "@pm/contracts";
import type { DB } from "./database.js";

/**
 * Projetos registrados na plataforma. A plataforma opera **sobre** eles
 * (features, bugs, refatorações), então cada run aponta para um projeto.
 */
export class ProjectsRepo {
  constructor(private readonly db: DB) {}

  upsert(p: ProjectTarget): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO projects (slug, root_path, kind, stack, default_branch, permissions_json, created_at, updated_at)
         VALUES (@slug, @root_path, @kind, @stack, @default_branch, @permissions_json, @now, @now)
         ON CONFLICT(slug) DO UPDATE SET
           root_path = excluded.root_path,
           kind = excluded.kind,
           stack = excluded.stack,
           default_branch = excluded.default_branch,
           permissions_json = excluded.permissions_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        slug: p.slug,
        root_path: p.rootPath,
        kind: p.kind,
        stack: p.stack ?? null,
        default_branch: p.defaultBranch,
        permissions_json: JSON.stringify(p.permissions),
        now,
      });
  }

  get(slug: string): ProjectTarget | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(): ProjectTarget[] {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY slug")
      .all() as Record<string, unknown>[];
    return rows.map(mapRow);
  }
}

function mapRow(row: Record<string, unknown>): ProjectTarget {
  const defaultPermissions = { read: true, write: true, deploy: false };
  return {
    slug: row.slug as string,
    rootPath: row.root_path as string,
    kind: row.kind as "registered" | "new",
    stack: (row.stack as string | null) ?? undefined,
    defaultBranch: row.default_branch as string,
    permissions: row.permissions_json
      ? (JSON.parse(row.permissions_json as string) as typeof defaultPermissions)
      : defaultPermissions,
  };
}
