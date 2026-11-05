// Sign-in with an access code; the session lives in the shared database behind an HttpOnly cookie.
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { nowSeconds, one, run } from "./db.js";
import { ApiError, forbidden } from "./errors.js";

export type Role = "coordinator" | "member" | "volunteer";

export interface Viewer {
  person: string;
  role: Role;
  name: string;
  household_code: string | null;
}

const COOKIE = "tally_session";

export function viewerJson(v: Viewer) {
  return { role: v.role, name: v.name, household_code: v.household_code };
}

function sessionToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

export function currentViewer(req: IncomingMessage): Viewer | null {
  const token = sessionToken(req);
  if (!token) return null;
  return (
    one<Viewer>(
      `SELECT p.access_code AS person, p.role, p.name, p.household_code
       FROM sessions s JOIN people p ON p.access_code = s.access_code WHERE s.token = ?`,
      token,
    ) ?? null
  );
}

export function signIn(code: unknown): { viewer: Viewer; cookie: string } {
  if (typeof code !== "string") {
    throw new ApiError(422, "validation", "Some fields need fixing.", { code: "Enter your access code." });
  }
  const viewer = one<Viewer>(
    "SELECT access_code AS person, role, name, household_code FROM people WHERE access_code = ?",
    code.trim(),
  );
  if (!viewer) throw new ApiError(401, "invalid_code", "That code doesn't match anyone in this club.");
  const token = randomBytes(32).toString("base64url");
  run("INSERT INTO sessions (token, access_code, created_at) VALUES (?, ?, ?)", token, viewer.person, nowSeconds());
  return { viewer, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` };
}

export function signOut(req: IncomingMessage): string {
  const token = sessionToken(req);
  if (token) run("DELETE FROM sessions WHERE token = ?", token);
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Refuses with 403 unless the viewer holds one of the roles. */
export function allow(viewer: Viewer, ...roles: Role[]): void {
  if (!roles.includes(viewer.role)) throw forbidden();
}
