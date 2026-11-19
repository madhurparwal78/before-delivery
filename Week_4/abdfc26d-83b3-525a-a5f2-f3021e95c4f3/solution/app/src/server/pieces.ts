import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { EASINGS, seedHash, type Easing } from "../shared/rules.js";
import { currentUser, requireRole, signedIn, type User } from "./auth.js";
import { iso, one, pool, rows, tx, type Db } from "./db.js";
import { ApiError, conflict, during, invalidTransition, notFound, storageUnavailable, validationFailed } from "./errors.js";
import { json, type Ctx, type Route } from "./http.js";
import { COLLECTED, fromStates, MOVES, occupying, type OrderState } from "./order-states.js";
import { draftShaderGraph } from "./provider.js";
import { putObject } from "./s3.js";

// Pieces and their edition runs. Piece states: draft → published → withdrawn, decided in `moves` only.

type PieceState = "draft" | "published" | "withdrawn";

const moves: Record<"publish" | "withdraw", { from: PieceState; to: PieceState }> = {
  publish: { from: "draft", to: "published" },
  withdraw: { from: "published", to: "withdrawn" },
};

export interface Uniform {
  name: string;
  label: string;
  min: number;
  max: number;
  value: number;
}

export interface Keyframe {
  time_s: number;
  value: number;
  easing: Easing;
}

export interface Timeline {
  duration_s: number;
  tracks: { uniform: string; keyframes: Keyframe[] }[];
  audio_asset_id: string | null;
}

interface PieceRow {
  id: string;
  slug: string;
  title: string;
  creator_id: string;
  creator_display_name: string;
  state: PieceState;
  version: number;
  fragment_source: string;
  uniforms: Uniform[];
  timeline: Timeline;
  remix_of_id: string | null;
  remix_slug: string | null;
  remix_title: string | null;
  remix_creator_display_name: string | null;
  edition_count: number | null;
  price_cents: number | null;
  export_render_id: string | null;
  published_at: Date | null;
  created_at: Date;
  editions_left: number;
}


const PIECE_SELECT = `
  SELECT p.*, u.display_name AS creator_display_name,
         s.slug AS remix_slug, s.title AS remix_title, su.display_name AS remix_creator_display_name,
         CASE WHEN p.edition_count IS NULL THEN 0
              ELSE p.edition_count - (SELECT count(*) FROM orders o WHERE o.piece_id = p.id AND ${occupying("o")}) END AS editions_left
    FROM pieces p
    JOIN users u ON u.id = p.creator_id
    LEFT JOIN pieces s ON s.id = p.remix_of_id
    LEFT JOIN users su ON su.id = s.creator_id`;

export async function pieceBySlug(db: Db, slug: string): Promise<PieceRow | undefined> {
  return one<PieceRow>(db, `${PIECE_SELECT} WHERE p.slug = $1`, [slug]);
}

const remixOf = (p: PieceRow) =>
  p.remix_slug ? { slug: p.remix_slug, title: p.remix_title, creator_display_name: p.remix_creator_display_name } : null;

async function assetsOf(db: Db, pieceId: string) {
  return rows<{ id: string; kind: string; filename: string; bytes: number }>(
    db,
    "SELECT id, kind, filename, bytes FROM assets WHERE piece_id = $1 ORDER BY created_at",
    [pieceId],
  );
}

async function pieceView(db: Db, p: PieceRow, viewer: User | null) {
  const owner = viewer?.id === p.creator_id;
  return {
    slug: p.slug,
    title: p.title,
    state: p.state,
    version: p.version,
    engine: "GLSL",
    creator: { id: p.creator_id, display_name: p.creator_display_name },
    ...(owner ? { fragment_source: p.fragment_source } : {}),
    uniforms: p.uniforms,
    timeline: p.timeline,
    ...(owner ? { assets: await assetsOf(db, p.id) } : {}),
    remix_of: remixOf(p),
    edition_count: p.edition_count,
    price_cents: p.price_cents,
    editions_left: p.state === "draft" ? null : p.editions_left,
    export_render_id: p.export_render_id,
  };
}

const cardView = (p: PieceRow) => ({
  slug: p.slug,
  title: p.title,
  creator_display_name: p.creator_display_name,
  engine: "GLSL",
  edition_count: p.edition_count,
  editions_left: p.editions_left,
  price_cents: p.price_cents,
  remix_of: remixOf(p),
  published_at: iso(p.published_at),
});

