// Sign-in and sign-out, the signed-in user, the member's ledger, packs and member search.
import { randomBytes } from "node:crypto";
import { one, pool, rows, theRow, tx, type Db } from "./db.ts";
import { quartersToHours } from "../shared/rules.ts";
import { ApiError } from "./http.ts";
import { now } from "./clock.ts";
import { json, type AuthedCtx, type Ctx, type Reply } from "./router.ts";
import { Fields } from "./validate.ts";
import {
  clearSignInFailures,
  clearingCookies,
  clientAddress,
  destroySession,
  openSession,
  recordSignInFailure,
  throttleRetryAfter,
  userByEmail,
  type SessionUser,
} from "./auth.ts";
import { currentDraft } from "./audit.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { balances, lockMember } from "./ledger.ts";
import { validThrough } from "./coverage.ts";
import { movements } from "./projections.ts";
import { ownMemberId } from "./scope.ts";
import type { Me } from "../shared/api.ts";

async function meBody(db: Db, user: SessionUser): Promise<Me> {
  const tenant = await theRow<{ id: string; name: string; legal_name: string }>(db, "SELECT id, name, legal_name FROM tenants WHERE id = $1", [user.tenantId]);
  const base: Me["user"] = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenant,
    site_id: user.siteId,
  };
  if (user.memberId === null) return { user: base, member: null };
  const memberId = user.memberId;
  await lockMember(db, memberId, now());
  const member = await theRow<{ business_name: string; home_site_id: string }>(db, "SELECT business_name, home_site_id FROM members WHERE id = $1", [memberId]);
  const truck = await one<{ id: string; name: string; permit_number: string }>(db, "SELECT id, name, permit_number FROM trucks WHERE member_id = $1", [memberId]);
  const held = await balances(db, memberId, now());
  return {
    user: base,
    member: {
      id: memberId,
      business_name: member.business_name,
      home_site_id: member.home_site_id,
      available_hours: held.available_hours,
      committed_hours: held.committed_hours,
      valid_through: await validThrough(db, memberId),
      truck: truck ?? null,
    },
  };
}

/** A hash no password matches, so an unknown email costs the same as a wrong password. */
const NO_ACCOUNT_HASH = hashPassword(randomBytes(16).toString("hex"));

// POST /api/session
export async function signIn(ctx: Ctx): Promise<Reply> {
  const fields = new Fields(ctx.body, ["email", "password"]);
  const email = fields.email("email", "Enter a valid email address.");
  const rawPassword = fields.raw("password");
  const password =
    typeof rawPassword === "string" && rawPassword.length >= 1 && rawPassword.length <= 200 ? rawPassword : fields.fail("password", "Enter your password.");
  if (email === undefined || password === undefined) return fields.reject();
  fields.raise();
  const user = await userByEmail(email);
  const matched = await verifyPassword(password, user?.passwordHash ?? (await NO_ACCOUNT_HASH));
  const address = clientAddress(ctx.req);
  const at = now();
  return tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", [address]);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))", [email]);
    const retryAfter = await throttleRetryAfter(db, email, address, at);
    if (retryAfter !== null) throw new ApiError("too_many_attempts", { headers: { "Retry-After": String(retryAfter) } });
    if (!user || !matched) {
      await recordSignInFailure(email, address, at);
      throw new ApiError("invalid_credentials");
    }
    await clearSignInFailures(db, email);
    const draft = currentDraft();
    if (draft) {
      draft.actor = { userId: user.id, name: user.name, role: user.role };
      draft.subjectUserId = user.id;
    }
    const cookies = await openSession(db, ctx.req, user.id, at);
    return json(200, await meBody(db, user), { "Set-Cookie": cookies });
  });
}

// DELETE /api/session
export async function signOut(ctx: Ctx): Promise<Reply> {
  const fields = new Fields(ctx.body, []);
  fields.raise();
  const tokenHash = ctx.sessionTokenHash;
  return tx(async (db) => {
    if (tokenHash !== null) await destroySession(db, tokenHash);
    return { kind: "empty", status: 204, headers: { "Set-Cookie": clearingCookies(ctx.req) } };
  });
}

// GET /api/me
export async function me(ctx: AuthedCtx): Promise<Reply> {
  return tx(async (db) => json(200, await meBody(db, ctx.user)));
}

// GET /api/me/ledger
export async function ledger(ctx: AuthedCtx): Promise<Reply> {
  const memberId = ownMemberId(ctx.user);
  return tx(async (db) => {
    await lockMember(db, memberId, now());
    return json(200, { balances: await balances(db, memberId, now()), movements: await movements(db, memberId) });
  });
}

// GET /api/packs
export async function listPacks(ctx: AuthedCtx): Promise<Reply> {
  const list = await rows<{ id: string; name: string; quarters: number; price_cents: number }>(
    pool,
    "SELECT id, name, quarters, price_cents FROM packs WHERE tenant_id = $1 ORDER BY position",
    [ctx.user.tenantId],
  );
  return json(200, { packs: list.map((p) => ({ id: p.id, name: p.name, hours: quartersToHours(p.quarters), price_cents: p.price_cents })) });
}

// GET /api/members?q=
export async function searchMembers(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const q = ctx.query.get("q");
  if (q === null || q.length < 2 || q.length > 100) throw new ApiError("validation", { fields: { q: "Type 2 to 100 characters." } });
  if (q.includes("\0")) return json(200, { members: [] });
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const list = await rows<{ id: string; business_name: string; contact_name: string; home_site_id: string; truck_id: string | null; truck_name: string | null }>(
    pool,
    `SELECT m.id, m.business_name, u.name AS contact_name, m.home_site_id, t.id AS truck_id, t.name AS truck_name
       FROM members m JOIN users u ON u.id = m.user_id LEFT JOIN trucks t ON t.member_id = m.id
      WHERE m.tenant_id = $1 AND ($2::uuid IS NULL OR m.home_site_id = $2)
        AND (m.business_name ILIKE $3 OR u.name ILIKE $3)
      ORDER BY m.business_name LIMIT 10`,
    [user.tenantId, user.role === "kitchen_manager" ? user.siteId : null, pattern],
  );
  return json(200, {
    members: list.map((m) => ({
      id: m.id,
      business_name: m.business_name,
      contact_name: m.contact_name,
      home_site_id: m.home_site_id,
      truck: m.truck_id === null || m.truck_name === null ? null : { id: m.truck_id, name: m.truck_name },
    })),
  });
}
