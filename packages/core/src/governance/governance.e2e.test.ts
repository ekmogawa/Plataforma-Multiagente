import { ProjectTarget, type ExecutionResult, type TaskSpec } from "@pm/contracts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { openDatabase } from "../db/database.js";
import { RunsRepo } from "../db/runs-repo.js";
import { TasksRepo, type SeedEntry } from "../db/tasks-repo.js";
import { GitManager } from "../execution/git-manager.js";
import { Gatekeeper } from "./gatekeeper.js";
import { ProjectManager } from "./project-manager.js";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-gov-e2e-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-b", "main");
  g("config", "user.email", "t@t.dev");
  g("config", "user.name", "T");
  writeFileSync(join(dir, "README.md"), "# t\n");
  g("add", "-A");
  g("commit", "-m", "init");
  return dir;
}

describe.runIf(gitAvailable())("Camada 4 e2e: done -> gatekeeper -> evidências -> WIP -> approve", () => {
  it("integra a mudança na branch do run após aprovação", async () => {
    const root = initRepo();
    const db = openDatabase(":memory:");
    const artRoot = mkdtempSync(join(tmpdir(), "pm-gov-e2e-art-"));
    writeFileSync(join(artRoot, "pnpm-workspace.yaml"), "packages: []\n");
    const artifacts = new ArtifactStore(db, artRoot);
    const runs = new RunsRepo(db);
    const tasks = new TasksRepo(db);
    const target = ProjectTarget.parse({ slug: "app", rootPath: root, kind: "registered" });

    runs.create({ id: "run_1", state: "running", projectSlug: "app", workKind: "feature" });
    const spec: TaskSpec = {
      id: "n1", planNodeId: "n1", runId: "run_1", projectSlug: "app", type: "backend",
      executorKind: "llm", executorId: "worker.llm", complexity: 2,
      input: { files: [], instructions: "x", contextRefs: [] }, acceptanceCriteria: [], timeoutMs: 60000, maxRetries: 3,
    };
    const entries: SeedEntry[] = [{ spec, dependsRemaining: 0, initialState: "ready" }];
    tasks.seed("run_1", entries, [], "2026-01-01T00:00:00.000Z");

    // Simula o worker: escreve o arquivo e registra o resultado.
    const git = new GitManager(root, "main");
    const origin = await git.currentBranch();
    await git.beginRun("run_1");
    writeFileSync(join(root, "feature.js"), "export const feito = true;\n");
    const result: ExecutionResult = {
      taskId: "n1", attempt: 1, status: "success",
      changedFiles: [{ path: "feature.js", action: "created" }], logs: "", durationMs: 0,
    };
    tasks.setResult("run_1", "n1", result, "2026-01-01T00:00:00.000Z");
    runs.setState("run_1", "done");

    // Governança (como o runGovernance do CLI).
    const review = await new Gatekeeper({ tasks, artifacts, target }).review("run_1");
    expect(review.verdict).toBe("approve"); // arquivo limpo
    const bundle = new ProjectManager({ artifacts, runs, tasks }).assembleEvidence("run_1");
    expect(bundle.changedFiles).toContainEqual({ path: "feature.js", action: "created" });
    await git.wipCommit(["feature.js"], "run_1");
    await git.checkoutOrigin(origin);
    runs.setState("run_1", "awaiting-approval");

    // Approve.
    await git.resumeRun("run_1");
    await git.finalizeApproved("pm: feature — run_1");
    await git.checkoutOrigin(origin);
    runs.setState("run_1", "approved");

    // A branch do run tem o commit final; main NÃO tem.
    const log = execFileSync("git", ["log", "pm/run-run_1", "-1", "--format=%s"], { cwd: root }).toString().trim();
    expect(log).toBe("pm: feature — run_1");
    expect(execFileSync("git", ["branch", "--show-current"], { cwd: root }).toString().trim()).toBe("main");
    const onMain = execFileSync("git", ["ls-files", "feature.js"], { cwd: root }).toString().trim();
    expect(onMain).toBe(""); // main ainda não tem o arquivo (só a branch do run)
    // O arquivo está na working tree (checkout main não o removeu pois é untracked? não: foi commitado na branch).
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("# t");
    db.close();
  });
});
