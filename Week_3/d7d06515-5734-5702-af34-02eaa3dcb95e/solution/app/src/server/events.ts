// Live updates: publishing to Valkey, server-sent event streams, presence, and the once-a-second time-edge ticker.
import type { ServerResponse } from 'node:http';
import { authorizeDrawing, linkStatus, requireUser, trialState, type DrawingAccess } from './access.ts';
import { clockedNow } from './clock.ts';
import { query } from './db.ts';
import { registerRoute, validation, type Context } from './http.ts';
import { collaborators, dropTab, readTabs, refreshTab, touchTab, type Person } from './presence.ts';
import { onProviderChange, providerUp, type ProviderName } from './providers.ts';
import { commands, onMessage } from './valkey.ts';

type DrawingMessageType = 'change' | 'presence' | 'link' | 'trace' | 'issues' | 'activity' | 'trial';
type AccountMessageType = 'files' | 'recent' | 'trial';

const HEARTBEAT_MS = 15000;
const TAB_REFRESH_MS = 9000;
const TICK_MS = 1000;
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FORWARDED = new Set<string>(['change', 'trace', 'issues', 'activity', 'trial', 'files', 'recent']);

interface Trial { confirmedAt: Date | null; zone: string }

interface Stream {
  res: ServerResponse;
  workspaceId: string;
  trialOf: Trial;
  /** The last JSON sent per state event, so a value is never pushed twice. */
  sent: Map<string, string>;
}

interface DrawingStream extends Stream {
  drawingId: string;
  person: Person;
  tabId: string | null;
  shareId: string | null;
}

interface AccountStream extends Stream {
  userId: string;
}

const drawingStreams = new Map<string, Set<DrawingStream>>();
const accountStreams = new Map<string, Set<AccountStream>>();

