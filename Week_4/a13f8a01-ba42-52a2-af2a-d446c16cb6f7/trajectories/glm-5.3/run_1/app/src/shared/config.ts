import type { Server } from "node:http";

export function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : def;
}

export interface AppConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; mailpitUrl: string; from: string };
  previewDelayMs: number;
  draftIntervalMs: number;
  searchDebounceMs: number;
  loopLimit: number;
  paneLimitBytes: number;
  maxTags: number;
  livePollMs: number;
  verifyTtlSeconds: number;
  bodyLimitBytes: number;
  grading: boolean;
  server: Server | null;
}

export function loadConfig(server: Server | null): AppConfig {
  const rawDelay = envInt("ASHLAR_PREVIEW_DELAY_MS", 500);
  return {
    port: envInt("APP_PUBLIC_PORT", 4173),
    publicUrl: (process.env.APP_PUBLIC_URL ?? "http://127.0.0.1:4173").replace(/\/+$/, ""),
    databaseUrl: process.env.DATABASE_URL ?? "",
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "",
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: process.env.S3_BUCKET ?? "",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    smtp: {
      host: process.env.SMTP_HOST ?? "127.0.0.1",
      port: envInt("SMTP_PORT", 1025),
      mailpitUrl: process.env.MAILPIT_URL ?? "",
      from: process.env.MAIL_FROM ?? "Ashlar <no-reply@ashlar.test>",
    },
    previewDelayMs: Math.min(800, Math.max(300, rawDelay)),
    draftIntervalMs: envInt("ASHLAR_DRAFT_INTERVAL_MS", 5000),
    searchDebounceMs: envInt("ASHLAR_SEARCH_DEBOUNCE_MS", 250),
    loopLimit: envInt("ASHLAR_LOOP_LIMIT", 100000),
    paneLimitBytes: envInt("ASHLAR_PANE_LIMIT_BYTES", 200000),
    maxTags: envInt("ASHLAR_MAX_TAGS", 5),
    livePollMs: 1000,
    verifyTtlSeconds: envInt("ASHLAR_VERIFY_TTL_SECONDS", 86400),
    bodyLimitBytes: envInt("ASHLAR_BODY_LIMIT_BYTES", 1000000),
    grading: process.env.ASHLAR_GRADING === "1",
    server,
  };
}

export interface ClientConfig {
  preview_delay_ms: number;
  draft_interval_ms: number;
  search_debounce_ms: number;
  loop_limit: number;
  pane_limit_bytes: number;
  max_tags: number;
  live_poll_ms: number;
}

export function clientConfig(c: AppConfig): ClientConfig {
  return {
    preview_delay_ms: c.previewDelayMs,
    draft_interval_ms: c.draftIntervalMs,
    search_debounce_ms: c.searchDebounceMs,
    loop_limit: c.loopLimit,
    pane_limit_bytes: c.paneLimitBytes,
    max_tags: c.maxTags,
    live_poll_ms: c.livePollMs,
  };
}
