import type { ServerResponse } from "node:http";
import type { LiveEvent } from "../shared/api";

interface Stream {
  res: ServerResponse;
  userId: string;
}

const streams = new Map<string, Set<Stream>>();

function write(stream: Stream, event: LiveEvent): void {
  const { type, ...data } = event;
  stream.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Opens a server-sent event stream for one tab; `onClose` runs once when the socket ends. */
export function openStream(res: ServerResponse, notebookId: string, userId: string, onClose: () => void): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const stream: Stream = { res, userId };
  const set = streams.get(notebookId) ?? new Set<Stream>();
  set.add(stream);
  streams.set(notebookId, set);
  write(stream, { type: "ready" });
  const beat = setInterval(() => res.write(": keep-alive\n\n"), 15000);
  res.on("close", () => {
    clearInterval(beat);
    set.delete(stream);
    if (set.size === 0) streams.delete(notebookId);
    onClose();
  });
}

export function publish(notebookId: string, event: LiveEvent): void {
  for (const stream of streams.get(notebookId) ?? []) write(stream, event);
}

/** Tells a person their access ended and closes their streams for that notebook. */
export function revokeAccess(notebookId: string, userId: string): void {
  for (const stream of [...(streams.get(notebookId) ?? [])]) {
    if (stream.userId !== userId) continue;
    write(stream, { type: "access_revoked" });
    stream.res.end();
  }
}

/** Closes every stream of a notebook, as when it is deleted. */
export function closeNotebook(notebookId: string): void {
  for (const stream of [...(streams.get(notebookId) ?? [])]) {
    write(stream, { type: "access_revoked" });
    stream.res.end();
  }
}