async function publish(channel: string, message: object): Promise<boolean> {
  try {
    await commands.publish(channel, JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

/** Resolves false when Valkey did not take the message. */
export function publishDrawing(drawingId: string, message: { type: DrawingMessageType } & Record<string, unknown>): Promise<boolean> {
  return publish(`drawing:${drawingId}`, message);
}

export function publishAccount(userId: string, message: { type: AccountMessageType } & Record<string, unknown>): Promise<boolean> {
  return publish(`account:${userId}`, message);
}

function write(stream: Stream, event: string, data: unknown): void {
  if (!stream.res.writableEnded && !stream.res.destroyed) stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Pushes a state event unless the stream already holds exactly this value. */
function pushState(stream: Stream, event: string, data: unknown): void {
  const json = JSON.stringify(data);
  if (stream.sent.get(event) === json) return;
  stream.sent.set(event, json);
  write(stream, event, data);
}

const syncData = (): { state: 'live' | 'paused'; storage: 'up' | 'down' } =>
  ({ state: providerUp('valkey') ? 'live' : 'paused', storage: providerUp('minio') ? 'up' : 'down' });

function leave(stream: DrawingStream | AccountStream): void {
  if ('drawingId' in stream) {
    const group = drawingStreams.get(stream.drawingId);
    if (!group?.delete(stream)) return;
    if (group.size === 0) drawingStreams.delete(stream.drawingId);
    if (stream.tabId) {
      void dropTab(stream.drawingId, stream.tabId).then(() => publishDrawing(stream.drawingId, { type: 'presence' }));
    }
  } else {
    const group = accountStreams.get(stream.userId);
    group?.delete(stream);
    if (group?.size === 0) accountStreams.delete(stream.userId);
  }
  if (!stream.res.writableEnded) stream.res.end();
}

function pushLink(stream: DrawingStream, status: string): void {
  pushState(stream, 'link', { status });
  if (status !== 'active') leave(stream);
}

function relay(channel: string, payload: string): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return;
  }
  const { type, ...data } = parsed;
  if (typeof type !== 'string') return;
  const [kind, id = ''] = channel.split(/:(.*)/s);
  if (kind === 'account') {
    for (const stream of accountStreams.get(id) ?? []) {
      if (type === 'trial') pushState(stream, type, data);
      else if (FORWARDED.has(type)) write(stream, type, data);
    }
    return;
  }
  const streams = drawingStreams.get(id);
  if (!streams) return;
  if (type === 'presence') {
    void evaluateTimeEdges();
  } else if (type === 'link') {
    for (const stream of streams) if (stream.shareId === data.share_id) pushLink(stream, String(data.status));
  } else if (FORWARDED.has(type)) {
    for (const stream of streams) {
      if (type === 'trial') pushState(stream, type, data);
      else write(stream, type, data);
    }
  }
}

onMessage(relay);

function openStream(ctx: Context): void {
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  ctx.req.socket.setNoDelay(true);
  ctx.res.flushHeaders();
  ctx.res.write('retry: 1000\n\n');
}

function ownerTrial(da: DrawingAccess): Trial {
  return { confirmedAt: da.ownerConfirmedAt, zone: da.zone };
}

const person = (da: DrawingAccess): Person => ({ actor: da.actor.key, name: da.actor.name, access: da.access });

async function streamDrawing(ctx: Context): Promise<void> {
  const da = await authorizeDrawing(ctx, ctx.params.id ?? '');
  const tab = ctx.query.get('tab');
  const stream: DrawingStream = {
    res: ctx.res,
    workspaceId: da.workspaceId,
    trialOf: ownerTrial(da),
    sent: new Map(),
    drawingId: da.drawing.id,
    person: person(da),
    tabId: tab && TAB_ID.test(tab) ? tab : null,
    shareId: ctx.caller?.kind === 'link' ? ctx.caller.share.id : null,
  };
  openStream(ctx);
  const group = drawingStreams.get(stream.drawingId) ?? new Set();
  group.add(stream);
  drawingStreams.set(stream.drawingId, group);
  ctx.res.on('close', () => leave(stream));
  if (stream.tabId && await touchTab(stream.drawingId, stream.tabId, stream.person, da.now, false)) {
    await publishDrawing(stream.drawingId, { type: 'presence' });
  }
  pushState(stream, 'sync', syncData());
  pushState(stream, 'presence', { collaborators: collaborators(providerUp('valkey') ? await readTabs(stream.drawingId) : [], da.now, stream.person.actor) });
  pushState(stream, 'trial', da.trial);
  if (stream.shareId) pushState(stream, 'link', { status: 'active' });
}

async function streamAccount(ctx: Context): Promise<void> {
  const user = requireUser(ctx);
  const stream: AccountStream = {
    res: ctx.res,
    workspaceId: user.workspace_id,
    trialOf: { confirmedAt: user.confirmed_at, zone: user.time_zone },
    sent: new Map(),
    userId: user.id,
  };
  openStream(ctx);
  const group = accountStreams.get(user.id) ?? new Set();
  group.add(stream);
  accountStreams.set(user.id, group);
  evaluateSoon();
  ctx.res.on('close', () => leave(stream));
}

function tabId(value: unknown): string | null {
  return typeof value === 'string' && TAB_ID.test(value) ? value : null;
}

export function registerEventRoutes(): void {
  registerRoute('GET', '/api/drawings/:id/events', async (ctx) => { await streamDrawing(ctx); });
  registerRoute('GET', '/api/events', async (ctx) => { await streamAccount(ctx); });
  registerRoute('POST', '/api/drawings/:id/presence', async (ctx) => {
    const da = await authorizeDrawing(ctx, ctx.params.id ?? '');
    const id = tabId((await ctx.json()).tab_id);
    if (!id) throw validation({ tab_id: 'Enter a tab id.' });
    if (await touchTab(da.drawing.id, id, person(da), da.now, true)) await publishDrawing(da.drawing.id, { type: 'presence' });
    return { status: 204 };
  });
}

interface WorkspaceClock { id: string; clock_base: Date | null; clock_set_at: Date | null }

/** Re-evaluates trial, link status and presence for every open stream; pushes only what changed. */
async function evaluate(): Promise<void> {
  const drawings = [...drawingStreams.values()].flatMap((group) => [...group]);
  const accounts = [...accountStreams.values()].flatMap((group) => [...group]);
  if (drawings.length + accounts.length === 0) return;
  const workspaceIds = [...new Set([...drawings, ...accounts].map((stream) => stream.workspaceId))];
  const clocks = await query<WorkspaceClock>('SELECT id, clock_base, clock_set_at FROM workspaces WHERE id = ANY($1::uuid[])', [workspaceIds]);
  const nowOf = new Map(clocks.map((row) => [row.id, clockedNow(row)]));
  const now = (stream: Stream): Date => nowOf.get(stream.workspaceId) ?? new Date();

  for (const stream of [...drawings, ...accounts]) {
    pushState(stream, 'trial', trialState(stream.trialOf.confirmedAt, stream.trialOf.zone, now(stream)));
  }

  const linked = drawings.filter((stream) => stream.shareId);
  if (linked.length > 0) {
    const shares = await query<{ id: string; revoked_at: Date | null; expires_at: Date | null }>(
      'SELECT id, revoked_at, expires_at FROM shares WHERE id = ANY($1::uuid[])',
      [linked.map((stream) => stream.shareId)],
    );
    const byId = new Map(shares.map((share) => [share.id, share]));
    for (const stream of linked) {
      const share = byId.get(stream.shareId ?? '');
      if (share) pushLink(stream, linkStatus(share, now(stream)));
    }
  }

  for (const [drawingId, group] of drawingStreams) {
    const tabs = providerUp('valkey') ? await readTabs(drawingId) : [];
    for (const stream of group) {
      pushState(stream, 'presence', { collaborators: collaborators(tabs, now(stream), stream.person.actor) });
    }
  }
}

let evaluating = false;
let rerun = false;

/** Runs one evaluation now; a call made while one is running schedules exactly one more. */
export async function evaluateTimeEdges(): Promise<void> {
  if (evaluating) {
    rerun = true;
    return;
  }
  evaluating = true;
  try {
    do {
      rerun = false;
      await evaluate();
    } while (rerun);
  } catch (error) {
    process.stdout.write(`time-edge evaluation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  } finally {
    evaluating = false;
  }
}

const evaluateSoon = (): void => { void evaluateTimeEdges(); };

async function keepAlive(heartbeat: boolean, refresh: boolean): Promise<void> {
  for (const group of drawingStreams.values()) {
    for (const stream of group) {
      if (heartbeat && !stream.res.writableEnded) stream.res.write(': ping\n\n');
      if (refresh && stream.tabId && providerUp('valkey')) {
        const alive = await refreshTab(stream.drawingId, stream.tabId);
        if (!alive) await touchTab(stream.drawingId, stream.tabId, stream.person, new Date(), false);
      }
    }
  }
  if (heartbeat) {
    for (const group of accountStreams.values()) for (const stream of group) if (!stream.res.writableEnded) stream.res.write(': ping\n\n');
  }
}

function onProvider(name: ProviderName, up: boolean): void {
  if (name !== 'valkey' && name !== 'minio') return;
  for (const group of drawingStreams.values()) for (const stream of group) pushState(stream, 'sync', syncData());
  if (name === 'valkey' && up) {
    for (const group of drawingStreams.values()) {
      for (const stream of group) if (stream.tabId) void touchTab(stream.drawingId, stream.tabId, stream.person, new Date(), false);
    }
    evaluateSoon();
  }
}

let lastHeartbeat = Date.now();
let lastRefresh = Date.now();
let timer: NodeJS.Timeout | undefined;

export function startEvents(): void {
  onProviderChange(onProvider);
  const tick = async (): Promise<void> => {
    const at = Date.now();
    const heartbeat = at - lastHeartbeat >= HEARTBEAT_MS;
    const refresh = at - lastRefresh >= TAB_REFRESH_MS;
    if (heartbeat) lastHeartbeat = at;
    if (refresh) lastRefresh = at;
    try {
      await keepAlive(heartbeat, refresh);
      await evaluateTimeEdges();
    } finally {
      timer = setTimeout(() => void tick(), TICK_MS);
    }
  };
  timer = setTimeout(() => void tick(), TICK_MS);
}

export function stopEvents(): void {
  clearTimeout(timer);
  for (const group of [...drawingStreams.values()]) for (const stream of [...group]) stream.res.end();
  for (const group of [...accountStreams.values()]) for (const stream of [...group]) stream.res.end();
}
