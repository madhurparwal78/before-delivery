// The one server-event store. `GET /api/events` is opened while a user is signed in; each event is applied to the
// store inside the message handler itself, with no timer. Business time is whatever the server says: `serverNow`
// comes from `clock` events and nothing here reads the device clock.
import { useSyncExternalStore } from 'react';
import type { Extract, ExportStatus } from '../../shared/model.ts';

/** What an `extract` event carries: the extract state without the row count. */
export type ExtractInfo = Omit<Extract, 'rows'>;

interface ExportProgress {
  status: ExportStatus;
  progress: 0 | 50 | 100;
}

interface EventsState {
  serverNow: string | null;
  unread: number;
  extracts: Readonly<Record<string, ExtractInfo>>;
  exports: Readonly<Record<string, ExportProgress>>;
}

const empty: EventsState = { serverNow: null, unread: 0, extracts: {}, exports: {} };

let state = empty;
let stream: EventSource | null = null;
const listeners = new Set<() => void>();

function update(next: Partial<EventsState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function payload<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

export function setExtract(source: string, extract: ExtractInfo): void {
  update({ extracts: { ...state.extracts, [source]: extract } });
}

/** A page's own read of an extract, kept only until the stream says something about that source. */
export function seedExtract(source: string, extract: ExtractInfo): void {
  if (!state.extracts[source]) setExtract(source, extract);
}

export function setUnread(unread: number): void {
  update({ unread });
}

/** Forgets what the last export event said about a job, as when it is retried. */
export function forgetExport(id: string): void {
  const { [id]: _gone, ...rest } = state.exports;
  update({ exports: rest });
}

export function connectEvents(): void {
  if (stream) return;
  stream = new EventSource('/api/events');
  stream.addEventListener('clock', (event) => update({ serverNow: payload<{ server_now: string }>(event).server_now }));
  stream.addEventListener('extract', (event) => {
    const { source, ...extract } = payload<{ source: string } & ExtractInfo>(event);
    setExtract(source, extract);
  });
  stream.addEventListener('export', (event) => {
    const { id, status, progress } = payload<{ id: string } & ExportProgress>(event);
    update({ exports: { ...state.exports, [id]: { status, progress } } });
  });
  stream.addEventListener('inbox', (event) => update({ unread: payload<{ unread: number }>(event).unread }));
}

export function disconnectEvents(): void {
  stream?.close();
  stream = null;
  update(empty);
}

export function useUnread(): number {
  return useSyncExternalStore(subscribe, () => state.unread);
}

/** The newest extract state of a source this user can read, or undefined before the server has reported it. */
export function useExtract(source: string): ExtractInfo | undefined {
  return useSyncExternalStore(subscribe, () => state.extracts[source]);
}

export function useExportProgress(id: string | null): ExportProgress | undefined {
  return useSyncExternalStore(subscribe, () => (id ? state.exports[id] : undefined));
}
