// Spaces, members, API keys and saved searches.
import { randomBytes } from "node:crypto";
import { now } from "../clock";
import { pool } from "../db";
import { errors } from "../errors";
import { authorize, findStream, signedInUser, type Access } from "../access";
import { sha256Hex } from "../auth";
import { ok, reply, route } from "../http";
import { currentSeq } from "../live";
import { parseFilters } from "../search/filters";
import { formatIso } from "../../shared/time";
import { Check, rowId } from "../validate";
import { membershipsOf } from "./accounts";

const ROLES = ["viewer", "editor", "admin"];
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const KEY_ACTIONS = ["read", "upload", "manage"];

route("GET", "/api/spaces", "none", async (ctx) => {
  const user = await signedInUser(ctx);
  return ok({ spaces: await membershipsOf(user.id) });
});

route("POST", "/api/spaces", "json", async (ctx) => {
  const user = await signedInUser(ctx);
  const body = ctx.json();
  const slug = typeof body.slug === "string" ? body.slug : "";
  const { rows: taken } = await pool.query("SELECT 1 FROM spaces WHERE slug = $1", [slug]);
  if (taken.length > 0) throw errors.nameTaken({ slug: "That name is already used." });
  const check = new Check();
  check.text(body, "name", "Enter a space name.", 60);
  if (!SLUG.test(slug)) check.fail("slug", "Use 1 to 40 characters: a-z, 0-9, _ or -.");
  check.done();
  const { rows } = await pool.query<{ id: number }>("INSERT INTO spaces (slug, name) VALUES ($1, $2) RETURNING id", [slug, body.name]);
  const id = (rows[0] as { id: number }).id;
  await pool.query("INSERT INTO members (space_id, user_id, role) VALUES ($1, $2, 'admin')", [id, user.id]);
  return reply(201, { slug, name: body.name, seq: await currentSeq(id) });
});

async function adminOf(ctx: Parameters<typeof signedInUser>[0], slug: string, role: string): Promise<{ spaceId: number }> {
  const user = await signedInUser(ctx);
  const { rows } = await pool.query<{ id: number; role: string }>(
    "SELECT s.id, m.role FROM spaces s JOIN members m ON m.space_id = s.id WHERE m.user_id = $1 AND s.slug = $2", [user.id, slug],
  );
  const found = rows[0];
  if (!found) throw errors.notFound();
  if (role === "admin" && found.role !== "admin") throw errors.forbidden();
  return { spaceId: found.id };
}

route("GET", "/api/spaces/:slug/members", "none", async (ctx) => {
  const { spaceId } = await adminOf(ctx, ctx.params.slug as string, "viewer");
  const { rows } = await pool.query<{ username: string; role: string }>(
    "SELECT u.username, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.space_id = $1 ORDER BY u.username", [spaceId],
  );
  return ok({ members: rows });
});

route("POST", "/api/spaces/:slug/members", "json", async (ctx) => {
  const { spaceId } = await adminOf(ctx, ctx.params.slug as string, "admin");
  const body = ctx.json();
  const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
  const { rows: users } = await pool.query<{ id: number }>("SELECT id FROM users WHERE username = $1", [username]);
  if (!users[0]) throw errors.notFound();
  const { rows: present } = await pool.query("SELECT 1 FROM members WHERE space_id = $1 AND user_id = $2", [spaceId, users[0].id]);
  if (present.length > 0) throw errors.nameTaken({ username: "That user is already a member." });
  const check = new Check();
  if (!ROLES.includes(body.role as string)) check.fail("role", "Choose viewer, editor or admin.");
  check.done();
  await pool.query("INSERT INTO members (space_id, user_id, role) VALUES ($1, $2, $3)", [spaceId, users[0].id, body.role]);
  return reply(201, { username, role: body.role });
});

interface KeyRow {
  id: number;
  name: string;
  stream_pattern: string;
  actions: string[];
  expires_ms: number | null;
  revoked: boolean;
  last4: string;
}

const keyView = (row: KeyRow) => ({
  id: row.id, name: row.name, stream_pattern: row.stream_pattern, actions: row.actions,
  expires_at: row.expires_ms === null ? null : formatIso(row.expires_ms), revoked: row.revoked, last4: row.last4,
});

route("GET", "/api/keys", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "admin" });
  const { rows } = await pool.query<KeyRow>("SELECT id, name, stream_pattern, actions, expires_ms, revoked, last4 FROM api_keys WHERE space_id = $1 ORDER BY id", [access.space.id]);
  return ok({ keys: rows.map(keyView) });
});

