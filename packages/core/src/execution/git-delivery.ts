import { runCommand } from "./command-runner.js";

/**
 * GitDelivery — entrega OPORTUNÍSTICA (push + PR). Só dispara quando há remoto E
 * gh autenticado; qualquer falha degrada para "só commit local", nunca falha a
 * aprovação. NUNCA push --force; deploy continua falso. Mantém o GitManager livre
 * de operações de rede (o invariante "GitManager nunca faz push").
 */
export interface DeliveryResult {
  committed: true;
  pushed: boolean;
  prUrl?: string;
  note?: string;
}

const GIT_TIMEOUT = 60_000;

export class GitDelivery {
  constructor(private readonly root: string) {}

  private async git(args: string[]) {
    return runCommand("git", args, { cwd: this.root, timeoutMs: GIT_TIMEOUT });
  }
  private async gh(args: string[]) {
    return runCommand("gh", args, { cwd: this.root, timeoutMs: GIT_TIMEOUT });
  }

  async remoteName(): Promise<string | undefined> {
    const r = await this.git(["remote"]);
    const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first;
  }

  async ghReady(): Promise<boolean> {
    const v = await this.gh(["--version"]);
    if (v.code !== 0 || v.toolMissing) return false;
    const auth = await this.gh(["auth", "status"]);
    return auth.code === 0;
  }

  /** push (sem --force) + PR se possível. Best-effort; sempre reporta o que deu. */
  async deliver(branch: string, opts: { base: string; title: string; body: string; noPr?: boolean }): Promise<DeliveryResult> {
    const remote = await this.remoteName();
    if (!remote) return { committed: true, pushed: false, note: "sem remoto — commit local apenas" };

    const push = await this.git(["push", "-u", remote, branch]);
    if (push.code !== 0) {
      return { committed: true, pushed: false, note: `push falhou (commit local mantido): ${push.output.slice(-200)}` };
    }
    if (opts.noPr) return { committed: true, pushed: true, note: "push feito; PR pulado (--no-pr)" };

    if (!(await this.ghReady())) {
      return { committed: true, pushed: true, note: "push feito; gh indisponível/não autenticado — abra o PR manualmente" };
    }
    const pr = await this.gh(["pr", "create", "--base", opts.base, "--head", branch, "--title", opts.title, "--body", opts.body]);
    if (pr.code !== 0) {
      return { committed: true, pushed: true, note: `push feito; gh pr create falhou: ${pr.output.slice(-200)}` };
    }
    const url = pr.stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s.startsWith("http"));
    return { committed: true, pushed: true, prUrl: url };
  }
}
