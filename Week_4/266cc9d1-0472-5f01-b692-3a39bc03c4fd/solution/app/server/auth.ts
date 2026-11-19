// Who is calling: contractor staff by session cookie or bearer access code, foresters by link token.
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { pool, type Db } from "./db.js";
import { linkStatus } from "./domain/reviewLink.js";
import { fail } from "./http/errors.js";

export const SESSION_COOKIE = "spanwise_session";

export type StaffRole = "survey_processor" | "vegetation_analyst";

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
  email: string;
  tenantId: string;
  tenantName: string;
}

export interface LinkAccess {
  linkId: string;
  token: string;
  setId: string;
  corridorId: string;
  tenantId: string;
  expiresAt: Date;
}

interface StaffRow {
  id: string;
  name: string;
  role: StaffRole;
  email: string;
  tenant_id: string;
  tenant_name: string;
}

const STAFF_COLUMNS = `s.id, s.name, s.role, s.email, s.tenant_id, t.name AS tenant_name`;

function toStaff(row: StaffRow): Staff {
  return { id: row.id, name: row.name, role: row.role, email: row.email, tenantId: row.tenant_id, tenantName: row.tenant_name };
}

export function staffJson(staff: Staff): Record<string, string> {
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    email: staff.email,
    tenant_id: staff.tenantId,
    tenant_name: staff.tenantName,
  };
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE && rest.length > 0) return rest.join("=");
  }
  return null;
}

export async function staffByAccessCode(db: Db, accessCode: string): Promise<Staff | null> {
  const found = await db.query<StaffRow>(
    `SELECT ${STAFF_COLUMNS} FROM staff s JOIN tenants t ON t.id = s.tenant_id WHERE s.access_code = $1`,
    [accessCode],
  );
  const row = found.rows[0];
  return row === undefined ? null : toStaff(row);
}

export async function staffFromRequest(req: IncomingMessage): Promise<Staff | null> {
  const authorization = req.headers.authorization ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer?.[1] !== undefined) return staffByAccessCode(pool, bearer[1].trim());
  const token = sessionToken(req);
  if (token === null) return null;
  const found = await pool.query<StaffRow>(
    `SELECT ${STAFF_COLUMNS} FROM staff_sessions x JOIN staff s ON s.id = x.staff_id
       JOIN tenants t ON t.id = s.tenant_id WHERE x.token_sha256 = $1`,
    [tokenDigest(token)],
  );
  const row = found.rows[0];
  return row === undefined ? null : toStaff(row);
}

export async function startSession(db: Db, staff: Staff): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO staff_sessions (token_sha256, staff_id) VALUES ($1, $2)", [tokenDigest(token), staff.id]);
  return token;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM staff_sessions WHERE token_sha256 = $1", [tokenDigest(token)]);
}

/** A review link authorises only its own set; unknown, withdrawn and expired links are refused. */
export async function linkFromToken(token: string): Promise<LinkAccess> {
  const found = await pool.query<{
    id: string;
    set_id: string;
    corridor_id: string;
    tenant_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT l.id, l.set_id, s.corridor_id, c.tenant_id, l.expires_at, l.revoked_at
       FROM review_links l JOIN findings_sets s ON s.id = l.set_id JOIN corridors c ON c.id = s.corridor_id
      WHERE l.token = $1`,
    [token],
  );
  const row = found.rows[0];
  if (row === undefined) throw fail.linkNotFound();
  const status = linkStatus(row);
  if (status === "revoked") throw fail.linkRevoked();
  if (status === "expired") throw fail.linkExpired();
  return { linkId: row.id, token, setId: row.set_id, corridorId: row.corridor_id, tenantId: row.tenant_id, expiresAt: row.expires_at };
}
