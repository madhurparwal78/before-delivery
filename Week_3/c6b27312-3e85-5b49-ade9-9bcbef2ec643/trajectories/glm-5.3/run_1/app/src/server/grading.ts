import type { AppCtx } from "./ctx.js";
import type { Response } from "express";
import { newId, hashPassword, foldEmail } from "./auth.js";
import { createRevision } from "./revisions.js";
import { parseSource } from "./tine.js";
import { SEED_PARTS, SEED_USERS } from "./seed.js";
import type { Values } from "../shared/records.js";
import { digestOf } from "../shared/canonical.js";
import { httpError } from "./http.js";

/** The grading setup route: create everything in one call, no mail, one createdAt. */
export async function gradingSetup(ctx: AppCtx, body: Record<string, unknown>, _req: unknown, res: Response): Promise<void> {
  const startedAt = new Date();
  const createdAt = startedAt;
  const out: Record<string, Record<string, unknown>> = { users: {}, parts: {}, revisions: {}, rooms: {}, comments: {} };
  const userByKey = new Map<string, string>();
  const partByKey = new Map<string, string>();
  const slugByKey = new Map<string, string>();
  const revisionByKey = new Map<string, string>();
  const roomByKey = new Map<string, string>();

  const fail = (field: string, message: string): never => {
    throw httpError(422, "invalid", "Check the highlighted fields.", { errors: { [field]: message } });
  };

  // users
  const users = (body.users ?? []) as Array<Record<string, unknown>>;
  for (const u of users) {
    const key = String(u.key ?? "");
    const email = String(u.email ?? "");
    const password = String(u.password ?? "");
    const displayName = String(u.displayName ?? "");
    const verified = u.verified !== false;
    if (!key || !email || !password) fail("users", "Each user needs key, email and password.");
    const id = newId("user");
    await ctx.db.query(
      `insert into users (id, email, password_hash, display_name, verified, created_at) values ($1,$2,$3,$4,$5,$6)
       on conflict (email) do update set verified = excluded.verified`,
      [id, foldEmail(email), hashPassword(password), displayName, verified, createdAt]
    );
    const row = await ctx.db.query(`select id from users where email = $1`, [foldEmail(email)]);
    const userId = row.rows[0]!.id as string;
    userByKey.set(key, userId);
    const sid = newId("session");
    await ctx.db.query(`insert into sessions (id, user_id) values ($1,$2)`, [sid, userId]);
    out.users[key] = { id: userId, cookie: `tw_session=${sid}` };
  }

  // parts
  const parts = (body.parts ?? []) as Array<Record<string, unknown>>;
  for (const p of parts) {
    const key = String(p.key ?? "");
    const ownerKey = String(p.owner ?? "");
    const from = p.from !== undefined ? String(p.from) : undefined;
    let title: string, category: string, slug: string, source: string;
    if (from !== undefined) {
      const seeded0 = SEED_PARTS.find((s) => s.slug === from);
      if (seeded0) {
        title = p.title !== undefined ? String(p.title) : seeded0.title;
        category = p.category !== undefined ? String(p.category) : seeded0.category;
        slug = p.slug !== undefined ? String(p.slug) : `${from}-copy-${Math.random().toString(16).slice(2, 8)}`;
        source = seeded0.source;
      } else {
        title = String(p.title ?? "");
        category = String(p.category ?? "");
        slug = String(p.slug ?? "");
        source = "";
        fail("parts", `Unknown seed part ${from}.`);
      }
    } else {
      title = String(p.title ?? "");
      category = String(p.category ?? "");
      slug = String(p.slug ?? "");
      source = String(p.source ?? "");
      if (!slug || !title || !source) fail("parts", "Each part needs slug, title and source.");
      const parsed = parseSource(source);
      if ("error" in parsed) fail("parts", `Line ${parsed.error.line}: ${parsed.error.reason}`);
    }
    const ownerId = userByKey.get(ownerKey);
    if (!ownerId) fail("parts", `Unknown user ${ownerKey}.`);
    await ctx.db.query(
      `insert into parts (slug, title, category, visibility, owner_id, created_at) values ($1,$2,$3,$4,$5,$6)
       on conflict (slug) do nothing`,
      [slug, title, category, p.visibility === "private" ? "private" : "public", ownerId, createdAt]
    );
    const sourceKey = `sources/${digestOf(source)}.tine`;
    await ctx.db.query(`insert into sources (key, bytes) values ($1,$2) on conflict (key) do nothing`, [sourceKey, source]);
    partByKey.set(key, slug);
    slugByKey.set(key, slug);
    // r1 at source defaults.
    const r = await createRevision(ctx, {
      partSlug: slug, parentRevisionId: null, authorId: ownerId!, values: {}, source, message: "First version",
    });
    revisionByKey.set(`${key}:r1`, r.id);
    out.parts[key] = { slug, headRevisionId: r.id };
  }

  // revisions
  const revisions = (body.revisions ?? []) as Array<Record<string, unknown>>;
  for (const rv of revisions) {
    const key = String(rv.key ?? "");
    const partRef = String(rv.part ?? "");
    const authorKey = String(rv.author ?? "");
    const values = (rv.values ?? {}) as Values;
    const message = String(rv.message ?? "");
    const slug = partByKey.get(partRef) ?? (slugByKey.has(partRef) ? partRef : partRef);
    const ownerId = userByKey.get(authorKey);
    if (!ownerId) fail("revisions", `Unknown user ${authorKey}.`);
    const headRow = await ctx.db.query(`select id from revisions where part_slug = $1 order by label desc limit 1`, [slug]);
    const head = headRow.rows[0]?.id as string | undefined;
    const sourceRow = await ctx.db.query(`select source_key from revisions where id = $1`, [head]);
    const source = sourceRow.rows[0] ? (await ctx.db.query(`select bytes from sources where key = $1`, [sourceRow.rows[0].source_key])).rows[0].bytes.toString("utf8") : "";
    const r = await createRevision(ctx, {
      partSlug: slug, parentRevisionId: head ?? null, authorId: ownerId!, values, source, message,
    });
    revisionByKey.set(key, r.id);
    out.revisions[key] = { id: r.id, label: `r${r.label}` };
  }

  // rooms
  const rooms = (body.rooms ?? []) as Array<Record<string, unknown>>;
  for (const room of rooms) {
    const key = String(room.key ?? "");
    const partRef = String(room.part ?? "");
    const ownerKey = String(room.owner ?? "");
    const title = String(room.title ?? "");
    const reviewers = (room.reviewers ?? []) as string[];
    const slug = partByKey.get(partRef) ?? partRef;
    const ownerId = userByKey.get(ownerKey);
    if (!ownerId) fail("rooms", `Unknown user ${ownerKey}.`);
    const id = newId("room");
    await ctx.db.query(
      `insert into rooms (id, part_slug, title, state, required_approvals, created_by, created_at)
       values ($1,$2,$3,'open',$4,$5,$6)`,
      [id, slug, title, ctx.config.requiredApprovals, ownerId, createdAt]
    );
    for (const reviewerKey of reviewers) {
      const reviewerId = userByKey.get(reviewerKey);
      const userRow = reviewerId ? await ctx.db.query(`select email, display_name from users where id = $1`, [reviewerId]) : null;
      const email = userRow?.rows[0]?.email ?? reviewerKey;
      await ctx.db.query(
        `insert into room_reviewers (room_id, email, user_id) values ($1,$2,$3) on conflict do nothing`,
        [id, email, reviewerId ?? null]
      );
    }
    roomByKey.set(key, id);
    out.rooms[key] = { id };
  }

  // comments
  const comments = (body.comments ?? []) as Array<Record<string, unknown>>;
  for (const c of comments) {
    const key = String(c.key ?? "");
    const roomRef = String(c.room ?? "");
    const authorKey = String(c.author ?? "");
    const bodyText = String(c.body ?? "");
    const anchor = (c.anchor ?? { kind: "none" }) as Record<string, unknown>;
    const pose = (c.pose ?? {}) as Record<string, unknown>;
    const roomId = roomByKey.get(roomRef) ?? roomRef;
    const authorId = userByKey.get(authorKey);
    if (!authorId) fail("comments", `Unknown user ${authorKey}.`);
    const roomRow = await ctx.db.query(`select part_slug from rooms where id = $1`, [roomId]);
    const slug = roomRow.rows[0]?.part_slug as string | undefined;
    const headRow = slug ? await ctx.db.query(`select id from revisions where part_slug = $1 order by label desc limit 1`, [slug]) : null;
    const id = newId("comment");
    await ctx.db.query(
      `insert into comments (id, room_id, author_id, body, anchor, pose, revision_id, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, roomId, authorId, bodyText, JSON.stringify(anchor), JSON.stringify(pose), headRow?.rows[0]?.id ?? "", createdAt]
    );
    out.comments[key] = { id };
  }

  // approvals
  const approvals = (body.approvals ?? []) as Array<Record<string, unknown>>;
  for (const a of approvals) {
    const roomRef = String(a.room ?? "");
    const reviewerKey = String(a.reviewer ?? "");
    const roomId = roomByKey.get(roomRef) ?? roomRef;
    const reviewerId = userByKey.get(reviewerKey);
    if (!reviewerId) fail("approvals", `Unknown user ${reviewerKey}.`);
    const roomRow = await ctx.db.query(`select part_slug from rooms where id = $1`, [roomId]);
    const slug = roomRow.rows[0]?.part_slug as string | undefined;
    const headRow = slug ? await ctx.db.query(`select id, geometry_digest from revisions where part_slug = $1 order by label desc limit 1`, [slug]) : null;
    if (!headRow?.rows[0]) continue;
    await ctx.db.query(
      `insert into approvals (room_id, reviewer_id, revision_id, geometry_digest, at) values ($1,$2,$3,$4,$5)
       on conflict do nothing`,
      [roomId, reviewerId, headRow.rows[0].id, headRow.rows[0].geometry_digest, createdAt]
    );
    const count = await ctx.db.query(
      `select count(*)::int as n from approvals where room_id = $1 and geometry_digest = $2`,
      [roomId, headRow.rows[0].geometry_digest]
    );
    if (count.rows[0]!.n >= ctx.config.requiredApprovals) {
      await ctx.db.query(`update rooms set state = 'approved' where id = $1`, [roomId]);
    }
  }

  // likes
  const likes = (body.likes ?? []) as Array<Record<string, unknown>>;
  for (const l of likes) {
    const partRef = String(l.part ?? "");
    const usersList = (l.users ?? []) as string[];
    const slug = partByKey.get(partRef) ?? partRef;
    for (const u of usersList) {
      const userId = userByKey.get(u);
      if (!userId) fail("likes", `Unknown user ${u}.`);
      await ctx.db.query(
        `insert into likes (part_slug, user_id, created_at) values ($1,$2,$3) on conflict do nothing`,
        [slug, userId, createdAt]
      );
    }
  }

  res.status(201).json(out);
}

export { SEED_USERS };
