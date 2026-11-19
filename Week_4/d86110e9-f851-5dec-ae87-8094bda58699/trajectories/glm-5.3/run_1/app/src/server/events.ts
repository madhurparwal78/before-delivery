// The live stream hub. Each connection belongs to one workspace and
// optionally registers presence on one draft. The stream only ever carries
// that workspace's events.

import type { ServerResponse } from "node:http";

export interface SseClient {
  res: ServerResponse;
  wsId: string;
  userId: string;
  userName: string;
  draftAid: string | null;
}

const clients = new Set<SseClient>();
const presence = new Map<string, Map<string, string>>();

export function addClient(c: SseClient): void {
  clients.add(c);
  if (c.draftAid) {
    let byUser = presence.get(c.draftAid);
    if (!byUser) {
      byUser = new Map();
      presence.set(c.draftAid, byUser);
    }
    const had = byUser.has(c.userId);
    byUser.set(c.userId, c.userName);
    if (!had) broadcastDraftPresence(c.draftAid, c.wsId);
  }
}

export function removeClient(c: SseClient): void {
  clients.delete(c);
  if (c.draftAid) {
    const byUser = presence.get(c.draftAid);
    if (byUser) {
      const remaining = [...clients].some((x) => x.draftAid === c.draftAid && x.userId === c.userId);
      if (!remaining) {
        byUser.delete(c.userId);
        broadcastDraftPresence(c.draftAid, c.wsId);
      }
      if (byUser.size === 0) presence.delete(c.draftAid);
    }
  }
}

export function draftMembers(aid: string, exceptUserId: string | null): { id: string; name: string }[] {
  const byUser = presence.get(aid);
  if (!byUser) return [];
  const out: { id: string; name: string }[] = [];
  for (const [id, name] of byUser) {
    if (id !== exceptUserId) out.push({ id, name });
  }
  return out;
}

function broadcastDraftPresence(aid: string, wsId: string): void {
  const byUser = presence.get(aid) ?? new Map();
  const members = [...byUser].map(([id, name]) => ({ id, name }));
  for (const c of clients) {
    if (c.wsId === wsId && c.draftAid === aid) {
      writeEvent(c.res, { type: "presence", workspace_id: wsId, automation_id: aid, members });
    }
  }
}

export function pushEvent(wsId: string, event: Record<string, unknown>): void {
  for (const c of clients) {
    if (c.wsId === wsId) writeEvent(c.res, event);
  }
}

export function writeEvent(res: ServerResponse, event: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed) return;
  res.write("data: " + JSON.stringify(event) + "\n\n");
}
