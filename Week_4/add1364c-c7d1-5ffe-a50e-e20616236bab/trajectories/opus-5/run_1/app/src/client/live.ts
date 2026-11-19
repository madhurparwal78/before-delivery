import { useEffect, useState } from 'react';

export type LiveName =
  | 'rule-in-force'
  | 'access-changed'
  | 'session-ended'
  | 'billing-changed'
  | 'check-finished'
  | 'review-opened'
  | 'review-changed'
  | 'seat-confirmed';

const NAMES: LiveName[] = [
  'rule-in-force',
  'access-changed',
  'session-ended',
  'billing-changed',
  'check-finished',
  'review-opened',
  'review-changed',
  'seat-confirmed',
];

type Handler = (data: unknown) => void;

const handlers = new Map<LiveName, Set<Handler>>();
let source: EventSource | null = null;

export function startLive(): void {
  if (source !== null) return;
  source = new EventSource('/api/events');
  for (const name of NAMES) {
    source.addEventListener(name, (event) => {
      const data: unknown = JSON.parse((event as MessageEvent<string>).data || '{}');
      for (const handler of handlers.get(name) ?? []) handler(data);
    });
  }
}

export function stopLive(): void {
  source?.close();
  source = null;
}

export function onLive(name: LiveName, handler: Handler): () => void {
  const set = handlers.get(name) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(name, set);
  return () => {
    set.delete(handler);
  };
}

/** Subscribes for the life of a component. */
export function useLive(name: LiveName, handler: Handler): void {
  useEffect(() => onLive(name, handler), [name, handler]);
}

type Region = 'status' | 'alert';
const messages: Record<Region, string> = { status: '', alert: '' };
const watchers = new Set<() => void>();

function publish(): void {
  for (const watcher of watchers) watcher();
}

/** Polite announcements go to Desk status; refusals go to Desk alert. */
export function say(message: string): void {
  messages.status = message;
  publish();
}

export function refuse(message: string): void {
  messages.alert = message;
  publish();
}

export function useAnnouncements(): { status: string; alert: string } {
  const [state, setState] = useState({ status: messages.status, alert: messages.alert });
  useEffect(() => {
    const watcher = (): void => setState({ status: messages.status, alert: messages.alert });
    watchers.add(watcher);
    watcher();
    return () => {
      watchers.delete(watcher);
    };
  }, []);
  return state;
}
