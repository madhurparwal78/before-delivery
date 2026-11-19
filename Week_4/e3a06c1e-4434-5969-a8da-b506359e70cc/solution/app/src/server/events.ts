// Session events travel through Postgres NOTIFY, so a viewer on any instance sees a session owned
// by any other. One ordered notifier connection publishes; one listener connection fans out.
import pg from "pg";
import { config } from "./config";
import { isRecord } from "../shared/guards";

export type SessionEvent =
  | { event: "state"; data: { state: string; close_reason: string | null } }
  | { event: "frame"; data: { frame: number; audio_ms: number; peak_bin: number; bins: number[] } }
  | { event: "segment"; data: { segment_id: string } }
  | { event: "correction"; data: { segment_id: string } };

const CHANNEL = "lowfield_session_events";
type Listener = (message: SessionEvent) => void;
const listeners = new Map<string, Set<Listener>>();

let notifier: pg.Client | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function connect(onNotify?: (payload: string) => void): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  if (onNotify) {
    client.on("notification", (message) => message.payload && onNotify(message.payload));
    await client.query(`LISTEN ${CHANNEL}`);
  }
  return client;
}

const isNumber = (value: unknown): value is number => typeof value === "number";

/** The event carried by a notification published through `publish`. */
function sessionEventOf(value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  switch (value.event) {
    case "state":
      return typeof data.state === "string" && (data.close_reason === null || typeof data.close_reason === "string")
        ? { event: "state", data: { state: data.state, close_reason: data.close_reason } }
        : null;
    case "frame":
      return isNumber(data.frame) && isNumber(data.audio_ms) && isNumber(data.peak_bin) && Array.isArray(data.bins) && data.bins.every(isNumber)
        ? { event: "frame", data: { frame: data.frame, audio_ms: data.audio_ms, peak_bin: data.peak_bin, bins: data.bins } }
        : null;
    case "segment":
    case "correction":
      return typeof data.segment_id === "string" ? { event: value.event, data: { segment_id: data.segment_id } } : null;
    default:
      return null;
  }
}

function dispatch(payload: string): void {
  let envelope: unknown;
  try {
    envelope = JSON.parse(payload);
  } catch {
    return;
  }
  if (!isRecord(envelope) || typeof envelope.session !== "string") return;
  const message = sessionEventOf(envelope.message);
  if (!message) return;
  for (const listener of listeners.get(envelope.session) ?? []) listener(message);
}

/** Listens for session events, reconnecting a second after the connection drops. */
export async function startEvents(): Promise<void> {
  try {
    const client = await connect(dispatch);
    client.on("error", () => undefined);
    client.on("end", () => setTimeout(startEvents, 1000));
  } catch {
    setTimeout(startEvents, 1000);
  }
}

export function publish(session: string, message: SessionEvent): void {
  const payload = JSON.stringify({ session, message });
  queue = queue
    .then(async () => {
      if (!notifier) {
        notifier = await connect();
        notifier.on("error", () => (notifier = null));
        notifier.on("end", () => (notifier = null));
      }
      await notifier.query("SELECT pg_notify($1, $2)", [CHANNEL, payload]);
    })
    .catch(() => {
      notifier = null;
    });
}

export function subscribe(session: string, listener: Listener): () => void {
  const set = listeners.get(session) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(session, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(session);
  };
}
