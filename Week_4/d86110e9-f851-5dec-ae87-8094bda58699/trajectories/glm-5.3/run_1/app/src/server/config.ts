import type { PoolClient } from "pg";

export type Role = "owner" | "editor" | "viewer";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: S3Config;
  smtp: { host: string; port: number };
  mailpitUrl: string;
  mailFrom: string;
  timeZone: string;
  gradingKey: string;
  retryCount: number;
  retryDelaySeconds: number;
  stepLimit: number;
  waitMaxSeconds: number;
  webhookBodyLimit: number;
  idempotencyWindowSeconds: number;
  editHoldSeconds: number;
  scheduleTickSeconds: number;
  canvasBreakpointPx: number;
}

function int(v: string | undefined, d: number): number {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

export const CONFIG: Config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  publicUrl: process.env.APP_PUBLIC_URL ?? "http://127.0.0.1:4173",
  databaseUrl: process.env.DATABASE_URL ?? "",
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  },
  smtp: { host: process.env.SMTP_HOST ?? "127.0.0.1", port: Number(process.env.SMTP_PORT ?? 1025) },
  mailpitUrl: process.env.MAILPIT_URL ?? "",
  mailFrom: process.env.MAIL_FROM ?? "Pinbyte Switchyard <runs@switchyard.example>",
  timeZone: process.env.WORKSPACE_TIME_ZONE ?? "America/New_York",
  gradingKey: process.env.GRADING_KEY ?? "gk-switchyard-4c9e27b1",
  retryCount: int(process.env.RETRY_COUNT, 2),
  retryDelaySeconds: int(process.env.RETRY_DELAY_SECONDS, 30),
  stepLimit: int(process.env.STEP_LIMIT, 40),
  waitMaxSeconds: int(process.env.WAIT_MAX_SECONDS, 86400),
  webhookBodyLimit: int(process.env.WEBHOOK_BODY_LIMIT_BYTES, 4096),
  idempotencyWindowSeconds: int(process.env.IDEMPOTENCY_WINDOW_SECONDS, 600),
  editHoldSeconds: int(process.env.EDIT_HOLD_SECONDS, 20),
  scheduleTickSeconds: int(process.env.SCHEDULE_TICK_SECONDS, 1),
  canvasBreakpointPx: int(process.env.CANVAS_BREAKPOINT_PX, 720),
};

export const KIND_LABELS: Record<string, string> = {
  form: "Form trigger",
  schedule: "Schedule trigger",
  webhook: "Webhook trigger",
  row_added: "Row added trigger",
  manual: "Manual trigger",
  set: "Set values",
  filter: "Filter",
  branch: "Branch",
  loop: "Loop",
  wait: "Wait",
  send_email: "Send email",
  add_row: "Add row",
  update_row: "Update row",
  call_webhook: "Call webhook",
};

export const STEP_KINDS = ["set", "filter", "branch", "loop", "wait", "send_email", "add_row", "update_row", "call_webhook"];
export const TRIGGER_KINDS = ["form", "schedule", "webhook", "row_added", "manual"];
export const OPERATORS = ["equals", "not equals", "contains", "greater than", "less than", "is empty", "is not empty"];

export const PORTS: Record<string, string[]> = {
  trigger: ["out"],
  set: ["out", "error"],
  filter: ["out"],
  branch: ["true", "false"],
  loop: ["each", "done"],
  wait: ["out"],
  send_email: ["out", "error"],
  add_row: ["out", "error"],
  update_row: ["out", "error"],
  call_webhook: ["out", "error"],
};

export const GRID_COLS = 24;
export const GRID_ROWS = 12;

export interface Pool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}
