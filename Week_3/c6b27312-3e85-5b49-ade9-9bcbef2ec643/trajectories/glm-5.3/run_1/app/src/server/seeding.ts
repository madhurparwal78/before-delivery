import type { AppCtx } from "./ctx.js";
import { SEED_PARTS, SEED_USERS, SEED_EXTRA_REVISIONS, SEED_LIKES, HERO_SOURCE } from "./seed.js";
import { createRevision } from "./revisions.js";
import { newId, hashPassword, foldEmail } from "./auth.js";
import { evaluate } from "./evaluate.js";
import { parseStored } from "./domain.js";
import { Buffer } from "node:buffer";
import { canonicalJson, digestOf } from "../shared/canonical.js";
import { thumbnailSvg } from "./thumbnail.js";

/** Apply seed data and bucket objects idempotently, every time the app serves. */
export async function seed(ctx: AppCtx): Promise<void> {
  // Users: created once, kept as they are.
  const userIds = new Map<string, string>();
  for (const u of SEED_USERS) {
    const rows = await ctx.db.query(`select id from users where email = $1`, [foldEmail(u.email)]);
    if (rows.rows.length > 0) {
      userIds.set(u.key, rows.rows[0]!.id as string);
      continue;
    }
    const id = newId("user");
    await ctx.db.query(
      `insert into users (id, email, password_hash, display_name, verified) values ($1,$2,$3,$4,true)`,
      [id, foldEmail(u.email), hashPassword(u.password), u.displayName]
    );
    userIds.set(u.key, id);
  }

  // Seed revisions only when the part is absent; when storage is down here,
  // this copy leaves object creation to the copy that can reach storage.
  const storageHere = ctx.storageUp;
  for (const part of SEED_PARTS) {
    const exists = await ctx.db.query(`select 1 from parts where slug = $1`, [part.slug]);
    if (exists.rows.length > 0) continue;
    if (!storageHere) continue;
    const ownerId = userIds.get(part.ownerKey)!;
    await ctx.db.query(
      `insert into parts (slug, title, category, visibility, owner_id, seed_position, created_at)
       values ($1,$2,$3,'public',$4,$5,$6)`,
      [part.slug, part.title, part.category, ownerId, part.seedPosition, part.createdAt]
    );
    await createRevision(ctx, {
      partSlug: part.slug, parentRevisionId: null, authorId: ownerId,
      values: {}, source: part.source, message: "First version",
    });
    for (const extra of SEED_EXTRA_REVISIONS.filter((e) => e.part === part.slug)) {
      await createRevision(ctx, {
        partSlug: part.slug,
        parentRevisionId: (await ctx.db.query(`select id from revisions where part_slug = $1 order by label desc limit 1`, [part.slug])).rows[0]!.id,
        authorId: userIds.get(extra.authorKey)!, values: extra.values, source: part.source, message: extra.message,
      });
    }
  }

  // The hidden hero part: evaluable but never listed (private, owned by the first seeded user).
  if (storageHere) {
    const exists = await ctx.db.query(`select 1 from parts where slug = 'hero-cable-clip'`);
    if (exists.rows.length === 0) {
      const ownerId = userIds.get("ines")!;
      await ctx.db.query(
        `insert into parts (slug, title, category, visibility, owner_id, created_at)
         values ('hero-cable-clip', 'Hero cable clip', 'organisers', 'public', $1, $2)
         on conflict (slug) do nothing`,
        [ownerId, new Date().toISOString()]
      );
      await createRevision(ctx, {
        partSlug: "hero-cable-clip", parentRevisionId: null, authorId: ownerId,
        values: {}, source: HERO_SOURCE, message: "First version",
      });
    }
    const parsed = parseStored(HERO_SOURCE);
    const evaluated = evaluate(parsed, {}, 8000);
    if ("ok" in evaluated) {
      const digest = evaluated.ok.digest;
      const json = canonicalJson(evaluated.ok.solid);
      if (digestOf(json) === digest) {
        await ctx.putObject(`solids/${digest}.json`, Buffer.from(json, "utf8"), "application/json").catch(() => {});
        await ctx.putObject(`thumbnails/${digest}.svg`, Buffer.from(thumbnailSvg(evaluated.ok.solid), "utf8"), "image/svg+xml").catch(() => {});
      }
    }
  }

  // Likes: one record per person per part, only for parts that exist.
  for (const like of SEED_LIKES) {
    for (const userKey of like.users) {
      const userId = userIds.get(userKey)!;
      await ctx.db.query(
        `insert into likes (part_slug, user_id) values ($1,$2) on conflict do nothing`,
        [like.part, userId]
      );
    }
  }
}
