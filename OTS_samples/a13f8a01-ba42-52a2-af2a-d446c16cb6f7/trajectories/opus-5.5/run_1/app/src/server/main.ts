import http from "node:http";
import type { ClientConfig } from "../shared/types";
import { gradingSession, me, resendVerification, signin, signout, signup, verify } from "./accounts";
import { sessionCookieName, userForSession } from "./auth";
import { addCollectionPen, createCollection, deleteCollection, getCollection, listCollections, removeCollectionPen, updateCollection } from "./collections";
import { config } from "./config";
import { applySchema, pool } from "./db";
import { ApiError, MailUnavailable, StorageUnavailable } from "./errors";
import { openEventStream } from "./events";
import { forkPen } from "./forks";
import { gradingSeed } from "./grading";
import { json, matchRoute, parseCookies, readBody, route, writeReply, type Context, type Reply, type Route } from "./http";
import { mailReachable } from "./mail";
import { framingHeaders, serveAsset, servePage } from "./pages";
import { createPen, deletePen, getPen, likePen, listMyPens, unlikePen, updatePen } from "./pens";
import { createRender, servePreview } from "./renders";
import { searchPens } from "./search";
import { seedStarterPens, startMaintenance } from "./seed";
import { listShelf, serveShelfFile } from "./shelf";
import { storageReachable } from "./storage";
import { diffVersions, exportPen, getVersion, listVersions, restoreVersion, saveVersion } from "./versions";

const clientConfig: ClientConfig = {
  preview_delay_ms: config.previewDelayMs,
  draft_interval_ms: config.draftIntervalMs,
  search_debounce_ms: config.searchDebounceMs,
  loop_limit: config.loopLimit,
  pane_limit_bytes: config.paneLimitBytes,
  max_tags: config.maxTags,
  live_poll_ms: 1000,
};

async function health(): Promise<Reply> {
  const [database, storage, mail] = await Promise.all([
    pool.query("SELECT 1").then(
      () => true,
      () => false,
    ),
    storageReachable(),
    mailReachable(),
  ]);
  return json(200, { status: database && storage && mail ? "ok" : "unavailable" });
}

const apiRoutes: Route[] = [
  route("GET", "/api/health", health),
  route("GET", "/api/config", async () => json(200, clientConfig)),
  route("POST", "/api/signup", signup),
  route("POST", "/api/signin", signin),
  route("POST", "/api/signout", signout),
  route("GET", "/api/me", me),
  route("POST", "/api/verify", verify),
  route("POST", "/api/verify/resend", resendVerification),
  route("GET", "/api/pens", listMyPens),
  route("POST", "/api/pens", createPen),
  route("GET", "/api/pens/:id", getPen),
  route("PATCH", "/api/pens/:id", updatePen),
  route("DELETE", "/api/pens/:id", deletePen),
  route("POST", "/api/pens/:id/versions", saveVersion),
  route("GET", "/api/pens/:id/versions", listVersions),
  route("GET", "/api/pens/:id/versions/:n", getVersion),
  route("GET", "/api/pens/:id/diff", diffVersions),
  route("POST", "/api/pens/:id/restore", restoreVersion),
  route("POST", "/api/pens/:id/fork", forkPen),
  route("PUT", "/api/pens/:id/like", likePen),
  route("DELETE", "/api/pens/:id/like", unlikePen),
  route("GET", "/api/pens/:id/export", exportPen),
  route("GET", "/api/search", searchPens),
  route("GET", "/api/shelf", listShelf),
  route("GET", "/api/collections", listCollections),
  route("POST", "/api/collections", createCollection),
  route("GET", "/api/collections/:id", getCollection),
  route("PATCH", "/api/collections/:id", updateCollection),
  route("POST", "/api/collections/:id/pens", addCollectionPen),
  route("DELETE", "/api/collections/:id/pens/:pen", removeCollectionPen),
  route("DELETE", "/api/collections/:id", deleteCollection),
  route("POST", "/api/renders", createRender),
  route("GET", "/api/events", async (ctx) => openEventStream(ctx)),
  ...(config.grading ? [route("POST", "/api/grading/seed", gradingSeed), route("POST", "/api/grading/session", gradingSession)] : []),
];

const otherRoutes: Route[] = [
  route("GET", "/preview/:render", servePreview),
  route("GET", "/shelf/:library/:file", serveShelfFile),
];

const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return json(error.status, error.body);
  if (error instanceof StorageUnavailable) return errorReply(new ApiError("storage_unavailable"));
  if (error instanceof MailUnavailable) return errorReply(new ApiError("mail_unavailable"));
  console.error(error);
  return errorReply(new ApiError("storage_unavailable", { message: "Something went wrong, so nothing was changed." }));
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<Reply> {
  const url = new URL(req.url ?? "/", "http://ashlar.invalid");
  const method = req.method ?? "GET";
  const isApi = url.pathname.startsWith("/api/");
  const body = await readBody(req, config.bodyLimitBytes);
  if (body === "too_large") return errorReply(new ApiError("body_too_large"));
  const sessionToken = parseCookies(req.headers.cookie)[sessionCookieName] ?? null;
  if (isApi && writeMethods.has(method) && sessionToken !== null) {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== config.publicOrigin) return errorReply(new ApiError("forbidden", { message: "Cross-site request refused." }));
  }
  const user = sessionToken ? await userForSession(sessionToken) : null;
  let matched: ReturnType<typeof matchRoute>;
  try {
    matched = matchRoute(isApi ? apiRoutes : otherRoutes, method, url.pathname);
  } catch {
    matched = null;
  }
  if (matched) {
    const ctx: Context = { req, res, url, params: matched.params, rawBody: body, sessionToken, user };
    return matched.route.handler(ctx);
  }
  if (isApi) throw new ApiError("not_found");
  if (method === "GET" || method === "HEAD") {
    if (url.pathname.startsWith("/assets/")) {
      const asset = serveAsset(url.pathname.slice("/assets/".length));
      if (asset) return asset;
    }
    return servePage(url.pathname, user);
  }
  return servePage("/not-found", user);
}

async function main(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await seedStarterPens();
      break;
    } catch (error) {
      console.error("waiting for postgres:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0] ?? "/";
    handle(req, res)
      .catch(errorReply)
      .then((reply) => writeReply(res, reply, framingHeaders(pathname)))
      .catch((error: unknown) => {
        console.error("response failed", error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });
  server.keepAliveTimeout = 65000;
  server.listen(config.port, "0.0.0.0", () => console.log(`Ashlar listening on ${config.port}`));
  startMaintenance();
}

void main();
