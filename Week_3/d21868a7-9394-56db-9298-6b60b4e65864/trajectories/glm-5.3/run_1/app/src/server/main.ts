// The app server: one origin for the app and its API, the request boundary,
// the retry worker, and startup.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import pg from "pg";
import { loadConfig } from "./config.ts";
import { SCHEMA_SQL } from "./schema.ts";
import { seedIfEmpty } from "./seed.ts";
import { Store, type Role, type UserRow } from "./store.ts";
import {
  ApiError, errDatabaseUnavailable, errForbidden, errNotFound, errNotSignedIn,
  errTooLarge, errUnsupportedType, fieldErrors,
} from "./errors.ts";
import { routes } from "./api.ts";
import { s3EnsureBucket, s3Put, s3Get, s3Delete } from "./s3.ts";
import { smtpSend } from "./smtp.ts";
import { confirmStroke, writeStrokeRecord } from "./cards.ts";
import { REGULATOR_EMAIL, packSha256 } from "./packs.ts";
import { formatInstant, truncateToSecond } from "../shared/district-time.ts";
import type { Ctx } from "./api.ts";

const cfg = loadConfig();
const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 12 });
const store = new Store(pool);
const ctx: Ctx = { cfg, store, pool, dbReady: false };

const DIST_ROOT = join(process.cwd(), "dist", "public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const FORBIDDEN_FILES = [/run\.json$/, /package-lock\.json$/, /tsconfig\.json$/, /\.env/, /\.ts$/, /\.map$/, /THIRD_PARTY/];

async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

let storeReady = false;

async function startup(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await seedIfEmpty(pool);
      ctx.dbReady = true;
      return;
    } catch (e) {
      console.error("startup retry:", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// --- the retry worker: strokes, packs and notices ----------------------------

async function workStrokes(): Promise<void> {
  if (!ctx.dbReady) return;
  const rows = await store.query(
    `SELECT * FROM gate_cards WHERE state = 'waiting-for-store' AND stroke_key IS NOT NULL ORDER BY id`,
  );
  for (const r of rows.rows) {
    const card = {
      id: r.id,
      order_number: r.order_number,
      turnout: r.turnout,
      channel_id: r.channel_id,
      window_id: r.window_id,
      kind: r.kind,
      state: r.state,
      holder_code: r.holder_code,
      from_ml_day: r.from_ml_day,
      to_ml_day: r.to_ml_day,
      stroke_key: r.stroke_key,
      stroke: null,
      created_at: new Date(r.created_at).getTime(),
    };
    const ok = await writeStrokeRecord(cfg.s3, card, r.stroke_operator, formatInstant(new Date(r.stroke_committed_at).getTime()));
    if (ok) {
      await confirmStroke(store, r.id, Date.now());
    }
  }
}

async function workPacks(): Promise<void> {
  if (!ctx.dbReady) return;
  const rows = await store.query(`SELECT * FROM packs WHERE state IN ('building','stored') OR (state = 'withdrawn' AND stalled_on = 'store') ORDER BY created_at`);
  for (const r of rows.rows) {
    if (r.state === "withdrawn") {
      // finish the delete
      if (r.object_key) {
        const ok = await s3Delete(cfg.s3, r.object_key);
        if (ok) await store.query(`UPDATE packs SET stalled_on = null WHERE id = $1`, [r.id]);
      } else {
        await store.query(`UPDATE packs SET stalled_on = null WHERE id = $1`, [r.id]);
      }
      continue;
    }
    if (r.state === "building") {
      const bytes = Buffer.from(r.document, "utf8");
      const ok = await s3Put(cfg.s3, `packs/${r.number}.txt`, bytes, "text/plain; charset=utf-8");
      if (ok) {
        await store.query(
          `UPDATE packs SET state = 'stored', sha256 = $1, stored_at = now(), stalled_on = null, object_key = $2 WHERE id = $3 AND state = 'building'`,
          [packSha256(r.document), `packs/${r.number}.txt`, r.id],
        );
      } else {
        await store.query(`UPDATE packs SET stalled_on = 'store' WHERE id = $1 AND state = 'building'`, [r.id]);
      }
      continue;
    }
    if (r.state === "stored") {
      const bytes = Buffer.from(r.document, "utf8");
      const digest = r.sha256 ?? packSha256(r.document);
      const sent = await smtpSend(cfg.smtp, {
        to: REGULATOR_EMAIL,
        subject: `Ditchbook delivery pack ${r.number}`,
        body: `Pack ${r.number} for ${r.from_date} to ${r.to_date}. SHA-256 ${digest}`,
        attachment: { filename: `${r.number}.txt`, contentType: "text/plain", bytes },
      });
      if (sent) {
        await store.query(`UPDATE packs SET state = 'mailed', mailed_at = now(), stalled_on = null WHERE id = $1 AND state = 'stored'`, [r.id]);
      } else {
        await store.query(`UPDATE packs SET stalled_on = 'mail' WHERE id = $1 AND state = 'stored'`, [r.id]);
      }
    }
  }
}

async function workNotices(): Promise<void> {
  if (!ctx.dbReady) return;
  const rows = await store.query(
    `SELECT n.*, p.email AS grower_email FROM notices n JOIN people p ON p.id = n.grower_id WHERE n.state = 'queued' ORDER BY n.id`,
  );
  for (const r of rows.rows) {
    const sent = await smtpSend(cfg.smtp, { to: r.grower_email, subject: r.subject, body: r.body });
    if (sent) {
      await store.query(`UPDATE notices SET state = 'sent', sent_at = now() WHERE id = $1 AND state = 'queued'`, [r.id]);
    }
  }
}

async function workerLoop(): Promise<void> {
  // The bucket is ensured once the store first answers.
  for (;;) {
    if (ctx.dbReady) {
      try {
        if (!storeReady) {
          await s3EnsureBucket(cfg.s3);
          storeReady = true;
        }
      } catch {
        storeReady = false;
      }
      try {
        await workStrokes();
        await workPacks();
        await workNotices();
      } catch {
        // the next cycle retries
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// --- request handling ---------------------------------------------------------

function readBody(req: http.IncomingMessage, limit: number): Promise<{ ok: false } | { ok: true; body: Buffer }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        // drain the rest so the reply can be read
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (over) resolve({ ok: false });
      else resolve({ ok: true, body: Buffer.concat(chunks) });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("close", () => resolve({ ok: false }));
  });
}

function sendApiError(res: http.ServerResponse, e: ApiError): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (e.code === "validation") {
    const errors = (e.extra?.errors as Record<string, string>) ?? {};
    res.writeHead(422, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ errors }));
    return;
  }
  const body: Record<string, unknown> = { error: e.code, message: e.message };
  if (e.extra) for (const [k, v] of Object.entries(e.extra)) body[k] = v;
  res.writeHead(e.status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  // 1. body: content type and size
  const isPackSubmit = method === "POST" && path === "/api/packs";
  const limit = isPackSubmit ? 2000000 : 16384;
  let body: unknown = {};
  const hasBody = !["GET", "HEAD"].includes(method);
  if (hasBody) {
    const raw = await readBody(req, limit);
    if (!raw.ok) throw errTooLarge();
    if (raw.body.length > 0) {
      const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json") throw errUnsupportedType();
      try {
        body = JSON.parse(raw.body.toString("utf8"));
      } catch {
        throw fieldErrors({ _: "Send valid JSON." });
      }
    }
  }

  // 2. database
  if (!ctx.dbReady) throw errDatabaseUnavailable();

  // 3. session
  let user: UserRow | null = null;
  const token = getSessionCookie(req);
  if (token) {
    user = await store.userBySession(token);
    if (!user) {
      // an ended session
      const found = routes.find((r) => r.method === method && r.pattern.test(path));
      if (found && found.roles !== "any") throw errNotSignedIn();
    }
  }

  // find the route
  const route = routes.find((r) => r.method === method && r.pattern.test(path));
  if (!route) throw errNotFound();

  // 4. forbidden by role
  if (route.roles !== "any") {
    if (!user) throw errNotSignedIn();
    if (route.roles !== "signed-in" && !route.roles.includes(user.role)) throw errForbidden();
  }

  const m = route.pattern.exec(path);
  const params: Record<string, string> = {};
  if (m) route.names.forEach((name, i) => {
    params[name] = decodeURIComponent(m[i + 1] ?? "");
  });

  await route.handler(ctx, req, res, user, url, body, params);
}

function getSessionCookie(req: http.IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "ditchbook_session") return v.join("=");
  }
  return null;
}

