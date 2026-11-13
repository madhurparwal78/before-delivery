// Authorisation in the one published order: 401, 429, 404, 403 (the handlers that follow decide 409 and 422).
import type { IncomingMessage } from "node:http";
import { pool } from "./db";
import { errors } from "./errors";
import { COOKIE_NAME, keyFromBearer, patternMatches, readCookie, userFromSession, type KeyAction, type Principal } from "./auth";
import { consume } from "./rate";
import type { Ctx } from "./http";

export type Role = "viewer" | "editor" | "admin";
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

export interface SpaceRef {
  id: number;
  slug: string;
  name: string;
}

export interface StreamRef {
  id: number;
  name: string;
  writeGeneration: number;
  lifecycle: Lifecycle;
}

export interface Lifecycle {
  rollover_max_age_ms?: number | null;
  rollover_max_events?: number | null;
  warm_after_ms?: number | null;
  archive_after_ms?: number | null;
  delete_after_ms?: number | null;
}

interface AuthSpec {
  role?: Role;
  keyAction?: KeyAction;
  rate?: "upload" | "search";
  stream?: string;
}

export interface Access {
  principal: Principal;
  space: SpaceRef;
  role: Role | null;
  stream: StreamRef | null;
  require(role: Role): void;
}

const VERBS: Record<KeyAction, string> = { read: "read", upload: "upload to", manage: "manage" };

async function principalOf(req: IncomingMessage): Promise<Principal> {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (bearer?.[1]) return keyFromBearer(bearer[1].trim());
  const user = await userFromSession(readCookie(req.headers.cookie, COOKIE_NAME));
  if (!user) throw errors.unauthenticated();
  return user;
}

export async function findStream(spaceId: number, name: string): Promise<StreamRef | null> {
  const { rows } = await pool.query<{ id: number; name: string; write_generation: number; lifecycle: Lifecycle }>(
    "SELECT id, name, write_generation, lifecycle FROM streams WHERE space_id = $1 AND name = $2",
    [spaceId, name],
  );
  const row = rows[0];
  return row ? { id: row.id, name: row.name, writeGeneration: row.write_generation, lifecycle: row.lifecycle } : null;
}

async function resolveSpace(principal: Principal, slug: string | null): Promise<{ space: SpaceRef; role: Role | null }> {
  if (principal.kind === "key") {
    const { rows } = await pool.query<SpaceRef>("SELECT id, slug, name FROM spaces WHERE id = $1", [principal.spaceId]);
    const space = rows[0];
    if (!space || (slug !== null && slug !== space.slug)) throw errors.notFound();
    return { space, role: null };
  }
  const byCurrent = slug === null;
  const { rows } = await pool.query<SpaceRef & { role: Role }>(
    `SELECT s.id, s.slug, s.name, m.role FROM spaces s JOIN members m ON m.space_id = s.id AND m.user_id = $1
     WHERE ${byCurrent ? "s.id = $2" : "s.slug = $2"}`,
    [principal.id, byCurrent ? principal.currentSpaceId : slug],
  );
  const row = rows[0];
  if (!row) throw errors.notFound();
  return { space: { id: row.id, slug: row.slug, name: row.name }, role: row.role };
}

export async function authorize(ctx: Ctx, spec: AuthSpec = {}): Promise<Access> {
  const principal = await principalOf(ctx.req);
  if (spec.rate) consume(spec.rate, principal.kind === "key" ? `key:${principal.id}` : spec.rate === "upload" ? `user:${principal.id}` : `session:${principal.sessionHash}`);
  const { space, role } = await resolveSpace(principal, ctx.query.get("space"));
  const stream = spec.stream === undefined ? null : await findStream(space.id, spec.stream);
  if (spec.stream !== undefined && !stream) throw errors.notFound();
  const access: Access = {
    principal, space, role, stream,
    require(needed) {
      if (this.role === null || RANK[this.role] < RANK[needed]) throw errors.forbidden();
    },
  };
  if (principal.kind === "key") {
    if (!spec.keyAction || !principal.actions.includes(spec.keyAction)) {
      throw spec.stream !== undefined && spec.keyAction ? errors.keyScope(VERBS[spec.keyAction], spec.stream) : errors.forbidden();
    }
    if (spec.stream !== undefined && !patternMatches(principal.pattern, spec.stream)) throw errors.keyScope(VERBS[spec.keyAction], spec.stream);
  } else if (spec.role) {
    access.require(spec.role);
  }
  return access;
}

/** A signed-in user, never a key, with no space resolution. */
export async function signedInUser(ctx: Ctx): Promise<Extract<Principal, { kind: "user" }>> {
  const principal = await principalOf(ctx.req);
  if (principal.kind === "key") throw errors.forbidden();
  return principal;
}

export function streamAllowed(access: Access, name: string): boolean {
  return access.principal.kind !== "key" || patternMatches(access.principal.pattern, name);
}
