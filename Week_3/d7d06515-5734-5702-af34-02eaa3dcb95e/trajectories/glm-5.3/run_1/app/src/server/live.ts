import { valkey, valkeyState } from "./providers/valkey.js";

export type DrawingEventType =
  | "change"
  | "presence"
  | "link"
  | "trace"
  | "issues"
  | "activity"
  | "trial"
  | "sync"
  | "layer";

export interface SseClient {
  send: (event: string, data: unknown) => void;
  close: () => void;
}

interface DrawingSub {
  drawingId: string;
  client: SseClient;
  filter: "drawing" | "account";
  accountId?: string;
}

const drawingSubs = new Map<string, Set<DrawingSub>>();
const accountSubs = new Map<string, Set<SseClient>>();

export function drawingChannel(drawingId: string): string {
  return `drawing:${drawingId}`;
}

export function accountChannel(userId: string): string {
  return `account:${userId}`;
}

export function addDrawingSubscriber(drawingId: string, client: SseClient, filter: "drawing" | "account", accountId?: string): () => void {
  const sub: DrawingSub = { drawingId, client, filter, accountId };
  let set = drawingSubs.get(drawingId);
  if (!set) {
    set = new Set();
    drawingSubs.set(drawingId, set);
    // Once subscribed, the channel stays subscribed for this instance; the set
    // of drawings is bounded by what this instance has served.
    void valkey.ensureSubscribed(drawingChannel(drawingId));
  }
  set.add(sub);
  return () => {
    set?.delete(sub);
    if (set && set.size === 0) drawingSubs.delete(drawingId);
  };
}

export function addAccountSubscriber(accountId: string, client: SseClient): () => void {
  let set = accountSubs.get(accountId);
  if (!set) {
    set = new Set();
    accountSubs.set(accountId, set);
    void valkey.ensureSubscribed(accountChannel(accountId));
  }
  set.add(client);
  return () => {
    set?.delete(client);
    if (set && set.size === 0) accountSubs.delete(accountId);
  };
}

export function publishDrawingChange(drawingId: string, payload: Record<string, unknown>): void {
  void valkey.publish(drawingChannel(drawingId), JSON.stringify({ type: "change", ...payload }));
}

export function publishDrawingEvent(drawingId: string, type: DrawingEventType, payload: Record<string, unknown>): void {
  void valkey.publish(drawingChannel(drawingId), JSON.stringify({ type, ...payload }));
}

export function publishAccountEvent(accountId: string, type: string, payload: Record<string, unknown>): void {
  void valkey.publish(accountChannel(accountId), JSON.stringify({ type, ...payload }));
}

/** Relay Valkey messages to the open SSE streams on this instance. */
export function startRelay(): void {
  valkey.onMessage((channel, message) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    if (channel.startsWith("drawing:")) {
      const drawingId = channel.slice("drawing:".length);
      relayDrawing(drawingId, parsed);
    } else if (channel.startsWith("account:")) {
      const accountId = channel.slice("account:".length);
      relayAccount(accountId, parsed);
    }
  });
}

function relayDrawing(drawingId: string, message: Record<string, unknown>): void {
  const subs = drawingSubs.get(drawingId);
  if (!subs) return;
  for (const sub of subs) {
    if (sub.filter === "drawing") {
      sub.client.send(String(message.type ?? "change"), message);
    }
  }
}

function relayAccount(accountId: string, message: Record<string, unknown>): void {
  const subs = accountSubs.get(accountId);
  if (!subs) return;
  for (const client of subs) {
    client.send(String(message.type ?? "files"), message);
  }
}

export function syncState(): "live" | "paused" {
  return valkeyState.available ? "live" : "paused";
}
