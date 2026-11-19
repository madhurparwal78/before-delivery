import type { ClientConfig, User } from "../shared/types.js";
import {
  resendVerification,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sessionFor,
  signIn,
  signOut,
  signUp,
  verify,
} from "./accounts.js";
import { requireOwner, requireVerified } from "./access.js";
import { databaseAnswers } from "./db.js";
import {
  addToCollection,
  changeCollection,
  createCollection,
  deleteCollection,
  listCollections,
  readCollection,
  removeFromCollection,
} from "./collections.js";
import { config, LIVE_POLL_MS } from "./config.js";
import { STREAMED, type Ctx, type Reply } from "./context.js";
import { ApiError, notFound, validation } from "./errors.js";
import { publishAccount, publishCounts, publishHead, subscribe } from "./events.js";
import { forkPen } from "./forks.js";
import { seedGrading } from "./grading.js";
import { open, signedIn, type Route } from "./http.js";
import { mailAnswers } from "./mail.js";
import { drainOutbox } from "./outbox.js";
import {
  checkTitle,
  deletePen,
  fullPen,
  headVersion,
  insertPen,
  listOwnPens,
  patchPen,
  searchPens,
  setLike,
  visiblePen,
} from "./pens.js";
import { createRender, previewDocument, previewPolicy } from "./renders.js";
import { shelfFile, shelfLibraries } from "./shelf.js";
import { shellReply } from "./static.js";
import { storageAnswers } from "./storage.js";
import { diffVersions, integerOrNull, listVersions, readVersion, readVersionFor, requireVersion, saveVersion, versionNumber } from "./versions.js";
import { transaction } from "./db.js";
import { buildZip } from "./zip.js";

const STORAGE_DOWN = {
  save: "Storage is unreachable, so this version was not saved. Your edits are still here.",
  fork: "Storage is unreachable, so the fork was not made.",
  export: "Storage is unreachable, so the export was not made. Your pen is unchanged.",
  remove: "Storage is unreachable, so the pen was not deleted.",
};

const NO_BODY: Reply = { status: 204 };

function cookie(value: string, maxAge: number): Record<string, string> {
  return { "Set-Cookie": `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` };
}

function peek(ctx: Ctx, field: string): unknown {
  const body = ctx.parsedBody();
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>)[field] : undefined;
}

function counted<T>(penId: string, reply: T): Promise<T> {
  return publishCounts(penId).then(() => reply);
}

function pageReply(embeddable = false) {
  return async (ctx: Ctx): Promise<Reply> => {
    try {
      await visiblePen(ctx.params["id"] as string, ctx.viewer);
    } catch (error) {
      if (error instanceof ApiError) return shellReply(404, embeddable);
      throw error;
    }
    return shellReply(200, embeddable);
  };
}

const infrastructure: Route[] = [
  open("GET", "/api/health", async () => {
    const [database, storage, mail] = await Promise.all([databaseAnswers(), storageAnswers(), mailAnswers()]);
    return { status: 200, body: { status: database && storage && mail ? "ok" : "unavailable" } };
  }),
  open("GET", "/api/config", async () => {
    const body: ClientConfig = {
      preview_delay_ms: config.previewDelayMs,
      draft_interval_ms: config.draftIntervalMs,
      search_debounce_ms: config.searchDebounceMs,
      loop_limit: config.loopLimit,
      pane_limit_bytes: config.paneLimitBytes,
      max_tags: config.maxTags,
      live_poll_ms: LIVE_POLL_MS,
    };
    return { status: 200, body };
  }),
  open("GET", "/api/shelf", async () => ({ status: 200, body: { libraries: shelfLibraries() } })),
  open("GET", "/api/events", async (ctx) => {
    const ids = (ctx.query.get("pens") ?? "").split(",").filter((id) => id !== "");
    await subscribe(ctx.res, ctx.viewer, ids);
    return STREAMED;
  }),
  open("GET", "/shelf/:id/:file", async (ctx) => {
    const content = shelfFile(ctx.params["id"] as string, ctx.params["file"] as string);
    if (content === null) return { status: 404, raw: "Not found", type: "text/plain; charset=utf-8" };
    return {
      status: 200,
      raw: content,
      type: "text/javascript; charset=utf-8",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    };
  }),
  open("GET", "/preview/:id", async (ctx) => {
    const html = await previewDocument(ctx.params["id"] as string);
    if (html === null) return { status: 404, raw: "Not found", type: "text/plain; charset=utf-8" };
    const host = ctx.header("host") ?? new URL(config.publicUrl).host;
    return {
      status: 200,
      raw: html,
      type: "text/html; charset=utf-8",
      headers: { "Content-Security-Policy": previewPolicy(`${new URL(config.publicUrl).protocol}//${host}`), "Cache-Control": "no-store" },
    };
  }),
  open(
    "POST",
    "/api/renders",
    async (ctx) => {
      const body = ctx.body();
      const viewer = typeof body["pen_id"] === "string" ? await ctx.resolveViewer() : null;
      return { status: 201, body: await createRender(body, viewer) };
    },
    { lazyViewer: true },
  ),
];

