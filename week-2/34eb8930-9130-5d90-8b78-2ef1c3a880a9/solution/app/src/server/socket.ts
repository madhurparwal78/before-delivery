import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { pool, rows } from "./db.js";
import { ApiError, forbidden, invalid, notFound, toApiError } from "./errors.js";
import { type Client, register, send, unregister } from "./hub.js";
import { personOn, requireAccess, rolesOn, storedMode } from "./people.js";
import { updateShare } from "./proposals.js";
import { applyOps, applyReplaceAll, broadcast, decideAll, decideOne, enter, getRoom, iso, leave, openRoom, othersPresent, roomIfLoaded, serial, touch } from "./rooms.js";
import { OpError, planReplaceAll, wellFormed } from "../shared/model.js";
import { MAX_BODY_BYTES, MODES, canDecide, canWrite, modesFor, type Decision, type EditMode, type Mode, type Op } from "../shared/types.js";

type Frame = Record<string, unknown>;

const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * MAX_BODY_BYTES });

/** Upgrade (API, Socket): origin first, then a valid session cookie. */
export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, sameOrigin: boolean, personId: string | null): void {
  const refuse = (status: string): void => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
  if (!sameOrigin) return refuse("403 Forbidden");
  if (!personId) return refuse("401 Unauthorized");
  wss.handleUpgrade(req, socket, head, (ws) => connect(ws, personId));
}

function connect(ws: WebSocket, personId: string): void {
  const client: Client = { ws, personId, documentId: null, lastFrameAt: Date.now(), ended: false };
  register(client);
  let chain = Promise.resolve();
  ws.on("message", (data) => { chain = chain.then(() => receive(client, data)).catch(() => undefined); });
  ws.on("error", () => undefined);
  ws.on("close", () => {
    unregister(client);
    const loaded = client.documentId ? roomIfLoaded(client.documentId) : undefined;
    if (loaded) void loaded.then((room) => leave(room, client)).catch(() => undefined);
  });
}

function refFrom(text: string): string | null {
  try {
    const f = JSON.parse(text) as Frame;
    return typeof f.ref === "string" ? f.ref : null;
  } catch {
    return /"ref"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? null;
  }
}

function fail(client: Client, ref: string | null, e: unknown): void {
  send(client, toApiError(e).frame(ref));
}

