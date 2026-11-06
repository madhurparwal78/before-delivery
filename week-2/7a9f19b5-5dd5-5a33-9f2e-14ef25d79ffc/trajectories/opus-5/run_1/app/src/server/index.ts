/**
 * The Lightfall server. It binds the published port and answers the health check
 * whatever the state of the providers, so it starts and serves every feature that
 * does not need a missing service.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { applySchemaAndSeed } from "./db/seed.js";
import { makeCtx, parseJsonBody, readBody, sendApiError, sendJson, type Ctx } from "./http/context.js";
import { ApiError, crossOrigin, notFound } from "./http/errors.js";
import { Router } from "./http/router.js";
import { serveStatic } from "./http/static.js";
import { userFromHeaders } from "./http/session.js";
import * as auth from "./routes/auth.js";
import * as catalogue from "./routes/catalogue.js";
import * as cart from "./routes/cart.js";
import * as checkout from "./routes/checkout.js";
import * as projects from "./routes/projects.js";
import * as shares from "./routes/shares.js";
import * as admin from "./routes/admin.js";
import * as newsletter from "./routes/newsletter.js";
import { startShareWorker } from "./routes/shares.js";
import { ensureCollections } from "./services/pocketbase.js";

const config = loadConfig();

const router = new Router()
  .get("/api/health", async (ctx) => sendJson(ctx.res, 200, { status: "ok" }))

  .post("/api/auth/signup", auth.signup)
  .post("/api/auth/signin", auth.signin)
  .post("/api/auth/signout", auth.signout)
  .get("/api/me", auth.me)
  .put("/api/me/dial", auth.setDial)

  .get("/api/catalogue", catalogue.catalogue)
  .get("/api/products/:slug", catalogue.product)
  .get("/api/compare", catalogue.compare)
  .get("/api/variants/:code/spec-sheet", catalogue.specSheet)
  .get("/api/favourites", catalogue.listFavourites)
  .put("/api/favourites/:code", catalogue.saveFavourite)
  .delete("/api/favourites/:code", catalogue.removeFavourite)

  .get("/api/cart", cart.getCart)
  .post("/api/cart/lines", cart.addCartLine)
  .patch("/api/cart/lines/:code", cart.setCartLineQuantity)

  .post("/api/orders/:orderKey/authorise", checkout.authorise)
  .post("/api/orders/:orderKey/place-on-account", checkout.placeOnAccount)
  .get("/api/orders", checkout.listOrders)
  .get("/api/orders/:orderKey", checkout.getOrder)

  .post("/api/newsletter", newsletter.subscribe)
  .get("/api/newsletter/confirm", newsletter.confirm)

  .post("/api/projects", projects.createProject)
  .get("/api/projects", projects.listProjects)
  .get("/api/projects/:id", projects.getProject)
  .patch("/api/projects/:id", projects.patchProject)
  .post("/api/projects/:id/lines", projects.addProjectLine)
  .patch("/api/projects/:id/lines/:code", projects.setProjectLineQuantity)
  .post("/api/projects/:id/cover", projects.uploadCover, "multipart")
  .get("/api/projects/:id/cover", projects.getCover)
  .post("/api/projects/:id/placements", projects.createPlacement)
  .patch("/api/projects/:id/placements/:pid", projects.movePlacement)
  .delete("/api/projects/:id/placements/:pid", projects.deletePlacement)
  .post("/api/projects/:id/collaborators", projects.addCollaborator)
  .delete("/api/projects/:id/collaborators/:userId", projects.removeCollaborator)
  .get("/api/projects/:id/comments", projects.listComments)
  .post("/api/projects/:id/comments", projects.postComment)
  .get("/api/projects/:id/live", projects.liveStream)
  .post("/api/projects/:id/shares", shares.createShare)
  .get("/api/projects/:id/shares", shares.listShares)
  .get("/api/shares/:shareId/pdf", shares.getSharePdf)

  .get("/api/admin/trade-applications", admin.listApplications)
  .post("/api/admin/trade-applications/:id/approve", admin.approveApplication)
  .post("/api/admin/trade-applications/:id/decline", admin.declineApplication)
  .get("/api/admin/orders", admin.listOrders)
  .post("/api/admin/orders/:orderKey/dispatch", admin.dispatch)
  .post("/api/admin/orders/:orderKey/refunds", admin.refund)
  .post("/api/admin/orders/:orderKey/record-payment", admin.recordPayment)
  .get("/api/admin/stock", admin.listStock)
  .patch("/api/admin/variants/:code", admin.adjustVariant)
  .get("/api/admin/health", admin.health);

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The browser talks only to the app's own origin. A state-changing request whose
 * `Origin` header is present and differs answers 403.
 */
function isCrossOrigin(ctx: Ctx): boolean {
  if (!STATE_CHANGING.has(ctx.method)) return false;
  const origin = ctx.headers.origin;
  if (typeof origin !== "string" || origin === "" || origin === "null") return false;
  const host = ctx.headers.host;
  try {
    const candidate = new URL(origin);
    if (typeof host === "string" && host !== "" && candidate.host === host) return false;
    return candidate.origin !== new URL(config.app.publicUrl).origin;
  } catch {
    return true;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const method = (req.method ?? "GET").toUpperCase();

  if (!url.pathname.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    if (await serveStatic(res, url.pathname)) return;
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    // Error precedence step 1: 413, then 415, then invalid_json, then cross_origin.
    const body = await readBody(req);
    const match = router.match(method, url.pathname);
    const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "";
    const takesJson = match === null || match.bodyKind === "json";
    const parsedBody = takesJson ? parseJsonBody(body, contentType) : {};

    const ctx = makeCtx({ req, res, url, body, parsedBody, params: match?.params ?? {} });
    if (isCrossOrigin(ctx)) throw crossOrigin();
    if (!match) throw notFound();

    ctx.user = await userFromHeaders(req.headers);
    await match.handler(ctx);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      sendApiError(res, error);
      return;
    }
    console.error("unhandled request failure", error);
    sendJson(res, 500, { error: "internal_error" });
  }
}

async function main(): Promise<void> {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  // Live streams are long lived, so the request itself must not time out.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  await new Promise<void>((resolve) => {
    server.listen(config.app.port, "0.0.0.0", resolve);
  });
  console.log(`Lightfall is serving on port ${config.app.port}`);

  // Postgres is the system of record, so the schema and seed must apply. The other
  // providers may be unreachable at boot: the app still starts and serves.
  await applySchemaAndSeed();

  void ensureCollections().catch(() => undefined);
  setInterval(() => {
    void ensureCollections().catch(() => undefined);
  }, 30_000).unref();

  startShareWorker();
}

void main().catch((error: unknown) => {
  console.error("Lightfall failed to start", error);
  process.exitCode = 1;
});
