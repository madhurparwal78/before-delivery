// Postcards: upload after the PNG check, the postbox list, revoke, the share page and image,
// mailing a share link within the rolling limit, and the store clean-up.
import { config } from "./config";
import { all, lockKey, one, pool, tx } from "./db";
import { ApiError, conflict, notFound, validation } from "./errors";
import { isObject, json, noContent, parsedBody, publishedBody, route } from "./http";
import { iso, randomId, secretToken } from "./ids";
import { sendPostcard } from "./mail";
import { checkPng } from "./png";
import { deleteObject, getObject, listObjects, putObject } from "./s3";
import { darkroom } from "./services";
import { requireSession, requireSignedIn } from "./sessions";
import { htmlReply, returnedPage, sharePage } from "./pages";
import { storedTicket, storeTicket, ticketHeader } from "./tickets";
import { emailReason } from "./routes-auth";

const POSTBOX_CAP = 24;
const MAIL_LIMIT = 5;
const objectKey = (postcardId: string): string => `postcards/${postcardId}.png`;

interface PostcardRow {
  id: string;
  courier_id: string;
  share_token: string;
  width: number;
  height: number;
  bytes: number;
  created_at: Date;
}

const view = (p: PostcardRow) => ({
  postcard_id: p.id,
  share_url: `${config.base}/p/${p.share_token}`,
  width: p.width,
  height: p.height,
  bytes: p.bytes,
  created_at: iso(p.created_at),
});

async function ownPostcard(courierId: string, postcardId: string): Promise<PostcardRow> {
  const p = await one<PostcardRow>(pool, "SELECT * FROM postcards WHERE id = $1 AND NOT revoked", [postcardId]);
  if (!p || p.courier_id !== courierId) throw notFound();
  return p;
}

const countPostcards = async (courierId: string): Promise<number> =>
  (await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM postcards WHERE courier_id = $1 AND NOT revoked", [courierId]))!
    .n;

route("GET", "/api/postcards", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  requireSignedIn(s.courier);
  const rows = await all<PostcardRow>(
    pool,
    "SELECT * FROM postcards WHERE courier_id = $1 AND NOT revoked ORDER BY created_at DESC, id DESC",
    [s.courier.id],
  );
  return json(200, { postcards: rows.map(view) });
});

