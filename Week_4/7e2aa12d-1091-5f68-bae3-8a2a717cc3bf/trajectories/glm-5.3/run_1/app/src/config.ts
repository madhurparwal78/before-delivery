// The one place that decides the app's configuration. Read once at start.
const int = (v: string | undefined, dflt: number): number => {
  if (v === undefined || v === '') return dflt;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
};

export interface Config {
  databaseUrl: string;
  valkeyUrl: string;
  gradingKey: string | null;
  presenceSeconds: number;
  maxTracks: number;
  maxBreakpoints: number;
  publicPort: number;
}

export interface BootEnv {
  DATABASE_URL: string;
  VALKEY_URL: string;
  GRADING_KEY: string;
  PRESENCE_SECONDS: string;
  MAX_TRACKS: string;
  MAX_BREAKPOINTS: string;
  APP_PUBLIC_PORT: string;
}

export function readConfig(env: Partial<Record<keyof BootEnv, string>> = process.env as Partial<Record<keyof BootEnv, string>>): Config {
  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  const valkeyUrl = (env.VALKEY_URL ?? '').trim();
  return {
    databaseUrl,
    valkeyUrl,
    gradingKey: (env.GRADING_KEY && env.GRADING_KEY.length > 0) ? env.GRADING_KEY : null,
    presenceSeconds: Math.max(5, int(env.PRESENCE_SECONDS, 30)),
    maxTracks: Math.max(2, int(env.MAX_TRACKS, 12)),
    maxBreakpoints: Math.max(1, int(env.MAX_BREAKPOINTS, 3)),
    publicPort: int(env.APP_PUBLIC_PORT, 4173),
  };
}

export const config = readConfig();
