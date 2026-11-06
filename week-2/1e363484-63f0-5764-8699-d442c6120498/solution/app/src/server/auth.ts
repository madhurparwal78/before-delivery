// People, sessions and project roles. Roles come from the database on every request, so a grant
// change applies to the next request on every instance.

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";
import { pool } from "./db.js";
import { HttpError, notFound } from "./http.js";
import { nowSeconds } from "./domain/time.js";
import type { ProjectGeometry, Sensor } from "./domain/derivation.js";
import type { Point } from "./domain/geometry.js";

const scryptAsync = promisify(scrypt) as (secret: string, salt: Buffer, length: number) => Promise<Buffer>;

export type OrgRole = "admin" | "steward" | "member";
export type ProjectRole = "viewer" | "analyst" | "sealer";

export interface Person {
  id: string;
  name: string;
  email: string;
  org_role: OrgRole;
}

export interface Project extends ProjectGeometry {
  name: string;
  kind: string;
  code: string;
  leadPersonId: string;
}

export const SESSION_COOKIE = "fluxseal_session";

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, analyst: 2, sealer: 3 };

export function roleAtLeast(role: ProjectRole, needed: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[needed];
}

/** An admin holds the higher of viewer and their grant; anyone else holds their grant or nothing. */
function effectiveRole(orgRole: OrgRole, grant: ProjectRole | null): ProjectRole | null {
  return orgRole === "admin" ? grant ?? "viewer" : grant;
}

export async function hashPassword(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const DECOY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(32)}`;

async function passwordMatches(secret: string, stored: string): Promise<boolean> {
  const [, saltHex = "", hashHex = ""] = stored.split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(secret, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Checks the credentials and opens a session; null when they do not match. */
export async function signIn(email: string, secret: string): Promise<{ person: Person; token: string } | null> {
  const { rows } = await pool.query<Person & { password_hash: string }>(
    "SELECT id, name, email, org_role, password_hash FROM people WHERE email = $1", [email.trim().toLowerCase()]);
  const row = rows[0];
  const matches = await passwordMatches(secret, row?.password_hash ?? DECOY_HASH);
  if (!row || !matches) return null;
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, person_id, expires_at) VALUES ($1, $2, to_timestamp($3))",
    [tokenHash(token), row.id, nowSeconds() + config.sessionTtlSeconds]);
  return { person: { id: row.id, name: row.name, email: row.email, org_role: row.org_role }, token };
}

export async function signOut(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export async function sessionPerson(token: string | undefined): Promise<Person | null> {
  if (!token) return null;
  const { rows } = await pool.query<Person>(
    `SELECT p.id, p.name, p.email, p.org_role FROM sessions s JOIN people p ON p.id = s.person_id
      WHERE s.token_hash = $1 AND s.expires_at > to_timestamp($2)`, [tokenHash(token), nowSeconds()]);
  return rows[0] ?? null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${config.sessionTtlSeconds}`;
}

export const CLEARED_SESSION_COOKIE = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

interface ProjectRow {
  slug: string; name: string; kind: string; code: string; floor_tenths: number; buffer_tenths: number;
  lead_person_id: string; boundary: Point[]; sensors: Sensor[];
}

const projectSelect = (extraColumns = "") => `
  SELECT p.slug, p.name, p.kind, p.code, p.floor_tenths, p.buffer_tenths, p.lead_person_id, p.boundary, ${extraColumns}
         coalesce((SELECT json_agg(json_build_object('id', s.id, 'kind', s.kind, 'polygon', s.polygon) ORDER BY s.id COLLATE "C")
                     FROM sensors s WHERE s.project = p.slug), '[]') AS sensors
    FROM projects p`;

function toProject(row: ProjectRow): Project {
  return {
    slug: row.slug, name: row.name, kind: row.kind, code: row.code, floorTenths: row.floor_tenths,
    bufferTenths: row.buffer_tenths, leadPersonId: row.lead_person_id, boundary: row.boundary, sensors: row.sensors,
  };
}

export async function findProject(slug: string): Promise<Project | null> {
  const { rows } = await pool.query<ProjectRow>(`${projectSelect()} WHERE p.slug = $1`, [slug]);
  return rows[0] ? toProject(rows[0]) : null;
}

/** Every project with the person's effective role (null when it is invisible to them). */
export async function projectsWithRoles(person: Person): Promise<{ project: Project; role: ProjectRole | null }[]> {
  const { rows } = await pool.query<ProjectRow & { grant_role: ProjectRole | null }>(
    `${projectSelect("g.role AS grant_role,")} LEFT JOIN grants g ON g.project = p.slug AND g.person_id = $1
      ORDER BY p.name`, [person.id]);
  return rows.map((row) => ({ project: toProject(row), role: effectiveRole(person.org_role, row.grant_role) }));
}

async function grantOn(personId: string, slug: string): Promise<ProjectRole | null> {
  const { rows } = await pool.query<{ role: ProjectRole }>(
    "SELECT role FROM grants WHERE person_id = $1 AND project = $2", [personId, slug]);
  return rows[0]?.role ?? null;
}

/** The project and the caller's role on it; 404 when it is unknown or invisible to the caller. */
export async function visibleProject(person: Person, slug: string): Promise<{ project: Project; role: ProjectRole }> {
  const project = await findProject(slug);
  const role = project ? effectiveRole(person.org_role, await grantOn(person.id, slug)) : null;
  if (!project || !role) throw notFound();
  return { project, role };
}

export function requireRole(role: ProjectRole, needed: ProjectRole): void {
  if (!roleAtLeast(role, needed)) throw new HttpError(403, { error: "forbidden" });
}
