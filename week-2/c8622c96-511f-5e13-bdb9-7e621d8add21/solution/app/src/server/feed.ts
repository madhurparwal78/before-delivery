// The contact sheet feed and search, and the frame media it points at.
import { coopTime, isoInstant } from "../shared/coop-time.js";
import { serverNow } from "./clock.js";
import { one, query } from "./db.js";
import { creditLine, creditsOf, isCredited, licencesOnEssays, mediaUrl, visibleEssay, windowBody, type EssayRow } from "./essay-model.js";
import { notFound, sendJson } from "./http.js";
import { ON_SHEET } from "./lifecycle.js";
import { on, type Ctx } from "./router.js";
import { getObject, keys, VARIANTS, type Variant } from "./s3.js";
import { drawSeededFrame, seedFrameOf } from "./seed-media.js";

on("GET", "/api/feed", "none", async (ctx: Ctx) => {
  const q = (ctx.url.searchParams.get("q") ?? "").toLowerCase();
  const essays = await query<EssayRow & { frame_count: number; cover: string | null }>(
    `SELECT e.*, (SELECT count(*)::int FROM frames f WHERE f.essay_id = e.id) AS frame_count,
       (SELECT f.id FROM frames f WHERE f.essay_id = e.id ORDER BY f.position LIMIT 1) AS cover
     FROM essays e
     WHERE e.state = ANY($2) AND ($1 = '' OR strpos(lower(e.title), $1) > 0
       OR strpos(lower(e.caption), $1) > 0
       OR EXISTS (SELECT 1 FROM frames f WHERE f.essay_id = e.id AND strpos(lower(f.caption), $1) > 0)
       OR EXISTS (SELECT 1 FROM credits c JOIN people p ON p.handle = c.handle
                  WHERE c.essay_id = e.id AND strpos(lower(p.name), $1) > 0))
     ORDER BY e.lift_at DESC, e.id`, [q, ON_SHEET]);
  const ids = essays.map((e) => e.id);
  const [credits, licences, now] = await Promise.all([creditsOf(ids), licencesOnEssays(ids), serverNow()]);
  sendJson(ctx.res, 200, { essays: essays.map((e) => ({
    id: e.id,
    title: e.title,
    credit_line: creditLine(credits.filter((c) => c.essay_id === e.id).map((c) => c.name)),
    state: e.state,
    lift_at: isoInstant(e.lift_at),
    lift_display: coopTime(e.lift_at),
    frame_count: e.frame_count,
    cover_url: e.cover ? mediaUrl(e.cover, "grid") : null,
    window: windowBody(ctx.person, licences.filter((l) => l.essay_id === e.id), now),
  })) });
});

on("GET", "/media/frames/:frame/:variant", "none", async (ctx: Ctx) => {
  const [frameId = "", variant = ""] = ctx.params;
  const frame = await one<{ id: string; essay_id: string }>("SELECT id, essay_id FROM frames WHERE id = $1", [frameId]);
  if (!frame || !(VARIANTS as readonly string[]).includes(variant)) throw notFound();
  const essay = await visibleEssay(ctx.person, frame.essay_id);
  if (essay.state === "taken_down") throw notFound();
  const mayStory = ctx.person.role === "desk_editor"
    || (ctx.person.role === "contributor" && isCredited(ctx.person, await creditsOf([essay.id])));
  if (variant === "story" && !mayStory) throw notFound();
  const key = keys.derivative(essay.id, frame.id, variant as Variant);
  let bytes = await getObject(key);
  const seeded = bytes ? null : seedFrameOf(frame);
  if (seeded) {
    await drawSeededFrame(seeded);
    bytes = await getObject(key);
  }
  if (!bytes) throw notFound();
  ctx.res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": String(bytes.length),
    "Cache-Control": "private, max-age=300" });
  ctx.res.end(bytes);
});
