import type { Pool } from "pg";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export const env = readEnv(process.env);

export type AppEnv = ReturnType<typeof readEnv>;

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readEnv(raw: NodeJS.ProcessEnv) {
  const tz = raw.APP_TIME_ZONE && raw.APP_TIME_ZONE.trim() !== "" ? raw.APP_TIME_ZONE : "UTC";
  const today =
    raw.APP_TODAY && /^\d{4}-\d{2}-\d{2}$/.test(raw.APP_TODAY)
      ? raw.APP_TODAY
      : todayIn(tz);
  return {
    port: int(raw.APP_PUBLIC_PORT, 4173),
    publicUrl: (raw.APP_PUBLIC_URL ?? "http://127.0.0.1:4173").replace(/\/+$/, ""),
    gradingKey: raw.GRADING_KEY ?? "",
    today,
    tz,
    limits: {
      maxChartRows: int(raw.MAX_CHART_ROWS, 120),
      maxChartCols: int(raw.MAX_CHART_COLS, 80),
      maxColours: int(raw.MAX_COLOURS, 6),
      coloursPerRow: int(raw.COLOURS_PER_ROW, 2),
      maxFloat: int(raw.MAX_FLOAT, 5),
      undoDepth: int(raw.UNDO_DEPTH, 100),
      noteMaxChars: int(raw.NOTE_MAX_CHARS, 500),
      editsPerMinute: int(raw.EDITS_PER_MINUTE, 600),
      sheetLinesPerPage: int(raw.SHEET_LINES_PER_PAGE, 40),
      noticeSeconds: int(raw.NOTICE_SECONDS, 6),
      rowMotionMs: int(raw.ROW_MOTION_MS, 200),
      presenceTtlSeconds: int(raw.PRESENCE_TTL_SECONDS, 30),
      inviteTtlHours: int(raw.INVITE_TTL_HOURS, 168),
      verifyTtlHours: int(raw.VERIFY_TTL_HOURS, 24),
    },
    smtp: {
      host: raw.SMTP_HOST ?? "mailpit",
      port: int(raw.SMTP_PORT, 1025),
      from: raw.MAIL_FROM ?? "Twinrow <studio@twinrow.test>",
    },
  };
}

function todayIn(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : new Date().toISOString().slice(0, 10);
}

const PoolCtor = require("pg").Pool as new (config: {
  connectionString: string | undefined;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}) => Pool;

export const db = new PoolCtor({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 120000,
  connectionTimeoutMillis: 5000,
});

export async function sql<T = unknown>(query: string, args: readonly unknown[] = []): Promise<T[]> {
  const result = await db.query(query, args as unknown[]);
  return result.rows as T[];
}
