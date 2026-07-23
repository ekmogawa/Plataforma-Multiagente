import { describe, expect, it } from "vitest";
import { openDatabase, schemaVersion } from "./database.js";
import { MetricsRepo } from "./metrics-repo.js";
import { CacheRepo } from "./cache-repo.js";

describe("banco em memória", () => {
  it("aplica migrações e sobe a versão de schema", () => {
    const db = openDatabase(":memory:");
    expect(schemaVersion(db)).toBeGreaterThan(0);
    db.close();
  });

  it("MetricsRepo grava e conta eventos", () => {
    const db = openDatabase(":memory:");
    const repo = new MetricsRepo(db);
    expect(repo.count()).toBe(0);
    repo.record({
      ts: new Date().toISOString(),
      kind: "llm_call",
      model: "deepseek-flash",
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.0001,
      durationMs: 123,
      success: true,
      meta: {},
    });
    expect(repo.count()).toBe(1);
    expect(repo.totalCostUsd()).toBeCloseTo(0.0001, 6);
    db.close();
  });

  it("CacheRepo faz round-trip por chave", () => {
    const db = openDatabase(":memory:");
    const cache = new CacheRepo(db);
    const key = CacheRepo.keyFor({ model: "m", system: "s", user: "u" });
    expect(cache.get(key)).toBeUndefined();
    cache.set(key, { answer: 42 });
    expect(cache.get<{ answer: number }>(key)?.answer).toBe(42);
    db.close();
  });
});
