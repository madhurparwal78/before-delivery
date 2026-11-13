/**
 * The live tail: one SSE per stream, rate limited per second (rule H).
 */
import type { Response } from "express";
import { config } from "./config";
import { nowMs } from "./clock";

interface TailClient {
  res: Response;
  streamId: string;
  second: number;
  sentThisSecond: number;
  skipped: number;
}

const clients = new Set<TailClient>();

export function addTailClient(res: Response, streamId: string): void {
  clients.add({ res, streamId, second: 0, sentThisSecond: 0, skipped: 0 });
}

export function removeTailClient(res: Response): void {
  for (const c of clients) {
    if (c.res === res) {
      clients.delete(c);
      return;
    }
  }
}

export interface TailLine {
  streamId: string;
  body: Record<string, unknown>;
}

/** Send one new event line to every tail of its stream, respecting the rate limit. */
export function tailLine(line: TailLine): void {
  const now = nowMs();
  const sec = Math.floor(now / 1000);
  const rate = config().settings.tail_rate;
  for (const c of clients) {
    if (c.streamId !== line.streamId) continue;
    if (c.second !== sec) {
      c.second = sec;
      c.sentThisSecond = 0;
      if (c.skipped > 0) {
        try {
          c.res.write(`event: slowed\ndata: ${JSON.stringify({ skipped: c.skipped })}\n\n`);
        } catch {
          clients.delete(c);
          continue;
        }
        c.skipped = 0;
      }
    }
    if (c.sentThisSecond >= rate) {
      c.skipped += 1;
      continue;
    }
    c.sentThisSecond += 1;
    try {
      c.res.write(`event: line\ndata: ${JSON.stringify(line.body)}\n\n`);
    } catch {
      clients.delete(c);
    }
  }
}

export function heartbeatTails(): void {
  for (const c of clients) {
    try {
      c.res.write(": hb\n\n");
    } catch {
      clients.delete(c);
    }
  }
}