async function receive(client: Client, data: RawData): Promise<void> {
  client.lastFrameAt = Date.now();
  const text = data.toString();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return fail(client, refFrom(text), new OpError("too_large"));
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(client, null, invalid());
  const f = parsed as Frame;
  const ref = typeof f.ref === "string" ? f.ref : null;
  try {
    if (ref === null) throw invalid();
    if (f.type === "join") return await join(client, ref, f);
    if (!client.documentId) throw new ApiError(409, "not_joined");
    await dispatch(client, client.documentId, ref, f);
  } catch (e) {
    fail(client, ref, e);
  }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isEditMode = (v: unknown): v is EditMode => v === "editing" || v === "suggesting";
const isDecision = (v: unknown): v is Decision => v === "accept" || v === "reject";

async function join(client: Client, ref: string, f: Frame): Promise<void> {
  if (client.documentId) throw new ApiError(409, "conflict");
  if (typeof f.documentId !== "string") throw invalid();
  const proposalId = f.documentId;
  const access = await requireAccess(client.personId, proposalId);
  if (!isInt(f.revision)) throw invalid();
  const since = f.revision;
  const room = await openRoom(proposalId);
  await serial(room, async () => {
    client.documentId = proposalId;
    await enter(room, client);
    await pool.query("INSERT INTO recent (proposal_id, person_id, joined_at) VALUES ($1,$2,now()) ON CONFLICT (proposal_id, person_id) DO UPDATE SET joined_at = now()",
      [proposalId, client.personId]);
    const roles = await rolesOn(proposalId);
    const people = await Promise.all(othersPresent(room, client.personId).map(async (p) => ({ person: await personOn(p.personId, roles), state: p.state })));
    send(client, {
      type: "joined", ref, documentId: proposalId, revision: room.revision, role: access.role, mode: await storedMode(proposalId, client.personId, access.role),
      accessEndsAt: access.accessEndsAt && iso(access.accessEndsAt), people,
    });
    const missed = await rows<{ revision: number; author_id: string; mode: EditMode; ops: Op[] }>(
      "SELECT revision, author_id, mode, ops FROM ops WHERE proposal_id = $1 AND revision > $2 ORDER BY revision", [proposalId, since]);
    for (const r of missed) send(client, { type: "op", revision: r.revision, authorId: r.author_id, mode: r.mode, ops: r.ops });
    for (const [personId, c] of room.carets) {
      if (personId !== client.personId && room.presence.has(personId)) send(client, { type: "caret", person: await personOn(personId, roles), at: c.at, length: c.length });
    }
  });
}

/** Socket frames after a join, in the error order of the API (not_found, forbidden, conflict, invalid). */
async function dispatch(client: Client, proposalId: string, ref: string, f: Frame): Promise<void> {
  const access = await requireAccess(client.personId, proposalId);
  const role = access.role;
  const room = await getRoom(proposalId);
  switch (f.type) {
    case "heartbeat":
      return send(client, { type: "ack", ref });
    case "caret": {
      if (!isInt(f.at) || !isInt(f.length)) throw invalid();
      touch(room, client.personId);
      room.carets.set(client.personId, { at: f.at, length: f.length });
      send(client, { type: "ack", ref });
      const person = await personOn(client.personId, await rolesOn(proposalId));
      broadcast(room, { type: "caret", person, at: f.at, length: f.length }, client);
      for (const c of room.clients) if (c.personId === client.personId && c !== client) send(c, { type: "caret", person, at: f.at, length: f.length });
      return;
    }
    case "mode": {
      if (!MODES.includes(f.mode as Mode)) throw invalid();
      if (!modesFor(role).includes(f.mode as Mode)) throw forbidden();
      await pool.query("INSERT INTO modes (proposal_id, person_id, mode) VALUES ($1,$2,$3) ON CONFLICT (proposal_id, person_id) DO UPDATE SET mode = $3",
        [proposalId, client.personId, f.mode]);
      touch(room, client.personId);
      return send(client, { type: "ack", ref });
    }
    case "op": {
      if (!canWrite(role, f.mode === "editing" ? "editing" : "suggesting")) throw forbidden();
      if (!isEditMode(f.mode) || !isInt(f.baseRevision) || !Array.isArray(f.ops) || !f.ops.length || !wellFormed(f.ops)) throw invalid();
      const frame = { baseRevision: f.baseRevision, mode: f.mode, ops: f.ops };
      touch(room, client.personId);
      return serial(room, async () => {
        if (!canWrite((await requireAccess(client.personId, proposalId)).role, frame.mode)) throw forbidden();
        if (frame.baseRevision > room.revision) throw invalid();
        await applyOps(room, client, ref, frame);
      });
    }
    case "replace_all": {
      if (!canWrite(role, f.mode === "editing" ? "editing" : "suggesting")) throw forbidden();
      const { find, replace } = f;
      if (!isEditMode(f.mode) || !isInt(f.baseRevision) || typeof find !== "string" || !find || typeof replace !== "string" || typeof f.matchCase !== "boolean") throw invalid();
      const mode = f.mode;
      const matchCase = f.matchCase;
      const base = f.baseRevision;
      return serial(room, async () => {
        if (!canWrite((await requireAccess(client.personId, proposalId)).role, mode)) throw forbidden();
        if (base > room.revision) throw invalid();
        const plan = planReplaceAll(room.proposal, find, replace, matchCase, mode);
        const revision = await applyReplaceAll(room, client.personId, mode, plan.ops);
        send(client, { type: "ack", ref, revision, count: plan.count });
      });
    }
    case "decide": {
      if (typeof f.suggestionId !== "string") throw notFound();
      const sid = f.suggestionId;
      const exists = await rows("SELECT 1 FROM suggestions WHERE id = $1 AND proposal_id = $2", [sid, proposalId]);
      if (!exists.length) throw notFound();
      if (!canDecide(role)) throw forbidden();
      if (!isDecision(f.decision)) throw invalid();
      const decision = f.decision;
      return serial(room, async () => {
        const r = await decideOne(room, client.personId, sid, decision);
        send(client, { type: "ack", ref, revision: r.revision, applied: r.applied, status: r.status });
      });
    }
    case "decide_all": {
      if (!canDecide(role)) throw forbidden();
      if (!isDecision(f.decision)) throw invalid();
      const decision = f.decision;
      return serial(room, async () => {
        const r = await decideAll(room, client.personId, decision);
        send(client, { type: "ack", ref, revision: r.revision, count: r.count });
      });
    }
    case "share": {
      if (typeof f.shareId !== "string") throw notFound();
      const body: Frame = {};
      if ("role" in f) body.role = f.role;
      if ("endsAt" in f) body.endsAt = f.endsAt;
      await updateShare(client.personId, proposalId, f.shareId, body);
      return send(client, { type: "ack", ref });
    }
    default:
      throw invalid();
  }
}
