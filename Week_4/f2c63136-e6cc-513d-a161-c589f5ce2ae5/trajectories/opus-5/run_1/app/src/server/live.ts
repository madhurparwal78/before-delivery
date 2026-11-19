import type { ServerResponse } from 'node:http';
import { config } from './config.js';

export type LiveEventKind =
  | 'review'
  | 'review-dismissed'
  | 'check'
  | 'revision'
  | 'restack'
  | 'restack-conflict'
  | 'not-restacked'
  | 'queue-position'
  | 'queue-removed'
  | 'merge'
  | 'comment'
  | 'rules';

export interface LiveEvent {
  kind: LiveEventKind;
  text: string;
  change?: number;
  walkFrom?: number;
}

export type PageContext =
  | { kind: 'change'; number: number }
  | { kind: 'queue' };

export interface Subscriber {
  id: number;
  repoId: number;
  userId: number | null;
  page: PageContext;
  response: ServerResponse;
}

export interface Delivery {
  events: LiveEvent[];
  fragments: Record<string, string>;
}

export type FragmentRenderer = (subscriber: Subscriber, events: LiveEvent[]) => Promise<Delivery>;

let renderFragments: FragmentRenderer = async (_subscriber, events) => ({ events, fragments: {} });

export function setFragmentRenderer(renderer: FragmentRenderer): void {
  renderFragments = renderer;
}

const subscribers = new Map<number, Subscriber>();
let nextSubscriberId = 1;

export function addSubscriber(repoId: number, userId: number | null, page: PageContext, response: ServerResponse): number {
  const id = nextSubscriberId;
  nextSubscriberId += 1;
  subscribers.set(id, { id, repoId, userId, page, response });
  return id;
}

export function removeSubscriber(id: number): void {
  subscribers.delete(id);
}

function send(subscriber: Subscriber, payload: unknown): void {
  try {
    subscriber.response.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    subscribers.delete(subscriber.id);
  }
}

export class EventSink {
  private readonly events: LiveEvent[] = [];

  add(event: LiveEvent): void {
    this.events.push(event);
  }

  list(): LiveEvent[] {
    return this.events;
  }
}

const pendingByRepo = new Map<number, LiveEvent[]>();
const timers = new Map<number, NodeJS.Timeout>();

export function publish(repoId: number, events: LiveEvent[]): void {
  const pending = pendingByRepo.get(repoId) ?? [];
  pending.push(...events);
  pendingByRepo.set(repoId, pending);
  if (timers.has(repoId)) return;
  const timer = setTimeout(() => {
    timers.delete(repoId);
    const batch = pendingByRepo.get(repoId) ?? [];
    pendingByRepo.delete(repoId);
    void deliver(repoId, batch);
  }, Math.max(0, Math.min(config.liveUpdateDelayMs - 50, 50)));
  timers.set(repoId, timer);
}

async function deliver(repoId: number, events: LiveEvent[]): Promise<void> {
  for (const subscriber of [...subscribers.values()]) {
    if (subscriber.repoId !== repoId) continue;
    try {
      send(subscriber, await renderFragments(subscriber, events));
    } catch {
      send(subscriber, { events, fragments: {} });
    }
  }
}

/** Waits until every pushed update of the current batch has been delivered. */
export async function flushLive(): Promise<void> {
  const repoIds = [...timers.keys()];
  for (const repoId of repoIds) {
    const timer = timers.get(repoId);
    if (timer) clearTimeout(timer);
    timers.delete(repoId);
    const batch = pendingByRepo.get(repoId) ?? [];
    pendingByRepo.delete(repoId);
    await deliver(repoId, batch);
  }
}
