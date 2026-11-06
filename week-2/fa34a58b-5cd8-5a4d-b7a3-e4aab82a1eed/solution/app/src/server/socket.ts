// /api/socket: refuses foreign origins at the handshake and pushes every change to every listener.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { SocketMessage } from "../shared/types.ts";
import { sameOrigin } from "./origin.ts";

const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });

export function broadcast(message: SocketMessage): void {
  const text = JSON.stringify(message);
  for (const client of sockets.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(text);
  }
}

export function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  greeting: () => Promise<SocketMessage>,
): void {
  const path = (request.url ?? "").split("?")[0];
  if (path !== "/api/socket") {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  if (!sameOrigin(request)) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => {
    client.on("error", () => client.terminate());
    greeting().then(
      (message) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(message)),
      () => undefined,
    );
  });
}
