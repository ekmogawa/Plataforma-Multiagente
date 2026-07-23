import type { ModelsConfig } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import { CapabilityResolver, UnknownCapabilityError } from "./capability-resolver.js";

const cfg: ModelsConfig = {
  providers: {
    omnirouter: { protocol: "openai", apiKeyEnv: "K" },
    anthropic: { protocol: "claude-agent-sdk" },
  },
  models: {
    "deepseek-flash": { provider: "omnirouter", model: "df", tier: "cheap" },
    glm: { provider: "omnirouter", model: "glm", tier: "mid" },
    "qwen-max": { provider: "omnirouter", model: "qwen", tier: "mid" },
    "claude-code": { provider: "anthropic", model: "sub", tier: "premium" },
  },
  capabilities: {
    understanding: { default: "glm", "complexity>=4": "claude-code" },
    planner: { default: "claude-code" },
  },
  fallbacks: { "claude-code": ["qwen-max"] },
};

describe("CapabilityResolver", () => {
  const resolver = new CapabilityResolver(cfg);

  it("usa o default quando nenhuma condição casa", () => {
    expect(resolver.resolve("understanding", { complexity: 2 }).model).toBe("glm");
  });

  it("aplica condição de complexidade", () => {
    expect(resolver.resolve("understanding", { complexity: 5 }).model).toBe(
      "claude-code",
    );
  });

  it("respeita o teto de tier via fallback", () => {
    // planner=claude-code (premium); teto mid -> cai para qwen-max (mid).
    const d = resolver.resolve("planner", { tierCeiling: "mid" });
    expect(d.model).toBe("qwen-max");
    expect(d.reason).toContain("teto");
  });

  it("lança em capacidade desconhecida", () => {
    expect(() => resolver.resolve("inexistente")).toThrow(UnknownCapabilityError);
  });

  it("regra de diversidade: troca o modelo excluído pelo fallback (autor≠revisor)", () => {
    // planner=claude-code; excluindo claude-code -> cai para qwen-max (fallback).
    const d = resolver.resolve("planner", { exclude: ["claude-code"] });
    expect(d.model).toBe("qwen-max");
    expect(d.reason).toContain("diversidade");
  });

  it("diversidade sem alternativa mantém o modelo e registra", () => {
    // understanding=glm; glm não tem fallback configurado neste fixture.
    const d = resolver.resolve("understanding", { exclude: ["glm"] });
    expect(d.model).toBe("glm");
    expect(d.reason).toContain("sem alternativa");
  });
});
