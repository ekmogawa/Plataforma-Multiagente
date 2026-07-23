/**
 * Helpers de saída. Regra: dados estruturados vão para stdout (o Claude Code
 * consome via --json); mensagens humanas e logs vão para stderr.
 */

export interface OutputOptions {
  json: boolean;
}

/** Emite o resultado: JSON puro em --json, ou texto humano caso contrário. */
export function emit(
  data: unknown,
  human: () => string,
  opts: OutputOptions,
): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    process.stdout.write(human() + "\n");
  }
}

export function line(msg = ""): string {
  return msg;
}

export const mark = {
  ok: "✓",
  fail: "✗",
  warn: "!",
};
