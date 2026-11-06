import { createServer } from "node:http";
import { ApiError, bodyTooLarge, imageTooLarge, invalid, notFound, unexpected } from "../shared/errors.js";
import { isSafeRedirect } from "../shared/redirect.js";
import { memberRole, requireEditor, roleIn, workspaceOf } from "./access.js";
import { clearedCookie, createUser, currentUser, endSession, requireUser, sessionCookie, signIn, startSession } from "./auth.js";
import { listThreads, createThread, reply, setStatus } from "./comments.js";
import { config } from "./config.js";
import { boot, pool, transaction } from "./db.js";
import { seed, storageOutage } from "./grading.js";
import { baseHeaders, changesState, fromOtherOrigin, JSON_LIMIT, parseJson, readBody, redirect, Router, sendError, sendJson, sendNoContent, UPLOAD_LIMIT, type Ctx } from "./http.js";
import { confirmedImages, confirmedImageType, filePart, imageKey, upload } from "./images.js";
import { attachLive } from "./live.js";
import { acceptInvite, changeRole, invite, listMembers, removeMember, revokeInvite } from "./members.js";
import { changeLog, submit } from "./ops.js";
import { getStatus, publish, servePublic, trackPublish, unpublish } from "./publish.js";
import { getObject, StorageDown, storageReachable, storageUnavailable } from "./storage.js";
import { getVersion, listVersions, restoreVersion, saveVersion } from "./versions.js";
import { sendEditorNotFound, sendInviteInvalid, sendShell, serveStatic } from "./web.js";
import { createWorkspace, loadDoc, workspacesOf } from "./workspaces.js";

type Body = Record<string, unknown>;
const raw = new WeakMap<Ctx, Buffer>();

/** The JSON body, parsed only when a handler reaches it (after sign-in and access checks). */
function parsed(ctx: Ctx): unknown {
  return parseJson(raw.get(ctx) ?? Buffer.alloc(0));
}

function json(ctx: Ctx): Body {
  const value = parsed(ctx);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Body) : {};
}

async function user(ctx: Ctx) {
  return requireUser(await currentUser(ctx.req));
}

