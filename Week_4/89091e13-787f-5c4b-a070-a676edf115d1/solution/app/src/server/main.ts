import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { cookieValue, SESSION_COOKIE, userOfSession } from "./auth.ts";
import { loadClock } from "./clock.ts";
import { config } from "./config.ts";
import { applySchema, exclusive, pool } from "./db.ts";
import { catchUp, startRealtimeClock } from "./engine.ts";
import { HttpError } from "./errors.ts";
import { flushObjects } from "./blocks.ts";
import { subscribe } from "./live.ts";
import { deliverDueMail } from "./outbox.ts";
import { chainRoutes } from "./routes/chain.ts";
import { memberScope } from "./routes/context.ts";
import { economyRoutes } from "./routes/economy.ts";
import { gradingRoutes } from "./routes/grading.ts";
import { sessionRoutes } from "./routes/session.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import { buildSeed } from "./seed.ts";
import { appShell, clientAsset, loadClientAssets } from "./static.ts";
import { probeStorage } from "./storage.ts";

const STORAGE_RECHECK_MS = 2000;
const MAIL_SWEEP_MS = 1000;

const api = new Hono();
api.route("/", sessionRoutes);
api.route("/", workspaceRoutes);
api.route("/", chainRoutes);
api.route("/", economyRoutes);
api.route("/grading", gradingRoutes);

const app = new Hono();
app.onError((error, c) => {
  if (error instanceof HttpError) return c.json(error.body, error.status);
  console.error(error);
  return c.json({ error: "Something went wrong." }, 500);
});
app.route("/api", api);
const SHELL_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };

/** The shell names the workspace of a member's route so the browser can open the live channel at once. */
async function shellFor(path: string, cookie: string | undefined): Promise<string> {
  const routeId = /^\/w\/([^/]+)/.exec(path)?.[1];
  const user = routeId ? await userOfSession(pool, cookieValue(cookie, SESSION_COOKIE)) : undefined;
  const scope = routeId && user ? await memberScope(user, routeId) : undefined;
  return appShell(scope ? routeId : undefined);
}

app.notFound(async (c) => {
  if (c.req.method !== "GET" || c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
  const asset = clientAsset(c.req.path);
  if (asset) return c.body(new Uint8Array(asset.body), 200, { "Content-Type": asset.type, "Cache-Control": "no-cache" });
  if (/\.[a-z0-9]+$/i.test(c.req.path)) return c.json({ error: "Not found" }, 404);
  return c.body(await shellFor(c.req.path, c.req.header("cookie")), 200, SHELL_HEADERS);
});
app.get("/", async (c) => c.body(await shellFor(c.req.path, undefined), 200, SHELL_HEADERS));

await applySchema();
await loadClientAssets();
if (!(await loadClock(pool))) await exclusive(buildSeed);
await probeStorage();

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, () => console.log(`Fernsquare listening on ${config.port}`));

const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", async (request, socket, head) => {
  const refuse = (status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const origin = request.headers.origin;
  const match = /^\/api\/w\/([^/?]+)\/live$/.exec(request.url?.split("?")[0] ?? "");
  if (!match) return refuse("404 Not Found");
  if (origin && new URL(origin).host !== request.headers.host) return refuse("403 Forbidden");
  const user = await userOfSession(pool, cookieValue(request.headers.cookie, SESSION_COOKIE));
  if (!user) return refuse("401 Unauthorized");
  const scope = await memberScope(user, match[1] as string);
  if (!scope) return refuse("404 Not Found");
  sockets.handleUpgrade(request, socket, head, (client) => subscribe(scope.workspaceId, client));
});

// Background work (clock, mail, storage) retries on its own schedule; a transient failure is logged, never fatal.
process.on("unhandledRejection", (error) => console.error(error));

startRealtimeClock();
setInterval(() => void probeStorage().then(flushObjects), STORAGE_RECHECK_MS);
setInterval(() => void deliverDueMail(), MAIL_SWEEP_MS);
void exclusive(catchUp);
