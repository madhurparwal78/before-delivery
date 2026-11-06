import { COPY } from '../shared/copy';

export type LiveHandler = (type: string, data: Record<string, unknown>) => void;

const handlers = new Set<LiveHandler>();
let source: EventSource | null = null;
let lastEventId = '';
let statusNode: HTMLElement | null = null;

const EVENT_TYPES = [
  'block.saved',
  'block.removed',
  'backlinks.changed',
  'object.saved',
  'object.removed',
  'board.saved',
  'settings.saved',
  'share_link.changed',
  'sessions.changed',
  'presence.changed',
  'sync.reset',
  'session.ended',
];

export function onLive(handler: LiveHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function setSyncStatusNode(node: HTMLElement): void {
  statusNode = node;
  showStatus(source !== null);
}

function showStatus(live: boolean): void {
  if (statusNode === null) return;
  statusNode.textContent = live ? COPY.syncLive : COPY.syncPaused;
}

function dispatch(type: string, event: MessageEvent): void {
  if (event.lastEventId !== undefined && event.lastEventId !== '') lastEventId = event.lastEventId;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    data = {};
  }
  for (const handler of [...handlers]) handler(type, data);
}

/** Every open tab keeps the live sync channel open and resumes from its last event id. */
export function startLiveSync(): void {
  if (source !== null) source.close();
  source = new EventSource('/api/events');
  source.addEventListener('open', () => showStatus(true));
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (event) => dispatch(type, event as MessageEvent));
  }
  source.addEventListener('error', () => {
    showStatus(false);
    if (source !== null && source.readyState === EventSource.CLOSED) {
      window.setTimeout(reconnect, 2000);
    }
  });
}

function reconnect(): void {
  if (source !== null) source.close();
  source = null;
  // EventSource sends Last-Event-ID by itself; a fresh channel resumes from the same id.
  startLiveSync();
}

export function stopLiveSync(): void {
  if (source !== null) source.close();
  source = null;
}
