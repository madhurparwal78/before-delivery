import { config } from './config';
import type { Sink } from './websocket';
import type { InviteJson, NavigationJson, PageJson, PublishReport, Role, UserRef } from '../shared/types';

interface EditorStream {
  sink: Sink;
  teamId: string;
  user: UserRef;
  role: Role;
  versionId: string | null;
  pageId: string | null;
}

export interface EditorEvents {
  navigation: NavigationJson;
  page: PageJson;
  presence: { pageId: string; editors: UserRef[] };
  report: PublishReport;
  role: { userId: string; role: Role };
  invite: InviteJson;
  analytics: { siteId: string };
}

const editors = new Set<EditorStream>();
const readers = new Map<string, Set<Sink>>();

function frame(event: string, data: unknown): string {
  return JSON.stringify({ event, data });
}

// Presence: an editor is present on a page while one of their streams for it is open, and for the presence
// timeout after the last one closes.
interface Presence {
  user: UserRef;
  streams: number;
  leaving: NodeJS.Timeout | null;
}
const presence = new Map<string, Map<string, Presence>>();

function presentOn(pageId: string): UserRef[] {
  return [...(presence.get(pageId)?.values() ?? [])].map((entry) => entry.user);
}

function broadcastPresence(pageId: string): void {
  const data = { pageId, editors: presentOn(pageId) };
  for (const stream of editors) {
    if (stream.pageId === pageId) {
      stream.sink.write(frame('presence', data));
    }
  }
}

function enter(pageId: string, user: UserRef): void {
  const onPage = presence.get(pageId) ?? new Map<string, Presence>();
  presence.set(pageId, onPage);
  const entry = onPage.get(user.id) ?? { user, streams: 0, leaving: null };
  if (entry.leaving) {
    clearTimeout(entry.leaving);
    entry.leaving = null;
  }
  entry.streams += 1;
  onPage.set(user.id, entry);
}

function leave(pageId: string, user: UserRef): void {
  const entry = presence.get(pageId)?.get(user.id);
  if (!entry) {
    return;
  }
  entry.streams -= 1;
  if (entry.streams === 0) {
    entry.leaving = setTimeout(() => {
      presence.get(pageId)?.delete(user.id);
      broadcastPresence(pageId);
    }, config.presenceTimeoutMs);
  }
}

export function openEditorStream(sink: Sink, stream: Omit<EditorStream, 'sink'>): void {
  const entry: EditorStream = { sink, ...stream };
  const { pageId } = entry;
  const present = entry.role !== 'viewer';
  editors.add(entry);
  if (pageId !== null) {
    if (present) {
      enter(pageId, entry.user);
    }
    broadcastPresence(pageId);
  }
  const beat = setInterval(() => sink.ping(), 15_000);
  sink.onClose(() => {
    clearInterval(beat);
    editors.delete(entry);
    if (pageId !== null && present) {
      leave(pageId, entry.user);
    }
  });
}

/** Send to the streams that follow a version, a page, or a whole team. */
export function emit<K extends keyof EditorEvents>(
  event: K,
  data: EditorEvents[K],
  audience: { teamId?: string; versionId?: string; pageId?: string },
): void {
  const text = frame(event, data);
  for (const stream of editors) {
    const reached =
      (audience.teamId !== undefined && stream.teamId === audience.teamId) ||
      (audience.versionId !== undefined && stream.versionId === audience.versionId) ||
      (audience.pageId !== undefined && stream.pageId === audience.pageId);
    if (reached) {
      stream.sink.write(text);
    }
  }
}

export function openReaderStream(sink: Sink, siteSlug: string): void {
  const open = readers.get(siteSlug) ?? new Set<Sink>();
  readers.set(siteSlug, open);
  open.add(sink);
  const beat = setInterval(() => sink.ping(), 15_000);
  sink.onClose(() => {
    clearInterval(beat);
    open.delete(sink);
  });
}

export function emitPublished(siteSlug: string, data: { versionId: string; snapshotId: string; changedPageIds: string[] }): void {
  for (const sink of readers.get(siteSlug) ?? []) {
    sink.write(frame('published', data));
  }
}
