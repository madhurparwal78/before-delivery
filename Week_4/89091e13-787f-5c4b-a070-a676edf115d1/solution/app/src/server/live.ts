import type { WebSocket } from "ws";
import type { LiveEvent } from "../shared/api.ts";

const sockets = new Map<string, Set<WebSocket>>();

export function subscribe(workspaceId: string, socket: WebSocket): void {
  const group = sockets.get(workspaceId) ?? new Set<WebSocket>();
  group.add(socket);
  sockets.set(workspaceId, group);
  socket.on("close", () => group.delete(socket));
}

export function broadcast(workspaceId: string, event: LiveEvent): void {
  const message = JSON.stringify(event);
  for (const socket of sockets.get(workspaceId) ?? []) socket.send(message);
}
