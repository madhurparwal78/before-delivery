import { one, rows } from "./db.js";
import { notFound } from "./errors.js";
import type { Mode, Person, Role, ShareRole } from "../shared/types.js";
import { defaultMode, modesFor } from "../shared/types.js";

export interface PersonRow { id: string; email: string; display_name: string; colour: string; is_consultant: boolean }

/** The people projection (API, People projection): the only builder of person objects. */
export function personObject(p: PersonRow, role?: Role): Person {
  return role ? { personId: p.id, displayName: p.display_name, colour: p.colour, role } : { personId: p.id, displayName: p.display_name, colour: p.colour };
}

const cache = new Map<string, PersonRow>();

export async function personById(id: string): Promise<PersonRow> {
  const hit = cache.get(id);
  if (hit) return hit;
  const row = await one<PersonRow>("SELECT id, email, display_name, colour, is_consultant FROM people WHERE id = $1", [id]);
  if (!row) throw notFound();
  cache.set(id, row);
  return row;
}

export async function personByEmail(email: string): Promise<PersonRow | undefined> {
  return one<PersonRow>("SELECT id, email, display_name, colour, is_consultant FROM people WHERE lower(email) = lower($1)", [email]);
}

export interface Access { role: Role; accessEndsAt: Date | null }

/**
 * Share expiry (Time rules), decided once: a share over alias `s` counts while it is active and its
 * end time is ahead of the server's current time, passed as parameter `$n`.
 */
export const activeShare = (n: number): string => `s.status = 'active' AND (s.ends_at IS NULL OR s.ends_at > $${n})`;

/**
 * Visibility (Business rules): a person can open a proposal only while they are its Owner or hold
 * an active share whose end time is still ahead on the server's clock.
 */
async function accessOf(personId: string, proposalId: string): Promise<Access | null> {
  const row = await one<{ owner_id: string; role: ShareRole | null; ends_at: Date | null }>(
    `SELECT d.owner_id, s.role, s.ends_at FROM proposals d
       LEFT JOIN shares s ON s.proposal_id = d.id AND s.person_id = $1 AND ${activeShare(3)}
      WHERE d.id = $2`, [personId, proposalId, new Date()]);
  if (!row) return null;
  if (row.owner_id === personId) return { role: "owner", accessEndsAt: null };
  if (!row.role) return null;
  return { role: row.role, accessEndsAt: row.ends_at };
}

export async function requireAccess(personId: string, proposalId: string): Promise<Access> {
  const a = await accessOf(personId, proposalId);
  if (!a) throw notFound();
  return a;
}

/** The Owner and everyone with an active share, with their roles. */
export async function peopleWithAccess(proposalId: string): Promise<Person[]> {
  const list = await rows<PersonRow & { role: Role }>(
    `SELECT p.id, p.email, p.display_name, p.colour, p.is_consultant, 'owner' AS role, 0 AS ord, d.created_at AS since
       FROM proposals d JOIN people p ON p.id = d.owner_id WHERE d.id = $1
     UNION ALL
     SELECT p.id, p.email, p.display_name, p.colour, p.is_consultant, s.role, 1, s.created_at
       FROM shares s JOIN people p ON p.id = s.person_id
      WHERE s.proposal_id = $1 AND ${activeShare(2)}
     ORDER BY ord, since`, [proposalId, new Date()]);
  return list.map((p) => personObject(p, p.role));
}

export async function rolesOn(proposalId: string): Promise<Map<string, Role>> {
  return new Map((await peopleWithAccess(proposalId)).flatMap((p) => (p.role ? [[p.personId, p.role] as const] : [])));
}

/** A person object for someone on a proposal: role included while they hold access. */
export async function personOn(personId: string, roles: Map<string, Role>): Promise<Person> {
  return personObject(await personById(personId), roles.get(personId));
}

export async function storedMode(proposalId: string, personId: string, role: Role): Promise<Mode> {
  const row = await one<{ mode: Mode }>("SELECT mode FROM modes WHERE proposal_id = $1 AND person_id = $2", [proposalId, personId]);
  return row && modesFor(role).includes(row.mode) ? row.mode : defaultMode(role);
}