/** Published pieces are public; a draft is its owner's; a withdrawn piece its owner's and the founder's. Anyone else: 404. */
async function visiblePiece(ctx: Ctx, slug: string): Promise<{ piece: PieceRow; viewer: User | null }> {
  const piece = await pieceBySlug(pool, slug);
  if (!piece) throw notFound();
  const viewer = await currentUser(ctx);
  if (piece.state === "published") return { piece, viewer };
  const allowed = viewer && (viewer.id === piece.creator_id || (piece.state === "withdrawn" && viewer.roles.includes("founder-operator")));
  if (!allowed) throw notFound();
  return { piece, viewer };
}

/** Steps 2 to 4 for the creator's own-piece actions: 401, then 404 for anyone but the owner, then 403. */
export async function ownPiece(ctx: Ctx): Promise<{ user: User; piece: PieceRow }> {
  const user = await signedIn(ctx);
  const piece = await pieceBySlug(pool, ctx.params.slug ?? "");
  if (!piece || piece.creator_id !== user.id) throw notFound();
  requireRole(user, "creator");
  return { user, piece };
}

export function requireDraft(piece: PieceRow): void {
  if (piece.state !== "draft") throw invalidTransition("Only a draft piece can change.");
}

// ---- validation helpers ----

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function kebab(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "piece";
}

const newSlug = (title: string): string => `${kebab(title)}-${randomBytes(2).toString("hex")}`;

function readTimeline(raw: unknown, uniforms: Uniform[], audioIds: Set<string>, fields: Record<string, string>): Timeline {
  const fail = (message: string): Timeline => {
    fields.timeline ??= message;
    return { duration_s: 10, tracks: [], audio_asset_id: null };
  };
  if (!isRecord(raw)) return fail("Send the timeline.");
  const duration = raw.duration_s;
  if (!finite(duration) || duration < 1 || duration > 600) return fail("The timeline lasts 1 to 600 seconds.");
  if (!Array.isArray(raw.tracks)) return fail("Send the timeline's tracks.");
  const byName = new Map(uniforms.map((u) => [u.name, u]));
  const seen = new Set<string>();
  const tracks: Timeline["tracks"] = [];
  for (const track of raw.tracks) {
    if (!isRecord(track) || typeof track.uniform !== "string" || !Array.isArray(track.keyframes)) return fail("Each track names a uniform and its keyframes.");
    const uniform = byName.get(track.uniform);
    if (!uniform || seen.has(track.uniform)) return fail("Each track belongs to one uniform of the piece.");
    seen.add(track.uniform);
    const times = new Set<number>();
    const keyframes: Keyframe[] = [];
    for (const key of track.keyframes) {
      if (!isRecord(key) || !finite(key.time_s) || !finite(key.value)) return fail("Each keyframe has a time and a value.");
      if (typeof key.easing !== "string" || !(EASINGS as readonly string[]).includes(key.easing)) {
        return fail("Easing is linear, ease-in, ease-out or ease-in-out.");
      }
      if (key.time_s < 0 || key.time_s > duration) return fail("Keyframes sit inside the timeline.");
      if (key.value < uniform.min || key.value > uniform.max) return fail(`${uniform.label} keyframes stay between ${uniform.min} and ${uniform.max}.`);
      const time = Math.round(key.time_s * 1000);
      if (times.has(time)) return fail(`${uniform.label} has two keyframes at the same time.`);
      times.add(time);
      keyframes.push({ time_s: key.time_s, value: key.value, easing: key.easing as Easing });
    }
    keyframes.sort((a, b) => a.time_s - b.time_s);
    tracks.push({ uniform: track.uniform, keyframes });
  }
  const audio = raw.audio_asset_id ?? null;
  if (audio !== null && (typeof audio !== "string" || !audioIds.has(audio))) return fail("The audio stem must be an audio asset of this piece.");
  return { duration_s: duration, tracks, audio_asset_id: audio };
}

// ---- handlers ----

