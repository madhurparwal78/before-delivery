import type { LiveEvent } from "./types";

type Handler = (event: LiveEvent) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;
let everOpened = false;

export function onLive(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function dispatch(event: LiveEvent): void {
  for (const handler of [...handlers]) handler(event);
}

/** Opens the one live stream of this page; after a drop it asks every page to resynchronise. */
export function startLive(): void {
  if (source) return;
  source = new EventSource("/api/events");
  source.onopen = () => {
    if (everOpened) dispatch({ t: "resync" });
    everOpened = true;
  };
  source.onmessage = (message) => dispatch(JSON.parse(message.data) as LiveEvent);
}

export function stopLive(): void {
  source?.close();
  source = null;
  everOpened = false;
}

/** Presence: a stream opened for one task is that person's "Viewing now" entry. */
export function viewTask(taskId: string): () => void {
  const stream = new EventSource(`/api/events?task=${encodeURIComponent(taskId)}`);
  return () => stream.close();
}
