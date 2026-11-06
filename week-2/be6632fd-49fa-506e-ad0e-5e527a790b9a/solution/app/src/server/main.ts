// Start-up (brief: Deployment; Server boundary): schema and seed under one advisory lock, then the HTTP server
// on 0.0.0.0, the sweep, and the built client from dist/client.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./auth";
import { config } from "./config";
import { one, pool } from "./db";
import { dispatch, reply, route, send } from "./http";
import { SCHEMA } from "./schema";
import { seed } from "./seed";
import { startSweep } from "./sweep";
import "./allocations";
import "./holds";
import "./lineSheets";
import "./looks";
import "./members";
import "./previews";
import "./priceLists";
import "./public";
import "./restocks";
import "./stockists";
import "./story";
import "./waitlist";

route("GET", "/api/health", "none", async () => reply(200, { status: "ok" }));

const CLIENT = join(fileURLToPath(new URL(".", import.meta.url)), "client");
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

const SCREENS = [
  /^\/$/, /^\/sign-in$/, /^\/forgot-password$/, /^\/reset-password\/[^/]+$/, /^\/invite\/[^/]+$/, /^\/waitlist\/confirm\/[^/]+$/,
  /^\/studio\/(drops|invoicing|price-lists|press|stockists|members|my-store)$/, /^\/studio\/drops\/new$/,
  /^\/studio\/drops\/[^/]+(\/(allocations|line-sheet|lookbook|story|previews))?$/, /^\/studio\/allocations\/[^/]+$/, /^\/studio\/stockists\/[^/]+$/,
];

/** The HTTP status of a screen address: 404 outside the screen table, 410 for a withdrawn drop or a dead preview. */
async function screenStatus(path: string): Promise<number> {
  const drop = /^\/drops\/([^/]+)$/.exec(path);
  if (drop) {
    const found = await one<{ status: string }>(pool, "SELECT status FROM drops WHERE slug = $1", [decodeURIComponent(drop[1])]);
    return !found || found.status === "draft" ? 404 : found.status === "withdrawn" ? 410 : 200;
  }
  const press = /^\/press\/([^/]+)$/.exec(path);
  if (press) {
    const token = decodeURIComponent(press[1]);
    const found = await one<{ live: boolean }>(
      pool,
      `SELECT (p.revoked_at IS NULL AND p.expires_at > now() AND d.status <> 'withdrawn' AND p.token = $1) AS live
       FROM previews p JOIN drops d ON d.id = p.drop_id WHERE p.token = $1 OR p.id IN (SELECT preview_id FROM replaced_preview_tokens WHERE token = $1)`,
      [token],
    );
    return !found ? 404 : found.live ? 200 : 410;
  }
  const claim = /^\/claim\/([^/]+)$/.exec(path);
  if (claim) return (await one(pool, "SELECT 1 FROM holds WHERE token_hash = $1", [sha256(decodeURIComponent(claim[1]))])) ? 200 : 404;
  return SCREENS.some((s) => s.test(path)) ? 200 : 404;
}

let indexHtml: Buffer | null = null;

async function staticFile(path: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!/^\/(assets|fonts)\/[\w.-]+$/.test(path)) return null;
  const file = normalize(join(CLIENT, path));
  if (!file.startsWith(CLIENT)) return null;
  try {
    return { bytes: await readFile(file), type: TYPES[extname(file)] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  for (;;) {
    const client = await pool.connect().catch((error: Error) => {
      console.error("waiting for postgres:", error.message);
      return null;
    });
    if (client) {
      try {
        await client.query("SELECT pg_advisory_lock(7000)");
        await client.query(SCHEMA);
        await client.query("BEGIN");
        await seed(client);
        await client.query("COMMIT");
        break;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error("start-up step failed, retrying:", (error as Error).message);
      } finally {
        await client.query("SELECT pg_advisory_unlock(7000)").catch(() => undefined);
        client.release();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  indexHtml = await readFile(join(CLIENT, "index.html"));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/") || url.pathname === "/sitemap.xml") {
      void dispatch(req, res, url);
      return;
    }
    void (async () => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, { status: 405, bytes: Buffer.from("Method not allowed"), contentType: "text/plain; charset=utf-8", headers: { Allow: "GET, HEAD" } });
        return;
      }
      const file = await staticFile(url.pathname);
      if (file) {
        send(res, { status: 200, bytes: file.bytes, contentType: file.type, headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
        return;
      }
      const status = await screenStatus(url.pathname).catch(() => 404);
      send(res, { status, bytes: indexHtml ?? Buffer.alloc(0), contentType: "text/html; charset=utf-8" });
    })();
  });
  server.listen(config.port, "0.0.0.0", () => console.log(`Hourline Launch Hub on ${config.publicUrl}`));
  startSweep();
  const stop = (): void => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

void boot();
