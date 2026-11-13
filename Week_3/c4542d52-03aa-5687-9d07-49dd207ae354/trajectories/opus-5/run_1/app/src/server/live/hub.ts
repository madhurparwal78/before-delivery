import type { WebSocket } from "ws";
import type { LiveEvent, Role } from "../../shared/types.js";
import { audienceMatches, type DeliverableEvent } from "./events.js";

interface Connection {
  socket: WebSocket;
  personId: string;
  role: Role;
}

const connections = new Set<Connection>();

function send(socket: WebSocket, event: LiveEvent): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}

export function addConnection(socket: WebSocket, personId: string, role: Role): void {
  const connection: Connection = { socket, personId, role };
  connections.add(connection);
  socket.on("close", () => {
    connections.delete(connection);
  });
}

export function publish(item: DeliverableEvent): void {
  if (item.event.type === "role_changed") {
    const personId = item.event.data["person_id"];
    const role = item.event.data["role"];
    if (typeof personId === "string" && typeof role === "string") {
      for (const connection of connections) {
        if (connection.personId === personId) connection.role = role as Role;
      }
    }
  }
  for (const connection of connections) {
    if (audienceMatches(item.audience, connection.personId, connection.role)) send(connection.socket, item.event);
  }
  if (item.event.type === "access_removed") {
    const personId = item.event.data["person_id"];
    if (typeof personId === "string") {
      for (const connection of connections) {
        if (connection.personId === personId) connection.socket.close();
      }
    }
  }
}

export function sendTo(socket: WebSocket, event: LiveEvent): void {
  send(socket, event);
}

/** The server clock, sent to every open page once a second. */
export function startClock(): void {
  setInterval(() => {
    const event: LiveEvent = {
      seq: 0,
      type: "clock",
      at: new Date().toISOString(),
      data: { server_time: new Date().toISOString() },
    };
    for (const connection of connections) send(connection.socket, event);
  }, 1000);
}
