import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand, type CommandResult } from "./command-runner.js";

/**
 * GitManager — segurança de git sobre node:child_process (sem nova dependência).
 * Regras: working tree limpa ANTES de escrever; branch própria por run (nunca a
 * principal); UM commit no fim, escopado SÓ aos arquivos mudados (`add -A -- <path>`
 * por caminho, nunca um `add -A` global); rollback = descartar a branch. Nunca
 * push, nunca --force. deploy fica falso.
 */
export class GitSafetyError extends Error {}

const GIT_TIMEOUT = 30_000;

export class GitManager {
  /** Ponto de partida (branch ou SHA se HEAD destacado) para o rollback. */
  private origin?: string;

  constructor(
    private readonly root: string,
    private readonly defaultBranch = "main",
  ) {}

  private async git(args: string[]): Promise<CommandResult> {
    return runCommand("git", args, { cwd: this.root, timeoutMs: GIT_TIMEOUT });
  }

  /** É um repositório git? (best-effort — projeto não-git é pulado, não bloqueia.) */
  async isGitRepo(): Promise<boolean> {
    const r = await this.git(["rev-parse", "--is-inside-work-tree"]);
    return r.code === 0 && r.stdout.trim() === "true";
  }

  async currentBranch(): Promise<string> {
    const r = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    return r.stdout.trim();
  }

  /** Working tree limpa é pré-condição — recusa em repo sujo. */
  async assertClean(): Promise<void> {
    const r = await this.git(["status", "--porcelain"]);
    if (r.code !== 0) throw new GitSafetyError(`git status falhou: ${r.output}`);
    if (r.stdout.trim() !== "") {
      throw new GitSafetyError(
        "A working tree do projeto tem alterações não salvas. Faça commit/stash antes de executar.",
      );
    }
  }

  /** Cria e entra na branch do run (a partir do HEAD). Devolve o nome da branch. */
  async beginRun(runId: string): Promise<string> {
    const branch = `pm/run-${runId}`;
    const current = await this.currentBranch();
    if (current === branch) return branch; // resume (origin desconhecido -> default no abort)
    // Guarda o ponto de partida real (branch atual, ou SHA se HEAD destacado).
    this.origin = current === "HEAD" ? (await this.git(["rev-parse", "HEAD"])).stdout.trim() : current;
    const r = await this.git(["checkout", "-b", branch]);
    if (r.code !== 0) throw new GitSafetyError(`não foi possível criar a branch ${branch}: ${r.output}`);
    return branch;
  }

  /**
   * Commit WIP escopado no fim da EXECUÇÃO (antes da aprovação). Amenda o commit
   * WIP existente no --resume, para manter UM commit por run. A entrega final
   * (mensagem definitiva) é o finalizeApproved, no approve.
   */
  async wipCommit(changedFiles: string[], runId: string): Promise<boolean> {
    const wipSubject = `pm: WIP run ${runId}`;
    for (const rel of changedFiles) {
      // -A cobre criação, modificação E deleção de um path rastreado.
      const add = await this.git(["add", "-A", "--", rel]);
      if (add.code === 0) continue;
      // pathspec não casou: arquivo criado e apagado no MESMO run (nunca
      // rastreado, ausente do disco) — não há o que commitar; ignora esse path.
      const tracked = (await this.git(["ls-files", "--error-unmatch", "--", rel])).code === 0;
      const present = existsSync(join(this.root, rel));
      if (tracked || present) throw new GitSafetyError(`git add falhou: ${add.output}`);
    }
    const lastSubject = (await this.git(["log", "-1", "--format=%s"])).stdout.trim();
    if (lastSubject === wipSubject) {
      const r = await this.git(["commit", "--amend", "--no-edit"]); // resume: dobra no WIP
      return r.code === 0;
    }
    if ((await this.git(["status", "--porcelain"])).stdout.trim() === "") return false;
    const r = await this.git(["commit", "-m", wipSubject]);
    if (r.code !== 0) throw new GitSafetyError(`git commit falhou: ${r.output}`);
    return true;
  }

  /** Retoma a branch de um run existente (para pm run start --resume). */
  async resumeRun(runId: string): Promise<string> {
    const branch = `pm/run-${runId}`;
    if ((await this.git(["rev-parse", "--verify", branch])).code !== 0) {
      throw new GitSafetyError(`branch ${branch} não existe — nada para retomar.`);
    }
    await this.assertClean();
    const r = await this.git(["checkout", branch]);
    if (r.code !== 0) throw new GitSafetyError(`não foi possível entrar em ${branch}: ${r.output}`);
    return branch;
  }

  /** Reescreve a mensagem do commit WIP para a mensagem final (no approve). */
  async finalizeApproved(message: string): Promise<boolean> {
    const lastSubject = (await this.git(["log", "-1", "--format=%s"])).stdout.trim();
    if (!lastSubject.startsWith("pm: WIP run")) return false; // run vazio
    const r = await this.git(["commit", "--amend", "-m", message]);
    if (r.code !== 0) throw new GitSafetyError(`git commit --amend falhou: ${r.output}`);
    return true;
  }

  /** Volta à branch de origem (deixa a working tree do usuário limpa). */
  async checkoutOrigin(origin?: string): Promise<void> {
    await this.git(["checkout", origin ?? this.origin ?? this.defaultBranch]);
  }

  /**
   * Rollback: descarta a branch do run e volta ao ponto de partida. NUNCA toca a
   * working tree do usuário quando já estamos FORA da branch do run (fluxo normal
   * de reject, em processo novo). O `reset --hard` só roda se estivermos NA branch
   * descartável do run — aí ele afeta só essa branch, nunca a de origem.
   */
  async abortRun(runId: string, origin?: string): Promise<void> {
    const branch = `pm/run-${runId}`;
    let target = origin ?? this.origin ?? this.defaultBranch;
    if (target === branch) target = this.defaultBranch; // nunca voltar para a branch que será apagada
    const current = await this.currentBranch();
    if (current === branch) {
      await this.git(["reset", "--hard"]); // limpa a branch do run antes de sair dela
      const co = await this.git(["checkout", target]);
      if (co.code !== 0) {
        throw new GitSafetyError(`não foi possível sair de ${branch} para ${target}: ${co.output}`);
      }
    }
    // Fora da branch do run: só remove a branch (guarda o commit WIP a descartar).
    if ((await this.git(["rev-parse", "--verify", "--quiet", branch])).code !== 0) {
      return; // branch já não existe — nada a remover
    }
    const del = await this.git(["branch", "-D", branch]);
    if (del.code !== 0) {
      throw new GitSafetyError(`não foi possível remover a branch ${branch}: ${del.output}`);
    }
  }
}
