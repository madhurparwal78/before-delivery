// Waitlists (brief: Business rules → Waitlist and opt-in, Rate limit, Names in mail).
import { COPY, FIELD, rateLimited, tooLong } from "../shared/copy";
import { marketTime } from "../shared/format";
import { CITY, type Market, instantText } from "../shared/time";
import { randomToken, requireRole, sha256, staff } from "./auth";
import { config } from "./config";
import { type Db, nowSeconds, one, pool, rows, tx } from "./db";
import { type DropRow, staffDrop } from "./drops";
import { ApiError, type Ctx, type Json, reply, route, validationFailed } from "./http";
import { holdStatus } from "./holds";
import { queueMail } from "./mail";
import { publicDrop } from "./public";
import { checkEmail, checkMarket, failed, type Fields, graphemes } from "./validate";

/** A shopper's name folded to one line: trimmed, each run of line breaks and the spaces around it one space. */
export function foldName(value: unknown, path: string, fields: Fields): string {
  const name = typeof value === "string" ? value.replace(/[ \t]*[\r\n\u0085\u2028\u2029]+[ \t]*/g, " ").trim() : "";
  if (!name) fields[path] = FIELD.required;
  else if (graphemes(name) > 60) fields[path] = tooLong(60);
  return name;
}

/** Step 3 of the ladder: at most 5 joins per client address in the window, counted across every copy. */
async function rateLimit(ctx: Ctx): Promise<void> {
  const client = ctx.clientAddress();
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`waitlist:${client}`]);
    const now = Date.now();
    const since = new Date(now - config.ttl.rateWindow * 1000);
    const counted = await rows<{ at: Date }>(db, "SELECT at FROM waitlist_joins WHERE client = $1 AND at > $2 ORDER BY at", [client, since]);
    if (counted.length >= 5) {
      const seconds = Math.max(1, Math.ceil((counted[0].at.getTime() + config.ttl.rateWindow * 1000 - now) / 1000));
      throw new ApiError(429, "rate_limited", rateLimited(seconds), { retryAfterSeconds: seconds }, { "Retry-After": String(seconds) });
    }
    await db.query("INSERT INTO waitlist_joins (client, at) VALUES ($1, $2)", [client, new Date(now)]);
  });
}

async function sendOptIn(db: Db, drop: DropRow, entry: { id: string; name: string; email: string; market: Market }): Promise<void> {
  const token = randomToken();
  const issued = nowSeconds();
  const expires = new Date(issued.getTime() + config.ttl.optIn * 1000);
  await db.query("UPDATE waitlist_members SET opt_in_token_hash = $2, opt_in_expires_at = $3 WHERE id = $1", [entry.id, sha256(token), expires]);
  await queueMail(db, {
    toName: entry.name,
    toEmail: entry.email,
    subject: `Confirm your place on the ${drop.name} waitlist`,
    body: `Hello ${entry.name},\n\nConfirm your place on the ${drop.name} waitlist for ${CITY[entry.market]}:\n${config.publicUrl}/waitlist/confirm/${token}\n\nThe link works once and expires ${marketTime(expires.getTime(), entry.market)}.\n`,
  });
}

route("POST", "/api/public/drops/{slug}/waitlist", "json", async (ctx) => {
  await rateLimit(ctx);
  const drop = await publicDrop(pool, ctx.params.slug);
  const body = ctx.json();
  if (drop.status === "sold_out") throw new ApiError(409, "drop_closed", COPY.dropClosed);
  const fields: Fields = {};
  const market = checkMarket(body.market, "market", fields);
  const name = foldName(body.name, "name", fields);
  const email = checkEmail(body.email, "email", fields);
  if (body.consent !== true) fields.consent = FIELD.consent;
  if (failed(fields)) throw validationFailed(fields);
  await tx(async (db) => {
    await db.query(
      "INSERT INTO waitlist_members (drop_id, market, name, email, status, joined_at) VALUES ($1, $2, $3, $4, 'pending', $5) ON CONFLICT DO NOTHING",
      [drop.id, market, name, email, nowSeconds()],
    );
    const entry = await one<{ id: string; name: string; email: string; status: string; opt_in_expires_at: Date | null }>(
      db,
      "SELECT id, name, email, status, opt_in_expires_at FROM waitlist_members WHERE drop_id = $1 AND market = $2 AND lower(email) = lower($3) FOR UPDATE",
      [drop.id, market, email],
    );
    if (!entry || entry.status === "confirmed") return;
    if (entry.opt_in_expires_at && Date.now() < entry.opt_in_expires_at.getTime()) return;
    await sendOptIn(db, drop, { id: entry.id, name: entry.name, email: entry.email, market });
  });
  return reply(202, { status: "check_email" });
});

