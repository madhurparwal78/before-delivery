import { noteServerDate } from "./api";
import { loadChannels, loadHistory, noteReceived } from "./data";
import { getState, notify, placeMessage, putEntries, removeMessage, revokeChannel, upsertChannel } from "./store";
import type { Channel, Message } from "./types";

// The one live event stream. It remembers the id of the last event applied, reconnects within
// a second of a drop (at once when the network returns) naming that id, and applies replayed
// events in order. The first connection opens with the shell and then refetches what is shown,
// so nothing logged before it opened is missed.

type Handlers = {
  onSessionEnded: () => void;
  onReset: () => void;
  onEvent: (name: string, data: unknown) => void;
};

const RETRY_MS = 1_000;
const PAUSED_NOTICE_MS = 5_000;

let lastId: string | null = null;
let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pausedTimer: ReturnType<typeof setTimeout> | null = null;
let fresh = true;
let dropped = false;
let running = false;
let handlers: Handlers | null = null;

function apply(name: string, data: unknown): void {
  switch (name) {
    case "message.created": {
      const { message } = data as { message: Message };
      placeMessage(message);
      noteReceived([message]);
      break;
    }
    case "message.updated": {
      const { message } = data as { message: Message };
      if (getState().entries[message.id]) putEntries([message]);
      break;
    }
    case "message.deleted":
      removeMessage((data as { message_id: string }).message_id);
      break;
    case "receipts.updated": {
      const counts = data as { message_id: string; recipient_count: number; delivered_count: number; read_count: number };
      const entry = getState().entries[counts.message_id];
      if (entry && !entry.deleted) {
        putEntries([{ ...entry, recipient_count: counts.recipient_count, delivered_count: counts.delivered_count, read_count: counts.read_count }]);
      }
      break;
    }
    case "channel.updated":
    case "channel.added":
      upsertChannel((data as { channel: Channel }).channel);
      break;
    case "channel.revoked":
      revokeChannel((data as { channel_id: string }).channel_id);
      break;
    case "stream.reset":
      handlers?.onReset();
      break;
    case "session.ended":
      stop();
      handlers?.onSessionEnded();
      return;
  }
  handlers?.onEvent(name, data);
}

function lostConnection(): void {
  controller?.abort();
  controller = null;
  if (!running) return;
  if (!dropped) {
    dropped = true;
    pausedTimer = setTimeout(() => {
      if (dropped) notify("Live updates paused. Reconnecting.");
    }, PAUSED_NOTICE_MS);
  }
  if (retryTimer === null) retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, RETRY_MS);
}

function connected(): void {
  if (!dropped) return;
  dropped = false;
  if (pausedTimer !== null) clearTimeout(pausedTimer);
  pausedTimer = null;
  notify("Live updates resumed.");
}

async function connect(): Promise<void> {
  if (!running || controller) return;
  if (!navigator.onLine) {
    lostConnection();
    return;
  }
  const own = new AbortController();
  controller = own;
  try {
    const response = await fetch("/api/events", {
      headers: lastId === null ? { Accept: "text/event-stream" } : { Accept: "text/event-stream", "Last-Event-ID": lastId },
      credentials: "same-origin",
      signal: own.signal,
    });
    noteServerDate(response.headers.get("date"));
    if (response.status === 401) {
      stop();
      handlers?.onSessionEnded();
      return;
    }
    if (!response.ok || !response.body) throw new Error("stream refused");
    connected();
    if (fresh) {
      fresh = false;
      handlers?.onReset();
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let block: { id?: string; event?: string; data: string[] } = { data: [] };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line === "") {
          if (block.id !== undefined) lastId = block.id;
          if (block.event !== undefined) apply(block.event, block.data.length > 0 ? JSON.parse(block.data.join("\n")) : null);
          block = { data: [] };
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const raw = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "id") block.id = raw;
          else if (field === "event") block.event = raw;
          else if (field === "data") block.data.push(raw);
        }
        newline = buffer.indexOf("\n");
      }
    }
  } catch {
    // Dropped or refused; reconnect below.
  }
  if (controller === own) {
    controller = null;
    lostConnection();
  }
}

function onOffline(): void {
  lostConnection();
}

function onOnline(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  void connect();
}

export function startLive(next: Handlers): void {
  handlers = next;
  if (running) return;
  running = true;
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  void connect();
}

export function stop(): void {
  running = false;
  window.removeEventListener("offline", onOffline);
  window.removeEventListener("online", onOnline);
  controller?.abort();
  controller = null;
  for (const timer of [retryTimer, pausedTimer]) if (timer !== null) clearTimeout(timer);
  retryTimer = pausedTimer = null;
  dropped = false;
  fresh = true;
  lastId = null;
}

// stream.reset: everything shown is fetched again.
export async function resync(openChannelId: string | null): Promise<void> {
  await loadChannels();
  if (openChannelId) await loadHistory(openChannelId);
}