async function describe(ctx: Ctx) {
  const user = await signedIn(ctx);
  requireRole(user, "creator");
  const prompt = isRecord(ctx.body) ? ctx.body.prompt : undefined;
  const length = typeof prompt === "string" ? [...prompt.trim()].length : 0;
  if (typeof prompt !== "string" || length < 3 || length > 500) throw validationFailed({ prompt: "Describe the piece in 3 to 500 characters." });
  const graph = await draftShaderGraph(prompt.trim());
  const uniforms: Uniform[] = graph.uniforms.map((u) => ({ name: u.name, label: u.label, min: u.min, max: u.max, value: u.default }));
  const timeline: Timeline = { duration_s: 10, tracks: [], audio_asset_id: null };
  for (;;) {
    const slug = newSlug(graph.title);
    const inserted = await one(
      pool,
      `INSERT INTO pieces (id, slug, title, creator_id, state, version, fragment_source, uniforms, timeline)
       VALUES ($1, $2, $3, $4, 'draft', 1, $5, $6, $7) ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [randomUUID(), slug, graph.title, user.id, graph.fragmentSource, JSON.stringify(uniforms), JSON.stringify(timeline)],
    );
    if (inserted) {
      const piece = await pieceBySlug(pool, slug);
      return json(201, { piece: await pieceView(pool, piece as PieceRow, user) });
    }
  }
}

async function getPiece(ctx: Ctx) {
  const { piece, viewer } = await visiblePiece(ctx, ctx.params.slug ?? "");
  return json(200, await pieceView(pool, piece, viewer), { ETag: `"${piece.version}"` });
}

async function savePiece(ctx: Ctx) {
  const { user, piece } = await ownPiece(ctx);
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(String(ctx.req.headers["if-match"] ?? "").trim());
  if (!match) throw new ApiError(428, "version_required", "Send the piece's current version in If-Match.");
  return tx(async (client) => {
    const locked = await one<{ version: number; state: PieceState }>(client, "SELECT version, state FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
    const current = locked?.version ?? piece.version;
    if (Number(match[1]) !== current) {
      throw new ApiError(412, "version_conflict", "This piece changed since you loaded it.", { current_version: current });
    }
    requireDraft({ ...piece, state: locked?.state ?? piece.state });
    const fields: Record<string, string> = {};
    const body = isRecord(ctx.body) ? ctx.body : {};
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > 120) fields.title = "Name the piece in 1 to 120 characters.";
    const values = isRecord(body.uniforms) ? body.uniforms : null;
    const uniforms = piece.uniforms.map((u) => ({ ...u }));
    if (!values) fields.uniforms = "Send a value for every fader.";
    else {
      for (const key of Object.keys(values)) if (!uniforms.some((u) => u.name === key)) fields.uniforms ??= `The piece has no fader ${key}.`;
      for (const u of uniforms) {
        const value = values[u.name];
        if (value === undefined) continue;
        if (!finite(value) || value < u.min || value > u.max) fields.uniforms ??= `${u.label} stays between ${u.min} and ${u.max}.`;
        else u.value = value;
      }
    }
    const audioIds = new Set((await assetsOf(client, piece.id)).filter((a) => a.kind === "audio").map((a) => a.id));
    const timeline = readTimeline(body.timeline, uniforms, audioIds, fields);
    if (Object.keys(fields).length) throw validationFailed(fields);
    await client.query(
      "UPDATE pieces SET title = $2, uniforms = $3, timeline = $4, version = version + 1 WHERE id = $1",
      [piece.id, title, JSON.stringify(uniforms), JSON.stringify(timeline)],
    );
    const saved = (await pieceBySlug(client, piece.slug)) as PieceRow;
    return json(200, await pieceView(client, saved, user), { ETag: `"${saved.version}"` });
  });
}

const EXTENSIONS: Record<string, readonly string[]> = { font: [".woff2", ".ttf"], model: [".glb"], audio: [".wav", ".mp3"] };
const CONTENT_TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".glb": "model/gltf-binary",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

async function uploadAsset(ctx: Ctx) {
  const { piece } = await ownPiece(ctx);
  requireDraft(piece);
  const kind = ctx.parts.find((p) => p.name === "kind" && p.filename === null)?.data.toString("utf8").trim() ?? "";
  const file = ctx.parts.find((p) => p.name === "file" && p.filename !== null);
  const fields: Record<string, string> = {};
  const allowed = EXTENSIONS[kind];
  if (!allowed) fields.kind = "Choose font, model or audio.";
  const filename = path.basename((file?.filename ?? "").replace(/\\/g, "/")).replace(/[\u0000-\u001f"]/g, "").slice(0, 120);
  const extension = path.extname(filename).toLowerCase();
  if (!file || !filename || file.data.length === 0) fields.file = "Choose a file to upload.";
  else if (allowed && !allowed.includes(extension)) fields.file = `A ${kind} is ${allowed.join(" or ")}.`;
  if (Object.keys(fields).length) throw validationFailed(fields);
  const id = randomUUID();
  const data = (file as NonNullable<typeof file>).data;
  await during("minio", storageUnavailable, () =>
    putObject(`pieces/${piece.slug}/assets/${id}/${filename}`, data, CONTENT_TYPES[extension] ?? "application/octet-stream"),
  );
  await pool.query("INSERT INTO assets (id, piece_id, kind, filename, bytes) VALUES ($1, $2, $3, $4, $5)", [id, piece.id, kind, filename, data.length]);
  return json(201, { asset: { id, kind, filename, bytes: data.length } });
}

async function publish(ctx: Ctx) {
  const { user, piece } = await ownPiece(ctx);
  return tx(async (client) => {
    const locked = await one<{ state: PieceState }>(client, "SELECT state FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
    if (locked?.state !== moves.publish.from) throw invalidTransition("Only a draft can be published.");
    const body = isRecord(ctx.body) ? ctx.body : {};
    const fields: Record<string, string> = {};
    const count = body.edition_count;
    const price = body.price_cents;
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 500) fields.edition_count = "A run has 1 to 500 editions.";
    if (!Number.isInteger(price) || (price as number) < 100 || (price as number) > 500_000) fields.price_cents = "Price an edition between $1.00 and $5,000.00.";
    const renderId = body.export_render_id;
    const ready =
      typeof renderId === "string" && /^[0-9a-f-]{36}$/i.test(renderId)
        ? await one(client, "SELECT 1 FROM renders WHERE id = $1 AND piece_id = $2 AND state = 'ready'", [renderId, piece.id])
        : undefined;
    if (!ready) fields.export_render_id = "Choose a ready export of this piece.";
    if (Object.keys(fields).length) throw validationFailed(fields);
    await client.query(
      "UPDATE pieces SET state = $2, edition_count = $3, price_cents = $4, export_render_id = $5, published_at = now() WHERE id = $1",
      [piece.id, moves.publish.to, count, price, renderId],
    );
    return json(200, await pieceView(client, (await pieceBySlug(client, piece.slug)) as PieceRow, user));
  });
}

async function withdraw(ctx: Ctx) {
  const { user, piece } = await ownPiece(ctx);
  return tx(async (client) => {
    const locked = await one<{ state: PieceState }>(client, "SELECT state FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
    if (locked?.state !== moves.withdraw.from) throw invalidTransition("Only a published piece can be withdrawn.");
    await client.query("UPDATE pieces SET state = $2 WHERE id = $1", [piece.id, moves.withdraw.to]);
    await client.query("UPDATE orders SET state = $2 WHERE piece_id = $1 AND state = ANY($3)", [piece.id, MOVES.expire.to, fromStates("expire")]);
    return json(200, await pieceView(client, (await pieceBySlug(client, piece.slug)) as PieceRow, user));
  });
}

async function remix(ctx: Ctx) {
  const user = await signedIn(ctx);
  const source = await pieceBySlug(pool, ctx.params.slug ?? "");
  if (!source || source.state !== "published") throw notFound();
  requireRole(user, "creator");
  if (source.creator_id === user.id) throw conflict("own_piece", "You cannot remix your own piece.");
  if (source.remix_of_id) throw conflict("remix_of_remix", "A remix cannot be remixed.");
  const title = `${source.title} (remix)`.slice(0, 120);
  const timeline: Timeline = { ...source.timeline, audio_asset_id: null };
  for (;;) {
    const slug = newSlug(title);
    const inserted = await one(
      pool,
      `INSERT INTO pieces (id, slug, title, creator_id, state, version, fragment_source, uniforms, timeline, remix_of_id)
       VALUES ($1, $2, $3, $4, 'draft', 1, $5, $6, $7, $8) ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [randomUUID(), slug, title, user.id, source.fragment_source, JSON.stringify(source.uniforms), JSON.stringify(timeline), source.id],
    );
    if (inserted) return json(201, { piece: await pieceView(pool, (await pieceBySlug(pool, slug)) as PieceRow, user) });
  }
}

