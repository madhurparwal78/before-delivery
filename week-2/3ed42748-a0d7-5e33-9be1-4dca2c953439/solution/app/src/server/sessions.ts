// Sessions and roles: the pm_session cookie, session lookup, the role checks and the Me view.
import type pg from "pg";
import { all, one, type Db } from "./db";
import { ApiError, forbidden } from "./errors";
import type { Ctx } from "./http";
import { courierName, randomId, secretToken, sha256 } from "./ids";
import { balanceOf } from "./ledger";
import { openParcel } from "./parcels";
import { SATCHELS, STARTING_SATCHEL } from "./seed";

export type Role = "guest" | "courier" | "helper" | "founder";

export interface Courier {
  id: string;
  role: Role;
  email: string | null;
  display_name: string;
  name_locked: boolean;
  muted: boolean;
  satchel_id: string;
  moderation_ref: string;
}

interface Session {
  id: string;
  courier: Courier;
}

const COOKIE_AGE_S = 400 * 86_400;

export const sessionCookie = (token: string): string =>
  `pm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_AGE_S}`;
export const clearedCookie = "pm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";

export async function sessionOf(ctx: Ctx, db: Db): Promise<Session | null> {
  if (ctx.cache.has("session")) return ctx.cache.get("session") as Session | null;
  let session: Session | null = null;
  if (ctx.cookieToken) {
    const row = await one<Courier & { session_id: string }>(
      db,
      `SELECT s.id AS session_id, c.id, c.role, c.email, c.display_name, c.name_locked, c.muted, c.satchel_id, c.moderation_ref
         FROM sessions s JOIN couriers c ON c.id = s.courier_id
        WHERE s.id = $1 AND s.ended_at IS NULL`,
      [sha256(ctx.cookieToken)],
    );
    if (row) {
      const { session_id, ...courier } = row;
      session = { id: session_id, courier };
    }
  }
  ctx.cache.set("session", session);
  return session;
}

export async function requireSession(ctx: Ctx, db: Db): Promise<Session> {
  const session = await sessionOf(ctx, db);
  if (!session) throw new ApiError(401, "unauthenticated");
  return session;
}

const isStaff = (c: Courier): boolean => c.role === "helper" || c.role === "founder";

export function requireSignedIn(c: Courier): void {
  if (c.role === "guest") throw forbidden("sign_in_required");
}

export function requireStaff(c: Courier): void {
  if (!isStaff(c)) throw forbidden("staff_only");
}

export function requireFounder(c: Courier): void {
  if (c.role !== "founder") throw forbidden("founder_only");
}

/** Locks the courier's row so parcel, purchase and merge work for one courier runs one at a time. */
export async function lockCourier(db: pg.PoolClient, courierId: string): Promise<void> {
  await db.query("SELECT 1 FROM couriers WHERE id = $1 FOR UPDATE", [courierId]);
}

export async function startSession(db: Db, courierId: string): Promise<{ id: string; token: string }> {
  const token = secretToken();
  const id = sha256(token);
  await db.query("INSERT INTO sessions (id, courier_id, created_at) VALUES ($1, $2, $3)", [id, courierId, new Date()]);
  return { id, token };
}

export async function createCourier(db: Db, role: Role, email: string | null): Promise<string> {
  const id = randomId("cr_");
  await db.query(
    "INSERT INTO couriers (id, role, email, display_name, satchel_id, moderation_ref, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, role, email, courierName(), STARTING_SATCHEL, randomId("mr_"), new Date()],
  );
  await db.query("INSERT INTO owned_satchels (courier_id, satchel_id) VALUES ($1, $2)", [id, STARTING_SATCHEL]);
  return id;
}

export async function ownedSatchels(db: Db, courierId: string): Promise<string[]> {
  const rows = await all<{ satchel_id: string }>(db, "SELECT satchel_id FROM owned_satchels WHERE courier_id = $1", [
    courierId,
  ]);
  const owned = new Set(rows.map((r) => r.satchel_id));
  return SATCHELS.filter((s) => owned.has(s.id)).map((s) => s.id);
}

/** The Me object, read live. */
export async function meOf(db: Db, courierId: string): Promise<object> {
  const c = (await one<Courier>(
    db,
    "SELECT id, role, email, display_name, name_locked, muted, satchel_id, moderation_ref FROM couriers WHERE id = $1",
    [courierId],
  ))!;
  const parcel = await openParcel(db, courierId);
  return {
    role: c.role,
    display_name: c.display_name,
    satchel_colour: c.satchel_id,
    balance: await balanceOf(db, courierId),
    email: c.role === "guest" ? null : c.email,
    name_locked: c.name_locked,
    muted: c.muted,
    satchels_owned: await ownedSatchels(db, courierId),
    open_parcel: parcel ? (JSON.parse(parcel.first_answer) as object) : null,
  };
}
