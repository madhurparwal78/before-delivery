// Lowfield Console server: applies the schema and seed data, then serves the API, the live
// WebSocket endpoint and the browser bundle on 0.0.0.0.
import { createServer } from "node:http";
import { config } from "./config";
import { applySchema, tx, waitForDatabase } from "./db";
import { ApiError, describe, internalError, notFound, readBody, Router, sendError, serveStatic } from "./http";
import { markForeignOrigin } from "./access";
import { registerPublic } from "./routes/public";
import { registerOrg } from "./routes/org";
import { registerProjects } from "./routes/projects";
import { registerSessions } from "./routes/sessions";
import { registerCorrections } from "./routes/corrections";
import { attachListen } from "./listen";
import { seed, uploadSeedObjects } from "./seed";
import { startEvents } from "./events";
import { startRuntime } from "./runtime";
import { startBilling } from "./billing";

const router = new Router();
registerPublic(router);
registerOrg(router);
registerProjects(router);
registerSessions(router);
registerCorrections(router);

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://app");
  const method = req.method ?? "GET";
  let route = url.pathname;
  try {
    const api = /^\/(api|v1|fixtures)\//.test(url.pathname);
    if (!api) {
      if ((method === "GET" || method === "HEAD") && (await serveStatic(url.pathname, res))) return;
      throw notFound();
    }
    const match = router.match(method, url.pathname);
    if (match === null) throw notFound();
    route = match.route.path;
    const body = STATE_CHANGING.has(method) ? await readBody(req, match.route.body) : ({ kind: "none" } as const);
    // Same-origin writes only: the origin is this request's own scheme and Host. A foreign write is
    // refused at the 403 step of the error precedence, so 413/415, 401 and 404 still come first.
    const origin = req.headers.origin;
    if (url.pathname.startsWith("/api/") && STATE_CHANGING.has(method) && origin !== undefined && origin !== `http://${req.headers.host}`) {
      markForeignOrigin(req);
    }
    await match.route.handler({ req, res, method, path: url.pathname, query: url.searchParams, params: match.params, body });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) sendError(res, error);
    else {
      console.error(`${method} ${route} failed: ${describe(error)}`);
      sendError(res, internalError());
    }
  }
});
server.requestTimeout = 0;
server.keepAliveTimeout = 5000;
attachListen(server);

function retrying(ms: number, work: () => Promise<void>): void {
  work().catch(() => setTimeout(() => retrying(ms, work), ms).unref());
}

async function main(): Promise<void> {
  await waitForDatabase();
  for (;;) {
    try {
      await tx(async (db) => {
        await applySchema(db);
        await seed(db);
      });
      break;
    } catch (error) {
      console.error(`schema not applied yet: ${describe(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await startEvents();
  startRuntime();
  startBilling();
  retrying(5000, uploadSeedObjects);
  server.listen(config.port, "0.0.0.0", () => console.log(`Lowfield Console listening on port ${config.port}`));
}

void main();
