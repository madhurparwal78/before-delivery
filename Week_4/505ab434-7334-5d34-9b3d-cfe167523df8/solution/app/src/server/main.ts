// Boot: wait for PostgreSQL, apply the schema, load the demo dataset on an empty database, then serve.
import { createServer } from "node:http";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { ApiError, notFound } from "./errors.ts";
import { Ctx, Router, crossOrigin, errorReply, send, type Reply } from "./http.ts";
import { principalForSession } from "./auth.ts";
import { startLive } from "./live.ts";
import { startMailer } from "./mailer.ts";
import { page } from "./pages.ts";
import { prepareDatabase } from "./seed.ts";
import { registerRoutes } from "./routes/index.ts";
import { parseCookies } from "./http.ts";

const router = new Router();
registerRoutes(router);

async function respond(req: import("node:http").IncomingMessage): Promise<Reply> {
  const url = new URL(req.url ?? "/", "http://app");
  const principal = await principalForSession(parseCookies(req.headers.cookie)[config.sessionCookieName]);
  if (crossOrigin(req)) throw new ApiError(403, "cross_origin", "Requests must come from this site.");
  const method = req.method ?? "GET";
  const isApi = url.pathname.startsWith("/api/") || url.pathname.startsWith("/dl/");
  const route = router.match(method, url.pathname);
  if (route) {
    const ctx = new Ctx(req, url.pathname, url.search, principal);
    ctx.params = route.params;
    return route.handler(ctx);
  }
  if (isApi || (method !== "GET" && method !== "HEAD")) throw notFound();
  return page(url.pathname, principal);
}

const server = createServer((req, res) => {
  respond(req).then(
    (reply) => send(res, reply),
    (error: unknown) => {
      if (error instanceof ApiError) return send(res, errorReply(error));
      console.error(error);
      send(res, { status: 500, body: { error: "internal_error", message: "Something went wrong." } });
    },
  );
});

async function connect(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

await connect();
await prepareDatabase();
startMailer();
startLive(server);
server.listen(config.port, "0.0.0.0", () => console.log(`rulehouse listening on ${config.port}`));