// --- static assets ---------------------------------------------------------------

function serveAsset(res: http.ServerResponse, file: string): boolean {
  const safe = normalize(file).replace(/^(\.\.[/\\])+/, "");
  const full = join(DIST_ROOT, safe);
  if (!full.startsWith(DIST_ROOT)) return false;
  if (FORBIDDEN_FILES.some((re) => re.test(full))) return false;
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  const type = MIME[extname(full)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(readFileSync(full));
  return true;
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ditchbook</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;

function servePage(res: http.ServerResponse): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(INDEX_HTML);
}

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;

function serveNotFound(res: http.ServerResponse): void {
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(NOT_FOUND_HTML);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      try {
        await handleApi(req, res, url);
      } catch (e) {
        if (e instanceof ApiError) sendApiError(res, e);
        else {
          console.error("api error:", e);
          sendApiError(res, new ApiError(500, "server_error", "Something went wrong."));
        }
      }
      return;
    }
    if (url.pathname === "/api/health") {
      if (!ctx.dbReady) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "database_unavailable", message: "The database is not answering." }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    // static assets and pages
    if (req.method === "GET" || req.method === "HEAD") {
      if (url.pathname === "/" || !extname(url.pathname) || url.pathname === "/index.html") {
        servePage(res);
        return;
      }
      if (serveAsset(res, url.pathname)) return;
      if (extname(url.pathname)) {
        serveNotFound(res);
        return;
      }
      servePage(res);
      return;
    }
    serveNotFound(res);
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server_error", message: "Something went wrong." }));
    }
  }
});

server.listen(cfg.port, "0.0.0.0", () => {
  console.log(`ditchbook listening on 0.0.0.0:${cfg.port}`);
});

void startup().then(() => {
  console.log("schema and seed in place");
});
void workerLoop();
