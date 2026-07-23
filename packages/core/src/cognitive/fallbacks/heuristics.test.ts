import { describe, expect, it } from "vitest";
import {
  anyMatch,
  countMatches,
  extractMentionedArtifacts,
  wordMatch,
} from "./heuristics.js";

describe("wordMatch (fronteira de palavra)", () => {
  it("radical (>=4) casa por prefixo de palavra, não por substring", () => {
    expect(wordMatch("definir a senha do usuário", "senha")).toBe(true);
    // NÃO deve casar "senha" dentro de "desenhar"
    expect(wordMatch("desenhar a tela inicial", "senha")).toBe(false);
    expect(wordMatch("fazer a migração do banco", "migra")).toBe(true);
  });

  it("needle curto (<4) exige palavra exata", () => {
    expect(wordMatch("criar uma api rest", "api")).toBe(true);
    expect(wordMatch("sessão de terapia", "api")).toBe(false);
    expect(wordMatch("uma cli simples", "cli")).toBe(true);
    expect(wordMatch("cadastro de cliente", "cli")).toBe(false);
  });

  it("'tela' não casa dentro de 'prateleira'", () => {
    expect(wordMatch("organizar a prateleira", "tela")).toBe(false);
    expect(wordMatch("mudar a tela inicial", "tela")).toBe(true);
  });

  it("needle com espaço casa como frase", () => {
    expect(wordMatch("alterar o banco de dados", "banco de dados")).toBe(true);
    expect(wordMatch("um banco no parque", "banco de dados")).toBe(false);
  });

  it("countMatches e anyMatch usam a mesma regra", () => {
    expect(countMatches("desenhar a tela", ["senha", "tela"])).toBe(1);
    expect(anyMatch("desenhar a tela", ["senha"])).toBe(false);
  });

  it("countMatches conta tokens distintos (sinônimos não dobram a mesma palavra)", () => {
    // "migração" casa "migra" E "migration", mas é uma só palavra -> conta 1.
    expect(countMatches("fazer a migração agora", ["migra", "migration"])).toBe(1);
    // duas palavras distintas -> conta 2.
    expect(countMatches("login e senha", ["login", "senha"])).toBe(2);
  });
});

describe("extractMentionedArtifacts", () => {
  it("captura arquivos e caminhos com extensão de arquivo", () => {
    const arts = extractMentionedArtifacts(
      "editar src/app.ts e config/models.yaml e o Login.tsx",
    );
    expect(arts).toContain("src/app.ts");
    expect(arts).toContain("config/models.yaml");
    expect(arts).toContain("Login.tsx");
  });

  it("NÃO captura datas, versões nem pares sem extensão", () => {
    const arts = extractMentionedArtifacts(
      "entregar até 21/07/2026 a arquitetura cliente/servidor na versão 3.24",
    );
    expect(arts).not.toContain("21/07/2026");
    expect(arts).not.toContain("cliente/servidor");
    expect(arts).not.toContain("3.24");
  });
});
