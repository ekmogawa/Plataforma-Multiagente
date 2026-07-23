import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redaction.js";

describe("redactSecrets", () => {
  it("redige chaves de API conhecidas", () => {
    const r = redactSecrets("use a chave sk-abc123def456ghi789jkl012 para chamar");
    expect(r.count).toBe(1);
    expect(r.text).not.toContain("sk-abc123def456ghi789jkl012");
    expect(r.text).toContain("[REDIGIDO]");
  });

  it("redige atribuições de senha/token", () => {
    const r = redactSecrets('API_KEY="minhachavesecreta123"\nsenha: hunter2hunter2');
    expect(r.count).toBe(2);
    expect(r.text).not.toContain("minhachavesecreta123");
    expect(r.text).not.toContain("hunter2hunter2");
  });

  it("redige blocos de chave privada PEM", () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----";
    const r = redactSecrets(`config:\n${pem}\nfim`);
    expect(r.count).toBe(1);
    expect(r.text).not.toContain("MIIEvQIBADANBg");
  });

  it("redige segredos rotulados em JSON (chave entre aspas)", () => {
    const r = redactSecrets('{ "password": "hunter2secret", "apiKey": "chaveopaca12345" }');
    expect(r.text).not.toContain("hunter2secret");
    expect(r.text).not.toContain("chaveopaca12345");
    expect(r.count).toBe(2);
  });

  it("redige credenciais embutidas em URL", () => {
    const r = redactSecrets("DATABASE_URL=postgres://user:s3nh4secreta@db.host:5432/app");
    expect(r.text).not.toContain("s3nh4secreta");
    expect(r.text).toContain("postgres://user:[REDIGIDO]@db.host");
    expect(r.count).toBeGreaterThanOrEqual(1);
  });

  it("não altera texto comum", () => {
    const original = "função que soma dois números e retorna o resultado";
    const r = redactSecrets(original);
    expect(r.count).toBe(0);
    expect(r.text).toBe(original);
  });
});
