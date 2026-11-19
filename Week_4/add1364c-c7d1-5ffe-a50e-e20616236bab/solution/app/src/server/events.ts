import type { ServerResponse } from "node:http";
import { now } from "./clock.js";

interface Connection {
  res: ServerResponse;
  personId: string;
  role: string;
  tokenHash: string;
  endsAt: Date;
  known: Set<string>;
}

const connections = new Set<Connection>();

export function attach(connection: Connection): void {
  connections.add(connection);
  connection.res.on("close", () => connections.delete(connection));
}

export function connected(): ReadonlySet<Connection> {
  return connections;
}

export function send(connection: Connection, event: string, data: unknown): void {
  connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const DESK_ROLES = ["office_manager", "managing_partner"];

export function emitToDesk(event: string, data: unknown): void {
  for (const connection of connections) {
    if (DESK_ROLES.includes(connection.role)) send(connection, event, data);
  }
}

export function closePerson(personId: string): void {
  for (const connection of [...connections]) {
    if (connection.personId === personId) connection.res.end();
  }
}

export function keepAlive(): void {
  for (const connection of connections) connection.res.write(`: keepalive ${now().getTime()}\n\n`);
}
