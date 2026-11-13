/**
 * The live message bus per space: SSE connections and seq handling.
 */
import type { Response } from "express";

export type LiveKind = "clock" | "alert" | "inbox" | "case" | "upload" | "lifecycle";

export interface LiveMessage {
  kind: LiveKind;
  spaceId: string;
  seq: number;
  data: Record<string, unknown>;
}

interface SseClient {
  res: Response;
  spaceId: string;
}

const clients = new Set<SseClient>();
const seqBySpace = new Map<string, number>();

export function nextSeq(spaceId: string): number {
  const cur = seqBySpace.get(spaceId) ?? 0;
  const next = cur + 1;
  seqBySpace.set(spaceId, next);
  return next;
}

export function currentSeq(spaceId: string): number {
  return seqBySpace.get(spaceId) ?? 0;
}

export function initSeq(spaceId: string, seq: number): void {
  const cur = seqBySpace.get(spaceId) ?? 0;
  seqBySpace.set(spaceId, Math.max(cur, seq));
}

export function addSseClient(res: Response, spaceId: string): void {
  clients.add({ res, spaceId });
}

export function removeSseClient(res: Response): void {
  for (const c of clients) {
    if (c.res === res) {
      clients.delete(c);
      return;
    }
  }
}

export function publish(message: LiveMessage): void {
  for (const c of clients) {
    if (c.spaceId !== message.spaceId) continue;
    try {
      c.res.write(`id: ${message.seq}\n`);
      c.res.write(`event: ${message.kind}\n`);
      c.res.write(`data: ${JSON.stringify({ ...message.data, seq: message.seq })}\n\n`);
    } catch {
      clients.delete(c);
    }
  }
}

export function broadcastToSpace(spaceId: string, kind: LiveKind, data: Record<string, unknown>, seq?: number): void {
  const s = seq ?? nextSeq(spaceId);
  publish({ kind, spaceId, seq: s, data });
}

export function heartbeatAll(): void {
  for (const c of clients) {
    try {
      c.res.write(": hb\n\n");
    } catch {
      clients.delete(c);
    }
  }
}
