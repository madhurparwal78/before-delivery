// Passboard server: boots without waiting for any dependency, applies schema and seed as soon as
// PostgreSQL answers, serves the API, the built browser assets and the public packet page.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { configureBilling, settleQueued } from "./billing.js";
import { completeFinished } from "./bookings.js";
import { now, nowSecond, startClock } from "./clock.js";
import { readConfig, type Config } from "./config.js";
import { databaseReady, markReady, openPool, tx } from "./db.js";
import { queueExpiryWarnings } from "./documents.js";
import { ApiError, unavailable } from "./errors.js";
import { expireHolds } from "./holds.js";
import { cookies, crossOrigin, errorReply, match, MAX_JSON_BYTES, MAX_UPLOAD_BYTES, mediaType, parseJson, parseMultipart, readBody, send, type Reply, type Request } from "./http.js";
import { idempotent, requestHash, validKey } from "./idempotency.js";
import { loadCatalog } from "./kitchen.js";
import { deliverMail } from "./mail.js";
import { PACKET_HEADERS, usablePacket } from "./packets.js";
import { apiRoutes, type Endpoint } from "./routes.js";
import { migrate, SEED_DOCUMENTS, seedDocumentKey } from "./schema.js";
import { seedCertificatePdf } from "./seedFiles.js";
import { sessionUser, SESSION_COOKIE } from "./sessions.js";
import { configureSmtp } from "./smtp.js";
import { configureStorage, objectExists, putObject } from "./storage.js";

const SWEEP_MS = 5000;
const APP_ROOT = process.cwd();
const PAGE_PATHS = new Set(["/", "/board", "/hours", "/documents", "/invoices", "/shifts", "/review", "/members", "/usage", "/packets"]);
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/assets/app.js": { file: "dist/web/app.js", type: "text/javascript; charset=utf-8" },
  "/assets/app.css": { file: "dist/web/app.css", type: "text/css; charset=utf-8" },
  "/fonts/big-shoulders-display-latin-wght-normal.woff2": { file: "public/fonts/big-shoulders-display-latin-wght-normal.woff2", type: "font/woff2" },
  "/fonts/public-sans-latin-wght-normal.woff2": { file: "public/fonts/public-sans-latin-wght-normal.woff2", type: "font/woff2" },
};

function log(message: string): void {
  process.stdout.write(`[passboard] ${message}\n`);
}

