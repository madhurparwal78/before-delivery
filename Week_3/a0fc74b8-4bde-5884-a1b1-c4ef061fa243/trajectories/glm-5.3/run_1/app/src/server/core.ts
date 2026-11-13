import { Pool, PoolClient, type QueryResultRow } from "pg";
import { type AppConfig } from "./config.js";
import type { DocumentRow, Recipient, Field, Role, DocumentStatus, RecipientStatus, Delivery, FieldKind } from "./domain.js";
import type { Mailer } from "./mail.js";
import type { Storage } from "./storage.js";

export interface Actor {
  userId: string;
  teamId: string;
  role: Role;
  email: string;
  name: string;
}

export interface Ctx {
  pool: Pool;
  cfg: AppConfig;
  actor: Actor | null;
  health: HealthState;
  live: LiveHub;
  mailer: Mailer;
  storage: Storage;
  instanceId: string;
}

export interface HealthState {
  mailOk: boolean;
  storageOk: boolean;
  lastCheck: number;
}

export interface LiveClient { send: (payload: string) => void }
export interface LiveHub {
  publishTeam: (teamId: string, payload: unknown) => void;
  publishDocument: (documentId: string, payload: unknown) => void;
}

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function err(status: number, code: string, extra?: Record<string, unknown>): ApiError {
  return new ApiError(status, { error: code, ...extra });
}

export const validation = (fields: Record<string, string>) =>
  new ApiError(422, { error: "validation", fields });

export function invalidState(status: string): ApiError {
  return err(409, "invalid_state", { status });
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`);
}

/* ---------- geometry ---------- */

export const MIN_SIZE = 0.02;

/** Single place that clamps field geometry into the page. */
export function clampGeometry(page: number, x: number, y: number, w: number, h: number): { page: number; x: number; y: number; w: number; h: number } {
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  let ww = Math.min(Math.max(w, MIN_SIZE), 1);
  let hh = Math.min(Math.max(h, MIN_SIZE), 1);
  const xx = r4(Math.min(Math.max(x, 0), 1 - ww));
  const yy = r4(Math.min(Math.max(y, 0), 1 - hh));
  return { page, x: xx, y: yy, w: r4(ww), h: r4(hh) };
}

export function geometryBreaksRules(x: number, y: number, w: number, h: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return true;
  if (x < -0.00005 || y < -0.00005) return true;
  if (w < MIN_SIZE - 0.00005 || h < MIN_SIZE - 0.00005) return true;
  if (x + w > 1.00005 || y + h > 1.00005) return true;
  return false;
}

/* ---------- document shape ---------- */

export interface DocumentJsonRecipient {
  id: string;
  name: string;
  email: string;
  order: number;
  status: RecipientStatus;
  delivery: Delivery;
  linkExpiresAt: string | null;
  signedAt: string | null;
  declineReason: string | null;
  binding: boolean;
}

export interface DocumentJsonField {
  id: string;
  recipientId: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
}

export interface DocumentJson {
  id: string;
  title: string;
  status: DocumentStatus;
  teamId: string;
  ownerId: string;
  timeZone: string;
  pageCount: number;
  originalSha256: string;
  completedSha256: string | null;
  version: number;
  currentOrder: number | null;
  reminderAvailableAt: string | null;
  recipients: DocumentJsonRecipient[];
  fields: DocumentJsonField[];
}

/** Single place deciding the Next step text. */
export function nextStepText(doc: {
  status: DocumentStatus;
  currentOrder: number | null;
  recipientCount: number;
  currentRecipient: { name: string; status: RecipientStatus; delivery: Delivery } | null;
}): string {
  switch (doc.status) {
    case "draft":
      return "Add signers and fields";
    case "in_progress": {
      const r = doc.currentRecipient;
      if (!r) return "None";
      if (r.status === "expired") return `Link expired for ${r.name}`;
      if (r.status === "invited" && r.delivery === "held") return `Invitation not delivered yet to ${r.name}`;
      return `Waiting for ${r.name} (${doc.currentOrder} of ${doc.recipientCount})`;
    }
    case "sealing":
      return "Sealing the completed PDF";
    case "completed":
    case "declined":
    case "voided":
      return "None";
  }
}

export function recipientRowWord(status: RecipientStatus, delivery: Delivery): string {
  switch (status) {
    case "invited": return delivery === "held" ? "Not delivered yet" : "Invited";
    case "waiting": return "Waiting";
    case "viewed": return "Viewed";
    case "signed": return "Signed";
    case "declined": return "Declined";
    case "expired": return "Link expired";
  }
}

export function statusWord(status: DocumentStatus): string {
  switch (status) {
    case "draft": return "Draft";
    case "in_progress": return "In progress";
    case "sealing": return "Sealing";
    case "completed": return "Completed";
    case "declined": return "Declined";
    case "voided": return "Voided";
  }
}

/** Whether a link is expired, judged only by the server clock. */
export function linkIsExpired(recipient: { status: RecipientStatus; turnStartedAt: Date | null; linkExpiresAt: Date | null }, now: Date): boolean {
  if (recipient.status === "waiting" || recipient.status === "signed" || recipient.status === "declined") return false;
  if (recipient.turnStartedAt === null || recipient.linkExpiresAt === null) return false;
  return now.getTime() >= recipient.linkExpiresAt.getTime();
}

/* ---------- sql helpers ---------- */

export const r = String.raw;

export function docRow(row: QueryResultRow): DocumentRow {
  return {
    id: row.id,
    teamId: row.team_id,
    ownerId: row.owner_id,
    title: row.title,
    status: row.status,
    timeZone: row.time_zone,
    pageCount: Number(row.page_count),
    originalSha256: row.original_sha256,
    completedSha256: row.completed_sha256,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentOrder: row.current_order === null ? null : Number(row.current_order),
    reminderAvailableAt: row.reminder_available_at,
    voidReason: row.void_reason,
    voidedBy: row.voided_by,
    declinedByRecipientId: row.declined_by_recipient_id,
    declinedByName: row.declined_by_name,
    sendToken: row.send_token,
    reminderToken: row.reminder_token,
  };
}

export function recipientRow(row: QueryResultRow): Recipient {
  return {
    id: row.id,
    documentId: row.document_id,
    name: row.name,
    email: row.email,
    order: Number(row.order),
    status: row.status,
    delivery: row.delivery,
    linkHash: row.link_hash,
    linkExpiresAt: row.link_expires_at,
    turnStartedAt: row.turn_started_at,
    signedAt: row.signed_at,
    declineReason: row.decline_reason,
    binding: row.binding,
  };
}

export function fieldRow(row: QueryResultRow): Field {
  return {
    id: row.id,
    documentId: row.document_id,
    recipientId: row.recipient_id,
    kind: row.kind,
    label: row.label,
    required: row.required,
    page: Number(row.page),
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    value: row.value,
  };
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}
