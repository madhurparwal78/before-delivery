// Postbox keys, redeeming them (session rotation and the one-time guest save merge) and sign-out.
import type pg from "pg";
import { config } from "./config";
import { one, pool, tx } from "./db";
import { ApiError, validation, type FieldReason } from "./errors";
import { isObject, json, noContent, parsedBody, publishedBody, route } from "./http";
import { secretToken, sha256 } from "./ids";
import { balanceOf } from "./ledger";
import { sendPostboxKey } from "./mail";
import { dropParcel, openParcel } from "./parcels";
import { dropSessionPresence, moveSessionPresence } from "./presence";
import { SATCHELS, STARTING_SATCHEL } from "./seed";
import {
  clearedCookie,
  createCourier,
  ownedSatchels,
  requireSession,
  sessionCookie,
  sessionOf,
  startSession,
  type Courier,
} from "./sessions";

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function emailReason(value: unknown): FieldReason | null {
  if (value === undefined) return "required";
  if (typeof value !== "string") return "invalid";
  if ([...value].length > 254) return "too_long";
  return EMAIL.test(value) ? null : "invalid";
}

/** The accepted return paths: Bramble's own pages, character for character. */
function returnPathReason(value: unknown): FieldReason | null {
  if (typeof value !== "string") return "invalid";
  if ([...value].length > 200) return "too_long";
  const ok =
    value === "/" ||
    value === "/console" ||
    value === "/console?mission=new" ||
    /^\/console\?mission=[a-z0-9-]{1,64}$/.test(value);
  return ok ? null : "invalid";
}

route(
  "POST",
  "/api/auth/postbox-key",
  "json",
  async (ctx) => {
    const body = publishedBody(ctx, { email: true, return_to: true });
    const fields: Record<string, FieldReason> = {};
    const emailProblem = emailReason(body.email);
    if (emailProblem) fields.email = emailProblem;
    const returnTo = "return_to" in body ? body.return_to : "/";
    const returnProblem = returnPathReason(returnTo);
    if (returnProblem) fields.return_to = returnProblem;
    if (Object.keys(fields).length) throw validation(fields);
    const token = secretToken();
    await tx(async (db) => {
      await db.query("INSERT INTO postbox_keys (id, email, return_to, created_at) VALUES ($1, $2, $3, $4)", [
        sha256(token),
        (body.email as string).toLowerCase(),
        returnTo,
        new Date(),
      ]);
      await sendPostboxKey(body.email as string, `${config.base}/claim?token=${token}`, config.postboxKeyTtlSeconds);
    });
    return json(200, { status: "sent" });
  },
  false,
);

interface GuestSave extends Courier {
  merged_into: string | null;
}

/** A guest save has progress when it has any movement, a satchel beyond the starting one, or an open parcel. */
async function hasProgress(db: pg.PoolClient, guestId: string): Promise<boolean> {
  const moved = await one(db, "SELECT 1 FROM movements WHERE courier_id = $1 LIMIT 1", [guestId]);
  const satchels = (await ownedSatchels(db, guestId)).some((s) => s !== STARTING_SATCHEL);
  return Boolean(moved) || satchels || (await openParcel(db, guestId)) !== null;
}

/** Merges a guest save into a courier once: movements keep their ids and times, tickets travel too. */
async function mergeGuest(db: pg.PoolClient, guest: GuestSave, courierId: string, created: boolean): Promise<object> {
  const { count } = (await one<{ count: number }>(db, "SELECT count(*)::int AS count FROM movements WHERE courier_id = $1", [
    guest.id,
  ]))!;
  await db.query("UPDATE couriers SET merged_into = $2 WHERE id = $1", [guest.id, courierId]);
  const had = new Set(await ownedSatchels(db, courierId));
  const guestOwns = await ownedSatchels(db, guest.id);
  const added = SATCHELS.map((s) => s.id).filter((id) => guestOwns.includes(id) && !had.has(id));
  for (const id of added)
    await db.query("INSERT INTO owned_satchels (courier_id, satchel_id) VALUES ($1, $2)", [courierId, id]);
  if (created)
    await db.query("UPDATE couriers SET display_name = $2, satchel_id = $3 WHERE id = $1", [
      courierId,
      guest.display_name,
      guest.satchel_id,
    ]);
  const guestParcel = await openParcel(db, guest.id);
  let parcel: "moved" | "dropped" | "none" = "none";
  if (guestParcel) {
    parcel = (await openParcel(db, courierId)) ? "dropped" : "moved";
    if (parcel === "moved") await db.query("UPDATE acceptances SET courier_id = $2 WHERE id = $1", [guestParcel.id, courierId]);
    else await dropParcel(db, guestParcel, () => ({}));
  }
  await db.query(
    `DELETE FROM tickets g WHERE g.courier_id = $1 AND EXISTS (
       SELECT 1 FROM tickets c WHERE c.courier_id = $2 AND c.namespace = g.namespace AND c.ticket = g.ticket)`,
    [guest.id, courierId],
  );
  await db.query("UPDATE tickets SET courier_id = $2 WHERE courier_id = $1", [guest.id, courierId]);
  return { movements: count, satchels_added: added, parcel, name_kept: created ? "guest" : "courier" };
}

