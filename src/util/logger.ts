export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLogLevel(env: string | undefined): LogLevel {
  if (env && env.toLowerCase() in LOG_LEVELS) {
    return env.toLowerCase() as LogLevel;
  }
  return "info";
}

let currentLevel: LogLevel = parseLogLevel(process.env.LOG_LEVEL);

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  // MCP servers use stdio for transport, so logs go to stderr
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};
