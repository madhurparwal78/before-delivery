import { findObject, type SceneDocument } from "../shared/doc";
import { CAN_EDIT, requireRole, sceneAccess } from "./access";
import { pool } from "./db";
import { ApiError, notFound, validation } from "./errors";
import { STREAMED, route, type Ctx, type Reply } from "./http";
import { attach, lockJson, notifyScene, presenceBody, writeEvent, type Connection } from "./live";
import { currentDocument } from "./scenes";
import { getStatus } from "./services/status";
import { valkey } from "./services/valkey";

const TAB = /^[A-Za-z0-9-]{8,64}$/;
const record = (body: unknown): Record<string, unknown> => (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {});

function tabOf(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw validation({ tab: "Give a tab id of 8 to 64 letters, digits and hyphens." });
    return null;
  }
  if (typeof value !== "string" || !TAB.test(value)) throw validation({ tab: "Give a tab id of 8 to 64 letters, digits and hyphens." });
  return value;
}

async function takeLock(ctx: Ctx): Promise<Reply> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  requireRole(role, CAN_EDIT);
  const current = await currentDocument(pool, scene.id);
  if (!findObject(current.doc as SceneDocument, ctx.params.objectId)) throw notFound();
  const tab = tabOf(record(ctx.body).tab, false);
  const result = await valkey.grant(scene.id, ctx.params.objectId, ctx.user, tab);
  notifyScene(scene.id);
  if (!result.granted) {
    throw new ApiError(409, "lock_held", `${result.holder.displayName} is editing that object.`, undefined, {
      holder: { userId: result.holder.userId, displayName: result.holder.displayName },
      expiresAt: result.holder.expiresAt,
    });
  }
  return { status: 200, json: { lock: lockJson(result.lock) } };
}

async function dropLock(ctx: Ctx): Promise<Reply> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  requireRole(role, CAN_EDIT);
  const result = await valkey.release(scene.id, ctx.params.objectId, ctx.user.id);
  if (result.result === "held") {
    throw new ApiError(409, "lock_held", `${result.holder.displayName} is editing that object.`, undefined, {
      holder: { userId: result.holder.userId, displayName: result.holder.displayName },
      expiresAt: result.holder.expiresAt,
    });
  }
  notifyScene(scene.id);
  return { status: 204, bytes: new Uint8Array() };
}

async function putPresence(ctx: Ctx): Promise<Reply> {
  const { scene } = await sceneAccess(ctx.params.sid, ctx.user);
  const body = record(ctx.body);
  const tab = tabOf(body.tab, true) as string;
  const cursor = body.cursor;
  const validCursor = cursor === null || (Array.isArray(cursor) && cursor.length === 3 && cursor.every((n) => typeof n === "number" && Number.isFinite(n)));
  const selected = body.selected;
  if (!validCursor || !(selected === null || typeof selected === "string")) throw validation({ cursor: "Give cursor as [x,y,z] or null, and selected as an object id or null." });
  await valkey.putPresence(scene.id, ctx.user.id, tab, { displayName: ctx.user.displayName, cursor: cursor as [number, number, number] | null, selected: selected as string | null });
  notifyScene(scene.id);
  return { status: 204, bytes: new Uint8Array() };
}

async function deletePresence(ctx: Ctx): Promise<Reply> {
  const { scene } = await sceneAccess(ctx.params.sid, ctx.user);
  const tab = tabOf(ctx.query.get("tab"), true) as string;
  await valkey.deletePresence(scene.id, ctx.user.id, tab);
  await valkey.releaseWhere(scene.id, (lock) => lock.userId === ctx.user.id && lock.tab === tab);
  notifyScene(scene.id);
  return { status: 204, bytes: new Uint8Array() };
}

async function getPresence(ctx: Ctx): Promise<Reply> {
  const { scene } = await sceneAccess(ctx.params.sid, ctx.user);
  return { status: 200, json: await presenceBody(scene.id, scene.workspace_id) };
}

async function openLive(ctx: Ctx): Promise<typeof STREAMED> {
  const { scene, role } = await sceneAccess(ctx.params.sid, ctx.user);
  const tab = tabOf(ctx.query.get("tab"), true) as string;
  ctx.res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", "x-server-time": new Date().toISOString() });
  ctx.res.write(": open\n\n");
  const connection: Connection = { res: ctx.res, userId: ctx.user.id, displayName: ctx.user.displayName, tab, workspaceId: scene.workspace_id, role, lastWrite: Date.now() };
  writeEvent(connection, "status", getStatus());
  try {
    await valkey.putPresence(scene.id, ctx.user.id, tab, { displayName: ctx.user.displayName, cursor: null, selected: null });
  } catch {
    /* presence is unavailable while the lock service is down */
  }
  const detach = attach(scene.id, connection);
  ctx.req.on("close", () => void detach());
  return STREAMED;
}

export function registerCollabRoutes(): void {
  route("POST", "/api/scenes/:sid/locks/:objectId", takeLock);
  route("DELETE", "/api/scenes/:sid/locks/:objectId", dropLock);
  route("PUT", "/api/scenes/:sid/presence", putPresence);
  route("DELETE", "/api/scenes/:sid/presence", deletePresence);
  route("GET", "/api/scenes/:sid/presence", getPresence);
  route("GET", "/api/scenes/:sid/live", openLive);
}

