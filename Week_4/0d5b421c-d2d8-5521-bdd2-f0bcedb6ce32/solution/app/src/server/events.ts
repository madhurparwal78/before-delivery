// Live events: published after a change commits, replayable from Valkey for ten minutes,
// and fanned out to open pages through one reader per instance (never one connection per page).
import type { HostLiveEvent, LiveEvent, LiveEventType } from "../shared/api.js";
import { instantIso } from "./clock.js";
import { recordHolds } from "./dependencies.js";
import { lisbonDate, lisbonTime } from "./lisbon.js";
import { appendEvent, entriesAfter, eventStreamKey, key, lastEntryId, subscriber } from "./valkey.js";

export interface EventDetail {
  type: LiveEventType;
  startsAt: Date;
  tableIds: string[];
  partySize: number;
  reference?: string;
  name?: string;
  expiresAt?: Date;
}

/** Best effort: a change that commits while Valkey is unreachable publishes no event. */
export async function publishEvent(detail: EventDetail): Promise<void> {
  const event: HostLiveEvent = {
    type: detail.type,
    date: lisbonDate(detail.startsAt),
    time: lisbonTime(detail.startsAt),
    table_ids: detail.tableIds,
    party_size: detail.partySize,
    ...(detail.reference === undefined ? {} : { reference: detail.reference }),
    ...(detail.name === undefined ? {} : { name: detail.name }),
    ...(detail.expiresAt === undefined ? {} : { expires_at: instantIso(detail.expiresAt) }),
  };
  await appendEvent(event.date, JSON.stringify(event)).catch(() => recordHolds(false));
}

function publicProjection(event: HostLiveEvent): LiveEvent {
  return { type: event.type, date: event.date, time: event.time, table_ids: event.table_ids, party_size: event.party_size };
}

type Sink = (frame: string) => void;

interface Listener {
  date: string;
  host: boolean;
  sink: Sink;
  lastSent: string;
  ready: boolean;
}

const listeners = new Set<Listener>();

/** Stream ids are `<ms>-<sequence>`; they compare numerically in commit order. */
function after(id: string, other: string): boolean {
  const [ms = 0, seq = 0] = id.split("-").map(Number);
  const [otherMs = 0, otherSeq = 0] = other.split("-").map(Number);
  return ms > otherMs || (ms === otherMs && seq > otherSeq);
}

function frameOf(listener: Listener, id: string, data: string): string {
  const event = JSON.parse(data) as HostLiveEvent;
  return `id: ${id}\ndata: ${JSON.stringify(listener.host ? event : publicProjection(event))}\n\n`;
}

function deliver(listener: Listener, entries: { id: string; data: string }[]): void {
  for (const entry of entries) {
    if (!after(entry.id, listener.lastSent)) continue;
    listener.lastSent = entry.id;
    listener.sink(frameOf(listener, entry.id, entry.data));
  }
}

/** Opens a stream for a date: replays what Last-Event-ID missed, then follows live events. */
export async function openStream(date: string, host: boolean, sink: Sink, lastEventId: string | null): Promise<() => void> {
  const listener: Listener = { date, host, sink, lastSent: "0-0", ready: false };
  listeners.add(listener);
  sink("retry: 1000\n\n");
  try {
    if (lastEventId === null) listener.lastSent = (await lastEntryId(date)) ?? "0-0";
    else deliver(listener, await entriesAfter(date, /^\d+-\d+$/.test(lastEventId) ? lastEventId : null));
  } catch {
    recordHolds(false);
    listener.lastSent = `${Date.now()}-0`;
  }
  listener.ready = true;
  await follow(date);
  return () => listeners.delete(listener);
}

async function follow(date: string): Promise<void> {
  const open = [...listeners].filter((listener) => listener.date === date && listener.ready);
  if (open.length === 0) return;
  const oldest = open.reduce((low, listener) => (after(low, listener.lastSent) ? listener.lastSent : low), open[0]?.lastSent ?? "0-0");
  const entries = await entriesAfter(date, oldest).catch(() => []);
  for (const listener of open) deliver(listener, entries);
}

/** Subscribes once; the subscription is restored by itself whenever Valkey comes back. */
export function startEventReader(): void {
  const channelPrefix = key("events:");
  subscriber.on("pmessage", (_pattern: string, channel: string) => {
    void follow(channel.slice(channelPrefix.length));
  });
  void subscriber.psubscribe(eventStreamKey("*")).catch(() => undefined);
}

/** After Valkey answers again, open pages refresh what they missed. */
export function broadcastResync(): void {
  for (const listener of listeners) listener.sink("event: resync\ndata: {}\n\n");
}

export function keepOpen(): void {
  for (const listener of listeners) listener.sink(": keep-alive\n\n");
}
