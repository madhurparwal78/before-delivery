/** Staff sessions and review-link authorisation. */

import type { Request } from "express";
import { query, queryOne } from "./db.js";
import { linkExpired, linkNotFound, linkRevoked, unauthenticated } from "./errors.js";
import { newId } from "./ids.js";
import { linkStatus, type ReviewLinkRow, type SetRow } from "./domain/sets.js";

export const SESSION_COOKIE = "spanwise_session";

export interface StaffRow {
  id: string;
  tenant_id: string;
  name: string;
  role: "survey_processor" | "vegetation_analyst";
  email: string;
  tenant_name: string;
}

export interface StaffAuth {
  staff: StaffRow;
}

export interface ReviewAuth {
  link: ReviewLinkRow;
  set: SetRow;
}

const SELECT_STAFF = `
  SELECT s.id, s.tenant_id, s.name, s.role, s.email, t.name AS tenant_name
  FROM staff s JOIN tenants t ON t.id = s.tenant_id
`;

export async function staffByAccessCode(accessCode: string): Promise<StaffRow | null> {
  return queryOne<StaffRow>(`${SELECT_STAFF} WHERE s.access_code = $1`, [accessCode]);
}

export async function createSession(staffId: string): Promise<string> {
  const id = newId("ses");
  await query("INSERT INTO sessions (id, staff_id) VALUES ($1,$2)", [id, staffId]);
  return id;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionId(req: Request): string | null {
  return cookieValue(req, SESSION_COOKIE);
}

export function staffPayload(staff: StaffRow): Record<string, string> {
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    email: staff.email,
    tenant_id: staff.tenant_id,
    tenant_name: staff.tenant_name,
  };
}

export async function currentStaff(req: Request): Promise<StaffRow | null> {
  const session = sessionId(req);
  if (session) {
    const staff = await queryOne<StaffRow>(
      `${SELECT_STAFF} JOIN sessions sn ON sn.staff_id = s.id WHERE sn.id = $1`,
      [session],
    );
    if (staff) return staff;
  }
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return staffByAccessCode(header.slice("Bearer ".length).trim());
  }
  return null;
}

export async function authenticateStaff(req: Request): Promise<StaffAuth> {
  const staff = await currentStaff(req);
  if (!staff) throw unauthenticated();
  return { staff };
}

/** A review route is authorised only by the token in its path. */
export async function authenticateReview(req: Request): Promise<ReviewAuth> {
  const token = req.params.token;
  const link = await queryOne<ReviewLinkRow>("SELECT * FROM review_links WHERE token = $1", [
    token,
  ]);
  if (!link) throw linkNotFound();
  const status = linkStatus(link);
  if (status === "revoked") throw linkRevoked();
  if (status === "expired") throw linkExpired();
  const set = await queryOne<SetRow>("SELECT * FROM findings_sets WHERE id = $1", [link.set_id]);
  if (!set) throw linkNotFound();
  return { link, set };
}