route("POST", "/api/postcards", "png", async (ctx) => {
  const s = await requireSession(ctx, pool);
  requireSignedIn(s.courier);
  if ((await countPostcards(s.courier.id)) >= POSTBOX_CAP) throw conflict("postbox_full");
  const checked = checkPng(ctx.raw);
  if (!checked.ok) throw validation({ image: checked.reason });
  const id = randomId("pc_");
  await darkroom.use(() => putObject(objectKey(id), ctx.raw, "image/png"));
  try {
    const row = await tx(async (db) => {
      await lockKey(db, `postbox:${s.courier.id}`);
      if ((await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM postcards WHERE courier_id = $1 AND NOT revoked", [s.courier.id]))!.n >= POSTBOX_CAP)
        throw conflict("postbox_full");
      return (await one<PostcardRow>(
        db,
        `INSERT INTO postcards (id, courier_id, share_token, width, height, bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, s.courier.id, secretToken(), checked.width, checked.height, ctx.raw.length, new Date()],
      ))!;
    });
    return json(201, view(row));
  } catch (error) {
    await deleteObject(objectKey(id)).catch(() => undefined);
    throw error;
  }
});

route("DELETE", "/api/postcards/:postcard_id", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  const p = await ownPostcard(s.courier.id, ctx.params.postcard_id!);
  await pool.query("UPDATE postcards SET revoked = true WHERE id = $1", [p.id]);
  try {
    await darkroom.use(() => deleteObject(objectKey(p.id)));
  } catch (error) {
    await pool.query("UPDATE postcards SET revoked = false WHERE id = $1", [p.id]);
    throw error;
  }
  await pool.query("DELETE FROM postcards WHERE id = $1", [p.id]).catch(() => undefined);
  return noContent();
});

route("POST", "/api/postcards/:postcard_id/mail", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  const ticket = ticketHeader(ctx, "Mail-Ticket");
  const raw = parsedBody(ctx)?.value;
  const binding = JSON.stringify([ctx.params.postcard_id, isObject(raw) ? raw.to : null]);
  return tx(async (db) => {
    const replay = await storedTicket(db, s.courier.id, "mail", ticket, binding);
    if (replay) return replay;
    const p = await ownPostcard(s.courier.id, ctx.params.postcard_id!);
    const body = publishedBody(ctx, { to: true });
    const problem = emailReason(body.to);
    if (problem) throw validation({ to: problem });
    await lockKey(db, `mail-slots:${s.courier.id}`);
    const windowMs = config.mailWindowSeconds * 1000;
    const now = Date.now();
    const counted = await all<{ reserved_at: Date }>(
      db,
      "SELECT reserved_at FROM mail_slots WHERE courier_id = $1 AND reserved_at > $2 ORDER BY reserved_at",
      [s.courier.id, new Date(now - windowMs)],
    );
    if (counted.length >= MAIL_LIMIT) {
      const wait = Math.max(1, Math.ceil((counted[0]!.reserved_at.getTime() + windowMs - now) / 1000));
      throw new ApiError(429, "mail_limit", undefined, { "Retry-After": String(wait) });
    }
    await db.query("INSERT INTO mail_slots (courier_id, reserved_at) VALUES ($1, $2)", [s.courier.id, new Date(now)]);
    const sender = (await one<{ display_name: string }>(db, "SELECT display_name FROM couriers WHERE id = $1", [s.courier.id]))!;
    const sentAt = await sendPostcard(body.to as string, sender.display_name, view(p).share_url);
    const answer = JSON.stringify({ status: "sent", sent_at: iso(sentAt) });
    return storeTicket(db, s.courier.id, "mail", ticket, binding, { status: 200, body: answer });
  });
});

// ---- public share links ----


async function sharedPostcard(token: string): Promise<{ id: string; display_name: string } | undefined> {
  return one(
    pool,
    `SELECT p.id, c.display_name FROM postcards p JOIN couriers c ON c.id = p.courier_id
      WHERE p.share_token = $1 AND NOT p.revoked`,
    [token],
  );
}


route(
  "GET",
  "/p/:token",
  "none",
  async (ctx) => {
    const card = await sharedPostcard(ctx.params.token!);
    return card ? htmlReply(sharePage(ctx.params.token!, card.display_name)) : htmlReply(returnedPage(), 404);
  },
  false,
);

route(
  "GET",
  "/p/:token/image.png",
  "none",
  async (ctx) => {
    const card = await sharedPostcard(ctx.params.token!);
    if (!card) throw notFound();
    const bytes = await darkroom.use(() => getObject(objectKey(card.id)));
    if (!bytes) throw notFound();
    return {
      status: 200,
      body: bytes,
      type: "image/png",
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Disposition": 'inline; filename="postcard.png"',
      },
    };
  },
  false,
);

/** Any deeper path under /p/ is no postcard: the returned-to-sender page, and 405 for other methods. */
route("GET", "/p/:rest*", "none", async () => htmlReply(returnedPage(), 404), false);

/** Removes images older than a minute that no record points at, and records whose image is already gone. */
export async function sweepStore(): Promise<void> {
  const objects = await listObjects("postcards/");
  const records = new Map(
    (await all<{ id: string; revoked: boolean }>(pool, "SELECT id, revoked FROM postcards")).map((r) => [r.id, r.revoked]),
  );
  const cutoff = Date.now() - 60_000;
  const present = new Set<string>();
  for (const o of objects) {
    const id = /^postcards\/(pc_[a-z0-9]+)\.png$/.exec(o.key)?.[1];
    if (id) present.add(id);
    if (o.modified < cutoff && (!id || !records.has(id))) await deleteObject(o.key);
  }
  for (const [id, revoked] of records) if (revoked && !present.has(id)) await pool.query("DELETE FROM postcards WHERE id = $1 AND revoked", [id]);
}
