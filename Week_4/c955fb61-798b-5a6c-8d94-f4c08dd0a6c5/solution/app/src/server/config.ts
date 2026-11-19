import { isIsoDate, type IsoDate } from "../shared/calendar";
import type { AppConfig } from "../shared/types";

const env = process.env;

function text(name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
}

function whole(name: string, fallback: number): number {
  return Number(text(name, String(fallback)));
}

const port = whole("APP_PUBLIC_PORT", 4173);

export const settings = {
  port,
  publicUrl: text("APP_PUBLIC_URL", `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL", ""),
  s3: {
    endpoint: text("S3_ENDPOINT", "").replace(/\/+$/, ""),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET", ""),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID", ""),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY", ""),
  },
  smtp: {
    host: text("SMTP_HOST", ""),
    port: whole("SMTP_PORT", 1025),
    from: text("MAIL_FROM", "Slackwater Plan <plans@slackwater.test>"),
  },
  gradingKey: text("GRADING_KEY", ""),
  planToday: text("PLAN_TODAY", ""),
  timeZone: text("PLAN_TIME_ZONE", "UTC"),
  assignNoticeDelaySeconds: whole("ASSIGN_NOTICE_DELAY_SECONDS", 60),
  presenceTimeoutSeconds: whole("PRESENCE_TIMEOUT_SECONDS", 15),
  knockOnMs: whole("KNOCK_ON_MS", 220),
  knockOnStaggerMs: whole("KNOCK_ON_STAGGER_MS", 45),
  finishMotionMs: whole("FINISH_MOTION_MS", 320),
};

/** Today, owned by the server: `PLAN_TODAY` when set, else the current date in `PLAN_TIME_ZONE`. */
export function planToday(): IsoDate {
  if (isIsoDate(settings.planToday)) return settings.planToday;
  return new Intl.DateTimeFormat("en-CA", { timeZone: settings.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function publicConfig(): AppConfig {
  return {
    today: planToday(),
    timeZone: settings.timeZone,
    assignNoticeDelaySeconds: settings.assignNoticeDelaySeconds,
    presenceTimeoutSeconds: settings.presenceTimeoutSeconds,
    knockOnMs: settings.knockOnMs,
    knockOnStaggerMs: settings.knockOnStaggerMs,
    finishMotionMs: settings.finishMotionMs,
  };
}
