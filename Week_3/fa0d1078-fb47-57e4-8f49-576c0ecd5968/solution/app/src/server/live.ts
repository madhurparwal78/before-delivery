import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { ClientMessage, Player, ServerMessage } from "../shared/protocol";
import { isDate } from "../shared/dates";
import { attach, detach, dropAllRooms, playMove, setReady } from "./duels";
import { ApiError } from "./errors";
import { onLive, onValkeyLost, type Audience } from "./valkey";

const NO_SESSION_CLOSE = 4401;
const HEARTBEAT_MS = 20_000;
const MAX_MESSAGE_BYTES = 65_536;

interface Connection {
  socket: WebSocket;
  player: Player;
  room: string | null;
  boards: Set<string>;
  alive: boolean;
  inbox: Promise<void>;
}

const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

/** Open sockets of this process: connections only; rooms, presence and results live in Valkey. */
const connections = new Set<Connection>();

function send(connection: Connection, message: ServerMessage): void {
  connection.socket.send(JSON.stringify(message));
}

function parse(data: RawData): ClientMessage | null {
  try {
    const message: unknown = JSON.parse(data.toString());
    return typeof message === "object" && message !== null && typeof (message as { type?: unknown }).type === "string" ? (message as ClientMessage) : null;
  } catch {
    return null;
  }
}

async function dispatch(connection: Connection, message: ClientMessage): Promise<void> {
  switch (message.type) {
    case "room":
      connection.room = await attach(connection.player, message.code);
      return;
    case "ready":
      if (connection.room) await setReady(connection.player, connection.room, message.ready === true);
      return;
    case "move":
      if (connection.room) await playMove(connection.player, connection.room, message);
      return;
    case "leaderboard":
      if (!isDate(message.date)) throw new ApiError("VALIDATION");
      connection.boards.add(message.date);
      return;
  }
}

function sendFailure(connection: Connection, error: unknown): void {
  if (error instanceof ApiError) send(connection, { type: "error", code: error.code, message: error.message });
  else console.error(error);
}

function open(socket: WebSocket, player: Player | null): void {
  if (!player) {
    socket.close(NO_SESSION_CLOSE);
    return;
  }
  const connection: Connection = { socket, player, room: null, boards: new Set(), alive: true, inbox: Promise.resolve() };
  connections.add(connection);
  socket.on("pong", () => {
    connection.alive = true;
  });
  socket.on("message", (data) => {
    const message = parse(data);
    if (!message) return;
    connection.inbox = connection.inbox.then(() => dispatch(connection, message)).catch((error: unknown) => sendFailure(connection, error));
  });
  socket.on("close", () => {
    connections.delete(connection);
    const room = connection.room;
    const rejoined = [...connections].some((other) => other.player.player_id === connection.player.player_id && other.room === room);
    if (room && !rejoined) void detach(connection.player, room);
  });
}

export function acceptSocket(request: IncomingMessage, socket: Duplex, head: Buffer, player: Player | null): void {
  sockets.handleUpgrade(request, socket, head, (accepted) => open(accepted, player));
}

function deliver(audience: Audience, message: ServerMessage): void {
  for (const connection of connections) {
    const wanted =
      "players" in audience
        ? audience.players.includes(connection.player.player_id)
        : message.type === "leaderboard" && connection.boards.has(audience.leaderboard);
    if (wanted) send(connection, message);
  }
}

/** Starts fan-out from Valkey, the heartbeat that retires dead sockets, and the notice when Valkey goes away. */
export function startLive(): void {
  onLive(deliver);
  onValkeyLost(() => {
    dropAllRooms();
    for (const connection of connections) {
      if (connection.room) send(connection, { type: "error", code: "LIVE_UNAVAILABLE", message: new ApiError("LIVE_UNAVAILABLE").message });
    }
  });
  setInterval(() => {
    for (const connection of connections) {
      if (!connection.alive) connection.socket.terminate();
      connection.alive = false;
      connection.socket.ping();
    }
  }, HEARTBEAT_MS).unref();
}
