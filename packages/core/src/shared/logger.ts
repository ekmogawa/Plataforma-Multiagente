/**
 * Logger mínimo. Escreve em stderr para não poluir a saída --json (stdout).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentLevel(): LogLevel {
  const env = (process.env.PM_LOG_LEVEL ?? "info").toLowerCase();
  return env in ORDER ? (env as LogLevel) : "info";
}

function emit(level: LogLevel, msg: string, extra?: unknown): void {
  if (ORDER[level] < ORDER[currentLevel()]) return;
  const line = `[${level.toUpperCase()}] ${msg}`;
  if (extra !== undefined) {
    process.stderr.write(`${line} ${safeStringify(extra)}\n`);
  } else {
    process.stderr.write(`${line}\n`);
  }
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (msg: string, extra?: unknown) => emit("debug", msg, extra),
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};
