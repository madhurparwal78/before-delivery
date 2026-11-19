import { useCallback, useEffect, useRef, useState } from 'react';
import { announce } from '../../announce';
import { api, ApiError, newIdempotencyKey } from '../../api';
import type { Message } from '../../types';

/** A message typed in this page and not yet stored: sending, waiting for the network, or refused by the server. */
export interface OutgoingMessage {
  id: string;
  key: string;
  text: string;
  state: 'sending' | 'waiting' | 'failed';
  /** Why a refused message was not sent. */
  reason: 'not_connected' | 'refused' | null;
}

/** Seconds after a network failure: 1, 2 and 4, then every 8 while online. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

/**
 * The thread's outbox. Messages send one at a time in typed order, each with its own Idempotency-Key. A send that fails on the
 * network keeps its key and waits; the page is offline while the browser says so and after a network failure until a send reaches the server.
 */
export function useOutbox(conversationId: string, onStored: (message: Message) => void) {
  const [items, setItems] = useState<OutgoingMessage[]>([]);
  const [networkFailed, setNetworkFailed] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const itemsRef = useRef<OutgoingMessage[]>([]);
  const failuresRef = useRef(0);
  const networkFailedRef = useRef(false);
  const drainingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const storedRef = useRef(onStored);
  storedRef.current = onStored;

  const commit = useCallback((next: OutgoingMessage[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const setFailed = useCallback((failed: boolean) => {
    networkFailedRef.current = failed;
    setNetworkFailed(failed);
  }, []);

  const patch = useCallback(
    (id: string, change: Partial<OutgoingMessage>) => commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...change } : item))),
    [commit],
  );

  const drain = useCallback(async (): Promise<void> => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    window.clearTimeout(timerRef.current);
    try {
      for (;;) {
        const next = itemsRef.current.find((item) => item.state !== 'failed');
        if (!next || !navigator.onLine) return;
        try {
          const stored = await api.post<Message>(`/api/conversations/${conversationId}/messages`, { text: next.text }, { idempotencyKey: next.key });
          failuresRef.current = 0;
          setFailed(false);
          commit(itemsRef.current.filter((item) => item.id !== next.id));
          storedRef.current(stored);
          announce('Messaging announcements', 'Message sent.');
        } catch (error) {
          if (error instanceof ApiError) {
            failuresRef.current = 0;
            setFailed(false);
            patch(next.id, { state: 'failed', reason: error.body.error === 'not_connected' ? 'not_connected' : 'refused' });
            announce('Messaging announcements', 'Message not sent.');
          } else {
            setFailed(true);
            patch(next.id, { state: 'waiting' });
            const delay = RETRY_DELAYS_MS[Math.min(failuresRef.current, RETRY_DELAYS_MS.length - 1)] ?? 8000;
            failuresRef.current += 1;
            timerRef.current = window.setTimeout(() => void drain(), delay);
            return;
          }
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [commit, conversationId, patch, setFailed]);

  useEffect(() => {
    const online = () => {
      setBrowserOnline(true);
      window.clearTimeout(timerRef.current);
      void drain();
    };
    const offline = () => setBrowserOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.clearTimeout(timerRef.current);
    };
  }, [drain]);

  const reachable = browserOnline && !networkFailed;

  const send = useCallback(
    (text: string) => {
      const waiting = !navigator.onLine || networkFailedRef.current || itemsRef.current.some((item) => item.state === 'waiting');
      commit([...itemsRef.current, { id: crypto.randomUUID(), key: newIdempotencyKey(), text, state: waiting ? 'waiting' : 'sending', reason: null }]);
      void drain();
    },
    [commit, drain],
  );

  const retry = useCallback(
    (id: string) => {
      patch(id, { state: networkFailedRef.current || !navigator.onLine ? 'waiting' : 'sending', reason: null });
      void drain();
    },
    [drain, patch],
  );

  const discard = useCallback((id: string) => commit(itemsRef.current.filter((item) => item.id !== id)), [commit]);

  return { items, offline: !reachable, send, retry, discard };
}