route("POST", "/api/public/waitlist/confirm", "json", async (ctx) => {
  const body = ctx.json();
  return tx(async (db) => {
    const entry =
      typeof body.token === "string"
        ? await one<{ id: string; status: string; market: Market; opt_in_expires_at: Date; drop_name: string; drop_status: string }>(
            db,
            `SELECT w.id, w.status, w.market, w.opt_in_expires_at, d.name AS drop_name, d.status AS drop_status
             FROM waitlist_members w JOIN drops d ON d.id = w.drop_id WHERE w.opt_in_token_hash = $1 FOR UPDATE OF w`,
            [sha256(body.token)],
          )
        : undefined;
    if (!entry) throw new ApiError(404, "not_found", COPY.optInExpired);
    if (entry.drop_status === "withdrawn") throw new ApiError(410, "drop_withdrawn", COPY.dropWithdrawnPublic);
    if (entry.status === "confirmed") throw new ApiError(410, "link_used", COPY.optInUsed);
    if (Date.now() >= entry.opt_in_expires_at.getTime()) throw new ApiError(410, "link_expired", COPY.optInExpired);
    await db.query("UPDATE waitlist_members SET status = 'confirmed', confirmed_at = $2 WHERE id = $1", [entry.id, nowSeconds()]);
    return reply(200, { status: "confirmed", dropName: entry.drop_name, market: entry.market });
  });
});

interface Entry {
  id: string;
  name: string;
  email: string;
  market: Market;
  status: string;
  joined_at: Date;
  position: number;
  hold_status: string | null;
  offered_at: Date | null;
  expires_at: Date | null;
}

function entryJson(e: Entry, nowMs: number): Json {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    market: e.market,
    status: e.status,
    joinedAt: instantText(e.joined_at.getTime()),
    position: e.position,
    hold:
      e.hold_status && e.offered_at && e.expires_at
        ? { status: holdStatus(e.hold_status, e.expires_at, nowMs), offeredAt: instantText(e.offered_at.getTime()), expiresAt: instantText(e.expires_at.getTime()) }
        : null,
  };
}

async function entries(db: Db, dropId: string, ids?: string[]): Promise<Json[]> {
  const found = await rows<Entry>(
    db,
    `SELECT w.id, w.name, w.email, w.market, w.status, w.joined_at,
       (row_number() OVER (PARTITION BY w.market ORDER BY w.join_position))::int AS position,
       h.status AS hold_status, h.offered_at, h.expires_at
     FROM waitlist_members w LEFT JOIN holds h ON h.waitlist_member_id = w.id
     WHERE w.drop_id = $1 ORDER BY w.market, w.join_position`,
    [dropId],
  );
  const now = Date.now();
  return found.filter((e) => !ids || ids.includes(e.id)).map((e) => entryJson(e, now));
}

route("GET", "/api/drops/{dropId}/waitlist", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "launch_producer", "merchandiser");
  return reply(200, { items: await entries(pool, drop.id) });
});

route("POST", "/api/drops/{dropId}/waitlist/vip", "json", async (ctx) => {
  const me = await staff(ctx);
  const found = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "launch_producer");
  const body = ctx.json();
  if (found.status === "withdrawn") throw new ApiError(409, "drop_withdrawn_already", COPY.dropWithdrawnAlready);
  const fields: Fields = {};
  const market = checkMarket(body.market, "market", fields);
  const list = Array.isArray(body.members) ? body.members : [];
  if (list.length < 1 || list.length > 200) fields.members = list.length ? "Add at most 200 VIP members at once." : FIELD.required;
  const members = list.map((raw, i) => {
    const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return { name: foldName(m.name, `members.${i}.name`, fields), email: checkEmail(m.email, `members.${i}.email`, fields) };
  });
  if (failed(fields)) throw validationFailed(fields);
  return tx(async (db) => {
    const ids: string[] = [];
    for (const m of members) {
      const now = nowSeconds();
      const row = await one<{ id: string }>(
        db,
        `INSERT INTO waitlist_members (drop_id, market, name, email, status, joined_at, confirmed_at) VALUES ($1, $2, $3, $4, 'confirmed', $5, $5)
         ON CONFLICT (drop_id, market, lower(email)) DO UPDATE SET status = 'confirmed', confirmed_at = coalesce(waitlist_members.confirmed_at, $5)
         RETURNING id`,
        [found.id, market, m.name, m.email, now],
      );
      if (row) ids.push(row.id);
    }
    return reply(201, { items: await entries(db, found.id, ids) });
  });
});
