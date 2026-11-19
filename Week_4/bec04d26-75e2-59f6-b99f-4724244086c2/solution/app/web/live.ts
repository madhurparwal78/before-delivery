import { dateWords } from "../shared/calendar";
import type { LiveEvent, ReturnView, Role } from "../shared/types";
import { announce, PRIORITY } from "./announce";
import { ownActions } from "./api";
import { MAIL_BANNER, PDF_BANNER } from "./copy";
import { setApp } from "./store";
import LiveWorker from "./liveWorker?sharedworker";

type Handler = (event: LiveEvent) => void;

const handlers = new Set<Handler>();
const ownVersions = new Map<string, number>();
let source: EventSource | null = null;
let shared: MessagePort | null = null;

export function onLive(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Remembers the version this tab produced itself, so its own live echo is not announced twice. */
export function noteOwn(view: ReturnView): void {
  ownVersions.set(view.id, Math.max(ownVersions.get(view.id) ?? 0, view.version));
}

const label = (r: ReturnView): string => `${r.client.name} ${r.state} ${r.period_label}`;

function announceChange(event: Extract<LiveEvent, { type: "return" }>, role: Role): void {
  const r = event.return;
  const echoed = (ownVersions.get(r.id) ?? 0) >= r.version;
  switch (event.change) {
    case "prepared":
    case "filed":
    case "amended":
      if (!echoed) announce(`${label(r)} is now ${r.status_label}.`, PRIORITY.statusSaved);
      break;
    case "amounts":
      if (!echoed) announce(`Amounts saved for ${label(r)}.`, PRIORITY.amountsSaved);
      break;
    case "extended":
      if (!echoed) announce(`Extended to ${dateWords(r.due_date)}.`, PRIORITY.extensionGranted);
      break;
    case "approved":
      if (role === "bookkeeper") announce(`${event.by} approved ${r.state} ${r.period_label}.`, PRIORITY.approvalSeen);
      break;
    case "sent_back":
      if (role === "bookkeeper") announce(`${event.by} sent back ${r.state} ${r.period_label}.`, PRIORITY.approvalSeen);
      break;
    case "overdue":
      announce(`${label(r)} is overdue.`, PRIORITY.overdue);
      break;
    case "packet":
      announce(`Packet ready for ${label(r)}.`, PRIORITY.packetReady);
      break;
    case "recalculated":
    case "clock":
      break;
  }
}

function receive(event: LiveEvent, role: Role): void {
  handlers.forEach((handler) => handler(event));
  switch (event.type) {
    case "clock":
      setApp({ clock: event.clock });
      break;
    case "services":
      setApp({ services: event.services });
      if (!event.services.mail) announce(MAIL_BANNER, PRIORITY.banner);
      if (!event.services.pdf) announce(PDF_BANNER, PRIORITY.banner);
      break;
    case "return":
      announceChange(event, role);
      break;
    case "reminder":
      if (!event.cause || !ownActions.has(event.cause)) announce(`Reminder sent for ${event.client} ${event.state} ${event.period_label}.`, PRIORITY.reminderSent);
      break;
    case "lists":
    case "clients":
    case "states":
    case "practice":
      break;
  }
}

/**
 * The stream runs in a SharedWorker so the page holds no open request of its own (see liveWorker.ts); a browser
 * without SharedWorker reads the same stream from the page.
 */
export function startLive(role: Role, userId: string): void {
  if (source || shared) return;
  const refresh = (): void => handlers.forEach((handler) => handler({ type: "lists" }));
  if (typeof SharedWorker === "undefined") {
    let opened = false;
    source = new EventSource("/api/events");
    source.onmessage = (message) => receive(JSON.parse(message.data) as LiveEvent, role);
    source.onopen = () => {
      if (opened) refresh();
      opened = true;
    };
    return;
  }
  shared = new LiveWorker({ name: `duefield-live-${userId}` }).port;
  shared.onmessage = (message: MessageEvent<{ kind: "message"; data: string } | { kind: "reconnected" }>) => {
    if (message.data.kind === "reconnected") refresh();
    else receive(JSON.parse(message.data.data) as LiveEvent, role);
  };
}

export function stopLive(): void {
  source?.close();
  source = null;
  shared?.postMessage("stop");
  shared?.close();
  shared = null;
  ownVersions.clear();
}
