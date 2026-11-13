// The grading routes: build a world in one call, hold a part's evaluations, count a viewer's evaluations.
import type { Json } from "../shared/canonical";
import { foldEmail, normalizeText } from "../shared/text";
import { type Values } from "../shared/tine";
import { insertUser, isEmail, createSession } from "./auth";
import { CATEGORIES } from "./categories";
import { db } from "./db";
import { invalid, notFound } from "./errors";
import type { Ctx } from "./http";
import { get, post, type Route } from "./route";
import { sessionPair } from "./cookies";
import { approve, insertComment, insertRoom, parseAnchor, parsePose } from "./rooms";
import { applyLike } from "./parts";
import { headRevision, isReviewer, loadPart, modelOf, requirePart, sourceText } from "./records";
import { jsonReply, noContent } from "./reply";
import { commitRevision, createPart, freshSlug, prepareRevision } from "./revisions";
import { attempt, key } from "./valkey";
import { validateValues } from "./values";

type Entry = Record<string, Json | undefined>;

const MAX_DELAY_MS = 600_000;

function entries(body: Record<string, Json>, list: string): Entry[] {
  const value = body[list];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
    throw invalid({ [list]: "Send a list of objects." });
  }
  return value as Entry[];
}

const text = (entry: Entry, field: string, where: string): string => {
  const value = entry[field];
  if (typeof value !== "string" || value === "") throw invalid({ [`${where}.${field}`]: "Send a non-empty text." });
  return value;
};

/** The id a key names, from this call's keys. */
function named<T>(map: Map<string, T>, entry: Entry, field: string, where: string): T {
  const found = map.get(text(entry, field, where));
  if (found === undefined) throw invalid({ [`${where}.${field}`]: "Unknown key." });
  return found;
}

