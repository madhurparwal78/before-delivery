import type { StreamEventName, StreamEvents } from '../shared/types.js';

type Listener<E extends StreamEventName> = (data: StreamEvents[E]) => void;

const EVENT_NAMES: StreamEventName[] = [
  'student-joined',
  'student-renamed',
  'student-removed',
  'project-saved',
  'project-handed-in',
  'classroom-state',
  'access-ended',
];

const listeners = new Map<StreamEventName, Set<Listener<StreamEventName>>>();
let source: EventSource | null = null;

/** One live stream per tab; every page subscribes to the events it needs. */
export const startLiveStream = (): void => {
  if (source) return;
  source = new EventSource('/api/stream', { withCredentials: true });
  for (const name of EVENT_NAMES) {
    source.addEventListener(name, (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as StreamEvents[StreamEventName];
      for (const listener of listeners.get(name) ?? []) listener(data);
    });
  }
};

export const onLive = <E extends StreamEventName>(name: E, listener: Listener<E>): (() => void) => {
  const set = listeners.get(name) ?? new Set();
  set.add(listener as Listener<StreamEventName>);
  listeners.set(name, set);
  return () => set.delete(listener as Listener<StreamEventName>);
};