const accounts: Route[] = [
  open("POST", "/api/signup", async (ctx) => {
    const body = ctx.body();
    const result = await signUp({ handle: body["handle"], email: body["email"], password: body["password"] });
    return {
      status: 201,
      body: { user: result.user, verification: result.verification },
      headers: cookie(result.session, SESSION_MAX_AGE),
    };
  }),
  open("POST", "/api/signin", async (ctx) => {
    const body = ctx.body();
    const result = await signIn(body["email"], body["password"]);
    return { status: 200, body: { user: result.user }, headers: cookie(result.session, SESSION_MAX_AGE) };
  }),
  signedIn("POST", "/api/signout", async (ctx) => {
    await signOut(ctx.sessionToken);
    return { ...NO_BODY, headers: cookie("", 0) };
  }),
  signedIn("GET", "/api/me", async (ctx) => ({
    status: 200,
    body: ctx.verification === null ? { user: ctx.viewer } : { user: ctx.viewer, verification: ctx.verification },
  })),
  open("POST", "/api/verify", async (ctx) => {
    const user = await verify(ctx.body()["token"]);
    publishAccount(user.id);
    return { status: 200, body: { user } };
  }),
  signedIn("POST", "/api/verify/resend", async (ctx) => {
    await resendVerification(ctx.viewer);
    return { status: 202, body: { verification: "sent" } };
  }),
];

async function ownedPen(ctx: Ctx & { viewer: User }) {
  const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
  requireOwner(pen, ctx.viewer);
  return pen;
}

const pens: Route[] = [
  signedIn("GET", "/api/pens", async (ctx) => ({ status: 200, body: { pens: await listOwnPens(ctx.viewer.id) } })),
  signedIn("POST", "/api/pens", async (ctx) => {
    const title = ctx.body()["title"];
    const id = await transaction((tx) =>
      insertPen(tx, { ownerId: ctx.viewer.id, title: title === undefined ? "Untitled pen" : checkTitle(title), visibility: "private" }),
    );
    return { status: 201, body: await fullPen(await visiblePen(id, ctx.viewer), ctx.viewer) };
  }),
  open("GET", "/api/pens/:id", async (ctx) => {
    const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
    return { status: 200, body: await fullPen(pen, ctx.viewer) };
  }),
  signedIn("PATCH", "/api/pens/:id", async (ctx) => {
    const pen = await ownedPen(ctx);
    if (peek(ctx, "visibility") !== undefined) requireVerified(ctx.viewer);
    const body = ctx.body();
    await patchPen(pen, { title: body["title"], visibility: body["visibility"], tags: body["tags"] });
    return { status: 200, body: await fullPen(await visiblePen(pen.id, ctx.viewer), ctx.viewer) };
  }),
  signedIn(
    "DELETE",
    "/api/pens/:id",
    async (ctx) => {
      const pen = await ownedPen(ctx);
      await deletePen(pen);
      if (pen.forkOfPen !== null) await publishCounts(pen.forkOfPen);
      return NO_BODY;
    },
    { outage: () => STORAGE_DOWN.remove },
  ),
  signedIn(
    "POST",
    "/api/pens/:id/versions",
    async (ctx) => {
      const pen = await ownedPen(ctx);
      requireVerified(ctx.viewer);
      const reply = await ctx.effect(pen.id, async (tx) => {
        const version = await saveVersion(tx, {
          penId: pen.id,
          base: peek(ctx, "base_version"),
          content: async () => {
            const body = ctx.body();
            return { files: body["files"], libraries: body["libraries"] };
          },
        });
        return { status: 201, body: version };
      });
      await publishHead(pen.id);
      return reply;
    },
    { idempotent: true, outage: () => STORAGE_DOWN.save },
  ),
  open("GET", "/api/pens/:id/versions", async (ctx) => {
    const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
    return { status: 200, body: { versions: await listVersions(pen.id) } };
  }),
  open("GET", "/api/pens/:id/versions/:number", async (ctx) => {
    const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
    const number = versionNumber(ctx.params["number"]);
    if (number === null) throw notFound();
    return { status: 200, body: await readVersion(pen.id, number) };
  }),
  open("GET", "/api/pens/:id/diff", async (ctx) => {
    const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
    const a = versionNumber(ctx.query.get("a"));
    const b = versionNumber(ctx.query.get("b"));
    if (a === null || b === null) throw validation({ a: "Send a and b as version numbers." });
    return { status: 200, body: await diffVersions(pen.id, a, b) };
  }),
  signedIn(
    "POST",
    "/api/pens/:id/restore",
    async (ctx) => {
      const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
      const wanted = integerOrNull(peek(ctx, "version"));
      if (wanted !== null) await requireVersion(pen.id, wanted);
      requireOwner(pen, ctx.viewer);
      requireVerified(ctx.viewer);
      const reply = await ctx.effect(pen.id, async (tx) => {
        const version = await saveVersion(tx, {
          penId: pen.id,
          base: peek(ctx, "base_version"),
          ...(wanted === null ? {} : { restoredFrom: wanted }),
          content: () => readVersionFor(pen.id, wanted),
        });
        return { status: 201, body: version };
      });
      await publishHead(pen.id);
      return reply;
    },
    { idempotent: true, outage: (ctx) => `Storage is unreachable, so version ${String(peek(ctx, "version"))} was not restored.` },
  ),
  signedIn(
    "POST",
    "/api/pens/:id/fork",
    async (ctx) => {
      const source = await visiblePen(ctx.params["id"] as string, ctx.viewer);
      requireVerified(ctx.viewer);
      if (source.head === 0) throw new ApiError("nothing_to_fork", "This pen has no saved version to fork yet.");
      const reply = await ctx.effect(source.id, (tx) => forkPen(tx, source, ctx.viewer));
      await publishCounts(source.id);
      void drainOutbox();
      return reply;
    },
    { idempotent: true, outage: () => STORAGE_DOWN.fork },
  ),
  signedIn("PUT", "/api/pens/:id/like", async (ctx) => {
    const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
    if (pen.visibility === "private") throw new ApiError("forbidden", "Private pens cannot be liked.");
    requireVerified(ctx.viewer);
    const likes = await setLike(pen, ctx.viewer, true);
    return counted(pen.id, { status: 200, body: { liked: true, likes } });
  }),
  signedIn("DELETE", "/api/pens/:id/like", async (ctx) => {
    const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
    requireVerified(ctx.viewer);
    const likes = await setLike(pen, ctx.viewer, false);
    return counted(pen.id, { status: 200, body: { liked: false, likes } });
  }),
  open(
    "GET",
    "/api/pens/:id/export",
    async (ctx) => {
      const pen = await visiblePen(ctx.params["id"] as string, ctx.viewer);
      const version = await headVersion(pen);
      if (version === null) throw new ApiError("nothing_to_export", "Save a version before exporting.");
      const archive = buildZip([
        { name: "index.html", data: Buffer.from(version.files.html, "utf8") },
        { name: "style.css", data: Buffer.from(version.files.css, "utf8") },
        { name: "script.js", data: Buffer.from(version.files.js, "utf8") },
      ]);
      return {
        status: 200,
        raw: archive,
        type: "application/zip",
        headers: { "Content-Disposition": `attachment; filename="${pen.id}-v${version.number}.zip"` },
      };
    },
    { outage: () => STORAGE_DOWN.export },
  ),
  open("GET", "/api/search", async (ctx) => ({ status: 200, body: await searchPens(ctx.query.get("q") ?? "") })),
];

