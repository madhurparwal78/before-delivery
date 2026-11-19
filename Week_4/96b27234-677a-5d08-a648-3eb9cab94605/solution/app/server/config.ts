import { randomUUID } from "node:crypto";

function text(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function whole(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== undefined && process.env[name] !== "" ? value : fallback;
}

export const config = {
  port: whole("APP_PUBLIC_PORT", 4173),
  publicUrl: text("APP_PUBLIC_URL"),
  instanceName: text("INSTANCE_NAME", "a"),
  instanceId: randomUUID(),
  gradingKey: text("GRADING_KEY"),
  databaseUrl: text("DATABASE_URL"),
  valkeyUrl: text("VALKEY_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT"),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET"),
    pathStyle: text("S3_FORCE_PATH_STYLE", "true") !== "false",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: text("SMTP_HOST"), port: whole("SMTP_PORT", 1025), from: text("MAIL_FROM") },
  stepMinIntervalMs: whole("STEP_MIN_INTERVAL_MS", 200),
  dropGraceSeconds: whole("DROP_GRACE_SECONDS", 30),
  voteWindowSeconds: whole("VOTE_WINDOW_SECONDS", 60),
  inviteTtlSeconds: whole("INVITE_TTL_SECONDS", 604800),
  reminderLeadMinutes: whole("REMINDER_LEAD_MINUTES", 60),
  chatMaxChars: whole("CHAT_MAX_CHARS", 300),
  sessionCapacityMax: whole("SESSION_CAPACITY_MAX", 50),
} as const;
