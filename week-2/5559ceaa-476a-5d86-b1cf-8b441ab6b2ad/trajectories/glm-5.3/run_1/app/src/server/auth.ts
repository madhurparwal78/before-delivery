import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { User } from "../shared/types.js";

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function currentUser(pool: Pool, cookieToken: string | null): Promise<User | null> {
  if (!cookieToken) return null;
  const r = await pool.query(
    `SELECT u.id, u.email, u.name, u.kind FROM sessions_pg s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [cookieToken],
  );
  if ((r.rowCount ?? 0) === 0) return null;
  const row = r.rows[0] as unknown as { id: string; email: string | null; name: string; kind: string };
  return { id: row.id, email: row.email, name: row.name, kind: row.kind as User["kind"] };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}