let config: Config;
try {
  config = readConfig(process.env);
} catch (error) {
  process.stderr.write(`[passboard] cannot start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

startClock(config.clockStart);
openPool(config.databaseUrl);
configureStorage(config.s3);
configureSmtp(config.smtp);
configureBilling(config.killbill);
const routes = apiRoutes(config.holdSeconds);

async function staticFile(relative: string): Promise<Buffer> {
  return readFile(join(APP_ROOT, relative));
}

async function page(request: IncomingMessage, path: string): Promise<Reply> {
  if (request.method !== "GET" && request.method !== "HEAD") return { status: 405, body: { error: "method_not_allowed" } };
  const asset = STATIC_FILES[path];
  if (asset) return { status: 200, bytes: await staticFile(asset.file), headers: { "Content-Type": asset.type, "Cache-Control": "no-cache" } };
  const html = { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'" };
  const packet = /^\/packet\/([^/]+)$/.exec(path);
  if (packet) {
    if (!(await databaseAnswering())) throw unavailable("database_unavailable");
    const usable = await usablePacket(decodeURIComponent(packet[1]));
    return { status: usable ? 200 : 404, bytes: await staticFile("public/index.html"), headers: { ...html, ...PACKET_HEADERS } };
  }
  if (PAGE_PATHS.has(path)) return { status: 200, bytes: await staticFile("public/index.html"), headers: html };
  return { status: 404, body: { error: "not_found" } };
}

function multipartHash(method: string, path: string, req: Request): string {
  const fields = Object.entries(req.fields).sort(([a], [b]) => a.localeCompare(b));
  const file = req.file ? { name: req.file.filename, sha: createHash("sha256").update(req.file.bytes).digest("hex") } : null;
  return requestHash(method, path, Buffer.from(JSON.stringify({ fields, file })));
}

async function api(request: IncomingMessage, url: URL): Promise<Reply> {
  const found = match(routes, url.pathname);
  if (!found) return { status: 404, body: { error: "not_found" } };
  const method = request.method ?? "GET";
  const endpoint: Endpoint | undefined = found.route.methods[method];
  const packetRoute = url.pathname.startsWith("/api/packet/");
  if (!endpoint) return { status: 405, body: { error: "method_not_allowed" }, headers: packetRoute ? PACKET_HEADERS : undefined };
  if (crossOrigin(request)) return { status: 403, body: { error: "cross_origin" } };
  const multipart = endpoint.body === "multipart";
  const raw = await readBody(request, multipart ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES);
  if (raw === null) return { status: 413, body: { error: "payload_too_large" } };
  const type = mediaType(request);
  if (multipart ? type !== "multipart/form-data" : raw.length > 0 && type !== "application/json") {
    return { status: 415, body: { error: "unsupported_media_type" } };
  }
  const req: Request = { method, path: url.pathname, query: url.searchParams, params: found.params, headers: request.headers, raw, json: {}, fields: {}, file: null };
  if (multipart) Object.assign(req, await parseMultipart(request.headers, raw));
  else req.json = parseJson(raw);
  if (url.pathname !== "/api/health" && !(await databaseAnswering())) throw unavailable("database_unavailable");
  if (endpoint.access === "public") return endpoint.handle(req);
  const token = cookies(request.headers)[SESSION_COOKIE];
  const user = token ? await tx((db) => sessionUser(db, token)) : null;
  if (!user) return { status: 401, body: { error: "unauthenticated" } };
  const key = request.headers["idempotency-key"];
  if (method !== "POST" || typeof key !== "string") return endpoint.handle(req, user);
  if (!validKey(key)) return { status: 422, body: { error: "validation_failed", errors: { idempotency_key: "invalid" } } };
  const target = url.pathname + url.search;
  const hash = multipart ? multipartHash(method, target, req) : requestHash(method, target, raw);
  return idempotent(user.id, key, hash, () => endpoint.handle(req, user));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://passboard.local");
  let reply: Reply;
  try {
    reply = url.pathname.startsWith("/api/") ? await api(request, url) : await page(request, url.pathname);
  } catch (error) {
    if (error instanceof ApiError) {
      reply = errorReply(error);
    } else {
      log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      reply = { status: 500, body: { error: "internal_error" } };
    }
  }
  if (request.method === "HEAD") reply = { ...reply, body: undefined, bytes: undefined };
  send(response, reply);
}

const server = createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) send(response, { status: 500, body: { error: "internal_error" } });
  });
});
server.requestTimeout = 120_000;
server.listen(config.port, "0.0.0.0", () => log(`listening on port ${config.port}`));

let preparing: Promise<void> | null = null;

/** Applies schema and seed, then loads the kitchen catalog. */
async function prepareOnce(): Promise<void> {
  await tx((db) => migrate(db, new Date(nowSecond()), (doc) => seedCertificatePdf(doc).length));
  await tx((db) => loadCatalog(db));
  markReady();
  log("database ready");
}

async function prepareDatabase(): Promise<void> {
  for (;;) {
    preparing = prepareOnce();
    try {
      await preparing;
      return;
    } catch {
      preparing = null;
      log("database unavailable; retrying");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

/** Ready, or ready once the schema and seed being applied right now finish; unreachable answers at once. */
async function databaseAnswering(): Promise<boolean> {
  if (databaseReady()) return true;
  const attempt = preparing;
  if (attempt) await attempt.catch(() => undefined);
  return databaseReady();
}

/** Seeded documents each get a one-page PDF object, written once storage answers. */
async function writeSeedObjects(): Promise<void> {
  for (;;) {
    try {
      for (const doc of SEED_DOCUMENTS) {
        const key = seedDocumentKey(doc.member, doc.id);
        if (!(await objectExists(key))) await putObject(key, seedCertificatePdf(doc), "application/pdf");
      }
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, SWEEP_MS));
    }
  }
}

async function sweep(): Promise<void> {
  if (!databaseReady()) return;
  try {
    await tx(async (db) => {
      await expireHolds(db);
      await completeFinished(db);
      await queueExpiryWarnings(db);
      await db.query("DELETE FROM idempotency_keys WHERE created_at <= $1", [new Date(now() - 24 * 3_600_000)]);
    });
  } catch {
    // Database unreachable: the next sweep retries.
  }
  await deliverMail().catch(() => undefined);
  await settleQueued().catch(() => undefined);
}

void prepareDatabase().then(() => sweep());
void writeSeedObjects();
setInterval(() => void sweep(), SWEEP_MS);
