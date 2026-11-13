// The one WebSocket a page opens. It sends nothing before it opens and
// catches up by sequence number after a drop.

import type { EventRecord, Reminder } from "./api";
import { announce, announceOnce, state, changed } from "./state";

export type LiveMessage = {
  seq: number;
  type: string;
  data: Record<string, unknown>;
};

type Handler = (message: LiveMessage) => void;

const handlers = new Set<Handler>();
let socket: WebSocket | null = null;
let retry: number | null = null;

export function onLive(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  // A first connection names no sequence number: the page has just read the
  // whole state. A reconnect names its last one and catches up.
  const after = state.lastSeq > 0 ? `?after=${state.lastSeq}` : "";
  socket = new WebSocket(`${scheme}://${window.location.host}/api/live${after}`);
  socket.addEventListener("open", () => {
    state.connected = true;
    changed();
  });
  socket.addEventListener("message", (event) => {
    let message: LiveMessage;
    try {
      message = JSON.parse(String(event.data)) as LiveMessage;
    } catch {
      return;
    }
    if (message.seq > state.lastSeq) state.lastSeq = message.seq;
    deliver(message);
  });
  const lost = () => {
    if (!state.connected) return;
    state.connected = false;
    announce("Reconnecting. Changes will catch up.");
    changed();
    if (retry !== null) window.clearTimeout(retry);
    retry = window.setTimeout(connect, 1000);
  };
  socket.addEventListener("close", lost);
  socket.addEventListener("error", lost);
}

function deliver(message: LiveMessage): void {
  if (message.type === "decision") {
    const data = message.data as { decision_id: string; text: string };
    announceOnce(data.decision_id, data.text);
    void refreshNoticesSoon();
  }
  if (message.type === "reminder.fired") {
    const data = message.data as { reminder: Reminder; text: string };
    announce(data.text);
    firedReminders.set(data.reminder.id, data.reminder);
    void refreshNoticesSoon();
  }
  if (message.type === "share.changed") {
    const data = message.data as { text?: string };
    if (data.text) announce(data.text);
  }
  for (const handler of handlers) handler(message);
}

/** firedReminders holds every reminder still showing its own region. */
export const firedReminders = new Map<string, Reminder>();

let noticesPending = false;
async function refreshNoticesSoon(): Promise<void> {
  if (noticesPending) return;
  noticesPending = true;
  window.setTimeout(async () => {
    noticesPending = false;
    const { refreshNotices } = await import("./state");
    await refreshNotices();
  }, 50);
}

export type EventChange = { event_id: string; occurrence_id?: string; event?: EventRecord; removed?: boolean };
