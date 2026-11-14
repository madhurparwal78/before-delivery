import type { Timers } from "./domain/rules.ts";

function text(name: string, fallback = ""): string {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : fallback;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

const port = whole("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: text("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE") !== "false",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: text("SMTP_HOST"), port: Number(text("SMTP_PORT")), from: text("MAIL_FROM") },
  mailpitUrl: text("MAILPIT_URL"),
  gradingKey: text("GRADING_KEY"),
  simClock: text("SIM_CLOCK", "wall") === "stepped" ? ("stepped" as const) : ("wall" as const),
  appToday: text("APP_TODAY"),
  timeZone: text("APP_TIME_ZONE", "UTC"),
  inviteTtlHours: whole("INVITE_TTL_HOURS", 168),
  verifyTtlHours: whole("VERIFY_TTL_HOURS", 24),
  seatGraceSeconds: whole("SEAT_GRACE_SECONDS", 120),
  commandsPerMinute: whole("COMMANDS_PER_MINUTE", 120),
  layoutMaxBytes: whole("LAYOUT_MAX_BYTES", 200000),
};

export const timers: Timers = {
  pushSeconds: whole("PUSH_SECONDS", 30),
  lineupSeconds: whole("LINEUP_SECONDS", 20),
  takeoffRollSeconds: whole("TAKEOFF_ROLL_SECONDS", 30),
  landingRollSeconds: whole("LANDING_ROLL_SECONDS", 40),
  crossSeconds: whole("CROSS_SECONDS", 30),
  handoffOfferSeconds: whole("HANDOFF_OFFER_SECONDS", 60),
  arrivalProtectSeconds: whole("ARRIVAL_PROTECT_SECONDS", 120),
  goAroundSeconds: whole("GO_AROUND_SECONDS", 300),
  readbackCorrectSeconds: whole("READBACK_CORRECT_SECONDS", 15),
  readbackErrorEvery: whole("READBACK_ERROR_EVERY", 5),
  simSeedOffset: whole("SIM_SEED_OFFSET", 0),
  slotToleranceSeconds: whole("SLOT_TOLERANCE_SECONDS", 300),
  windChangeDelaySeconds: whole("WIND_CHANGE_DELAY_SECONDS", 120),
};

/** Today as YYYY-MM-DD: APP_TODAY when set, else the current date in APP_TIME_ZONE. */
export function today(): string {
  if (config.appToday) return config.appToday;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}
