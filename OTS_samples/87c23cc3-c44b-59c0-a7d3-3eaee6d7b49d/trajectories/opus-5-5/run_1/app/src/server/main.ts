import { createServer } from "node:http";
import { formatError, utf8Length } from "../shared/mortise.js";
import { registerAuthRoutes } from "./auth.js";
import { config } from "./config.js";
import { startSchema } from "./db.js";
import { FIELD, fail } from "./errors.js";
import { registerExportRoutes, countExports } from "./exports.js";
import { registerGradingRoutes } from "./grading.js";
import { serviceHealth } from "./health.js";
import { json, parseCookies, parseJson, readBody, Router, send, sendError, type Context } from "./http.js";
import { registerImportRoutes } from "./imports.js";
import { attachLive } from "./live.js";
import { serveAsset, servePage } from "./pages.js";
import { countProjects, parseText } from "./project-store.js";
import { registerProjectRoutes } from "./projects.js";
import { registerShareRoutes } from "./shares.js";
import { registerVersionRoutes } from "./versions.js";

const router = new Router();

router.add("GET", "/api/health", async () => {
  const health = await serviceHealth();
  if (!health.database) return json(503, { status: "unavailable" });
  return json(200, { status: health.storage && health.mail ? "ok" : "unavailable" });
});

router.add("GET", "/api/status", async () => {
  const health = await serviceHealth();
  return json(200, {
    storage: health.storage ? "up" : "down",
    mail: health.mail ? "up" : "down",
    checkedAt: health.checkedAt.toISOString(),
  });
});

router.add("GET", "/api/stats", async () => json(200, { projects: await countProjects(), exports: await countExports() }));

router.add("POST", "/api/check", async (ctx) => {
  const body = parseJson(ctx.body);
  if (typeof body.text !== "string") throw fail.invalid({ text: FIELD.text });
  if (utf8Length(body.text) > config.textLimitBytes) throw fail.textTooLarge(config.textLimitBytes);
  const result = parseText(body.text);
  return json(200, { valid: result.errors.length === 0, errorCount: result.errors.length, errors: result.errors.map(formatError) });
});

registerAuthRoutes(router);
registerProjectRoutes(router);
registerVersionRoutes(router);
registerShareRoutes(router);
registerExportRoutes(router);
registerImportRoutes(router);
registerGradingRoutes(router);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      const body = await readBody(req);
      const match = router.match(method, url.pathname);
      if (!match) throw fail.notFound();
      const ctx: Context = { req, url, params: match.params, body, cookies: parseCookies(req.headers.cookie) };
      send(res, await match.handler(ctx));
      return;
    }
    if ((method === "GET" || method === "HEAD") && serveAsset(url.pathname, res)) return;
    req.resume();
    await servePage(url.pathname, parseCookies(req.headers.cookie), res);
  } catch (error) {
    sendError(res, error);
  }
});

attachLive(server);
startSchema();
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Joinery listening on http://0.0.0.0:${config.port}`);
});
