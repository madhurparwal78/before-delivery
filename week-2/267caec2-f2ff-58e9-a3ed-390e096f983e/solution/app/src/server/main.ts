import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { config } from "./config.js";
import { pool } from "./db.js";
import { ApiError, refuse } from "./errors.js";
import { type ApiResult, readApiRequest } from "./http.js";
import { runMailSender } from "./mail.js";
import { runPacketWriter } from "./rounds.js";
import { UPLOAD_ROUTE, match } from "./routes.js";
import { SCHEMA } from "./schema.js";
import { runSeedImages, seed } from "./seed.js";

// The one origin: pages, bundled fonts and the API (brief: Deployment; Server boundary).

const PUBLIC_DIR = join(__dirname, "public");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

let ready = false;
let markReady: () => void = () => undefined;
const readiness = new Promise<void>((resolve) => {
  markReady = resolve;
});

function send(res: ServerResponse, result: ApiResult): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, ...result.headers };
  if (result.bytes) {
    res.writeHead(result.status, { ...headers, "Content-Type": result.bytes.type, "Content-Length": String(result.bytes.data.length) });
    res.end(result.bytes.data);
    return;
  }
  if (result.json === undefined) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  const body = Buffer.from(JSON.stringify(result.json));
  res.writeHead(result.status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Content-Length": String(body.length) });
  res.end(body);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (url.pathname === "/api/health") {
    send(res, ready ? { status: 200, json: { status: "ok" } } : { status: 503, json: { status: "starting" } });
    return;
  }
  try {
    const request = await readApiRequest(req, url, UPLOAD_ROUTE.test(url.pathname));
    await readiness;
    const route = match(request.method, url.pathname);
    if (!route) throw refuse("not_found");
    request.params = route.params;
    send(res, await route.handler(request));
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, { status: error.status, json: error.body });
      return;
    }
    console.error(`${req.method} ${url.pathname}: ${(error as Error).stack ?? String(error)}`);
    if (!res.headersSent) res.writeHead(500, SECURITY_HEADERS);
    res.end();
  }
}

/** A built asset under dist/public, or the app page for every other path. */
async function handlePage(res: ServerResponse, url: URL): Promise<void> {
  const requested = normalize(join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  let file = join(PUBLIC_DIR, "index.html");
  if (requested.startsWith(PUBLIC_DIR + sep) && TYPES[extname(requested)]) {
    const found = await stat(requested).catch(() => null);
    if (found?.isFile()) file = requested;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": file.endsWith(".woff2") ? "public, max-age=604800" : "no-cache",
  });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://desk.local");
  const handled = url.pathname === "/api" || url.pathname.startsWith("/api/") ? handleApi(req, res, url) : handlePage(res, url);
  handled.catch((error: unknown) => {
    console.error(`unhandled: ${String(error)}`);
    res.destroy();
  });
});

/** Applies the schema and seed under one lock, retrying every 2 seconds until Postgres answers. */
async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(4173)");
        await client.query(SCHEMA);
        await seed(client);
        await client.query("COMMIT");
        return;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`database not ready: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

server.listen(config.port, "0.0.0.0", () => console.log(`Cutline Jury Desk listening on 0.0.0.0:${config.port}`));

void prepareDatabase().then(() => {
  ready = true;
  markReady();
  console.log("schema applied; desk ready");
  void runMailSender();
  void runPacketWriter();
  void runSeedImages();
});
