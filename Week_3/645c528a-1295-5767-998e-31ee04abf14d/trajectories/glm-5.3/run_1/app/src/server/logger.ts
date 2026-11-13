export const logger = {
  info: (msg: string): void => {
    if (process.env.NODE_ENV !== 'test') console.log(`[info] ${msg}`);
  },
  warn: (msg: string): void => {
    console.warn(`[warn] ${msg}`);
  },
  error: (msg: string, err?: unknown): void => {
    console.error(`[error] ${msg}`, err instanceof Error ? err.stack ?? err.message : err ?? '');
  },
};
