/** The live channel (WebSocket, same origin): board changes, race rooms, countdown steps and racers' entries. */

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { BoardKind, BoardLength, LiveRequest } from "../shared/protocol";
import { isRecord } from "./http";
import { liveSessions, viewerOf } from "./auth";
import { BOARD_LENGTHS, boardRows, publicRow } from "./boards";
import { LiveConnection } from "./connection";
import { pool } from "./db";
import { attach, detach, receiveEntries, sweepFinishedRooms } from "./rooms";

const LIVE_PATH = "/api/live";
const MAX_MESSAGE_BYTES = 256 * 1024;
const SESSION_CHECK_MS = 2000;
const BOARD_KINDS: readonly BoardKind[] = ["daily", "alltime"];

const connections = new Set<LiveConnection>();

async function pushBoard(kind: BoardKind, length: BoardLength, changedRunId: string | null): Promise<void> {
  const watchers = [...connections].filter((connection) => connection.board?.kind === kind && connection.board.length === length);
  if (watchers.length === 0) return;
  const rows = await boardRows(kind, length);
  const changed = rows.find((row) => row.runId === changedRunId);
  const rowsOut = rows.map(publicRow);
  for (const connection of watchers) {
    const mine = rows.find((row) => row.typistId === connection.viewer?.typistId);
    connection.send({ type: "board", board: kind, length, rows: rowsOut, mine: mine?.rank ?? null, change: changed ? { name: changed.name, rank: changed.rank, speed: changed.speed } : null });
  }
}

/** A counted run may have added or improved a board row: refresh both boards of its length; a run that is not on a board changes nothing there. */
export async function publishCountedRun(runId: string): Promise<void> {
  const { rows } = await pool.query<{ length: string }>("SELECT length FROM runs WHERE id = $1", [runId]);
  const length = BOARD_LENGTHS.find((candidate) => String(candidate) === rows[0]?.length);
  if (length === undefined) return;
  for (const kind of BOARD_KINDS) await pushBoard(kind, length, runId);
}

export function dropTypistConnections(typistId: string): void {
  for (const connection of connections) if (connection.viewer?.typistId === typistId) connection.close();
}

function parseRequest(data: string): LiveRequest | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(message)) return null;
  if (message.type === "board" && BOARD_KINDS.includes(message.board as BoardKind) && BOARD_LENGTHS.includes(message.length as BoardLength)) {
    return { type: "board", board: message.board as BoardKind, length: message.length as BoardLength };
  }
  if (message.type === "room" && typeof message.code === "string" && (message.since === null || Number.isInteger(message.since))) {
    return { type: "room", code: message.code, since: message.since as number | null };
  }
  if (message.type === "entries" && typeof message.code === "string" && Array.isArray(message.entries)) {
    return { type: "entries", code: message.code, entries: message.entries as { k: string; t: number }[] };
  }
  return null;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return origin === undefined || new URL(origin).host === req.headers.host;
}

export function attachLive(server: Server): void {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== LIVE_PATH || !sameOrigin(req)) {
      socket.destroy();
      return;
    }
    void viewerOf(req)
      .then((viewer) =>
        sockets.handleUpgrade(req, socket, head, (ws) => {
          const connection = new LiveConnection(ws, viewer);
          connections.add(connection);
          ws.on("message", (data) => {
            const request = parseRequest(data.toString("utf8"));
            if (request?.type === "board") {
              connection.board = { kind: request.board, length: request.length };
              void pushBoard(request.board, request.length, null).catch(() => undefined);
            } else if (request?.type === "room") attach(connection, request.code, request.since);
            else if (request?.type === "entries") receiveEntries(connection, request.code, request.entries);
          });
          ws.on("close", () => {
            connections.delete(connection);
            detach(connection);
          });
          ws.on("error", () => ws.terminate());
        }),
      )
      .catch(() => socket.destroy());
  });
  setInterval(() => {
    const signedIn = [...connections].flatMap((connection) => (connection.viewer ? [{ connection, hash: connection.viewer.sessionHash }] : []));
    if (signedIn.length === 0) return;
    void liveSessions(signedIn.map(({ hash }) => hash))
      .then((alive) => {
        for (const { connection, hash } of signedIn) if (!alive.has(hash)) connection.close();
      })
      .catch(() => undefined);
  }, SESSION_CHECK_MS).unref();
  let today = new Date().toISOString().slice(0, 10);
  setInterval(() => {
    const now = new Date().toISOString().slice(0, 10);
    sweepFinishedRooms();
    if (now === today) return;
    today = now;
    for (const length of BOARD_LENGTHS) void pushBoard("daily", length, null).catch(() => undefined);
  }, 1000).unref();
}
