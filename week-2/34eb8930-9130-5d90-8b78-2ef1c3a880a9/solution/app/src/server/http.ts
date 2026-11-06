import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { one, passwordMatches, pool } from "./db.js";
import { ApiError, check, forbidden, invalid, notFound, toApiError } from "./errors.js";
import { type PersonRow, personByEmail, requireAccess } from "./people.js";
import {
  type ListView, createComment, createProposal, createShare, deleteProposal, listProposals, listNotices, listShares, readNotice,
  pickPeople, removeShare, renameProposal, setCommentStatus, snapshot, updateShare,
} from "./proposals.js";
import { decideAll, decideOne, getRoom, serial } from "./rooms.js";
import { upgrade } from "./socket.js";
import { MAX_BODY_BYTES, canDecide, type Decision } from "../shared/types.js";

const COOKIE = "qd_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const JSON_TYPE = "application/json; charset=utf-8";

export const state = { ready: false };

// ---- Static assets: only the built browser files and fonts (Server boundary).

const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml",
};
const assets = new Map<string, { body: Buffer; type: string }>();
for (const name of readdirSync(PUBLIC)) {
  const type = TYPES[extname(name)];
  if (type) assets.set(`/assets/${name}`, { body: readFileSync(join(PUBLIC, name)), type });
}
const SHELL = Buffer.from(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Quillmere Drafts</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/main.css">
<script type="module" src="/assets/main.js"></script>
</head>
<body><div id="app"></div></body>
</html>
`);
const PAGE_ROUTES = [/^\/$/, /^\/sign-in$/, /^\/d\/[^/]+$/];

function sendJson(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string | string[]> = {}): void {
  if (body === undefined) { res.writeHead(status, headers); res.end(); return; }
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": JSON_TYPE, "content-length": Buffer.byteLength(payload), "cache-control": "no-store", ...headers });
  res.end(payload);
}

const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-frame-options": "DENY" };

// ---- Boundary checks, in the error order of the API.

/** An `Origin` matches when its host and port equal the request's `Host` header; no `Origin` passes. */
function sameOrigin(req: IncomingMessage, required: boolean): boolean {
  const origin = req.headers.origin;
  if (!origin) return !required;
  try { return new URL(origin).host === (req.headers.host ?? ""); } catch { return false; }
}

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

const tokenHash = (t: string): string => createHash("sha256").update(t).digest("hex");

async function sessionPerson(req: IncomingMessage): Promise<PersonRow | null> {
  const token = cookie(req, COOKIE);
  if (!token) return null;
  return (await one<PersonRow>(
    `SELECT p.id, p.email, p.display_name, p.colour, p.is_consultant FROM sessions s JOIN people p ON p.id = s.person_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)])) ?? null;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? 0);
  const hasBody = declared > 0 || req.headers["transfer-encoding"] !== undefined;
  if (!hasBody) return {};
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new ApiError(415, "unsupported_media_type");
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, "too_large");
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { return null; }
}

// ---- Routes

interface Ctx { query: URLSearchParams; body: Record<string, unknown>; person: PersonRow; res: ServerResponse }
type Handler = (ctx: Ctx, params: string[]) => Promise<void>;

