import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { manualClock } from "../shared/clock.js";
import { GraphifyWorker, collectFiles } from "./graphify-worker.js";
import { SqliteKnowledgeStore } from "./knowledge-store.js";
import { ObsidianWriter } from "./obsidian-writer.js";

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "pm-graph-proj-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), 'import { b } from "./b.js";\nexport const a = b + 1;\n');
  writeFileSync(join(root, "src/b.ts"), "export const b = 1;\n");
  writeFileSync(join(root, "node_modules/dep/index.js"), "module.exports = 1;\n"); // deve ser ignorado
  return root;
}

describe("Graphify", () => {
  it("gera index.md com mermaid + graph.json a partir dos imports", () => {
    const db = openDatabase(":memory:");
    const store = new SqliteKnowledgeStore(db);
    const vault = mkdtempSync(join(tmpdir(), "pm-graph-vault-"));
    const writer = new ObsidianWriter({ vaultRoot: vault, store, clock: manualClock() });
    const projectRoot = makeProject();

    const res = new GraphifyWorker({ writer, vaultRoot: vault }).run({ slug: "app", projectRoot });
    expect(res.files).toBe(2); // src/a.ts e src/b.ts (node_modules ignorado)
    expect(res.edges).toBe(1); // a -> b

    const md = readFileSync(join(vault, "grafos/app/index.md"), "utf8");
    expect(md).toContain("```mermaid");
    expect(md).toContain("src/a.ts");
    const graphJson = JSON.parse(readFileSync(join(vault, "grafos/app/graph.json"), "utf8"));
    expect(graphJson.adjacency["src/a.ts"]).toContain("src/b.ts");
    db.close();
  });

  it("collectFiles ignora node_modules e respeita o teto", () => {
    const root = makeProject();
    const all = collectFiles(root, 100);
    expect(all.files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(all.truncated).toBe(false);
    const capped = collectFiles(root, 1);
    expect(capped.files.length).toBe(1);
    expect(capped.truncated).toBe(true);
  });

  it("collectFiles NÃO segue symlink de diretório (evita ciclo infinito)", () => {
    const root = makeProject();
    // junction/symlink auto-referente: src/self -> src. Sem privilégio no Windows
    // a criação falha; nesse caso o teste é pulado (não há o que provar).
    let created = false;
    try {
      symlinkSync(join(root, "src"), join(root, "src", "self"), "junction");
      created = true;
    } catch {
      try {
        symlinkSync(join(root, "src"), join(root, "src", "self"), "dir");
        created = true;
      } catch {
        /* sem privilégio de symlink — pula */
      }
    }
    if (!created) return;
    // Se o walk seguisse o symlink, isto entraria em recursão infinita.
    const res = collectFiles(root, 100);
    expect(res.files).toEqual(["src/a.ts", "src/b.ts"]); // o symlink foi ignorado
  });
});