type EditionStatus = "available" | "held" | "collected";

export async function editionStatuses(db: Db, pieceId: string, count: number, viewerId: string | null) {
  const taken = await rows<{ edition: number; state: OrderState; collector_id: string }>(
    db,
    `SELECT o.edition, o.state, o.collector_id FROM orders o WHERE o.piece_id = $1 AND ${occupying("o")}`,
    [pieceId],
  );
  const byNumber = new Map(taken.map((t) => [t.edition, t]));
  return Array.from({ length: count }, (_, i) => {
    const number = i + 1;
    const order = byNumber.get(number);
    const status: EditionStatus = !order ? "available" : COLLECTED.includes(order.state) ? "collected" : "held";
    return { number, status, held_by_you: status === "held" && order?.collector_id === viewerId };
  });
}

async function editions(ctx: Ctx) {
  const { piece, viewer } = await visiblePiece(ctx, ctx.params.slug ?? "");
  const count = piece.edition_count ?? 0;
  const list = await editionStatuses(pool, piece.id, count, viewer?.id ?? null);
  return json(200, {
    edition_count: count,
    editions: list.map((e) => ({ ...e, seed_hash: seedHash(piece.slug, e.number) })),
  });
}

async function gallery(ctx: Ctx) {
  const creator = ctx.query.get("creator");
  const params: unknown[] = [];
  let filter = "";
  if (creator) {
    params.push(creator);
    filter = "AND u.username = $1";
  }
  const published = await rows<PieceRow & { featured: boolean }>(
    pool,
    `${PIECE_SELECT} WHERE p.state = 'published' ${filter} ORDER BY p.published_at DESC, p.id`,
    params,
  );
  const featured = published.find((p) => p.featured) ?? published[0] ?? null;
  const runs = published.filter((p) => !p.remix_of_id);
  const remixes = published.filter((p) => p.remix_of_id);
  return json(200, {
    featured: featured ? cardView(featured) : null,
    sections: [
      { id: "runs", title: "Fresh runs", total: runs.length, pieces: runs.map(cardView) },
      { id: "remixes", title: "Remixes", total: remixes.length, pieces: remixes.map(cardView) },
    ],
  });
}

