import { useEffect, useRef, useState } from 'react';
import { get } from './api';

export type LiveTopic =
  | 'calendar'
  | 'queue'
  | 'ward'
  | 'beacons'
  | 'note'
  | 'stock'
  | 'staff'
  | 'invoices'
  | 'patients';

export type LiveMessage =
  | { kind: 'hello' }
  | { kind: 'changed'; topics: LiveTopic[]; noteAppointmentId?: string }
  | { kind: 'announce'; text: string; audience: 'all' | 'manager' }
  | { kind: 'role'; role: string }
  | { kind: 'revoked' };

type Listener = (message: LiveMessage) => void;

const listeners = new Set<Listener>();
let stream: EventSource | null = null;

export function startLiveFeed(): void {
  if (stream) return;
  stream = new EventSource('/api/live');
  stream.onmessage = (event) => {
    const message = JSON.parse(event.data) as LiveMessage;
    for (const listener of listeners) listener(message);
  };
  stream.onerror = () => {
    /* EventSource reconnects on its own; screens refetch on the next message */
  };
}

export function stopLiveFeed(): void {
  stream?.close();
  stream = null;
}

export function useLive(listener: Listener): void {
  const held = useRef(listener);
  held.current = listener;
  useEffect(() => {
    const wrapped: Listener = (message) => held.current(message);
    listeners.add(wrapped);
    return () => {
      listeners.delete(wrapped);
    };
  }, []);
}

/** Loads a resource and refetches it when the live feed reports a matching topic. */
export function useLiveResource<T>(
  path: string | null,
  topics: LiveTopic[],
): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const topicKey = topics.join(',');

  const load = useRef(async (target: string) => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    try {
      const value = await get<T>(target);
      if (latest.current === ticket) {
        setData(value);
        setError(null);
      }
    } catch (failure) {
      if (latest.current === ticket) setError((failure as Error).message);
    }
  });

  useEffect(() => {
    if (path) void load.current(path);
  }, [path]);

  useLive((message) => {
    if (!path) return;
    if (message.kind !== 'changed') return;
    if (message.topics.some((topic) => topicKey.split(',').includes(topic))) {
      void load.current(path);
    }
  });

  return {
    data,
    error,
    reload: () => {
      if (path) void load.current(path);
    },
  };
}
