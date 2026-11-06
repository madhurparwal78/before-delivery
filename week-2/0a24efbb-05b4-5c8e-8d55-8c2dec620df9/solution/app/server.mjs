import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import Fastify from "fastify";
import { createRequestHandler } from "react-router";
import { dispatch, sendFailure } from "./src/api.mjs";
import { startBoot } from "./src/boot.mjs";
import * as calendar from "./src/calendar.mjs";
import { config } from "./src/config.mjs";
import { requireStoreReached } from "./src/db.mjs";
import { wholeTrail } from "./src/audit.mjs";
import { BODY_LIMIT, WORDING, refuse } from "./src/http.mjs";
import { routePage } from "./src/pages.mjs";
import * as policy from "./src/policy.mjs";
import * as requests from "./src/requests.mjs";
import { sharedMonth } from "./src/share.mjs";

const here = new URL(".", import.meta.url);

/** A path that cannot be decoded names nothing: taken literally, it answers as any other unknown path does. */
function literalPath({ url }) {
  const path = url.split("?")[0];
  try {
    decodeURIComponent(path);
    return url;
  } catch {
    return path.replaceAll("%", "%25") + url.slice(path.length);
  }
}

const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT * 64, rewriteUrl: literalPath });

// Bodies are kept raw so the desk's own checks (size, type, shape) answer every malformed body.
app.removeAllContentTypeParsers();
app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

const carriesShareToken = (request) => {
  const [path, query = ""] = request.url.split(/\?(.*)/s);
  return path.startsWith("/share/") || new URLSearchParams(query).has("share");
};

// A shared link is read-only: any write carrying its token is refused before every other step, on any path.
app.addHook("onRequest", async (request, reply) => {
  if (request.method !== "GET" && request.method !== "HEAD" && carriesShareToken(request)) {
    return sendFailure(reply, refuse(403, WORDING.readOnly));
  }
});

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("content-security-policy", "frame-ancestors 'none'");
  // The shared month's token never leaks to another page through a referrer.
  reply.header("referrer-policy", request.url.startsWith("/share/") ? "no-referrer" : "strict-origin-when-cross-origin");
  return payload;
});

app.setErrorHandler((error, _request, reply) => {
  const tooLarge = error.code === "FST_ERR_CTP_BODY_TOO_LARGE";
  return sendFailure(reply, tooLarge ? refuse(413, WORDING.tooLarge) : error);
});

// Static files: the built stylesheet, the two webfonts and the browser island. Nothing else on disk is served.
const statics = new Map();
const LONG = "public, max-age=31536000, immutable";
async function publish(urlPath, file, type, cache) {
  const body = await readFile(new URL(file, here));
  statics.set(urlPath, { body, packed: type.startsWith("font/") ? null : gzipSync(body), type, cache });
}
for (const name of await readdir(new URL("build/client/assets/", here))) {
  if (name.endsWith(".css")) await publish(`/assets/${name}`, `build/client/assets/${name}`, "text/css; charset=utf-8", LONG);
}
for (const name of ["open-sans-latin-wght-normal.woff2", "poppins-latin-600-normal.woff2"]) {
  await publish(`/fonts/${name}`, `public/fonts/${name}`, "font/woff2", LONG);
}
await publish("/desk.js", "public/desk.js", "text/javascript; charset=utf-8", "no-store");
await publish("/queue-query.mjs", "src/queue-query.mjs", "text/javascript; charset=utf-8", "no-store");
await publish("/time.mjs", "src/time.mjs", "text/javascript; charset=utf-8", "no-store");
await publish("/text.mjs", "src/text.mjs", "text/javascript; charset=utf-8", "no-store");

/** Send text gzipped when the browser accepts it. */
function sendText(request, reply, body, packed = gzipSync(body)) {
  reply.header("vary", "accept-encoding");
  if (!/\bgzip\b/.test(String(request.headers["accept-encoding"] ?? ""))) return reply.send(body);
  return reply.header("content-encoding", "gzip").send(packed);
}

const build = await import(new URL("build/server/index.js", here).href);
const render = createRequestHandler(build, "production");
const desk = { ...requests, ...policy, ...calendar, wholeTrail, sharedMonth, publicUrl: config.publicUrl };

async function page(request, reply) {
  const reading = request.method === "GET" || request.method === "HEAD";
  const file = reading && statics.get(request.url.split("?")[0]);
  if (file) {
    reply.type(file.type).header("cache-control", file.cache);
    return file.packed ? sendText(request, reply, file.body, file.packed) : reply.send(file.body);
  }
  try {
    await requireStoreReached();
    const decided = await routePage(reading ? request.url : "/not-found", request.headers);
    if (decided.redirect) return reply.code(303).header("location", decided.redirect).send();
    const { path, context } = decided.render;
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const response = await render(new Request(new URL(path, `${request.protocol}://${request.host}`), { headers }), { ...context, desk });
    reply.code(response.status).type("text/html; charset=utf-8").header("cache-control", "no-store");
    return sendText(request, reply, Buffer.from(await response.text()));
  } catch (error) {
    console.error(error);
    return reply.code(500).type("text/html; charset=utf-8").send(`<!DOCTYPE html><html lang="en"><title>Rostara</title><p>${WORDING.failed}</p></html>`);
  }
}

app.route({ method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], url: "/api", handler: dispatch });
app.route({ method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], url: "/api/*", handler: dispatch });
app.route({ method: ["GET", "HEAD"], url: "/*", handler: page });
app.setNotFoundHandler(page);

startBoot();
await app.listen({ host: "0.0.0.0", port: config.port });
