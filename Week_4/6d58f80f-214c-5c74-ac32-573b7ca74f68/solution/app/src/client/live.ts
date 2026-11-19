// The live connection to GET /api/events: reconnects within a second or two after a drop and asks every open
// screen to refetch (brief: Browser support and performance).
import { Bus } from "./store";
import type { EventMessage } from "../shared/api";

type Messages = { [M in EventMessage as M["type"]]: M["data"] } & { reconnected: null; signedOut: null };

export const events = new Bus<Messages>();
// Every message kind the server sends; typed so a new kind in EventMessage must be added here too.
const KINDS: Record<EventMessage["type"], true> = {
  status: true, day: true, files: true, moved: true, folders: true, grants: true, access: true, handovers: true, policies: true, upload: true,
};

/** A message of a known kind with an object payload; anything else (bad JSON, null, an unknown kind) is dropped. */
function readMessage(text: string): EventMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { type, data } = parsed as { type?: unknown; data?: unknown };
  if (typeof type !== "string" || !Object.hasOwn(KINDS, type) || typeof data !== "object" || data === null) return null;
  return parsed as EventMessage;
}

let socket: WebSocket | null = null;
let stopped = true;
let everOpened = false;

function open(): void {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/events`);
  socket = ws;
  ws.addEventListener("open", () => {
    if (everOpened) events.emit("reconnected", null);
    everOpened = true;
  });
  ws.addEventListener("message", (event: MessageEvent<string>) => {
    const message = readMessage(event.data);
    if (message) (events.emit as (kind: string, data: unknown) => void)(message.type, message.data);
  });
  ws.addEventListener("close", (event) => {
    if (socket !== ws) return;
    socket = null;
    if (event.code === 4001) {
      events.emit("signedOut", null);
      return;
    }
    if (!stopped) setTimeout(() => !stopped && !socket && open(), 1_000);
  });
}

export function startLive(): void {
  if (!stopped) return;
  stopped = false;
  everOpened = false;
  open();
}

export function stopLive(): void {
  stopped = true;
  socket?.close();
  socket = null;
}
