import type { ServerResponse } from 'node:http';
import type { StreamEvent } from '../shared/types';

interface Connection {
  id: number;
  workspaceId: string;
  userId: string;
  userName: string;
  draftId: string | null;
  res: ServerResponse;
}

const connections = new Map<number, Connection>();
let nextId = 1;

export function addConnection(
  workspaceId: string,
  userId: string,
  userName: string,
  draftId: string | null,
  res: ServerResponse,
): number {
  const id = nextId;
  nextId += 1;
  connections.set(id, { id, workspaceId, userId, userName, draftId, res });
  if (draftId !== null) pushPresence(workspaceId, draftId);
  return id;
}

export function removeConnection(id: number): void {
  const connection = connections.get(id);
  if (connection === undefined) return;
  connections.delete(id);
  if (connection.draftId !== null) pushPresence(connection.workspaceId, connection.draftId);
}

export function send(event: StreamEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const connection of connections.values()) {
    if (connection.workspaceId !== event.workspace_id) continue;
    if (event.type === 'presence' && connection.draftId !== event.automation_id) continue;
    connection.res.write(payload);
  }
}

export function pushPresence(workspaceId: string, automationId: string): void {
  const members = new Map<string, string>();
  for (const connection of connections.values()) {
    if (connection.workspaceId === workspaceId && connection.draftId === automationId) {
      members.set(connection.userId, connection.userName);
    }
  }
  send({
    type: 'presence',
    workspace_id: workspaceId,
    automation_id: automationId,
    members: [...members.entries()].map(([id, name]) => ({ id, name })),
  });
}

export function heartbeat(): void {
  for (const connection of connections.values()) connection.res.write(': keep-alive\n\n');
}
