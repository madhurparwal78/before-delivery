// The live connection: presence, cursors, selections, operations broadcast.
import type { WebSocket } from 'ws';
import { config } from './config.js';

export type ClientMessage =
  | { type: 'op'; op: Record<string, unknown> }
  | { type: 'cursor'; pageId: string; x: number; y: number }
  | { type: 'select'; nodeId: string };

export interface Session {
  ws: WebSocket;
  workspaceId: string;
  userId: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  pageId: string | null;
  cursor: { x: number; y: number } | null;
  lastHeartbeat: number;
  closed: boolean;
}

interface Broadcast { type: string; [key: string]: unknown }

const sessionsByWorkspace = new Map<string, Set<Session>>();

export function addSession(s: Session): void {
  let set = sessionsByWorkspace.get(s.workspaceId);
  if (!set) { set = new Set(); sessionsByWorkspace.set(s.workspaceId, set); }
  set.add(s);
}

export function removeSession(s: Session): void {
  const set = sessionsByWorkspace.get(s.workspaceId);
  if (set) { set.delete(s); if (set.size === 0) sessionsByWorkspace.delete(s.workspaceId); }
}

export function sessionsOf(workspaceId: string): Session[] {
  return [...(sessionsByWorkspace.get(workspaceId) ?? [])];
}

export function send(s: Session, msg: Broadcast): void {
  if (s.closed) return;
  try { s.ws.send(JSON.stringify(msg)); } catch { /* connection closed */ }
}

export function broadcastWorkspace(workspaceId: string, msg: Broadcast, exceptUserId?: string): void {
  for (const s of sessionsOf(workspaceId)) {
    if (exceptUserId && s.userId === exceptUserId) continue;
    send(s, msg);
  }
}

export function presenceMessage(workspaceId: string, you: Session): Broadcast {
  const people: { id: string; name: string; role: string }[] = [];
  const seen = new Set<string>();
  for (const s of sessionsOf(workspaceId)) {
    if (seen.has(s.userId)) continue;
    seen.add(s.userId);
    people.push({ id: s.userId, name: s.name, role: s.userId === you.userId && people.length === 0 ? s.role : s.role });
  }
  return { type: 'presence', people };
}

let pingTimer: NodeJS.Timeout | null = null;

export function startPresencePinger(onTimeout: (s: Session) => void): void {
  if (pingTimer) return;
  pingTimer = setInterval(() => {
    const now = Date.now();
    for (const set of sessionsByWorkspace.values()) {
      for (const s of set) {
        send(s, { type: 'ping' });
        if (now - s.lastHeartbeat > config.presenceTimeoutMs) onTimeout(s);
      }
    }
  }, 1000);
}

export function heartbeat(s: Session): void {
  s.lastHeartbeat = Date.now();
}
