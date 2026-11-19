/** The only reader of the process environment. Every service URL, credential, clock and timing setting comes from here. */
import { DEFAULT_OFFICE_ZONE } from "../shared/office-time.js";

export interface Config {
  readonly port: number;
  readonly publicUrl: string;
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly meili: { readonly url: string; readonly apiKey: string; readonly index: string };
  readonly clockStart: Date | null;
  readonly officeZone: string;
  readonly holdSeconds: number;
  readonly holdCooldownSeconds: number;
  readonly holdAttemptWindowSeconds: number;
  readonly sessionSeconds: number;
  readonly mediaUrlSeconds: number;
  readonly searchRateLimit: number;
}

const text = (env: NodeJS.ProcessEnv, name: string, fallback = ""): string => {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
};

const whole = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number of seconds`);
  return parsed;
};

const instant = (env: NodeJS.ProcessEnv, name: string): Date | null => {
  const raw = env[name];
  if (raw === undefined || raw === "") return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be an ISO 8601 instant`);
  return parsed;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const port = whole(env, "APP_PUBLIC_PORT", 4173);
  return {
    port,
    publicUrl: text(env, "APP_PUBLIC_URL", `http://127.0.0.1:${port}`),
    databaseUrl: text(env, "DATABASE_URL"),
    s3: {
      endpoint: text(env, "S3_ENDPOINT").replace(/\/+$/, ""),
      region: text(env, "S3_REGION", "us-east-1"),
      bucket: text(env, "S3_BUCKET"),
      forcePathStyle: text(env, "S3_FORCE_PATH_STYLE", "true") !== "false",
      accessKeyId: text(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: text(env, "S3_SECRET_ACCESS_KEY"),
    },
    meili: {
      url: text(env, "MEILISEARCH_URL").replace(/\/+$/, ""),
      apiKey: text(env, "MEILISEARCH_API_KEY"),
      index: text(env, "MEILISEARCH_INDEX", "units"),
    },
    clockStart: instant(env, "APP_CLOCK_START"),
    officeZone: text(env, "SALES_OFFICE_TZ", DEFAULT_OFFICE_ZONE),
    holdSeconds: whole(env, "HOLD_SECONDS", 259_200),
    holdCooldownSeconds: whole(env, "HOLD_COOLDOWN_SECONDS", 86_400),
    holdAttemptWindowSeconds: whole(env, "HOLD_ATTEMPT_WINDOW_SECONDS", 600),
    sessionSeconds: whole(env, "SESSION_SECONDS", 1_209_600),
    mediaUrlSeconds: whole(env, "MEDIA_URL_SECONDS", 300),
    searchRateLimit: whole(env, "SEARCH_RATE_LIMIT", 240),
  };
};