route(
  "POST",
  "/api/auth/redeem",
  "json",
  async (ctx) => {
    const raw = parsedBody(ctx)?.value;
    const token = isObject(raw) && typeof raw.token === "string" ? raw.token : null;
    const previous = await sessionOf(ctx, pool);
    const result = await tx(async (db) => {
      if (token !== null) {
        const key = await one<{ email: string; return_to: string; created_at: Date; used_at: Date | null }>(
          db,
          "SELECT email, return_to, created_at, used_at FROM postbox_keys WHERE id = $1 FOR UPDATE",
          [sha256(token)],
        );
        if (!key) throw new ApiError(410, "link_invalid");
        if (key.used_at) throw new ApiError(410, "link_used");
        if (Date.now() > key.created_at.getTime() + config.postboxKeyTtlSeconds * 1000)
          throw new ApiError(410, "link_expired");
        publishedBody(ctx, { token: true });
        await db.query("UPDATE postbox_keys SET used_at = $2 WHERE id = $1", [sha256(token), new Date()]);
        return signIn(db, key.email, key.return_to, previous?.id ?? null);
      }
      const body = publishedBody(ctx, { token: true });
      throw validation({ token: "token" in body ? "invalid" : "required" });
    });
    return json(200, result.body, { "Set-Cookie": sessionCookie(result.token) });
  },
  false,
);

async function signIn(
  db: pg.PoolClient,
  email: string,
  returnTo: string,
  previousSessionId: string | null,
): Promise<{ body: object; token: string }> {
  let courier = await one<{ id: string }>(db, "SELECT id FROM couriers WHERE email = $1 FOR UPDATE", [email]);
  const created = !courier;
  courier ??= { id: await createCourier(db, "courier", email) };
  let report: object | null = null;
  if (previousSessionId) {
    const guest = await one<GuestSave>(
      db,
      `SELECT c.* FROM sessions s JOIN couriers c ON c.id = s.courier_id
        WHERE s.id = $1 AND s.ended_at IS NULL AND c.role = 'guest' AND c.merged_into IS NULL FOR UPDATE OF c`,
      [previousSessionId],
    );
    if (guest && (await hasProgress(db, guest.id))) report = await mergeGuest(db, guest, courier.id, created);
  }
  const session = await startSession(db, courier.id);
  if (previousSessionId) {
    await db.query("UPDATE sessions SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL", [previousSessionId, new Date()]);
    await moveSessionPresence(db, previousSessionId, session.id);
  }
  const me = (await one<{ role: string; display_name: string }>(db, "SELECT role, display_name FROM couriers WHERE id = $1", [
    courier.id,
  ]))!;
  return {
    token: session.token,
    body: {
      role: me.role,
      display_name: me.display_name,
      balance: await balanceOf(db, courier.id),
      merged_guest: report !== null,
      merge_report: report,
      return_to: returnTo,
    },
  };
}

route("POST", "/api/auth/sign-out", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  publishedBody(ctx, {});
  await tx(async (db) => {
    await db.query("UPDATE sessions SET ended_at = $2 WHERE id = $1", [s.id, new Date()]);
    await dropSessionPresence(db, s.id);
  });
  return noContent({ "Set-Cookie": clearedCookie });
});

