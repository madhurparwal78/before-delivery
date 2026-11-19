import { STATUS_CODES } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { LiveMessage } from "../shared/api";
import { pool, query } from "./db";
import { ApiError, errorBody, forbidden, liveUnavailable, notFound, unauthenticated } from "./errors";
import { foreignOrigin } from "./http";
import { outage } from "./outage";
import { userFromRequest } from "./session";

const sockets = new Map<string, Set<WebSocket>>();
const channel = new WebSocketServer({ noServer: true, maxPayload: 1024 });

/** Answers an upgrade request with the shared error body and closes the connection. */
function refuse(socket: Socket, error: ApiError): void {
  const body = errorBody(error);
  const reason = STATUS_CODES[error.status] ?? "Error";
  socket.write(
    `HTTP/1.1 ${error.status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

async function accept(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
  if (foreignOrigin(req)) return refuse(socket, forbidden("Requests from another origin are refused."));
  const user = await userFromRequest(req);
  if (!user) return refuse(socket, unauthenticated());
  if (outage.live) return refuse(socket, liveUnavailable());
  channel.handleUpgrade(req, socket, head, (ws) => {
    const mine = sockets.get(user.id) ?? new Set<WebSocket>();
    mine.add(ws);
    sockets.set(user.id, mine);
    ws.on("close", () => mine.delete(ws));
    ws.on("error", () => ws.terminate());
  });
}

/** Serves the live channel at /api/live on the same port as the API. */
export function attachLiveChannel(server: Server): void {
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://local").pathname !== "/api/live") return refuse(socket, notFound());
    accept(req, socket, head).catch(() => refuse(socket, new ApiError(500, "internal_error", "Something went wrong.")));
  });
}

/** Grading outage: every socket closes and upgrades are refused until the outage ends. */
export function closeAllSockets(): void {
  for (const mine of sockets.values()) for (const ws of mine) ws.close(1013, "paused");
}

function sendTo(userIds: readonly string[], message: LiveMessage): void {
  const text = JSON.stringify(message);
  for (const id of userIds) {
    for (const ws of sockets.get(id) ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}

/** Everyone who can see a recipe: its owner, or every member of its team. */
async function recipeAudience(recipeId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    pool,
    `SELECT r.owner_user_id AS user_id FROM recipes r WHERE r.id = $1 AND r.owner_user_id IS NOT NULL
     UNION SELECT m.user_id FROM recipes r JOIN team_members m ON m.team_id = r.team_id WHERE r.id = $1`,
    [recipeId],
  );
  return rows.map((row) => row.user_id);
}

export function announceVersionSaved(message: Extract<LiveMessage, { type: "version_saved" }>): void {
  recipeAudience(message.recipeId).then((audience) => sendTo(audience, message), () => undefined);
}

/** Tells the team's current members, and anyone just removed, that the members changed. */
export function announceMembershipChanged(teamId: string, alsoTell: readonly string[] = []): void {
  query<{ user_id: string }>(pool, "SELECT user_id FROM team_members WHERE team_id = $1", [teamId]).then(
    (rows) => sendTo([...rows.map((row) => row.user_id), ...alsoTell], { type: "membership_changed", teamId }),
    () => undefined,
  );
}
