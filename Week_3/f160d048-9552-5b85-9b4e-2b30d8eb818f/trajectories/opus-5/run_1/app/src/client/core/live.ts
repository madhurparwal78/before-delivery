export type LiveEventType =
  | 'queue.changed'
  | 'queue.history'
  | 'post.state'
  | 'member.unlocked'
  | 'company.changed'
  | 'application.stage'
  | 'channel.post'
  | 'alert.matched';

export interface LiveMessage {
  type: LiveEventType;
  data: Record<string, unknown>;
}

type Listener = (messages: ReadonlyArray<LiveMessage>, replayed: boolean) => void;

const TYPES: ReadonlyArray<LiveEventType> = [
  'queue.changed',
  'queue.history',
  'post.state',
  'member.unlocked',
  'company.changed',
  'application.stage',
  'channel.post',
  'alert.matched',
];

const listeners = new Set<Listener>();
const reloadListeners = new Set<() => void>();
let source: EventSource | null = null;
let buffering = true;
let buffered: LiveMessage[] = [];

function deliver(messages: ReadonlyArray<LiveMessage>, replayed: boolean): void {
  for (const listener of [...listeners]) listener(messages, replayed);
}

function handle(message: LiveMessage): void {
  if (buffering) buffered.push(message);
  else deliver([message], false);
}

export function startLive(): void {
  if (source) return;
  source = new EventSource('/api/live');
  source.addEventListener('open', () => {
    buffering = true;
    buffered = [];
  });
  source.addEventListener('hello', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as { replay?: string };
    const replayed = buffered;
    buffered = [];
    buffering = false;
    if (payload.replay === 'reload') {
      for (const listener of [...reloadListeners]) listener();
      return;
    }
    if (replayed.length > 0) deliver(replayed, true);
  });
  for (const type of TYPES) {
    source.addEventListener(type, (event) => {
      handle({ type, data: JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown> });
    });
  }
}

export function onLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onLiveReload(listener: () => void): () => void {
  reloadListeners.add(listener);
  return () => reloadListeners.delete(listener);
}
