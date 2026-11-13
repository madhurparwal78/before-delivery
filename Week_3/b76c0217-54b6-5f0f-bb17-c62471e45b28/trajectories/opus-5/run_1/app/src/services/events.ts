import type { ServerResponse } from 'node:http';
import { config } from '../config';

export type EventName =
  | 'navigation'
  | 'page'
  | 'presence'
  | 'report'
  | 'role'
  | 'invite'
  | 'analytics'
  | 'published';

interface Stream {
  readonly res: ServerResponse;
  readonly teamId: string | null;
  readonly userId: string | null;
  readonly userName: string | null;
  readonly versionId: string | null;
  readonly pageId: string | null;
  readonly siteSlug: string | null;
}

const streams = new Set<Stream>();

function write(stream: Stream, name: EventName, data: unknown): void {
  stream.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function send(name: EventName, data: unknown, pick: (stream: Stream) => boolean): void {
  for (const stream of streams) {
    if (pick(stream)) write(stream, name, data);
  }
}

export interface StreamOptions {
  res: ServerResponse;
  teamId?: string;
  userId?: string;
  userName?: string;
  versionId?: string;
  pageId?: string;
  siteSlug?: string;
}

export function openStream(options: StreamOptions): void {
  options.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  options.res.write(': open\n\n');
  const stream: Stream = {
    res: options.res,
    teamId: options.teamId ?? null,
    userId: options.userId ?? null,
    userName: options.userName ?? null,
    versionId: options.versionId ?? null,
    pageId: options.pageId ?? null,
    siteSlug: options.siteSlug ?? null,
  };
  streams.add(stream);
  const keepAlive = setInterval(() => stream.res.write(': ping\n\n'), 15000);
  const close = (): void => {
    clearInterval(keepAlive);
    if (!streams.delete(stream)) return;
    if (stream.pageId !== null) {
      setTimeout(() => emitPresence(stream.pageId as string), config.presenceTimeoutMs);
    }
  };
  options.res.on('close', close);
  if (stream.pageId !== null) emitPresence(stream.pageId);
}

export function emitNavigation(versionId: string, navigation: unknown): void {
  send('navigation', navigation, (stream) => stream.versionId === versionId);
}

export function emitPage(page: { id: string; versionId: string }): void {
  send(
    'page',
    page,
    (stream) =>
      stream.pageId === page.id || (stream.pageId === null && stream.versionId === page.versionId),
  );
}

export function emitPresence(pageId: string): void {
  const editors = new Map<string, { id: string; name: string }>();
  for (const stream of streams) {
    if (stream.pageId === pageId && stream.userId !== null && stream.userName !== null) {
      editors.set(stream.userId, { id: stream.userId, name: stream.userName });
    }
  }
  const data = { pageId, editors: [...editors.values()] };
  send('presence', data, (stream) => stream.pageId === pageId);
}

export function emitReport(versionId: string, report: unknown): void {
  send('report', report, (stream) => stream.versionId === versionId);
}

export function emitRole(teamId: string, data: { userId: string; role: string }): void {
  send('role', data, (stream) => stream.teamId === teamId);
}

export function emitInvite(teamId: string, invite: unknown): void {
  send('invite', invite, (stream) => stream.teamId === teamId);
}

export function emitAnalytics(teamId: string, siteId: string): void {
  send('analytics', { siteId }, (stream) => stream.teamId === teamId);
}

export function emitPublished(
  siteSlug: string,
  data: { versionId: string; snapshotId: string; changedPageIds: string[] },
): void {
  send('published', data, (stream) => stream.siteSlug === siteSlug);
}
