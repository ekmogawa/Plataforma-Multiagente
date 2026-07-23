import type { TaskSpec } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import type { TaskRow } from "../../db/tasks-repo.js";
import { fixedClock } from "../../shared/clock.js";
import { RetryManager } from "./retry-manager.js";
import { assertTransition, canTransition, IllegalTransitionError } from "./state-machine.js";

function row(attempt: number, maxRetries = 3): TaskRow {
  const spec = { maxRetries } as TaskSpec;
  return {
    id: "t1",
    runId: "run_1",
    state: "running",
    attempt,
    dependsRemaining: 0,
    spec,
    result: null,
    notBefore: null,
    leaseExpires: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("RetryManager", () => {
  const rm = new RetryManager({ backoffBaseMs: 1000, backoffFactor: 2, backoffMaxMs: 10000 });

  it("retry enquanto attempt < maxRetries; escala ao atingir o limite", () => {
    expect(rm.onFailure(row(1), fixedClock()).kind).toBe("retry");
    expect(rm.onFailure(row(2), fixedClock()).kind).toBe("retry");
    expect(rm.onFailure(row(3), fixedClock()).kind).toBe("escalate");
  });

  it("backoff exponencial com teto", () => {
    expect(rm.backoffMs(1)).toBe(1000);
    expect(rm.backoffMs(2)).toBe(2000);
    expect(rm.backoffMs(50)).toBe(10000); // teto
  });

  it("tierBump a partir da 3ª tentativa", () => {
    const d2 = rm.onFailure(row(2), fixedClock());
    const d1 = rm.onFailure(row(1), fixedClock());
    expect(d1.kind === "retry" && d1.tierBump).toBe(false);
    expect(d2.kind === "retry" && d2.tierBump).toBe(true);
  });
});

describe("state machine", () => {
  it("transições válidas e inválidas", () => {
    expect(canTransition("ready", "running")).toBe(true);
    expect(canTransition("running", "validating")).toBe(true);
    expect(canTransition("validating", "done")).toBe(true);
    expect(canTransition("done", "running")).toBe(false);
    expect(canTransition("escalated", "done")).toBe(false);
  });

  it("assertTransition lança em transição ilegal", () => {
    expect(() => assertTransition("done", "running")).toThrow(IllegalTransitionError);
  });
});
