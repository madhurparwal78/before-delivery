import type { ServerResponse } from "node:http";
import type { PoolClient } from "pg";
import { one, query } from "./db.ts";
import { purgeStale } from "./identity.ts";
import { limits } from "./config.ts";

export type LiveEvent =
  | { type: "cells"; cells: unknown[] }
  | { type: "cell_saved"; cells: unknown[] }
  | { type: "run_state"; cell_id: string; run_state: string; execution_count: number | null; outputs: unknown[]; outputs_version: number }
  | { type: "kernel_status"; kernel_status: string }
  | { type: "presence"; present: unknown[] }
  | { type: "lock"; cell_id: string; holder: string | null }
  | { type: "checkpoints"; checkpoints: unknown[] }
  | { type: "notebook"; notebook: unknown }
  | { type: "access_lost" };

type Subscriber = {
  notebookId: string;
  tabId: string;
  userId: string;
  send: (event: LiveEvent) => void;
  close: () => void;
};

const subscribers = new Map<number, Subscriber>();
let nextKey = 1;

export function subscribe(notebookId: string, tabId: string, userId: string, res: ServerResponse): void {
  const key = nextKey++;
  const send = (event: LiveEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": hello\n\n");
  const subscriber: Subscriber = { notebookId, tabId, userId, send, close: () => res.end() };
  subscribers.set(key, subscriber);
  res.on("close", () => {
    subscribers.delete(key);
    void dropTab(notebookId, tabId);
  });
  // Everyone present is shared with the new screen right away.
  void publishPresence(notebookId);
}

async function dropTab(notebookId: string, tabId: string): Promise<void> {
  await query("DELETE FROM presence WHERE notebook_id = $1 AND tab_id = $2", [notebookId, tabId]);
  await query("DELETE FROM locks WHERE notebook_id = $1 AND tab_id = $2", [notebookId, tabId]);
  await publishPresence(notebookId);
  await publishLocks(notebookId, null);
}

export function publish(notebookId: string, event: LiveEvent): void {
  for (const sub of subscribers.values()) {
    if (sub.notebookId === notebookId) {
      try {
        sub.send(event);
      } catch {
        // A dead stream is cleaned up by its own close handler.
      }
    }
  }
}

export async function publishPresence(notebookId: string): Promise<void> {
  await purgeStale(limits.presence_timeout_ms);
  const result = await query<{ tab_id: string; user_id: string; display_name: string; cell_id: string | null }>(
    "SELECT tab_id, user_id, display_name, cell_id FROM presence WHERE notebook_id = $1 ORDER BY display_name, tab_id",
    [notebookId],
  );
  publish(notebookId, { type: "presence", present: result.rows });
}

export async function publishLocks(notebookId: string, cellId: string | null): Promise<void> {
  if (cellId !== null) {
    const lock = await one<{ holder: string }>(
      "SELECT holder_display_name AS holder FROM locks WHERE notebook_id = $1 AND cell_id = $2",
      [notebookId, cellId],
    );
    publish(notebookId, { type: "lock", cell_id: cellId, holder: lock?.holder ?? null });
    return;
  }
  const locks = await query<{ cell_id: string; holder_display_name: string }>(
    "SELECT cell_id, holder_display_name FROM locks WHERE notebook_id = $1",
    [notebookId],
  );
  for (const row of locks.rows) {
    publish(notebookId, { type: "lock", cell_id: row.cell_id, holder: row.holder_display_name });
  }
}

export async function endStreamForUser(notebookId: string, userId: string): Promise<void> {
  for (const [key, sub] of [...subscribers.entries()]) {
    if (sub.notebookId === notebookId && sub.userId === userId) {
      sub.send({ type: "access_lost" });
      sub.close();
      subscribers.delete(key);
    }
  }
}

export function hasStreamsForUser(notebookId: string, userId: string): boolean {
  for (const sub of subscribers.values()) {
    if (sub.notebookId === notebookId && sub.userId === userId) return true;
  }
  return false;
}