const routes: [string, RegExp, Handler][] = [];
const route = (method: string, pattern: string, handler: Handler): void => {
  routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, "([^/]+)")}$`), handler]);
};

route("GET", "/api/session", async (c) => sendJson(c.res, 200, { person: sessionBody(c.person) }));
route("GET", "/api/documents", async (c) => {
  const view = c.query.get("view");
  if (view !== null && !["recent", "mine", "shared"].includes(view)) throw invalid({ view: "Choose recent, mine or shared." });
  const proposals = await listProposals(c.person.id, (view ?? "all") as ListView, c.query.get("q") ?? "");
  sendJson(c.res, 200, { documents: proposals });
});
route("POST", "/api/documents", async (c) => sendJson(c.res, 201, await createProposal(c.person, c.body)));
route("GET", "/api/documents/:id", async (c, [id]) => sendJson(c.res, 200, await snapshot(c.person.id, id)));
route("PATCH", "/api/documents/:id", async (c, [id]) => sendJson(c.res, 200, await renameProposal(c.person.id, id, c.body)));
route("DELETE", "/api/documents/:id", async (c, [id]) => { await deleteProposal(c.person.id, id); sendJson(c.res, 204); });
route("GET", "/api/documents/:id/shares", async (c, [id]) => sendJson(c.res, 200, { shares: await listShares(c.person.id, id) }));
route("POST", "/api/documents/:id/shares", async (c, [id]) => sendJson(c.res, 201, await createShare(c.person.id, id, c.body)));
route("PATCH", "/api/documents/:id/shares/:share", async (c, [id, share]) => sendJson(c.res, 200, await updateShare(c.person.id, id, share, c.body)));
route("DELETE", "/api/documents/:id/shares/:share", async (c, [id, share]) => { await removeShare(c.person.id, id, share); sendJson(c.res, 204); });
route("GET", "/api/documents/:id/people", async (c, [id]) => sendJson(c.res, 200, { people: await pickPeople(c.person.id, id, c.query.get("q") ?? "") }));
route("POST", "/api/documents/:id/suggestions/:sid/decision", async (c, [id, sid]) => {
  const access = await requireAccess(c.person.id, id);
  const exists = await one("SELECT 1 FROM suggestions WHERE id = $1 AND proposal_id = $2", [sid, id]);
  if (!exists) throw notFound();
  if (!canDecide(access.role)) throw forbidden();
  const decision = decisionField(c.body);
  const room = await getRoom(id);
  sendJson(c.res, 200, await serial(room, () => decideOne(room, c.person.id, sid, decision)));
});
route("POST", "/api/documents/:id/decisions", async (c, [id]) => {
  const access = await requireAccess(c.person.id, id);
  if (!canDecide(access.role)) throw forbidden();
  const decision = decisionField(c.body);
  const room = await getRoom(id);
  sendJson(c.res, 200, { decision, ...(await serial(room, () => decideAll(room, c.person.id, decision))) });
});
route("POST", "/api/documents/:id/comments", async (c, [id]) => sendJson(c.res, 201, await createComment(c.person.id, id, c.body)));
route("POST", "/api/documents/:id/comments/:cid/resolve", async (c, [id, cid]) => sendJson(c.res, 200, await setCommentStatus(c.person.id, id, cid, "resolved")));
route("POST", "/api/documents/:id/comments/:cid/reopen", async (c, [id, cid]) => sendJson(c.res, 200, await setCommentStatus(c.person.id, id, cid, "reopened")));
route("GET", "/api/notices", async (c) => sendJson(c.res, 200, await listNotices(c.person.id)));
route("POST", "/api/notices/:nid/read", async (c, [nid]) => sendJson(c.res, 200, await readNotice(c.person.id, nid)));

function decisionField(body: Record<string, unknown>): Decision {
  if (body.decision === "accept" || body.decision === "reject") return body.decision;
  throw invalid({ decision: "Choose accept or reject." });
}

function sessionBody(p: PersonRow): object {
  return { personId: p.id, displayName: p.display_name, email: p.email, colour: p.colour, isConsultant: p.is_consultant };
}

async function signIn(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const fields: Record<string, string> = {};
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email) fields.email = "Enter your email.";
  if (!password) fields.password = "Enter your password.";
  check(fields);
  const person = await personByEmail(email);
  const stored = person && (await one<{ password_hash: string }>("SELECT password_hash FROM people WHERE id = $1", [person.id]));
  if (!person || !stored || !passwordMatches(password, stored.password_hash)) throw new ApiError(401, "invalid_credentials");
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, person_id, expires_at) VALUES ($1,$2,$3)", [tokenHash(token), person.id, new Date(Date.now() + SESSION_MS)]);
  sendJson(res, 200, { person: sessionBody(person) }, { "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}` });
}

async function signOut(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = cookie(req, COOKIE);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  sendJson(res, 204, undefined, { "set-cookie": `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  if (url.pathname === "/api/health" && method === "GET") {
    sendJson(res, state.ready ? 200 : 503, { status: state.ready ? "ok" : "starting" });
    return;
  }
  if (!sameOrigin(req, false)) throw new ApiError(403, "cross_origin");
  let raw: unknown;
  try { raw = await readBody(req); } catch (e) {
    req.resume();
    throw e;
  }
  if (!state.ready) throw new ApiError(503, "starting");
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (url.pathname === "/api/session" && method === "POST") return signIn(res, body);
  if (url.pathname === "/api/session" && method === "DELETE") return signOut(req, res);
  const person = await sessionPerson(req);
  if (!person) throw new ApiError(401, "unauthenticated");
  for (const [m, pattern, handler] of routes) {
    const match = pattern.exec(url.pathname);
    if (match && m === method) {
      let params: string[];
      try { params = match.slice(1).map(decodeURIComponent); } catch { throw notFound(); }
      return handler({ query: url.searchParams, body, person, res }, params);
    }
  }
  throw notFound();
}

export function createApp(): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname.startsWith("/api/")) {
      api(req, res, url).catch((e: unknown) => {
        if (res.headersSent) return;
        if (!(e instanceof ApiError)) console.error("request failed", e instanceof Error ? e.message : e);
        const err = toApiError(e);
        sendJson(res, err.status, err.body());
      });
      return;
    }
    const asset = assets.get(url.pathname);
    if (req.method === "GET" && asset) {
      res.writeHead(200, { "content-type": asset.type, "content-length": asset.body.length, "cache-control": "public, max-age=3600", ...SECURITY });
      res.end(asset.body);
      return;
    }
    if (req.method === "GET" && PAGE_ROUTES.some((r) => r.test(url.pathname))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": SHELL.length, "cache-control": "no-store", ...SECURITY });
      res.end(SHELL);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...SECURITY });
    res.end("Not found");
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!sameOrigin(req, true)) { upgrade(req, socket, head, false, null); return; }
    if (url.pathname !== "/api/socket" || !state.ready) { socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"); return; }
    sessionPerson(req).then((p) => upgrade(req, socket, head, true, p?.id ?? null), () => socket.destroy());
  });
  return server;
}
