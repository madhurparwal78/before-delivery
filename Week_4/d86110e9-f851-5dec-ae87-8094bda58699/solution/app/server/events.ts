import type { ServerResponse } from 'node:http';
import { machineMs } from './clock.js';
import type { Json, JsonObject } from './json.js';

interface Connection {
  response: ServerResponse;
  userId: string;
  userName: string;
  workspaceId: string;
  draft: string | null;
}

const connections = new Set<Connection>();

/** Run events of the last few seconds, replayed to a stream that connects just after them (the page may still be opening it). */
const CATCH_UP_MS = 3000;
const recentRuns: Array<{ at: number; workspaceId: string; event: JsonObject }> = [];

function write(connection: Connection, event: JsonObject): void {
  connection.response.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Pushes one event to every connection of its workspace. */
export function publish(workspaceId: string, event: JsonObject): void {
  const body: JsonObject = { ...event, workspace_id: workspaceId };
  if (event.type === 'run') {
    const now = machineMs();
    while (recentRuns[0] !== undefined && recentRuns[0].at < now - CATCH_UP_MS) recentRuns.shift();
    recentRuns.push({ at: now, workspaceId, event: body });
  }
  for (const connection of connections) if (connection.workspaceId === workspaceId) write(connection, body);
}

function presenceOf(workspaceId: string, automationId: string): Json {
  const seen = new Map<string, string>();
  for (const connection of connections) {
    if (connection.workspaceId === workspaceId && connection.draft === automationId) seen.set(connection.userId, connection.userName);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

function announcePresence(workspaceId: string, automationId: string): void {
  const event: JsonObject = { type: 'presence', workspace_id: workspaceId, automation_id: automationId, members: presenceOf(workspaceId, automationId) };
  for (const connection of connections) {
    if (connection.workspaceId === workspaceId && connection.draft === automationId) write(connection, event);
  }
}

export function attach(connection: Connection): void {
  connections.add(connection);
  connection.response.write(': connected\n\n');
  const since = machineMs() - CATCH_UP_MS;
  for (const entry of recentRuns) if (entry.workspaceId === connection.workspaceId && entry.at >= since) write(connection, entry.event);
  if (connection.draft !== null) announcePresence(connection.workspaceId, connection.draft);
  connection.response.on('close', () => {
    connections.delete(connection);
    if (connection.draft !== null) announcePresence(connection.workspaceId, connection.draft);
  });
}

export function keepAlive(): void {
  for (const connection of connections) connection.response.write(': keepalive\n\n');
}
