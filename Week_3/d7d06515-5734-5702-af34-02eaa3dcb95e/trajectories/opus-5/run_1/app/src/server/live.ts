import type { Collaborator } from '../shared/api';
import { config } from './config';
import {
  accountChannel,
  drawingChannel,
  listPresenceTabs,
  onAvailabilityChange,
  publish,
  refreshPresenceTab,
  subscribe,
  valkeyAvailable,
  type BusMessage,
} from './bus';
import { trialState, workspaceNow, type WorkspaceRecord } from './clock';
import { findUserById, findWorkspace } from './accounts';
import { findDrawingRecord } from './drawings';
import { shareStatus, type ShareRecord } from './shares';
import { STREAMING, type HandlerResult, type RequestContext } from './http';

class EventStream {
  private closed = false;

  constructor(private readonly context: RequestContext) {
    context.response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    context.response.write(': open\n\n');
    context.request.on('close', () => {
      this.closed = true;
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(event: string, data: unknown): void {
    if (this.closed) return;
    this.context.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.context.response.end();
  }
}

type Ticker = () => Promise<void>;

const tickers = new Set<Ticker>();

setInterval(() => {
  for (const ticker of [...tickers]) void ticker();
}, 1000).unref();

export async function publishDrawing(drawingId: string, message: BusMessage): Promise<void> {
  await publish(drawingChannel(drawingId), message);
}

export async function publishAccount(userId: string, message: BusMessage): Promise<void> {
  await publish(accountChannel(userId), message);
}

/** A person is Editing with owner or edit access and Viewing otherwise; Away after the idle window. */
export async function collaboratorsFor(
  drawingId: string,
  excludeActor: string | null,
  now: Date,
): Promise<Collaborator[]> {
  const tabs = await listPresenceTabs(drawingId);
  const byActor = new Map<string, { name: string; access: string; newestInput: number }>();
  for (const tab of tabs) {
    if (tab.actor === excludeActor) continue;
    const existing = byActor.get(tab.actor);
    if (existing === undefined || tab.last_input_at > existing.newestInput) {
      byActor.set(tab.actor, { name: tab.name, access: tab.access, newestInput: tab.last_input_at });
    }
  }
  return [...byActor.values()].map((person) => {
    const idleFor = (now.getTime() - person.newestInput) / 1000;
    const state: Collaborator['state'] =
      idleFor >= config.presenceIdleSeconds
        ? 'Away'
        : person.access === 'owner' || person.access === 'edit'
          ? 'Editing'
          : 'Viewing';
    return { name: person.name, state };
  });
}

export interface DrawingStreamOptions {
  drawingId: string;
  workspace: WorkspaceRecord;
  actorKey: string;
  share: ShareRecord | null;
  ownerUserId: string | null;
  tabId: string | null;
}

export function openDrawingStream(context: RequestContext, options: DrawingStreamOptions): HandlerResult {
  const stream = new EventStream(context);
  const unsubscribe = subscribe(drawingChannel(options.drawingId), (message) => {
    const type = message.type;
    if (typeof type !== 'string') return;
    const { type: _ignored, ...payload } = message;
    stream.send(type, payload);
  });

  let lastSync: 'live' | 'paused' | null = null;
  let lastPresence = '';
  let lastTrial = '';
  let lastLink = '';

  const pushSync = (): void => {
    const state = valkeyAvailable() ? 'live' : 'paused';
    if (state === lastSync) return;
    lastSync = state;
    stream.send('sync', { state });
  };
  const stopAvailability = onAvailabilityChange(() => pushSync());
  pushSync();

  const tick: Ticker = async () => {
    if (stream.isClosed) {
      cleanup();
      return;
    }
    if (options.tabId !== null) await refreshPresenceTab(options.drawingId, options.tabId);
    const workspace = (await findWorkspace(options.workspace.id)) ?? options.workspace;
    const now = workspaceNow(workspace);

    const collaborators = await collaboratorsFor(options.drawingId, options.actorKey, now);
    const presenceKey = JSON.stringify(collaborators);
    if (presenceKey !== lastPresence) {
      lastPresence = presenceKey;
      stream.send('presence', { collaborators });
    }

    if (options.ownerUserId !== null) {
      const owner = await findUserById(options.ownerUserId);
      const trial = trialState(owner?.confirmed_on ?? null, workspace);
      const trialKey = JSON.stringify(trial);
      if (trialKey !== lastTrial) {
        lastTrial = trialKey;
        stream.send('trial', trial);
      }
    }

    if (options.share !== null) {
      const status = shareStatus(options.share, workspace, now);
      if (status !== lastLink) {
        lastLink = status;
        stream.send('link', { status });
      }
    }
    pushSync();
  };

  const cleanup = (): void => {
    tickers.delete(tick);
    unsubscribe();
    stopAvailability();
    stream.end();
  };

  tickers.add(tick);
  void tick();
  return STREAMING;
}

export function openAccountStream(context: RequestContext, userId: string, workspaceId: string): HandlerResult {
  const stream = new EventStream(context);
  const unsubscribe = subscribe(accountChannel(userId), (message) => {
    const type = message.type;
    if (typeof type !== 'string') return;
    const { type: _ignored, ...payload } = message;
    stream.send(type, payload);
  });

  let lastTrial = '';
  const tick: Ticker = async () => {
    if (stream.isClosed) {
      tickers.delete(tick);
      unsubscribe();
      stream.end();
      return;
    }
    const workspace = await findWorkspace(workspaceId);
    const user = await findUserById(userId);
    if (workspace === null || user === null) return;
    const trial = trialState(user.confirmed_on, workspace);
    const trialKey = JSON.stringify(trial);
    if (trialKey !== lastTrial) {
      lastTrial = trialKey;
      stream.send('trial', trial);
    }
  };
  tickers.add(tick);
  void tick();
  return STREAMING;
}

/** Tells every open tab of the account that its file list changed. */
export async function announceFiles(userId: string, folderId: string | null): Promise<void> {
  await publishAccount(userId, { type: 'files', folder_id: folderId });
}

export async function announceRecent(userId: string): Promise<void> {
  await publishAccount(userId, { type: 'recent' });
}

export async function drawingOwnerUserId(drawingId: string): Promise<string | null> {
  const drawing = await findDrawingRecord(drawingId);
  return drawing?.owner_user_id ?? null;
}