/** The creator's studio list. */
async function myPieces(ctx: Ctx) {
  const user = await signedIn(ctx);
  requireRole(user, "creator");
  const list = await rows<PieceRow & { editions_sold: number }>(
    pool,
    `SELECT q.*, (SELECT count(*) FROM orders o WHERE o.piece_id = q.id AND o.state = ANY($2)) AS editions_sold
       FROM (${PIECE_SELECT} WHERE p.creator_id = $1) q ORDER BY q.created_at DESC`,
    [user.id, COLLECTED],
  );
  return json(200, {
    pieces: list.map((p) => ({
      slug: p.slug,
      title: p.title,
      state: p.state,
      version: p.version,
      edition_count: p.edition_count,
      editions_sold: p.editions_sold,
      remix_of: remixOf(p),
    })),
  });
}

export const pieceRoutes: Route[] = [
  { method: "POST", pattern: "/api/pieces/describe", handler: describe },
  { method: "GET", pattern: "/api/gallery", handler: gallery },
  { method: "GET", pattern: "/api/me/pieces", handler: myPieces },
  { method: "GET", pattern: "/api/pieces/{slug}", handler: getPiece },
  { method: "PUT", pattern: "/api/pieces/{slug}", handler: savePiece },
  { method: "POST", pattern: "/api/pieces/{slug}/assets", handler: uploadAsset, multipart: true },
  { method: "POST", pattern: "/api/pieces/{slug}/publish", handler: publish },
  { method: "POST", pattern: "/api/pieces/{slug}/withdraw", handler: withdraw },
  { method: "POST", pattern: "/api/pieces/{slug}/remix", handler: remix },
  { method: "GET", pattern: "/api/pieces/{slug}/editions", handler: editions },
];
