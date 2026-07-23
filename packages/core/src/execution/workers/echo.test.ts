import type { TaskContext, TaskSpec } from "@pm/contracts";
import { describe, expect, it } from "vitest";
import { EchoWorker } from "./echo.js";

const spec: TaskSpec = {
  id: "t1",
  planNodeId: "t1",
  runId: "run_1",
  projectSlug: "p",
  type: "backend",
  executorKind: "deterministic",
  executorId: "worker.echo",
  complexity: 2,
  input: { files: [], instructions: "x", contextRefs: [] },
  acceptanceCriteria: [],
  timeoutMs: 60000,
  maxRetries: 3,
};
const context: TaskContext = { taskId: "t1", files: [], contracts: [], conventions: [], priorDecisions: [], estimatedTokens: 0 };
const input = (attempt = 1) => ({ spec, context, attempt, deadline: "2026-01-01T00:01:00.000Z" });

describe("EchoWorker", () => {
  it("sucesso por padrão, sem tokens, durationMs 0", async () => {
    const r = await new EchoWorker().execute(input());
    expect(r.status).toBe("success");
    expect(r.attempt).toBe(1);
    expect(r.tokenUsage).toBeUndefined();
    expect(r.durationMs).toBe(0);
  });

  it("falha forçada e timeout forçado por id", async () => {
    const fail = await new EchoWorker({ failTaskIds: new Set(["t1"]) }).execute(input());
    expect(fail.status).toBe("failure");
    const to = await new EchoWorker({ timeoutTaskIds: new Set(["t1"]) }).execute(input());
    expect(to.status).toBe("timeout");
  });

  it("failUntilAttempt: falha antes de N, sucesso a partir de N", async () => {
    const w = new EchoWorker({ failUntilAttempt: new Map([["t1", 2]]) });
    expect((await w.execute(input(1))).status).toBe("failure");
    expect((await w.execute(input(2))).status).toBe("success");
  });
});
