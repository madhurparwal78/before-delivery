import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { LiveEvent, PresencePerson } from "../shared/types";
import { settings } from "./config";
import { acceptSocket, type LiveSocket } from "./socket";

interface Connection {
  id: string;
  socket: LiveSocket;
  userId: string;
  userName: string;
  projectId: string;
  workspaceId: string;
  selected: string | null;
}

const connections = new Map<string, Connection>();

function send(connection: Connection, event: LiveEvent): void {
  connection.socket.send(JSON.stringify(event));
}

/** The people with a project open: one entry per person, the focus they last set, sorted by name. */
export function presenceOf(projectId: string): PresencePerson[] {
  const people = new Map<string, PresencePerson>();
  for (const connection of connections.values()) {
    if (connection.projectId !== projectId) continue;
    const known = people.get(connection.userId);
    people.set(connection.userId, {
      userId: connection.userId,
      name: connection.userName,
      selected: connection.selected ?? known?.selected ?? null,
    });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function announcePresence(projectId: string): void {
  const event: LiveEvent = { type: "presence", people: presenceOf(projectId) };
  for (const connection of connections.values()) if (connection.projectId === projectId) send(connection, event);
}

/** The browser's focus arrives on the live channel itself: it is not a change to the plan. */
function readFocus(message: string): string | null | undefined {
  try {
    const parsed: unknown = JSON.parse(message);
    if (typeof parsed !== "object" || parsed === null || (parsed as { type?: unknown }).type !== "select") return undefined;
    const selected = (parsed as { selected?: unknown }).selected;
    return typeof selected === "string" ? selected : null;
  } catch {
    return undefined;
  }
}

/** Opens one person's live channel; a channel silent for the presence timeout counts as gone. */
export function openConnection(req: IncomingMessage, raw: Duplex, who: { userId: string; userName: string; projectId: string; workspaceId: string }): void {
  const timeoutMs = settings.presenceTimeoutSeconds * 1000;
  let lastHeard = Date.now();
  const id = randomUUID();
  const socket = acceptSocket(req, raw, {
    heard: () => {
      lastHeard = Date.now();
    },
    text: (message) => {
      const selected = readFocus(message);
      const connection = connections.get(id);
      if (selected === undefined || !connection) return;
      connection.selected = selected;
      announcePresence(connection.projectId);
    },
    closed: () => {
      clearInterval(heartbeat);
      if (connections.delete(id)) announcePresence(who.projectId);
    },
  });
  const heartbeat = setInterval(() => {
    if (Date.now() - lastHeard > timeoutMs) raw.destroy();
    else socket.ping();
  }, Math.max(500, timeoutMs / 3));
  const connection: Connection = { id, socket, ...who, selected: null };
  connections.set(id, connection);
  send(connection, { type: "ready", people: presenceOf(who.projectId) });
  announcePresence(who.projectId);
}

/** Tells everyone in the workspace: the viewers of this project get the snapshot, the rest a workload nudge. */
export function publishProjectChange(workspaceId: string, projectId: string, event: Extract<LiveEvent, { type: "project" }>): void {
  for (const connection of connections.values()) {
    if (connection.workspaceId !== workspaceId) continue;
    send(connection, connection.projectId === projectId ? event : { type: "workload", projectId });
  }
}

export function publishToProject(projectId: string, event: LiveEvent): void {
  for (const connection of connections.values()) if (connection.projectId === projectId) send(connection, event);
}
