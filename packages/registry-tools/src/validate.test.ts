import { describe, expect, it } from "vitest";
import { validateRegistry } from "./validate.js";

describe("validateRegistry", () => {
  it("o registro versionado é válido", () => {
    const result = validateRegistry();
    if (!result.ok) {
      // Mostra os erros para diagnóstico se falhar.
      throw new Error(`Registro inválido:\n${result.errors.join("\n")}`);
    }
    expect(result.ok).toBe(true);
    expect(result.stats.components).toBeGreaterThan(0);
    expect(result.stats.relations).toBeGreaterThan(0);
    expect(result.stats.pipelines).toBeGreaterThan(0);
  });
});
