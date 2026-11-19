import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { useConfig } from '../../clock';
import { useLive } from '../../live';
import type { Message } from '../../types';

interface MessagePage {
  messages: Message[];
  next_cursor: string | null;
}

/**
 * The open thread: its stored messages (newest page re-read whenever the server says this conversation changed, older pages on
 * request), the other member's typing status, and read marking while the thread is open and the page is visible.
 */
export function useThread(conversationId: string, memberId: string, otherId: string) {
  const config = useConfig();
  const [recent, setRecent] = useState<Message[] | null>(null);
  const [older, setOlder] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const requestedUpTo = useRef<string | null>(null);
  const loadedOlder = useRef(false);
  const typingTimer = useRef<number | undefined>(undefined);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const page = await api.get<MessagePage>(`/api/conversations/${conversationId}/messages`);
      if (request !== latestRequest.current) return;
      setRecent(page.messages);
      if (!loadedOlder.current) setCursor(page.next_cursor);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setMissing(true);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
    return () => window.clearTimeout(typingTimer.current);
  }, [load]);

  useEffect(() => {
    const change = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);

  useLive(['message', 'read', 'typing', 'reconnected'], (event) => {
    if (event.type === 'reconnected') return void load();
    if (event.conversation_id !== conversationId) return;
    if (event.type === 'typing') {
      if (event.member_id !== otherId) return;
      setTyping(true);
      window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setTyping(false), config.typing_timeout_ms);
      return;
    }
    if (event.type === 'message' && event.sender_id === otherId) {
      window.clearTimeout(typingTimer.current);
      setTyping(false);
    }
    void load();
  });

  const loadOlder = useCallback(async () => {
    if (!cursor) return;
    const page = await api.get<MessagePage>(`/api/conversations/${conversationId}/messages?before=${encodeURIComponent(cursor)}`);
    loadedOlder.current = true;
    setOlder((previous) => [...page.messages, ...previous]);
    setCursor(page.next_cursor);
  }, [conversationId, cursor]);

  const markRead = useCallback(
    (stored: Message[]) => {
      const unread = stored.filter((message) => message.sender_id !== memberId && message.read_at === null);
      const last = unread[unread.length - 1];
      if (!last || requestedUpTo.current === last.id) return;
      requestedUpTo.current = last.id;
      void api.post(`/api/conversations/${conversationId}/read`, { up_to: last.id }).catch(() => {
        requestedUpTo.current = null;
      });
    },
    [conversationId, memberId],
  );

  const messages = recent ? [...older.filter((message) => !recent.some((fresh) => fresh.id === message.id)), ...recent] : null;

  useEffect(() => {
    if (messages && visible) markRead(messages);
  }, [messages, visible, markRead]);

  const addStored = useCallback((message: Message) => {
    setRecent((previous) => (previous && !previous.some((existing) => existing.id === message.id) ? [...previous, message] : previous));
  }, []);

  return { messages, hasOlder: cursor !== null, loadOlder, typing, missing, addStored };
}
