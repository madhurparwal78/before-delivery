// Sessions (the cairn_session cookie) and the Account / Device objects.
import type { ServerResponse } from "node:http";
import { pool } from "./db.ts";
import { ApiError, type Ctx } from "./http.ts";
import { newToken, tokenHash } from "./passwords.ts";
import { isoSeconds } from "../shared/time.ts";
import type { Account, Device } from "../shared/types.ts";

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  time_zone: string;
  operator: boolean;
}

export interface DeviceRow {
  id: string;
  name: string;
  approved: boolean;
  created_at: Date;
}

export interface Session {
  account: AccountRow;
  device: DeviceRow;
  tokenHash: string;
}

export const COOKIE = "cairn_session";

export function accountJson(row: AccountRow): Account {
  return { id: row.id, email: row.email, display_name: row.display_name, time_zone: row.time_zone, operator: row.operator };
}

export function deviceJson(row: DeviceRow): Device {
  return { id: row.id, name: row.name, approved: row.approved, created_at: isoSeconds(row.created_at) };
}

function cookieToken(ctx: Ctx): string | null {
  for (const part of (ctx.req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

async function optionalSession(ctx: Ctx): Promise<Session | null> {
  const token = cookieToken(ctx);
  if (!token) return null;
  const hash = tokenHash(token);
  const { rows } = await pool.query<{ a_id: string; email: string; display_name: string; time_zone: string; operator: boolean;
    d_id: string; name: string; approved: boolean; created_at: Date }>(
    `SELECT a.id AS a_id, a.email, a.display_name, a.time_zone, a.operator,
            d.id AS d_id, d.name, d.approved, d.created_at
     FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN devices d ON d.id = s.device_id
     WHERE s.token_hash = $1`, [hash]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    account: { id: r.a_id, email: r.email, display_name: r.display_name, time_zone: r.time_zone, operator: r.operator },
    device: { id: r.d_id, name: r.name, approved: r.approved, created_at: r.created_at },
    tokenHash: hash,
  };
}

export async function requireSession(ctx: Ctx): Promise<Session> {
  const session = await optionalSession(ctx);
  if (!session) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  return session;
}

export function requireApproved(session: Session): void {
  if (!session.device.approved) {
    throw new ApiError(403, "device_not_approved", "This device is waiting for approval from the account email.");
  }
}

/** Creates a session row and sets the session cookie on the response. */
export async function startSession(res: ServerResponse, accountId: string, deviceId: string): Promise<void> {
  const token = newToken();
  await pool.query("INSERT INTO sessions (token_hash, account_id, device_id) VALUES ($1, $2, $3)", [tokenHash(token), accountId, deviceId]);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
}
