import { loadBoard, visiblePinSql } from "./access.js";
import { changeRole as changeMemberRole, acceptInvite, inviteInfo, inviteToBoard, listMembers, removeMember, withdrawInvite } from "./members.js";
import { clearedCookie, confirmSignUp, endSession, requestSignUp, signIn } from "./accounts.js";
import { addSection, boardsFor, createBoard, deleteBoard, getBoard, moveItem, renameSection, updateBoard } from "./boards.js";
import { iso, now } from "./clock.js";
import { config } from "./config.js";
import { loadFeed } from "./feed.js";
import { moveBusinessClock, requireGradingKey, seedWorld } from "./grading.js";
import { one, pool } from "./db.js";
import { notFound, validation } from "./errors.js";
import { accepted, created, noContent, ok, RawReply, Reply, Router, type Ctx } from "./http.js";
import { contentTypeOf, extensionOf, type ImageFormat } from "./images.js";
import { createOperation, deleteOnePin, undoOperation } from "./operations.js";
import { editPin, getPin, savePin, suggestTags } from "./pins.js";
import { viewersOf } from "./presence.js";
import { search } from "./search.js";
import { addComment, deleteComment, followBoard, followUser, listComments, react } from "./social.js";
import { storageReachable, getObject } from "./storage.js";
import { createPin } from "./uploads.js";
import { pinsOf, profileOf } from "./users.js";
import type { PublicConfig } from "../shared/types.js";

const PREFIX = /^[\p{L}\p{N}_]{1,30}$/u;

