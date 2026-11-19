import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { accountRoutes, COOKIE } from "./accounts.js";
import { assetRoutes } from "./assets.js";
import { chatRoutes } from "./chat.js";
import { communityRoutes } from "./communities.js";
import { config } from "./config.js";
import { databaseReady, prepareDatabase } from "./db.js";
import { friendRoutes } from "./friends.js";
import { gatheringRoutes } from "./gatherings.js";
import { overGranite } from "./glb.js";
import { gradingRoutes } from "./grading.js";
import { healthStatus, startProbes } from "./health.js";
import {
  CROSS_ORIGIN_TEXT,
  errorBody,
  MULTIPART_LIMIT,
  notFound,
  parseCookies,
  parseJsonObject,
  readBody,
  Refusal,
  reply,
  Router,
  sameOrigin,
  sendBytes,
  sendJson,
  TOO_LARGE_TEXT,
  unauthorized,
  type Context,
} from "./http.js";
import { startLive } from "./live.js";
import { personForLogin, type Person } from "./people.js";
import { reportRoutes } from "./reports.js";
import { safetyRoutes } from "./safety.js";
import { startSeeding } from "./seed.js";
import { sessionRoutes } from "./sessions.js";
import { pageFor } from "./static.js";
import { startSweeper } from "./sweeper.js";
import { handleUpgrade } from "./upgrade.js";
import { voteRoutes } from "./votes.js";

const router = new Router<Person>();
router.add("GET", "/api/health", () => reply(200, { status: healthStatus() }), { anonymous: true });
for (const register of [accountRoutes, friendRoutes, safetyRoutes, sessionRoutes, chatRoutes, voteRoutes, assetRoutes, reportRoutes, communityRoutes, gatheringRoutes, gradingRoutes]) {
  register(router);
}

const CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LARGE_FILE = overGranite("file size");

async function api(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<void> {
  const found = router.find(method, url.pathname);
  if (!found) throw notFound();
  if (!databaseReady() && url.pathname !== "/api/health") throw new Refusal(503, "Hearthtile is starting. Try again in a moment.");
  const contentType = String(req.headers["content-type"] ?? "");
  const multipart = contentType.startsWith("multipart/");
  const limit = multipart ? MULTIPART_LIMIT : found.route.bodyLimit;
  const body = CHANGING.has(method) ? await readBody(req, limit) : { raw: Buffer.alloc(0), tooLarge: false };
  if (body.tooLarge) throw new Refusal(413, multipart ? LARGE_FILE : TOO_LARGE_TEXT);
  let parsed: Record<string, unknown> | null = null;
  const ctx: Context = {
    req,
    url,
    params: found.params,
    raw: body.raw,
    contentType,
    cookie: (name) => parseCookies(req.headers.cookie).get(name),
    json: () => (parsed ??= parseJsonObject(body.raw)),
  };
  const person = found.route.anonymous ? null : await personForLogin(ctx.cookie(COOKIE));
  if (!found.route.anonymous && !person) throw unauthorized();
  const result = await found.route.handler(ctx, person);
  if (Buffer.isBuffer(result.body)) sendBytes(res, result.status, result.headers?.["content-type"] ?? "application/octet-stream", result.body, { "cache-control": "no-store" });
  else sendJson(res, result.status, result.body, result.headers);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (CHANGING.has(method) && !sameOrigin(req)) {
      req.resume();
      throw new Refusal(403, CROSS_ORIGIN_TEXT);
    }
    if (url.pathname.startsWith("/api/")) await api(req, res, url, method);
    else if (method === "GET" || method === "HEAD") {
      const page = pageFor(url.pathname);
      sendBytes(res, page.status, page.type, method === "HEAD" ? Buffer.alloc(0) : page.bytes, {
        "cache-control": page.cache,
        "x-content-type-options": "nosniff",
        "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
      });
    } else throw notFound();
  } catch (error) {
    if (res.headersSent) return;
    if (error instanceof Refusal) sendJson(res, error.status, errorBody(error.message));
    else if (typeof error === "object" && error !== null && String((error as { code?: unknown }).code).startsWith("22")) {
      sendJson(res, 422, errorBody("Send a valid value."));
    } else {
      console.error(`[${config.instanceName}] ${method} ${url.pathname}`, error);
      sendJson(res, 500, errorBody("Something went wrong."));
    }
  }
}

const server = createServer((req, res) => void handle(req, res));
server.on("upgrade", handleUpgrade);
server.keepAliveTimeout = 65_000;

startLive();
startProbes();
void prepareDatabase().then(() => {
  startSweeper();
  startSeeding();
});

server.listen(config.port, "0.0.0.0", () => console.log(`[${config.instanceName}] Hearthtile listening on ${config.port}`));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
process.on("unhandledRejection", (reason) => console.error("unhandled rejection", reason));
