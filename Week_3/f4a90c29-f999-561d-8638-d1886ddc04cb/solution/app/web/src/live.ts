import { announce } from "./status";
import { bump, connection$, draft$, loadBase, loadMe, prints$, reminders$ } from "./state";
import { syncClock } from "./time";
import type { LiveMessage, Print } from "./types";

let socket: WebSocket | null = null;
let lastSeq: number | null = null;
let stopped = true;
const seen = new Set<string>();

function announceOnce(id: string, text: string): void {
  if (seen.has(id)) return;
  seen.add(id);
  announce(text);
}

function noticeOf(data: Record<string, unknown>): { id: string; text: string } | null {
  const n = data.notice as { id: string; text: string } | undefined;
  return n ?? null;
}

function handle(message: LiveMessage): void {
  lastSeq = message.seq;
  const data = message.data;
  switch (message.type) {
    case "event.changed":
      if ("draft" in data) {
        draft$.set({ loaded: true, draft: (data.draft as Record<string, unknown> | null) ?? null });
        return;
      }
      if ("me" in data) {
        void loadMe();
        bump();
        return;
      }
      break;
    case "decision":
      announceOnce("decision:" + String(data.decision_id), String(data.text));
      break;
    case "share.changed":
      announceOnce("notice:" + String(data.notice_id), String(data.text));
      void loadBase();
      break;
    case "zone_rule.recorded":
      break;
    case "reminder.fired": {
      const notice = noticeOf(data);
      const reminder = data.reminder as { id: string; occurrence_id: string; title: string };
      if (notice) {
        reminders$.set((list) => [...list.filter((r) => r.id !== reminder.id), { ...reminder, text: notice.text }]);
        announceOnce("notice:" + notice.id, notice.text);
      }
      return;
    }
    case "print.changed": {
      const print = data.print as Print;
      prints$.set((list) => [print, ...list.filter((p) => p.id !== print.id)]);
      return;
    }
    default:
      break;
  }
  const notice = noticeOf(data);
  if (notice) announceOnce("notice:" + notice.id, notice.text);
  bump();
}

function connect(): void {
  if (stopped) return;
  const query = lastSeq === null ? "" : `?after=${lastSeq}`;
  const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/live${query}`);
  socket = ws;
  let healthy: ReturnType<typeof setTimeout> | undefined;
  ws.onopen = () => {
    void syncClock();
    void loadBase();
    bump();
    healthy = setTimeout(() => connection$.set({ reconnecting: false }), 300);
  };
  ws.onmessage = (event) => handle(JSON.parse(event.data as string) as LiveMessage);
  ws.onclose = () => {
    clearTimeout(healthy);
    if (socket !== ws) return;
    connection$.set({ reconnecting: true });
    setTimeout(connect, 1000);
  };
}

export function startLive(): void {
  if (!stopped) return;
  stopped = false;
  connect();
}

export function stopLive(): void {
  stopped = true;
  socket?.close();
  socket = null;
  lastSeq = null;
  connection$.set({ reconnecting: false });
}
