import { describe, expect, it } from "vitest";
import { loadStrategiesConfig } from "../shared/config.js";
import { selectStrategyForScore } from "./strategy-selector.js";

describe("selectStrategyForScore", () => {
  const config = loadStrategiesConfig();

  it("mapeia score -> perfil conforme strategies.yaml", () => {
    expect(selectStrategyForScore(1, config).profile).toBe(
      config.scoreToProfile["1"],
    );
    expect(selectStrategyForScore(3, config).profile).toBe(
      config.scoreToProfile["3"],
    );
    expect(selectStrategyForScore(5, config).profile).toBe(
      config.scoreToProfile["5"],
    );
  });

  it("aplica os campos do perfil e os defaults", () => {
    const s = selectStrategyForScore(1, config);
    expect(s.planningDepth).toBeDefined();
    expect(s.budgetTokens).toBeGreaterThan(0);
    expect(typeof s.requiresHumanApproval).toBe("boolean");
    expect(s.concurrency).toBeGreaterThanOrEqual(1);
  });
});