const api = new Router()
  .on("GET", "/api/health", async ({ res }) => sendJson(res, 200, { status: "ok" }))
  .on("POST", "/api/auth/signup", async (ctx) => {
    const created = await createUser(pool, json(ctx));
    sendJson(ctx.res, 201, { user: created }, { "Set-Cookie": sessionCookie(await startSession(created.id)) });
  })
  .on("POST", "/api/auth/signin", async (ctx) => {
    const signed = await signIn(json(ctx));
    sendJson(ctx.res, 200, { user: signed }, { "Set-Cookie": sessionCookie(await startSession(signed.id)) });
  })
  .on("POST", "/api/auth/signout", async (ctx) => {
    await endSession(ctx.req);
    sendNoContent(ctx.res, { "Set-Cookie": clearedCookie });
  })
  .on("GET", "/api/me", async (ctx) => {
    const me = await user(ctx);
    sendJson(ctx.res, 200, { user: me, workspaces: await workspacesOf(me.id) });
  })
  .on("POST", "/api/workspaces", async (ctx) => {
    const me = await user(ctx);
    const doc = await transaction((tx) => createWorkspace(tx, json(ctx).name, me.id));
    sendJson(ctx.res, 201, { id: doc.id, name: doc.name, slug: doc.slug, pages: doc.pages.map((p) => ({ id: p.id, name: p.name, slug: p.slug })) });
  })
  .on("GET", "/api/workspaces/:wid/document", async (ctx) => {
    await memberRole(await user(ctx), ctx.params.wid);
    sendJson(ctx.res, 200, await loadDoc(ctx.params.wid));
  })
  .on("POST", "/api/workspaces/:wid/operations", async (ctx) => {
    const me = await user(ctx);
    await memberRole(me, ctx.params.wid);
    sendJson(ctx.res, 200, await submit(me, ctx.params.wid, parsed(ctx)));
  })
  .on("GET", "/api/workspaces/:wid/operations", async (ctx) => {
    await memberRole(await user(ctx), ctx.params.wid);
    const since = Number(ctx.url.searchParams.get("since") ?? 0);
    if (!Number.isInteger(since) || since < 0) throw invalid({ since: "since is a seq." });
    sendJson(ctx.res, 200, { operations: await changeLog(ctx.params.wid, since) });
  })
  .on("POST", "/api/workspaces/:wid/images", async (ctx) => {
    requireEditor(await memberRole(await user(ctx), ctx.params.wid));
    const part = filePart(ctx.req.headers["content-type"], raw.get(ctx) ?? Buffer.alloc(0));
    sendJson(ctx.res, 201, await upload(ctx.params.wid, part));
  })
  .on("GET", "/api/workspaces/:wid/images", async (ctx) => {
    await memberRole(await user(ctx), ctx.params.wid);
    sendJson(ctx.res, 200, { images: await confirmedImages(ctx.params.wid) });
  })
  .on("GET", "/api/images/:id", async (ctx) => {
    const me = await user(ctx);
    const workspaceId = await workspaceOf("image", ctx.params.id);
    await memberRole(me, workspaceId);
    const mime = await confirmedImageType(ctx.params.id);
    let bytes: Buffer | null;
    try {
      bytes = await getObject(workspaceId, imageKey(workspaceId, ctx.params.id));
    } catch (error) {
      if (error instanceof StorageDown) throw storageUnavailable();
      throw error;
    }
    if (!bytes) throw notFound();
    ctx.res.writeHead(200, { "Content-Type": mime, "Content-Length": bytes.length, "Cache-Control": "private, max-age=3600" });
    ctx.res.end(bytes);
  })
  .on("GET", "/api/workspaces/:wid/storage", async (ctx) => {
    await memberRole(await user(ctx), ctx.params.wid);
    sendJson(ctx.res, 200, { status: (await storageReachable(ctx.params.wid)) ? "ok" : "unavailable" });
  })
  .on("GET", "/api/pages/:pid/publish", async (ctx) => sendJson(ctx.res, 200, await getStatus(await user(ctx), ctx.params.pid)))
  .on("POST", "/api/pages/:pid/publish", async (ctx) =>
    sendJson(ctx.res, 201, await trackPublish(ctx.params.pid, async () => publish(await user(ctx), ctx.params.pid, ctx.req.headers["idempotency-key"]))),
  )
  .on("POST", "/api/pages/:pid/unpublish", async (ctx) => sendJson(ctx.res, 200, await unpublish(await user(ctx), ctx.params.pid)))
  .on("GET", "/api/workspaces/:wid/versions", async (ctx) => sendJson(ctx.res, 200, { versions: await listVersions(await user(ctx), ctx.params.wid) }))
  .on("POST", "/api/workspaces/:wid/versions", async (ctx) => sendJson(ctx.res, 201, await saveVersion(await user(ctx), ctx.params.wid, json(ctx))))
  .on("GET", "/api/versions/:vid", async (ctx) => sendJson(ctx.res, 200, await getVersion(await user(ctx), ctx.params.vid)))
  .on("POST", "/api/versions/:vid/restore", async (ctx) => sendJson(ctx.res, 201, await restoreVersion(await user(ctx), ctx.params.vid)))
  .on("GET", "/api/workspaces/:wid/comments", async (ctx) =>
    sendJson(ctx.res, 200, { threads: await listThreads(await user(ctx), ctx.params.wid, ctx.url.searchParams.get("pageId")) }),
  )
  .on("POST", "/api/workspaces/:wid/comments", async (ctx) => sendJson(ctx.res, 201, await createThread(await user(ctx), ctx.params.wid, json(ctx))))
  .on("POST", "/api/comments/:id/replies", async (ctx) => sendJson(ctx.res, 201, await reply(await user(ctx), ctx.params.id, json(ctx))))
  .on("POST", "/api/comments/:id/resolve", async (ctx) => sendJson(ctx.res, 200, await setStatus(await user(ctx), ctx.params.id, "resolved")))
  .on("POST", "/api/comments/:id/reopen", async (ctx) => sendJson(ctx.res, 200, await setStatus(await user(ctx), ctx.params.id, "open")))
  .on("GET", "/api/workspaces/:wid/members", async (ctx) => sendJson(ctx.res, 200, { members: await listMembers(await user(ctx), ctx.params.wid) }))
  .on("POST", "/api/workspaces/:wid/invites", async (ctx) => sendJson(ctx.res, 201, await invite(await user(ctx), ctx.params.wid, json(ctx))))
  .on("DELETE", "/api/invites/:id", async (ctx) => {
    await revokeInvite(await user(ctx), ctx.params.id);
    sendNoContent(ctx.res);
  })
  .on("PATCH", "/api/workspaces/:wid/members/:uid", async (ctx) => sendJson(ctx.res, 200, await changeRole(await user(ctx), ctx.params.wid, ctx.params.uid, json(ctx))))
  .on("DELETE", "/api/workspaces/:wid/members/:uid", async (ctx) => {
    await removeMember(await user(ctx), ctx.params.wid, ctx.params.uid);
    sendNoContent(ctx.res);
  })
  .on("POST", "/api/invites/:token/accept", async (ctx) => sendJson(ctx.res, 200, await acceptInvite(await user(ctx), ctx.params.token)))
  .on("POST", "/api/grading/seed", async (ctx) => {
    if (!config.gradingRoutes) throw notFound();
    sendJson(ctx.res, 201, await seed(json(ctx)));
  })
  .on("POST", "/api/grading/storage-outage", async (ctx) => {
    if (!config.gradingRoutes) throw notFound();
    storageOutage(json(ctx));
    sendJson(ctx.res, 200, { status: "ok" });
  });

