import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Request } from "express";
import { poolDb } from "./db";
import { businessNow } from "./clock";
import { userFromRequest, type UserRef } from "./auth";
import { canSeeBoard } from "./access";

export interface LiveClient {
  ws: WebSocket;
  user: UserRef;
  boards: Set<number>;
  pins: Set<number>;
  users: Set<number>;
  feed: boolean;
  watchingSince: Map<number, Date>; // board id -> earliest watch start for "who is viewing"
}

const clients = new Set<LiveClient>();

export type BoardChangeKind = "added" | "moved" | "removed" | "section_added" | "section_moved" | "section_renamed" | "updated";

export interface BoardChangeMessage {
  type: "board";
  board_id: number;
  seq: number;
  actor: { id: number; name: string };
  change: BoardChangeKind;
  pin: { id: number; title: string } | null;
  section: { id: number; name: string } | null;
  pin_count: number;
  order: unknown;
}

export type LiveMessage =
  | { type: "clock"; now: string }
  | BoardChangeMessage
  | { type: "membership"; board_id: number; role: "editor" | "viewer" | null }
  | { type: "feed"; pin_ids: number[] }
  | { type: "counts"; pin_id: number; saves: number; comments: number; reactions: number }
  | { type: "follow"; target: "user" | "board"; id: number; followers: number }
  | { type: "operation_expired"; id: number }
  | { type: "viewers"; board_id: number; viewers: { id: number; name: string }[] }
  | { type: "pin_changed"; pin_id: number; version: number };

/** The board page's "viewing now" list (DP-90): owner and members watching, earliest first. */
export async function boardViewers(boardId: number): Promise<{ id: number; name: string }[]> {
  const list: { id: number; name: string; since: Date }[] = [];
  for (const client of clients) {
    if (!client.boards.has(boardId)) continue;
    const role = await roleOf(client.user.id, boardId);
    if (!role) continue;
    const since = client.watchingSince.get(boardId) ?? new Date();
    const existing = list.find(v => v.id === client.user.id);
    if (!existing) list.push({ id: client.user.id, name: client.user.name, since });
    else if (since < existing.since) existing.since = since;
  }
  list.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : a.id - b.id));
  return list.map(({ id, name }) => ({ id, name }));
}

async function roleOf(userId: number, boardId: number): Promise<string | null> {
  const board = await poolDb.queryOne<{ owner_id: string }>(`select owner_id from boards where id = $1`, [boardId]);
  if (!board) return null;
  if (board.owner_id === String(userId)) return "owner";
  const member = await poolDb.queryOne<{ role: string }>(
    `select role from board_members where board_id = $1 and user_id = $2`, [boardId, userId]
  );
  return member?.role ?? null;
}

export function initLive(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/live") { socket.destroy(); return; }
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && origin !== `http://${host}` && origin !== `https://${host}`) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return;
    }
    const user = await userFromRequest(req as unknown as Request);
    if (!user) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      const client: LiveClient = { ws, user: user as UserRef, boards: new Set(), pins: new Set(), users: new Set(), feed: false, watchingSince: new Map() };
      clients.add(client);
      ws.on("message", raw => handleWatch(client, raw.toString()));
      ws.on("close", async () => {
        clients.delete(client);
        for (const boardId of client.boards) await announceViewers(boardId);
      });
      ws.send(JSON.stringify({ type: "clock", now: businessNow().toISOString() }));
    });
  });
}

async function handleWatch(client: LiveClient, raw: string): Promise<void> {
  let msg: { type: string; board?: number; pin?: number; user?: number; feed?: boolean };
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === "watch") {
    if (typeof msg.board === "number") {
      const visible = await canSeeBoard(poolDb, client.user, msg.board);
      if (!visible) { send(client, { type: "not_found", board: msg.board }); return; }
      if (!client.boards.has(msg.board)) client.watchingSince.set(msg.board, new Date());
      client.boards.add(msg.board);
      await announceViewers(msg.board);
    }
    if (typeof msg.pin === "number") client.pins.add(msg.pin);
    if (typeof msg.user === "number") client.users.add(msg.user);
    if (msg.feed === true) client.feed = true;
  } else if (msg.type === "unwatch") {
    if (typeof msg.board === "number") { client.boards.delete(msg.board); await announceViewers(msg.board); }
    if (typeof msg.pin === "number") client.pins.delete(msg.pin);
    if (typeof msg.user === "number") client.users.delete(msg.user);
    if (msg.feed === true) client.feed = false;
  }
}

function send(client: LiveClient, msg: unknown): void {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg));
}

export async function announceViewers(boardId: number): Promise<void> {
  const hasMembers = await poolDb.queryOne<{ n: string }>(
    `select count(*)::text as n from board_members where board_id = $1`, [boardId]
  );
  if (!hasMembers || Number(hasMembers.n) === 0) return;
  const viewers = await boardViewers(boardId);
  const msg: LiveMessage = { type: "viewers", board_id: boardId, viewers };
  for (const client of clients) {
    if (client.boards.has(boardId)) send(client, msg);
  }
}

export async function broadcastBoard(change: BoardChangeMessage): Promise<void> {
  for (const client of clients) {
    if (client.boards.has(change.board_id)) send(client, change);
  }
}

export async function broadcastFeed(pinIds: number[]): Promise<void> {
  if (pinIds.length === 0) return;
  for (const client of clients) {
    if (client.feed) send(client, { type: "feed", pin_ids: pinIds });
  }
}

export async function broadcastCounts(pinId: number, counts: { saves: number; comments: number; reactions: number }): Promise<void> {
  for (const client of clients) {
    if (client.pins.has(pinId)) send(client, { type: "counts", pin_id: pinId, ...counts });
  }
}

export async function broadcastFollow(target: "user" | "board", id: number, followers: number): Promise<void> {
  const msg: LiveMessage = { type: "follow", target, id, followers };
  for (const client of clients) {
    if (target === "user" && client.users.has(id)) send(client, msg);
    if (target === "board" && client.boards.has(id)) send(client, msg);
  }
}

export async function broadcastMembership(boardId: number, userId: number, role: "editor" | "viewer" | null): Promise<void> {
  for (const client of clients) {
    if (client.user.id === userId && client.boards.has(boardId)) {
      send(client, { type: "membership", board_id: boardId, role });
    }
  }
}

export async function broadcastPinChanged(pinId: number, version: number): Promise<void> {
  for (const client of clients) {
    if (client.pins.has(pinId)) send(client, { type: "pin_changed", pin_id: pinId, version });
  }
}

export async function broadcastOperationExpired(operationId: number, userId: number): Promise<void> {
  for (const client of clients) {
    if (client.user.id === userId) send(client, { type: "operation_expired", id: operationId });
  }
}

export function broadcastClock(now: string): void {
  for (const client of clients) send(client, { type: "clock", now });
}
