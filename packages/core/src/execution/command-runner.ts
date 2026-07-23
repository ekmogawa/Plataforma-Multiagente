import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * command-runner — execução Windows-safe de comandos do projeto alvo (build,
 * lint, testes). node:child_process spawn com shell:false (nenhuma string de
 * shell é interpretada); no win32, alvos .cmd/.bat (npm/npx/eslint) rodam via
 * cmd.exe com args em ARRAY (o Node cuida do quoting). Compartilhado por
 * test-runner, lint-fix, deps, scaffold e o Acceptance Engine.
 */

const isWin = process.platform === "win32";
/** Metacaracteres de shell/cmd.exe — comando que os contenha é RECUSADO. */
const SHELL_META = /[&|;<>`$(){}^%!]/;
/** Variáveis de ambiente que carregam segredos — removidas do subprocesso. */
const SECRET_ENV = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|OPENAI|ANTHROPIC|OMNIROUTER|_PAT)/i;
const DEFAULT_MAX_OUTPUT = 200_000;

export class CommandRunError extends Error {}

export interface CommandResult {
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout+stderr, limitado a maxOutputBytes. */
  output: string;
  timedOut: boolean;
  /** Executável ausente (ENOENT / "not recognized" / 9009). */
  toolMissing: boolean;
  durationMs: number;
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

/** Quebra um comando de string em argv, RECUSANDO metacaracteres de shell. */
export function tokenizeCommand(cmd: string): string[] {
  const trimmed = cmd.trim();
  if (!trimmed) throw new CommandRunError("comando vazio");
  if (SHELL_META.test(trimmed)) {
    throw new CommandRunError(`comando com metacaractere de shell recusado: ${cmd}`);
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

/** Env do subprocesso: sem segredos, com CI=1 (testes não-interativos). */
export function filterEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && !SECRET_ENV.test(k)) out[k] = v;
  }
  out.CI = "1";
  return out;
}

/** Caminho de um bin de pacote local (contorna o shim .cmd rodando via `node`). */
export function resolveNodeBin(root: string, relFromNodeModules: string): string | undefined {
  const p = join(root, "node_modules", relFromNodeModules);
  return existsSync(p) ? p : undefined;
}

/**
 * Resolve o programa para o executável real. No win32, faz a busca PATH+PATHEXT
 * para saber se é um shim .cmd/.bat (que EXIGE cmd.exe) ou um .exe (spawn direto,
 * SEM cmd.exe — fecha a injeção via metacaractere em argumentos como caminhos git).
 */
export function resolveExecutable(program: string): string {
  if (program.includes("/") || program.includes("\\") || /\.[a-z0-9]+$/i.test(program)) {
    return program; // já é caminho ou tem extensão
  }
  if (!isWin) return program; // POSIX resolve via PATH no próprio spawn
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const dirs = (process.env.PATH ?? "").split(";").filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = join(dir, program + ext);
      if (existsSync(cand)) return cand;
    }
  }
  return program;
}

export async function runCommand(
  program: string,
  args: string[],
  opts: RunOptions,
): Promise<CommandResult> {
  const started = performance.now();
  const command = [program, ...args].join(" ");
  const cap = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const env = opts.env ?? filterEnv();

  // Só shims .cmd/.bat vão por cmd.exe; .exe (git, node) roda direto (sem shell).
  const resolved = resolveExecutable(program);
  const useCmd = isWin && /\.(cmd|bat)$/i.test(resolved);
  const spawnOpts = {
    cwd: opts.cwd,
    env,
    shell: false,
    windowsHide: true,
    // POSIX: grupo próprio para matar a árvore inteira no timeout.
    ...(isWin ? {} : { detached: true }),
  } as const;
  const child = useCmd
    ? spawn("cmd.exe", ["/d", "/s", "/c", resolved, ...args], spawnOpts)
    : spawn(resolved, args, spawnOpts);

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let toolMissing = false;

  // Mantém a CAUDA (últimos `cap` bytes) — o erro costuma estar no fim.
  child.stdout?.on("data", (d: Buffer) => {
    stdout = (stdout + d.toString("utf8")).slice(-cap);
  });
  child.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString("utf8")).slice(-cap);
  });

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child.pid);
  }, opts.timeoutMs);

  const onAbort = () => killTree(child.pid);
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const code = await new Promise<number | null>((resolveCode) => {
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") toolMissing = true;
      resolveCode(null);
    });
    child.on("close", (c) => resolveCode(c));
  });

  clearTimeout(timer);
  opts.signal?.removeEventListener("abort", onAbort);

  // Heurística de tool ausente no win32 (cmd.exe não dá ENOENT).
  if (code === 9009 || /is not recognized|command not found|não é reconhecido/i.test(stderr)) {
    toolMissing = true;
  }

  const output = (stdout + (stderr ? "\n" + stderr : "")).slice(-cap);
  return {
    command,
    code,
    stdout,
    stderr,
    output,
    timedOut,
    toolMissing,
    durationMs: Math.round(performance.now() - started),
  };
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (isWin) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      // Filho é líder do grupo (detached) — mata o grupo inteiro (netos incluídos).
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    /* já morreu */
  }
}
