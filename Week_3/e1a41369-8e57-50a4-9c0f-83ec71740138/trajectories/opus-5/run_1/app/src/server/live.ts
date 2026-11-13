import type { ServerResponse } from 'node:http';

export type LiveEvent = 'player' | 'tasks' | 'party' | 'invite' | 'quest' | 'strike' | 'chat' | 'banner' | 'notice';

interface Connection {
  userId: string;
  res: ServerResponse;
}

const connections = new Set<Connection>();

export function addConnection(userId: string, res: ServerResponse): () => void {
  const connection: Connection = { userId, res };
  connections.add(connection);
  return () => {
    connections.delete(connection);
  };
}

function write(connection: Connection, event: LiveEvent, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  connection.res.write(payload);
}

export function sendToUser(userId: string, event: LiveEvent, data: unknown): void {
  for (const connection of connections) {
    if (connection.userId === userId) write(connection, event, data);
  }
}

export function sendToUsers(userIds: readonly string[], event: LiveEvent, data: unknown): void {
  for (const userId of userIds) sendToUser(userId, event, data);
}

export function heartbeat(): void {
  for (const connection of connections) connection.res.write(': ping\n\n');
}
