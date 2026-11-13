// Stowdeck server: schema, seed, service status, background work and the API.

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applySchema } from "./schema.js";
import { seed } from "./seed.js";
import { ServerClock } from "./clock.js";
import { startBackground } from "./background.js";
import { routes } from "./routes.js";
import { ensureIndexSettings, indexExists } from "./search.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const clock = new ServerClock(process.env.STOWDECK_NOW);

const app = Fastify({
  logger: { level: process.env.STOWDECK_LOG === "debug" ? "debug" : "warn" },
  bodyLimit: 65_536,
});
await app.register(multipart, { limits: { fileSize: 16_000_000, files: 1 } });

// Same-origin only: a state-changing request whose Origin header does not match
// the request's own host returns 403 cross_origin.
app.addHook("onRequest", async (req, reply) => {
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch { host = ""; }
    if (host !== (req.headers.host ?? "")) {
      return reply.code(403).send({ error: { code: "cross_origin", message: "Requests from other origins are not accepted." } });
    }
  }
});

// The published error shape for malformed JSON and oversized bodies.
app.setErrorHandler((err: Error & { code?: string; statusCode?: number }, req, reply) => {
  if (err.code === "FST_ERR_CTP_INVALID_JSON_BODY" || err.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
    return reply.code(400).send({ error: { code: "malformed_json", message: "That request body is not valid JSON." } });
  }
  if (err.code === "FST_ERR_CTP_BODY_TOO_LARGE" || err.statusCode === 413) {
    return reply.code(413).send({ error: { code: "too_large", message: "That request is too large." } });
  }
  if (err.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return reply.code(415).send({ error: { code: "unsupported_media_type", message: "That content type is not accepted." } });
  }
  if (err.statusCode === 404) {
    return reply.code(404).send({ error: { code: "not_found", message: "This reference isn't in your deck." } });
  }
  req.log.warn(err);
  return reply.code(500).send({ error: { code: "internal", message: "Something went wrong. Try again." } });
});

await applySchema(pool);
await seed(pool);
try {
  if (await indexExists()) await ensureIndexSettings();
} catch { /* recreated by the background index check */ }
await routes(app, pool, clock);
startBackground(pool, clock);

// Only the built browser assets and the API are served; requests for source
// files, lockfiles, environment files or the run manifest return 404.
const distDir = join(process.cwd(), "dist");
const STATIC_FILES = new Set(["/app.js", "/styles.css", "/host-grotesk.ttf",
  "/demo-radio.jpg", "/demo-calculator.jpg", "/demo-kettle.jpg"]);
const MIME: Record<string, string> = {
  ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf",
  ".jpg": "image/jpeg", ".html": "text/html",
};

app.setNotFoundHandler((req, reply) => {
  if (req.method === "GET" && req.url.startsWith("/api/")) {
    return reply.code(404).send({ error: { code: "not_found", message: "This reference isn't in your deck." } });
  }
  if (req.method !== "GET") {
    return reply.code(404).send({ error: { code: "not_found", message: "This reference isn't in your deck." } });
  }
  const path = req.url.split("?")[0];
  if (STATIC_FILES.has(path)) {
    const data = readFileSync(join(distDir, path));
    const ext = path.slice(path.lastIndexOf("."));
    reply.header("content-type", MIME[ext]);
    return reply.send(data);
  }
  // A route the client router handles (/, /library, /references/<id>, ...) is
  // served the app shell; anything that looks like a file returns 404.
  if (/\.[a-z0-9]+$/i.test(path)) {
    return reply.code(404).send({ error: { code: "not_found", message: "This reference isn't in your deck." } });
  }
  try {
    const data = readFileSync(join(distDir, "index.html"));
    reply.header("content-type", "text/html");
    return reply.send(data);
  } catch {
    return reply.code(404).send({ error: { code: "not_found", message: "This reference isn't in your deck." } });
  }
});

const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
await app.listen({ port, host: "0.0.0.0" });
console.log(`stowdeck serving on 0.0.0.0:${port}`);
