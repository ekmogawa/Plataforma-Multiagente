import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { manualClock } from "../shared/clock.js";
import { SqliteKnowledgeStore } from "./knowledge-store.js";
import { ObsidianWriter } from "./obsidian-writer.js";
import { KnowledgeProcessor } from "./knowledge-processor.js";
import { contentTokens, extractiveSummary, jaccard, topTags } from "./text-normalize.js";

function setup() {
  const db = openDatabase(":memory:");
  const store = new SqliteKnowledgeStore(db);
  const vault = mkdtempSync(join(tmpdir(), "pm-vault-"));
  const writer = new ObsidianWriter({ vaultRoot: vault, store, clock: manualClock() });
  return { db, store, vault, writer };
}

describe("migração v6 + FTS5", () => {
  it("busca é acento-insensível (decisao ~ decisão)", () => {
    const { db, store, writer } = setup();
    writer.write({
      kind: "decisao",
      title: "Decisão de arquitetura",
      body: "Adotamos ports e adapters para trocar componentes sem tocar a lógica.",
      vaultPath: "decisoes/app/adr-1.md",
      projectSlug: "app",
    });
    const hits = store.search({ text: "decisao", processedOnly: false });
    expect(hits.length).toBe(1);
    expect(hits[0]?.title).toContain("Decisão");
    db.close();
  });
});

describe("ObsidianWriter", () => {
  it("REDIGE segredos no .md e no índice", () => {
    const { db, vault, store, writer } = setup();
    const note = writer.write({
      kind: "licao",
      title: "Config com chave",
      body: 'Nunca commitar: const API_KEY = "sk-ant-abc123def456ghi789";',
      vaultPath: "licoes/app/segredo.md",
      projectSlug: "app",
    });
    const md = readFileSync(join(vault, "licoes/app/segredo.md"), "utf8");
    expect(md).not.toContain("sk-ant-abc123def456ghi789");
    expect(md).toContain("[REDIGIDO]");
    // o índice também não tem o segredo
    expect(store.get(note.noteId)?.body).not.toContain("sk-ant-abc123");
    db.close();
  });

  it("é idempotente por hash (mesmo conteúdo -> não reescreve)", () => {
    const { db, writer } = setup();
    const a = writer.write({ kind: "projeto", title: "T", body: "corpo", vaultPath: "projetos/app/index.md", projectSlug: "app" });
    const b = writer.write({ kind: "projeto", title: "T", body: "corpo", vaultPath: "projetos/app/index.md", projectSlug: "app" });
    expect(a.hash).toBe(b.hash);
    db.close();
  });

  it("headings sobrevivem ao round-trip (index/get simétricos)", () => {
    const { db, store, writer } = setup();
    const note = writer.write({
      kind: "decisao",
      title: "ADR",
      body: "corpo",
      vaultPath: "decisoes/app/x.md",
      projectSlug: "app",
      headings: ["Contexto", "Decisão", "Consequências"],
    });
    expect(store.get(note.noteId)?.headings).toEqual(["Contexto", "Decisão", "Consequências"]);
    db.close();
  });
});

describe("SqliteKnowledgeStore.search", () => {
  it("filtro por projeto inclui o global; kinds e score maior=melhor", () => {
    const { db, store, writer } = setup();
    writer.write({ kind: "licao", title: "Lição do app sobre cache", body: "cache invalida por hash do prompt", vaultPath: "licoes/app/a.md", projectSlug: "app" });
    writer.write({ kind: "licao", title: "Lição global sobre cache", body: "cache reduz custo de tokens", vaultPath: "licoes/g.md" /* global */ });
    writer.write({ kind: "decisao", title: "Decisão sem relação", body: "usar sqlite", vaultPath: "decisoes/app/d.md", projectSlug: "app" });

    const hits = store.search({ text: "cache", projectSlug: "app", kinds: ["licao"], processedOnly: false, limit: 10 });
    expect(hits.length).toBe(2); // app + global, ambos kind licao
    expect(hits.every((h) => typeof h.score === "number")).toBe(true);
    // decisão (kind diferente) não entra
    expect(hits.some((h) => h.title.includes("Decisão"))).toBe(false);
    db.close();
  });

  it("processedOnly filtra as não-destiladas", () => {
    const { db, store, writer } = setup();
    writer.write({ kind: "licao", title: "bruta", body: "assunto x", vaultPath: "licoes/app/b.md", projectSlug: "app", processed: false });
    writer.write({ kind: "licao", title: "destilada", body: "assunto x", vaultPath: "licoes/app/c.md", projectSlug: "app", processed: true });
    expect(store.search({ text: "assunto", processedOnly: true }).length).toBe(1);
    expect(store.search({ text: "assunto", processedOnly: false }).length).toBe(2);
    db.close();
  });
});

describe("KnowledgeProcessor (offline, não-destrutivo)", () => {
  it("marca processado e liga notas relacionadas sem apagar nada", () => {
    const { db, store, writer } = setup();
    // duas lições muito parecidas -> devem ser LIGADAS (não fundidas/apagadas)
    writer.write({ kind: "licao", title: "Retry e escalonamento", body: "quando a tarefa falha varias vezes ela escala para o auditor final revisar", vaultPath: "licoes/app/l1.md", projectSlug: "app" });
    writer.write({ kind: "licao", title: "Escalonamento no retry", body: "quando a tarefa falha varias vezes ela escala para o auditor final revisar de novo", vaultPath: "licoes/app/l2.md", projectSlug: "app" });

    const before = store.listByProject("app").length;
    const res = new KnowledgeProcessor({ store, writer }).process({});
    expect(res.processed).toBe(2);
    // nada foi apagado
    expect(store.listByProject("app").length).toBe(before);
    // ambas ficaram processadas e ao menos uma ganhou wikilink para a outra
    const l1 = store.get("licoes:app:l1");
    expect(l1?.processed).toBe(true);
    expect(res.linked).toBeGreaterThan(0);
    db.close();
  });
});

describe("text-normalize", () => {
  it("jaccard, tags e resumo extrativo são determinísticos", () => {
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(2 / 4, 5);
    expect(contentTokens("o cache reduz o custo de tokens")).toEqual(["cache", "reduz", "custo", "tokens"]);
    const tags = topTags("cache cache tokens tokens tokens custo", 2);
    expect(tags[0]).toBe("tokens"); // mais frequente primeiro
    const s = extractiveSummary("Frase um sem peso. O cache reduz o custo de tokens de forma clara. Outra frase.", 1);
    expect(s.length).toBeGreaterThan(0);
  });
});