const pages = new Router()
  .on("GET", "/signup", async ({ res }) => sendShell(res))
  .on("GET", "/signin", async ({ res }) => sendShell(res))
  .on("GET", "/", async (ctx) => ((await currentUser(ctx.req)) ? sendShell(ctx.res) : redirect(ctx.res, "/signin")))
  .on("GET", "/w/:wid/edit", async (ctx) => {
    const me = await currentUser(ctx.req);
    if (!me) return redirect(ctx.res, `/signin?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
    if (!(await roleIn(ctx.params.wid, me.id))) return sendEditorNotFound(ctx.res);
    sendShell(ctx.res);
  })
  .on("GET", "/invites/:token", async (ctx) => {
    const me = await currentUser(ctx.req);
    if (!me) return redirect(ctx.res, `/signin?next=${encodeURIComponent(ctx.url.pathname)}`);
    try {
      const accepted = await acceptInvite(me, ctx.params.token);
      redirect(ctx.res, isSafeRedirect(accepted.redirect) ? accepted.redirect : "/");
    } catch (error) {
      if (error instanceof ApiError && error.code === "invite_invalid") return sendInviteInvalid(ctx.res);
      throw error;
    }
  })
  .on("GET", "/p/:ws/:page", async (ctx) => servePublic(ctx, ctx.params.ws, ctx.params.page))
  .on("GET", "/p/:ws/:page/assets/:image", async (ctx) => servePublic(ctx, ctx.params.ws, ctx.params.page, ctx.params.image));

const server = createServer(async (req, res) => {
  baseHeaders(res);
  const url = new URL(req.url ?? "/", "http://local");
  const method = req.method ?? "GET";
  const ctx: Ctx = { req, res, url, method, params: {} };
  const isApi = url.pathname.startsWith("/api/");
  try {
    if (changesState(method)) {
      const upload = method === "POST" && /^\/api\/workspaces\/[^/]+\/images$/.test(url.pathname);
      const body = await readBody(req, upload ? UPLOAD_LIMIT : JSON_LIMIT, upload ? imageTooLarge : bodyTooLarge);
      if (fromOtherOrigin(req)) throw new ApiError(403, "cross_origin", "Requests from another origin are refused.");
      raw.set(ctx, body);
    }
    if (isApi) {
      const found = api.match(method, url.pathname);
      if (!found || found === "method") throw notFound();
      ctx.params = found.params;
      return await found.handler(ctx);
    }
    if ((method === "GET" || method === "HEAD") && serveStatic(res, url.pathname, method === "HEAD")) return;
    const found = pages.match(method, url.pathname);
    if (!found || found === "method") return sendEditorNotFound(res);
    ctx.params = found.params;
    await found.handler(ctx);
  } catch (error) {
    if (res.headersSent) return void res.end();
    if (error instanceof ApiError) return sendError(res, error);
    console.error(error);
    sendError(res, unexpected());
  }
});

await boot();
attachLive(server);
server.listen(config.port, "0.0.0.0", () => console.log(`Plinth listening on ${config.port}`));
