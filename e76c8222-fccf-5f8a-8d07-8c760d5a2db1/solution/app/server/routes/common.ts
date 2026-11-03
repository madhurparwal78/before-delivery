// Lookups every route shares: ids from the path, tenant-checked requests, rates, requester mailboxes.
import type { User } from "../../shared/api.js";
import type { Setting } from "../../shared/domain.js";
import { type Db, one, rows } from "../db.js";
import { ApiError } from "../errors.js";
import type { AuthedCtx } from "../http.js";
import { REQUEST_SELECT, type RequestRow } from "../views.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed id; anything else can never name a record. */
export const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export function idParam(ctx: AuthedCtx, name: string): string {
  const value = ctx.params[name];
  if (!isId(value)) throw new ApiError("not_found");
  return value;
}

/**
 * A request the user may see: requesters only their own organisation's (anything else is
 * `not_found`, never `forbidden`). `lock` takes the request row lock for a state change.
 */
export async function visibleRequest(db: Db, user: User, id: string, lock = false): Promise<RequestRow> {
  const row = await one<RequestRow>(db, `${REQUEST_SELECT} WHERE r.id = $1${lock ? " FOR UPDATE OF r" : ""}`, [id]);
  if (!row || (user.role === "requester" && row.org_id !== user.org_id)) throw new ApiError("not_found");
  return row;
}

export async function rateOf(db: Db, setting: Setting): Promise<number> {
  const rate = await one<{ cents: number }>(db, "SELECT cents FROM rates WHERE setting = $1", [setting]);
  if (!rate) throw new ApiError("internal");
  return rate.cents;
}

export async function requesterEmails(db: Db, orgId: string): Promise<string[]> {
  const found = await rows<{ email: string }>(db, "SELECT email FROM users WHERE role = 'requester' AND org_id = $1 ORDER BY name", [orgId]);
  return found.map((u) => u.email);
}

/** Accepted seats of a request, in seat order, with their interpreters. */
export async function acceptedSeats(db: Db, requestId: string): Promise<{ seat_id: string; interpreter_id: string; name: string; email: string }[]> {
  return rows(
    db,
    `SELECT s.id AS seat_id, u.id AS interpreter_id, u.name, u.email
     FROM seats s JOIN offers o ON o.seat_id = s.id AND o.status = 'accepted' JOIN users u ON u.id = o.interpreter_id
     WHERE s.request_id = $1 ORDER BY s.position`,
    [requestId],
  );
}

export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