const collections: Route[] = [
  signedIn("GET", "/api/collections", async (ctx) => ({ status: 200, body: { collections: await listCollections(ctx.viewer) } })),
  signedIn("POST", "/api/collections", async (ctx) => ({ status: 201, body: await createCollection(ctx.viewer, ctx.body()["title"]) })),
  signedIn("GET", "/api/collections/:id", async (ctx) => ({
    status: 200,
    body: await readCollection(ctx.params["id"] as string, ctx.viewer),
  })),
  signedIn("PATCH", "/api/collections/:id", async (ctx) => {
    const body = ctx.body();
    return { status: 200, body: await changeCollection(ctx.params["id"] as string, ctx.viewer, { title: body["title"], order: body["order"] }) };
  }),
  signedIn("POST", "/api/collections/:id/pens", async (ctx) => ({
    status: 201,
    body: await addToCollection(ctx.params["id"] as string, ctx.viewer, ctx.body()["pen_id"]),
  })),
  signedIn("DELETE", "/api/collections/:id/pens/:pen", async (ctx) => {
    await removeFromCollection(ctx.params["id"] as string, ctx.viewer, ctx.params["pen"] as string);
    return NO_BODY;
  }),
  signedIn("DELETE", "/api/collections/:id", async (ctx) => {
    await deleteCollection(ctx.params["id"] as string, ctx.viewer);
    return NO_BODY;
  }),
];

const grading: Route[] = [
  open("POST", "/api/grading/seed", async (ctx) => seedGrading(ctx.body()), { outage: () => STORAGE_DOWN.save }),
  open("POST", "/api/grading/session", async (ctx) => {
    const handle = ctx.body()["handle"];
    const found = typeof handle === "string" ? await sessionFor(handle) : null;
    if (found === null) throw notFound();
    return { status: 200, body: { user: found.user }, headers: cookie(found.session, SESSION_MAX_AGE) };
  }),
];

const pages: Route[] = [
  ...["/", "/signup", "/signin", "/verify", "/dashboard", "/explore", "/collections", "/shelf"].map((path) =>
    open("GET", path, async () => shellReply(200, false)),
  ),
  open("GET", "/collections/:id", async () => shellReply(200, false)),
  open("GET", "/pen/:id", pageReply()),
  open("GET", "/pen/:id/history", pageReply()),
  open("GET", "/embed/:id", pageReply(true)),
];

export function allRoutes(): Route[] {
  return [...infrastructure, ...accounts, ...pens, ...collections, ...(config.grading ? grading : []), ...pages];
}