async function setup(ctx: Ctx) {
  const body = ctx.json();
  ctx.checkNumbers();
  const now = new Date();
  const users = new Map<string, { id: string; email: string; verified: boolean; cookie: string }>();
  const parts = new Map<string, string>();
  const revisions = new Map<string, { id: string; label: string }>();
  const rooms = new Map<string, string>();
  const comments = new Map<string, string>();

  for (const [i, spec] of entries(body, "users").entries()) {
    const where = `users[${i}]`;
    const email = text(spec, "email", where);
    if (!isEmail(email) || (await db.row("SELECT 1 FROM users WHERE email_fold = $1", [foldEmail(email)]))) throw invalid({ [`${where}.email`]: "Send an unused email address." });
    const verified = spec.verified !== false;
    const id = await insertUser(db, { email, password: text(spec, "password", where), displayName: text(spec, "displayName", where), verified, createdAt: now });
    users.set(text(spec, "key", where), { id, email, verified, cookie: sessionPair(await createSession(db, id)) });
  }

  for (const [i, spec] of entries(body, "parts").entries()) {
    const where = `parts[${i}]`;
    const owner = named(users, spec, "owner", where);
    const seeded = typeof spec.from === "string" ? await loadPart(db, spec.from) : undefined;
    if (typeof spec.from === "string" && !seeded) throw invalid({ [`${where}.from`]: "Unknown part." });
    const source = seeded ? await sourceText(db, (await headRevision(db, seeded.slug)).source_ref) : text(spec, "source", where);
    const title = typeof spec.title === "string" ? spec.title : seeded?.title;
    const category = typeof spec.category === "string" ? spec.category : seeded?.category;
    if (!title || !CATEGORIES.some((c) => c.slug === category)) throw invalid({ [`${where}.category`]: "Send a title and a known category." });
    const slug = typeof spec.slug === "string" && spec.slug !== "" ? spec.slug : await freshSlug(title);
    const first = await createPart({
      slug, title, category: category as string, visibility: spec.visibility === "private" ? "private" : "public", ownerId: owner.id,
      sourceText: source, values: {}, message: "First version", createdAt: now,
    });
    parts.set(text(spec, "key", where), first.part_slug);
  }

  for (const [i, spec] of entries(body, "revisions").entries()) {
    const where = `revisions[${i}]`;
    const reference = text(spec, "part", where);
    const slug = parts.get(reference) ?? (await loadPart(db, reference))?.slug;
    if (slug === undefined) throw invalid({ [`${where}.part`]: "Unknown key." });
    const author = named(users, spec, "author", where);
    const source = await sourceText(db, (await headRevision(db, slug)).source_ref);
    const model = modelOf(source);
    const values: Values = validateValues(model, spec.values);
    const prepared = await prepareRevision({ partSlug: slug, sourceText: source, values, authorId: author.id });
    const message = typeof spec.message === "string" ? spec.message : "";
    const revision = await commitRevision({ ...prepared, partSlug: slug, authorId: author.id, values, message, createdAt: now }, null);
    revisions.set(text(spec, "key", where), { id: revision.id, label: `r${revision.n}` });
  }

  for (const [i, spec] of entries(body, "rooms").entries()) {
    const where = `rooms[${i}]`;
    const reference = text(spec, "part", where);
    const slug = parts.get(reference) ?? (await loadPart(db, reference))?.slug;
    if (slug === undefined) throw invalid({ [`${where}.part`]: "Unknown key." });
    const reviewerKeys = Array.isArray(spec.reviewers) ? spec.reviewers : [];
    const reviewerEmails = reviewerKeys.map((reviewer) => {
      const found = users.get(String(reviewer));
      if (!found) throw invalid({ [`${where}.reviewers`]: "Unknown key." });
      return found.email;
    });
    const room = await insertRoom({ partSlug: slug, ownerId: named(users, spec, "owner", where).id, title: text(spec, "title", where), reviewerEmails, createdAt: now, invite: false });
    rooms.set(text(spec, "key", where), room.id);
  }

  for (const [i, spec] of entries(body, "comments").entries()) {
    const where = `comments[${i}]`;
    const roomId = named(rooms, spec, "room", where);
    const author = named(users, spec, "author", where);
    const room = await db.one<{ part_slug: string }>("SELECT part_slug FROM rooms WHERE id = $1", [roomId]);
    const part = await requirePart(db, room.part_slug);
    if (part.ownerId !== author.id && !(await isReviewer(db, author, { roomId }))) {
      throw invalid({ [`${where}.author`]: "Only the owner and reviewers comment." });
    }
    const anchor = parseAnchor(spec.anchor);
    const pose = parsePose(spec.pose);
    if (!anchor || !pose) throw invalid({ [`${where}.pose`]: "Send an anchor and a camera pose." });
    const comment = await insertComment({ roomId, authorId: author.id, body: normalizeText(text(spec, "body", where)), anchor, pose, createdAt: now });
    comments.set(text(spec, "key", where), comment.id);
  }

  for (const [i, spec] of entries(body, "approvals").entries()) {
    const where = `approvals[${i}]`;
    const roomId = named(rooms, spec, "room", where);
    const room = await db.one<{ part_slug: string }>("SELECT part_slug FROM rooms WHERE id = $1", [roomId]);
    await approve(roomId, named(users, spec, "reviewer", where).id, (await headRevision(db, room.part_slug)).id, now);
  }

  for (const [i, spec] of entries(body, "likes").entries()) {
    const where = `likes[${i}]`;
    const reference = text(spec, "part", where);
    const slug = parts.get(reference) ?? (await loadPart(db, reference))?.slug;
    if (slug === undefined || !Array.isArray(spec.users)) throw invalid({ [`${where}.part`]: "Unknown key." });
    for (const liker of spec.users) {
      const found = users.get(String(liker));
      if (!found) throw invalid({ [`${where}.users`]: "Unknown key." });
      await applyLike(slug, found.id, true, now);
    }
  }

  const summary = async () => ({
    users: Object.fromEntries([...users].map(([k, u]) => [k, { id: u.id, cookie: u.cookie }])),
    parts: Object.fromEntries(await Promise.all([...parts].map(async ([k, slug]) => [k, { slug, headRevisionId: (await headRevision(db, slug)).id }] as const))),
    revisions: Object.fromEntries(revisions),
    rooms: Object.fromEntries([...rooms].map(([k, id]) => [k, { id }])),
    comments: Object.fromEntries([...comments].map(([k, id]) => [k, { id }])),
  });
  return jsonReply(201, await summary());
}

async function evaluatorDelay(ctx: Ctx) {
  ctx.checkNumbers();
  const { partSlug, ms } = ctx.json();
  if (typeof partSlug !== "string" || !(await loadPart(db, partSlug))) throw notFound();
  if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0 || ms > MAX_DELAY_MS) {
    throw invalid({ ms: `Use a whole number from 0 to ${MAX_DELAY_MS}.` });
  }
  const delayKey = key(`grading:delay:${partSlug}`);
  await attempt(async (client) => {
    if (ms === 0) await client.del(delayKey);
    else await client.set(delayKey, ms);
  }, undefined);
  return noContent;
}

async function evaluationCounts(ctx: Ctx) {
  const counts = await db.one<{ started: number; completed: number; cancelled: number }>(
    `SELECT count(*)::int AS started,
            count(*) FILTER (WHERE status IN ('succeeded', 'failed'))::int AS completed,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
       FROM evaluations WHERE viewer_id = $1`,
    [ctx.url.searchParams.get("viewerId") ?? ""],
  );
  return jsonReply(200, counts);
}

export const gradingRoutes: Route[] = [
  post("/api/grading/setup", setup, { outage: "save" }),
  post("/api/grading/evaluator-delay", evaluatorDelay),
  get("/api/grading/evaluations", evaluationCounts),
];