export function buildRouter(): Router {
  const router = new Router();
  const route = (method: string, path: string, auth: boolean, handler: (ctx: Ctx) => Promise<Reply | RawReply>): void =>
    router.add(method, path, auth, handler);

  route("GET", "/api/health", false, async () => ok({ status: storageReachable() ? "ok" : "unavailable" }));

  route("GET", "/api/config", false, async () => {
    const body: PublicConfig = {
      now: iso(now()),
      time_zone: config.timeZone,
      undo_seconds: config.undoSeconds,
      invite_ttl_seconds: config.inviteTtlSeconds,
      limits: config.limits,
    };
    return ok(body);
  });

  route("POST", "/api/accounts", false, async (ctx) => {
    await requestSignUp(await ctx.json());
    return accepted({ status: "code_sent" });
  });
  route("POST", "/api/accounts/confirm", false, async (ctx) => {
    const session = await confirmSignUp(await ctx.json());
    return ok({ user: session.user }, { "Set-Cookie": session.cookie });
  });
  route("POST", "/api/session", false, async (ctx) => {
    const session = await signIn(await ctx.json());
    return ok({ user: { ...session.user, email: session.email } }, { "Set-Cookie": session.cookie });
  });
  route("DELETE", "/api/session", false, async (ctx) => {
    await endSession(ctx.req);
    return noContent({ "Set-Cookie": clearedCookie });
  });
  route("GET", "/api/me", true, async (ctx) => ok({ user: ctx.me() }));

  route("GET", "/api/feed", true, async (ctx) => ok({ pins: await loadFeed(pool, ctx.me().id) }));

  route("POST", "/api/pins", true, async (ctx) => created(await createPin(ctx)));
  route("GET", "/api/pins/:id", true, async (ctx) => ok(await getPin(pool, ctx.me().id, ctx.id("id"))));
  route("PATCH", "/api/pins/:id", true, async (ctx) => {
    const body = await ctx.json();
    const pin = await editPin(ctx.me(), ctx.id("id"), {
      version: body.get("version"),
      fields: {
        ...(body.has("title") ? { title: body.get("title") } : {}),
        ...(body.has("description") ? { description: body.get("description") } : {}),
        ...(body.has("alt") ? { alt: body.get("alt") } : {}),
        ...(body.has("source") ? { source: body.get("source") } : {}),
      },
    });
    return ok(pin);
  });
  route("DELETE", "/api/pins/:id", true, async (ctx) => ok(await deleteOnePin(ctx.me(), ctx.id("id"))));
  route("POST", "/api/pins/:id/saves", true, async (ctx) => {
    const body = await ctx.json();
    const pinId = ctx.id("id");
    await getPin(pool, ctx.me().id, pinId);
    const board = body.reference("board");
    const section = body.get("section") === null || body.get("section") === undefined ? null : body.reference("section");
    return created(await savePin(ctx.me(), pinId, board, section));
  });
  route("GET", "/api/pins/:id/comments", true, async (ctx) => ok(await listComments(ctx.me().id, ctx.id("id"))));
  route("POST", "/api/pins/:id/comments", true, async (ctx) => {
    const body = await ctx.json();
    return created(await addComment(ctx.me(), ctx.id("id"), body.get("parent"), body.get("text")));
  });
  route("DELETE", "/api/comments/:id", true, async (ctx) => {
    await deleteComment(ctx.me(), ctx.id("id"));
    return noContent();
  });
  route("PUT", "/api/pins/:id/reaction", true, async (ctx) => ok(await react(ctx.me(), ctx.id("id"), (await ctx.json()).get("type"))));

  route("POST", "/api/boards", true, async (ctx) => created(await createBoard(ctx.me().id, await ctx.json())));
  route("GET", "/api/boards/mine", true, async (ctx) =>
    ok({ boards: await boardsFor(pool, ctx.me().id, ctx.query.get("q") ?? "", ctx.query.get("all") === "1") }),
  );
  route("GET", "/api/boards/:id", true, async (ctx) => ok(await getBoard(pool, ctx.me().id, ctx.id("id"))));
  route("PATCH", "/api/boards/:id", true, async (ctx) => ok(await updateBoard(ctx.me(), ctx.id("id"), await ctx.json())));
  route("DELETE", "/api/boards/:id", true, async (ctx) => {
    await deleteBoard(ctx.me().id, ctx.id("id"));
    return noContent();
  });
  route("GET", "/api/boards/:id/viewers", true, async (ctx) => {
    const access = await loadBoard(pool, ctx.id("id"), ctx.me().id);
    return ok({ viewers: await viewersOf(pool, access.id) });
  });
  route("POST", "/api/boards/:id/sections", true, async (ctx) =>
    created(await addSection(ctx.me(), ctx.id("id"), (await ctx.json()).get("name"))),
  );
  route("PATCH", "/api/sections/:id", true, async (ctx) => ok(await renameSection(ctx.me(), ctx.id("id"), (await ctx.json()).get("name"))));
  route("POST", "/api/boards/:id/moves", true, async (ctx) => ok(await moveItem(ctx.me(), ctx.id("id"), await ctx.json())));

  route("GET", "/api/tags/suggest", true, async (ctx) => {
    const prefix = ctx.query.get("prefix") ?? "";
    if (!PREFIX.test(prefix)) throw validation("prefix");
    return ok({ tags: await suggestTags(ctx.me().id, prefix) });
  });

  route("POST", "/api/operations", true, async (ctx) => created(await createOperation(ctx.me(), await ctx.json())));
  route("POST", "/api/operations/:id/undo", true, async (ctx) => ok(await undoOperation(ctx.me(), ctx.id("id"))));

  route("GET", "/api/boards/:id/members", true, async (ctx) => ok(await listMembers(ctx.me().id, ctx.id("id"))));
  route("PATCH", "/api/boards/:id/members/:user", true, async (ctx) => {
    const body = await ctx.json();
    return ok(await changeMemberRole(ctx.me(), ctx.id("id"), ctx.id("user"), body.get("role")));
  });
  route("DELETE", "/api/boards/:id/members/:user", true, async (ctx) => {
    await removeMember(ctx.me(), ctx.id("id"), ctx.id("user"));
    return noContent();
  });
  route("POST", "/api/boards/:id/invites", true, async (ctx) => accepted(await inviteToBoard(ctx.me(), ctx.id("id"), await ctx.json())));
  route("DELETE", "/api/invites/:id", true, async (ctx) => {
    await withdrawInvite(ctx.me(), ctx.id("id"));
    return noContent();
  });
  route("GET", "/api/invites/:token", false, async (ctx) => ok(await inviteInfo(ctx.params["token"])));
  route("POST", "/api/invites/:token/accept", true, async (ctx) => ok(await acceptInvite(ctx.me(), ctx.params["token"])));

  route("GET", "/api/users/:handle", true, async (ctx) =>
    ok(await profileOf(ctx.me().id, ctx.params["handle"], ctx.query.get("sort") ?? "last_saved")),
  );
  route("GET", "/api/users/:handle/pins", true, async (ctx) => ok({ pins: await pinsOf(ctx.me().id, ctx.params["handle"]) }));
  route("PUT", "/api/follows/users/:id", true, async (ctx) => ok(await followUser(ctx.me(), ctx.id("id"), true)));
  route("DELETE", "/api/follows/users/:id", true, async (ctx) => ok(await followUser(ctx.me(), ctx.id("id"), false)));
  route("PUT", "/api/follows/boards/:id", true, async (ctx) => ok(await followBoard(ctx.me(), ctx.id("id"), true)));
  route("DELETE", "/api/follows/boards/:id", true, async (ctx) => ok(await followBoard(ctx.me(), ctx.id("id"), false)));

  route("GET", "/api/search", true, async (ctx) =>
    ok(await search(ctx.me().id, ctx.query.get("q") ?? "", ctx.query.get("tag") ?? "", ctx.query.get("board") ?? "")),
  );

  route("GET", "/media/:pin/:which", true, async (ctx) => {
    const me = ctx.me();
    const row = await one<{ image_id: string; format: ImageFormat; variants: number[] }>(
      pool,
      `SELECT i.id AS image_id, i.format, i.variants FROM pins p JOIN images i ON i.id = p.image_id LEFT JOIN boards b ON b.id = p.board_id
        WHERE p.id = $2 AND ${visiblePinSql("p", "b", "$1")}`,
      [me.id, ctx.id("pin")],
    );
    if (!row) throw notFound();
    const which = ctx.params["which"];
    const extension = extensionOf(row.format);
    let key: string;
    if (which === "original") key = `images/${row.image_id}/original.${extension}`;
    else if (/^[0-9]+$/.test(which) && row.variants.includes(Number(which))) key = `images/${row.image_id}/w${which}.${extension}`;
    else throw notFound();
    return new RawReply(200, contentTypeOf(row.format), await getObject(key), { "Cache-Control": "private, max-age=300" });
  });

  route("POST", "/api/grading/seed", false, async (ctx) => {
    requireGradingKey(ctx.req);
    return created({ ids: await seedWorld((await ctx.json()).record()) });
  });
  route("POST", "/api/grading/clock", false, async (ctx) => {
    requireGradingKey(ctx.req);
    return ok({ now: await moveBusinessClock(await ctx.json()) });
  });

  return router;
}
