import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitManager, GitSafetyError } from "./git-manager.js";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-git-"));
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  g("init", "-b", "main");
  g("config", "user.email", "t@t.dev");
  g("config", "user.name", "T");
  writeFileSync(join(dir, "README.md"), "# t\n");
  g("add", "-A");
  g("commit", "-m", "init");
  return dir;
}

describe.runIf(gitAvailable())("GitManager", () => {
  it("branch por run, commit escopado no fim, rollback", async () => {
    const dir = initRepo();
    const gm = new GitManager(dir, "main");
    expect(await gm.isGitRepo()).toBe(true);
    await gm.assertClean();
    const branch = await gm.beginRun("run_1");
    expect(branch).toBe("pm/run-run_1");
    expect(await gm.currentBranch()).toBe("pm/run-run_1");

    writeFileSync(join(dir, "novo.txt"), "conteúdo\n");
    const committed = await gm.wipCommit(["novo.txt"], "run_1");
    expect(committed).toBe(true);

    await gm.abortRun("run_1");
    expect(await gm.currentBranch()).toBe("main");
  });

  it("recusa em working tree suja", async () => {
    const dir = initRepo();
    writeFileSync(join(dir, "sujo.txt"), "x\n"); // não commitado
    const gm = new GitManager(dir, "main");
    await expect(gm.assertClean()).rejects.toThrow(GitSafetyError);
  });

  it("ciclo Camada 4: WIP commit -> finalize (amend) -> checkout origin", async () => {
    const dir = initRepo();
    const gm = new GitManager(dir, "main");
    const origin = await gm.currentBranch();
    await gm.beginRun("run_1");
    writeFileSync(join(dir, "novo.js"), "export const x = 1;\n");
    const wip = await gm.wipCommit(["novo.js"], "run_1");
    expect(wip).toBe(true);
    expect(await lastSubject(dir)).toBe("pm: WIP run run_1");
    // finalize reescreve a mensagem do commit WIP.
    const fin = await gm.finalizeApproved("pm: bugfix — run_1");
    expect(fin).toBe(true);
    expect(await lastSubject(dir)).toBe("pm: bugfix — run_1");
    await gm.checkoutOrigin(origin);
    expect(await gm.currentBranch()).toBe("main");
  });

  it("reject a partir da origin NÃO apaga trabalho não commitado do usuário", async () => {
    const dir = initRepo();
    const gm = new GitManager(dir, "main");
    const origin = await gm.currentBranch(); // main
    await gm.beginRun("run_1");
    writeFileSync(join(dir, "gerado.js"), "export const x = 1;\n");
    await gm.wipCommit(["gerado.js"], "run_1");
    await gm.checkoutOrigin(origin); // volta para main, árvore limpa
    // Usuário edita um arquivo rastreado em main (não commitado).
    writeFileSync(join(dir, "README.md"), "# t\nedição não salva do usuário\n");
    // Reject roda em processo NOVO: GitManager sem origin em memória.
    const gm2 = new GitManager(dir, "main");
    await gm2.abortRun("run_1", origin);
    expect(await gm2.currentBranch()).toBe("main");
    // A edição do usuário sobreviveu (nada de reset --hard na branch de origem).
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("edição não salva");
    // A branch do run foi removida.
    expect(execFileSync("git", ["branch", "--list", "pm/run-run_1"], { cwd: dir }).toString().trim()).toBe("");
  });

  it("abortRun com origin = a própria branch do run cai para a branch padrão", async () => {
    const dir = initRepo();
    const gm = new GitManager(dir, "main");
    await gm.beginRun("run_1");
    writeFileSync(join(dir, "x.js"), "export const x = 1;\n");
    await gm.wipCommit(["x.js"], "run_1");
    await gm.abortRun("run_1", "pm/run-run_1"); // origin corrompido apontando para a branch do run
    expect(await gm.currentBranch()).toBe("main");
    expect(execFileSync("git", ["branch", "--list", "pm/run-run_1"], { cwd: dir }).toString().trim()).toBe("");
  });

  it("wipCommit ignora arquivo criado-e-apagado no mesmo run (pathspec ausente)", async () => {
    const dir = initRepo();
    const gm = new GitManager(dir, "main");
    await gm.beginRun("run_1");
    writeFileSync(join(dir, "real.js"), "export const r = 1;\n");
    // tmp.js nunca chegou ao disco (criado e apagado) — deve ser ignorado sem erro.
    const committed = await gm.wipCommit(["real.js", "tmp.js"], "run_1");
    expect(committed).toBe(true);
    expect(await lastSubject(dir)).toBe("pm: WIP run run_1");
  });
});

async function lastSubject(dir: string): Promise<string> {
  return execFileSync("git", ["log", "-1", "--format=%s"], { cwd: dir }).toString().trim();
}
