/** Every setting the server reads from the environment, read once at start. */
const integer = (name: string, fallback: number): number => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  port: integer('APP_PUBLIC_PORT', 4173),
  databaseUrl: process.env.DATABASE_URL ?? '',
  valkeyUrl: process.env.VALKEY_URL ?? '',
  /** No default: without it the grading route looks absent. */
  gradingKey: process.env.GRADING_KEY,
  presenceSeconds: integer('PRESENCE_SECONDS', 30),
  maxTracks: integer('MAX_TRACKS', 12),
  maxBreakpoints: integer('MAX_BREAKPOINTS', 3),
} as const;

export const limits = { maxTracks: config.maxTracks, maxBreakpoints: config.maxBreakpoints };
export type Limits = typeof limits;
