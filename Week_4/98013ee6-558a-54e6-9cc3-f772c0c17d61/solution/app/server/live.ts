import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import pg from "pg";
import { WebSocket, WebSocketServer } from "ws";
import { canSeeBoard, canSeePin } from "./access.js";
import { iso, loadClock, now } from "./clock.js";
import { config } from "./config.js";
import { ApiError, forbidden, unauthorized } from "./errors.js";
import { one, pool } from "./db.js";
import { LIVE_CHANNEL, type Envelope } from "./events.js";
import { feedPinIds } from "./feed.js";
import { userForRequest } from "./accounts.js";
import { isSameOrigin } from "./http.js";
import { addPresence, emitViewers, keepPresence, removePresence } from "./presence.js";
import { isRecord } from "../shared/guards.js";
import type { LiveMessage } from "../shared/types.js";

interface Connection {
  id: string;
  socket: WebSocket;
  userId: number;
  boards: Set<number>;
  pins: Set<number>;
  users: Set<number>;
  feed: boolean;
  alive: boolean;
}

const instance = randomUUID();
const connections = new Set<Connection>();

const send = (connection: Connection, message: LiveMessage): void => {
  if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify(message));
};

function reject(socket: Duplex, failure: ApiError, reason: string): void {
  const body = JSON.stringify(failure.body);
  socket.end(
    `HTTP/1.1 ${failure.status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

function groupByUser(list: Connection[]): Map<number, Connection[]> {
  const grouped = new Map<number, Connection[]>();
  for (const connection of list) grouped.set(connection.userId, [...(grouped.get(connection.userId) ?? []), connection]);
  return grouped;
}

async function dispatch({ target, message }: Envelope): Promise<void> {
  if (message.type === "clock") await loadClock();
  const all = [...connections];
  switch (target.kind) {
    case "all":
      all.forEach((connection) => send(connection, message));
      return;
    case "person":
      all.filter((connection) => connection.userId === target.user).forEach((connection) => send(connection, message));
      return;
    case "user":
      all.filter((connection) => connection.users.has(target.user)).forEach((connection) => send(connection, message));
      return;
    case "pin":
      for (const [userId, list] of groupByUser(all.filter((connection) => connection.pins.has(target.pin)))) {
        if (await canSeePin(pool, target.pin, userId)) list.forEach((connection) => send(connection, message));
      }
      return;
    case "board":
      for (const [userId, list] of groupByUser(all.filter((connection) => connection.boards.has(target.board)))) {
        if (await canSeeBoard(pool, target.board, userId)) list.forEach((connection) => send(connection, message));
      }
      return;
    case "feed":
      for (const [userId, list] of groupByUser(all.filter((connection) => connection.feed))) {
        const belonging = await feedPinIds(pool, userId, target.pinIds);
        if (belonging.length > 0) list.forEach((connection) => send(connection, { type: "feed", pin_ids: belonging }));
      }
      return;
  }
}

async function onNotification(payload: string | undefined): Promise<void> {
  const row = await one<{ payload: Envelope }>(pool, "SELECT payload FROM live_events WHERE id = $1", [Number(payload)]);
  if (row) await dispatch(row.payload);
}

async function listen(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  const retry = (): void => {
    client.removeAllListeners();
    client.end().catch(() => undefined);
    setTimeout(() => void listen().catch(() => retry()), 1000).unref();
  };
  client.on("error", retry);
  client.on("notification", (note) => {
    onNotification(note.payload).catch((error: unknown) => console.error("live dispatch failed", String(error)));
  });
  await client.connect();
  await client.query(`LISTEN ${LIVE_CHANNEL}`);
}

async function onClientMessage(connection: Connection, data: unknown): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(String(data));
  } catch {
    return;
  }
  if (!isRecord(message) || (message["type"] !== "watch" && message["type"] !== "unwatch")) return;
  const watching = message["type"] === "watch";
  const board = message["board"];
  const pin = message["pin"];
  const user = message["user"];
  if (typeof board === "number") {
    if (watching) {
      if (!(await canSeeBoard(pool, board, connection.userId))) {
        send(connection, { type: "not_found", board });
        return;
      }
      connection.boards.add(board);
      await addPresence(pool, connection.id, instance, board, connection.userId);
    } else {
      connection.boards.delete(board);
      await removePresence(pool, connection.id, board);
    }
    await emitViewers(pool, board);
  } else if (typeof pin === "number") {
    if (watching) connection.pins.add(pin);
    else connection.pins.delete(pin);
  } else if (typeof user === "number") {
    if (watching) connection.users.add(user);
    else connection.users.delete(user);
  } else if (message["feed"] === true) {
    connection.feed = watching;
  }
}

function accept(wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer): void {
  void (async () => {
    if (!isSameOrigin(req)) return reject(socket, forbidden(), "Forbidden");
    const user = await userForRequest(req);
    if (!user) return reject(socket, unauthorized(), "Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => {
      const connection: Connection = { id: randomUUID(), socket: ws, userId: user.id, boards: new Set(), pins: new Set(), users: new Set(), feed: false, alive: true };
      connections.add(connection);
      send(connection, { type: "clock", now: iso(now()) });
      ws.on("pong", () => {
        connection.alive = true;
      });
      ws.on("message", (data) => {
        onClientMessage(connection, data).catch((error: unknown) => console.error("live message failed", String(error)));
      });
      ws.on("close", () => {
        connections.delete(connection);
        for (const board of connection.boards) {
          removePresence(pool, connection.id, board)
            .then(() => emitViewers(pool, board))
            .catch((error: unknown) => console.error("presence cleanup failed", String(error)));
        }
      });
    });
  })().catch(() => socket.destroy());
}

export async function startLive(server: Server): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/api/live") {
      socket.destroy();
      return;
    }
    accept(wss, req, socket, head);
  });
  await listen();
  setInterval(() => {
    for (const connection of connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }, 20_000).unref();
  setInterval(() => {
    for (const connection of connections) send(connection, { type: "clock", now: iso(now()) });
  }, 30_000).unref();
  setInterval(() => {
    keepPresence(pool, instance)
      .then(() => pool.query("DELETE FROM live_events WHERE created_at < now() - interval '10 minutes'"))
      .catch((error: unknown) => console.error("live upkeep failed", String(error)));
  }, 10_000).unref();
}