route("POST", "/api/keys", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "admin" });
  const body = ctx.json();
  const check = new Check();
  check.text(body, "name", "Enter a key name.", 80);
  check.text(body, "stream_pattern", "Enter a stream pattern.", 80);
  const actions = Array.isArray(body.actions) ? body.actions : [];
  if (actions.length === 0 || !actions.every((action) => KEY_ACTIONS.includes(action as string))) check.fail("actions", "Choose at least one action.");
  const days = body.expires_in_days ?? null;
  if (days !== null && (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365)) check.fail("expires_in_days", "Enter a whole number from 1 to 365, or leave it empty.");
  check.done();
  const key = `spk_${randomBytes(16).toString("hex")}`;
  const created = now();
  const { rows } = await pool.query<KeyRow>(
    `INSERT INTO api_keys (space_id, name, stream_pattern, actions, created_ms, expires_ms, last4, key_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, stream_pattern, actions, expires_ms, revoked, last4`,
    [access.space.id, body.name, body.stream_pattern, actions, created, days === null ? null : created + (days as number) * 86_400_000, key.slice(-4), sha256Hex(key)],
  );
  return reply(201, { ...keyView(rows[0] as KeyRow), key });
});

route("DELETE", "/api/keys/:id", "none", async (ctx) => {
  const access = await authorize(ctx);
  const id = rowId(ctx.params.id);
  if (id === null) throw errors.notFound();
  const { rows } = await pool.query<KeyRow>(
    "UPDATE api_keys SET revoked = true WHERE id = $1 AND space_id = $2 RETURNING id, name, stream_pattern, actions, expires_ms, revoked, last4",
    [id, access.space.id],
  );
  if (!rows[0]) throw errors.notFound();
  access.require("admin");
  return ok(keyView(rows[0]));
});

interface SavedRow {
  id: number;
  name: string;
  stream: string;
  q: string;
  filters: unknown;
  from_ts: string;
  to_ts: string;
}

async function savedView(access: Pick<Access, "space">, row: SavedRow) {
  const present = (await findStream(access.space.id, row.stream)) !== null;
  return { id: row.id, name: row.name, stream: row.stream, q: row.q, filters: row.filters, from: row.from_ts, to: row.to_ts, needs_attention: !present };
}

const missingStream = (name: string): string => `Stream ${name} doesn't exist in this space.`;

route("GET", "/api/saved-searches", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  const { rows } = await pool.query<SavedRow>("SELECT id, name, stream, q, filters, from_ts, to_ts FROM saved_searches WHERE space_id = $1 ORDER BY id", [access.space.id]);
  return ok({ saved_searches: await Promise.all(rows.map((row) => savedView(access, row))) });
});

route("POST", "/api/saved-searches", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "editor" });
  const body = ctx.json();
  const check = new Check();
  const name = check.text(body, "name", "Enter a search name.", 80);
  if (typeof body.stream !== "string" || body.stream === "") check.fail("stream", "Choose a stream.");
  const filters = parseFilters(body.filters ?? []);
  if (!filters) check.fail("filters", "Send filters as a list.");
  if (typeof body.from !== "string" || typeof body.to !== "string") check.fail("from", "Send the range as ISO times.");
  check.done();
  const { rows } = await pool.query<SavedRow>(
    "INSERT INTO saved_searches (space_id, name, stream, q, filters, from_ts, to_ts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, stream, q, filters, from_ts, to_ts",
    [access.space.id, name, body.stream, typeof body.q === "string" ? body.q : "", JSON.stringify(filters), body.from, body.to],
  );
  return reply(201, { ...(await savedView(access, rows[0] as SavedRow)), seq: await currentSeq(access.space.id) });
});

async function savedIn(access: Access, raw: string): Promise<SavedRow> {
  const id = rowId(raw);
  if (id === null) throw errors.notFound();
  const { rows } = await pool.query<SavedRow>(
    "SELECT id, name, stream, q, filters, from_ts, to_ts FROM saved_searches WHERE id = $1 AND space_id = $2", [id, access.space.id],
  );
  if (!rows[0]) throw errors.notFound();
  return rows[0];
}

route("GET", "/api/saved-searches/:id", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  const row = await savedIn(access, ctx.params.id as string);
  const view = await savedView(access, row);
  return ok(view.needs_attention ? { ...view, problem: missingStream(row.stream) } : view);
});

route("POST", "/api/saved-searches/:id/copy", "json", async (ctx) => {
  const user = await signedInUser(ctx);
  const access = await authorize(ctx);
  const row = await savedIn(access, ctx.params.id as string);
  const slug = String(ctx.json().space ?? "");
  const { rows: targets } = await pool.query<{ id: number; slug: string; name: string; role: string }>(
    "SELECT s.id, s.slug, s.name, m.role FROM spaces s JOIN members m ON m.space_id = s.id WHERE m.user_id = $1 AND s.slug = $2", [user.id, slug],
  );
  const target = targets[0];
  if (!target) throw errors.notFound();
  access.require("editor");
  if (target.role === "viewer") throw errors.forbidden();
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO saved_searches (space_id, name, stream, q, filters, from_ts, to_ts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [target.id, row.name, row.stream, row.q, JSON.stringify(row.filters), row.from_ts, row.to_ts],
  );
  const missing = (await findStream(target.id, row.stream)) ? [] : [`stream ${row.stream}`];
  const message = missing.length === 0 ? "Copied with no missing references." : `Copied with ${missing.length} missing ${missing.length === 1 ? "reference" : "references"}: ${missing.join(", ")}.`;
  return reply(201, { id: (rows[0] as { id: number }).id, space: slug, missing, needs_attention: missing.length > 0, message });
});
