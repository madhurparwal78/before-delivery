function record(level: string, msg: string): void {
  if (level === "error") console.error(`${new Date().toISOString()} ${msg}`);
}

export const logger = {
  info: (msg: string) => record("info", msg),
  warn: (msg: string) => record("warn", msg),
  error: (msg: string) => record("error", msg),
};
