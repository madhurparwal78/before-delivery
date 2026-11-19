import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import { announce } from '../main.js';
import type { Conversation, Message } from '../types.js';
import { makeIdempotencyKey } from '../live.js';
import { useNavigationCounts } from '../chrome/counts.js';
import { firstNameOf } from '../format.js';

type OutboxMessage = {
  key: string; text: string; state: 'waiting' | 'failed'; failure?: 'not_connected' | 'other';
};

export const MessagingPage = ({ conversationId, withHandle }: { conversationId?: string; withHandle?: string }): JSX.Element => {
  const { me, navigate, liveEvents, config } = useApp();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openId, setOpenId] = useState<string | null>(conversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [text, setText] = useState('');
  const [typingName, setTypingName] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [online, setOnline] = useState(true);
  const [seenTime, setSeenTime] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | null>(null);
  const lastTypingSignal = useRef(0);
  const scrollRef = useRef(0);

  useNavigationCounts();

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = (): void => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const loadConversations = useCallback(async (): Promise<void> => {
    const result = await api.get<{ conversations: Conversation[] }>('/api/conversations');
    setConversations(result.conversations);
  }, []);

  const openConversation = useCallback(async (id: string): Promise<void> => {
    setOpenId(id);
    setRefusal(null);
    try {
      const result = await api.get<{ messages: Message[] }>(`/api/conversations/${id}/messages`);
      setMessages(result.messages);
      if (document.visibilityState === 'visible') {
        const last = result.messages.filter((m) => m.sender_id !== me?.id).at(-1);
        if (last && !last.read_at) {
          await api.post(`/api/conversations/${id}/read`, { up_to: last.id });
        }
      }
      await loadConversations();
    } catch (err) {
      const e2 = err as { status?: number };
      if (e2.status === 404) {
        setRefusal(`You can message ${otherName || 'this member'} once you're connected.`);
      }
    }
  }, [me?.id, loadConversations, otherName]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  const startWith = useCallback(async (handle: string): Promise<void> => {
    try {
      const profile = await api.get<{ id: string; name: string }>(`/api/profiles/${handle}`);
      const result = await api.post<{ id: string }>('/api/conversations', { member_id: profile.id });
      setOtherName(profile.name);
      await openConversation(result.id);
    } catch (err) {
      const e2 = err as { status?: number; body?: { error?: string } };
      if (e2.status === 404 || e2.body?.error === 'not_connected') {
        try {
          const profile = await api.get<{ name: string }>(`/api/profiles/${handle}`);
          setOtherName(profile.name);
          setRefusal(`You can message ${profile.name} once you're connected.`);
        } catch {
          setRefusal('This profile isn\'t available');
        }
      }
    }
  }, [openConversation]);

  useEffect(() => {
    if (withHandle) void startWith(withHandle);
  }, [withHandle, startWith]);

  useEffect(() => {
    if (openId && conversationId) void openConversation(openId);
  }, [openId, conversationId, openConversation]);

  useEffect(() => {
    return liveEvents.subscribe((event, data) => {
      const payload = data as { conversation_id?: string; member_id?: string; timeout_ms?: number };
      if (event === 'message' && payload.conversation_id === openId) {
        void openConversation(openId);
        const conv = conversations.find((c) => c.id === openId);
        if (conv) announce('Messaging announcements', `New message from ${conv.other.name}`);
      } else if (event === 'typing' && payload.conversation_id === openId && payload.member_id) {
        const conv = conversations.find((c) => c.id === openId);
        setTypingName(conv?.other.name ?? 'Someone');
        if (typingTimer.current) window.clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => setTypingName(null), config?.typing_timeout_ms ?? 5000);
      } else if (event === 'read' && payload.conversation_id === openId) {
        void openConversation(openId);
      } else if (event === 'connection') {
        void loadConversations();
      }
    });
  }, [liveEvents, openId, openConversation, conversations, config, loadConversations]);

  useEffect(() => {
    const lastRead = [...messages].reverse().find((m) => m.sender_id === me?.id && m.read_at);
    setSeenTime(lastRead?.read_at ?? null);
  }, [messages, me?.id]);

  const sendText = async (key: string, body: string): Promise<{ ok: boolean; refused?: 'not_connected' | 'other' }> => {
    try {
      const result = await api.post<Message>(`/api/conversations/${openId}/messages`, { text: body }, key);
      setMessages((prev) => [...prev.filter((m) => m.id !== result.id), result]);
      announce('Messaging announcements', 'Message sent.');
      await loadConversations();
      return { ok: true };
    } catch (err) {
      const e2 = err as { status?: number; body?: { error?: string } };
      if (e2.status === 403 || e2.body?.error === 'not_connected') return { ok: false, refused: 'not_connected' };
      if (e2.status !== undefined && e2.status >= 400) return { ok: false, refused: 'other' };
      return { ok: false };
    }
  };

  const send = async (): Promise<void> => {
    const value = text;
    if (value.trim().length === 0) return;
    setText('');
    if (!navigator.onLine || !online) {
      setOutbox((prev) => [...prev, { key: makeIdempotencyKey(), text: value, state: 'waiting' }]);
      return;
    }
    const key = makeIdempotencyKey();
    const result = await sendText(key, value);
    if (!result.ok) {
      if (result.refused === undefined) {
        setOutbox((prev) => [...prev, { key, text: value, state: 'waiting' }]);
        setOnline(false);
      } else {
        setOutbox((prev) => [...prev, { key, text: value, state: 'failed', failure: result.refused }]);
      }
    }
  };

  const drainOutbox = useCallback(async (): Promise<void> => {
    setOutbox((prev) => {
      void (async () => {
        const next = [...prev];
        for (let index = 0; index < next.length; index++) {
          const message = next[index];
          if (message.state !== 'waiting') continue;
          const result = await sendText(message.key, message.text);
          if (result.ok) {
            next.splice(index, 1);
            index -= 1;
          } else if (result.refused !== undefined) {
            next[index] = { ...message, state: 'failed', failure: result.refused };
            break;
          } else {
            break;
          }
        }
        setOutbox(next);
      })();
      return prev;
    });
  }, []);

  useEffect(() => {
    if (online) void drainOutbox();
  }, [online, drainOutbox]);

  const typingSignal = (): void => {
    if (!online) return;
    const now = Date.now();
    if (now - lastTypingSignal.current < 1000) return;
    lastTypingSignal.current = now;
    void api.post(`/api/conversations/${openId}/typing`, {}).catch(() => undefined);
  };

  const tz = config?.time_zone ?? 'UTC';
  const conv = conversations.find((c) => c.id === openId);
  const openName = conv?.other.name ?? otherName;

  return (
    <div className="messaging-layout">
      <div className={`conversations-pane ${openId && phone ? '' : 'open'}`}>
        <h1 className="profile-name">Messaging</h1>
        {conversations.length === 0 && (
          <div className="big-empty">
            <p>No conversations yet.</p>
            <a href="/network" onClick={(e) => { e.preventDefault(); navigate('/network'); }}>Go to My network</a>
          </div>
        )}
        <ul aria-label="Conversations">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <a
                href={`/messaging/${conversation.id}`}
                className="conversation-link"
                data-unread={conversation.unread_count}
                onClick={(e) => { e.preventDefault(); scrollRef.current = window.scrollY; void openConversation(conversation.id); }}
              >
                {conversation.other.name}
                {conversation.unread_count > 0 && ` ${conversation.unread_count} unread`}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className={`conversation-pane ${openId ? 'open' : ''}`}>
        {openId && (
          <div className="thread" role="region" aria-label={`Conversation with ${openName}`}>
            {phone && (
              <button type="button" className="text-button" onClick={() => {
                setOpenId(null);
                window.scrollTo(0, scrollRef.current);
                const first = document.querySelector<HTMLAnchorElement>('.conversation-link');
                first?.focus();
              }}>Back to conversations</button>
            )}
            <div className="message-log" role="log" aria-label="Messages" ref={logRef}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`message-bubble ${message.sender_id === me?.id ? 'mine' : ''}`}
                  data-message-id={message.id}
                  data-sender-id={message.sender_id}
                  data-read={message.read_at ? 'true' : 'false'}
                >
                  <p className="comment-text">{message.text}</p>
                </div>
              ))}
              {outbox.map((message) => (
                <div key={message.key} className="message-bubble mine"
                  data-pending={message.state === 'waiting' ? 'true' : 'false'}
                  data-failed={message.state === 'failed' ? 'true' : 'false'}>
                  <p className="comment-text">{message.text}</p>
                  {message.state === 'waiting' && <p className="message-status">Waiting to send</p>}
                  {message.state === 'failed' && (
                    <>
                      <p className="message-status">
                        {message.failure === 'not_connected' ? 'Not sent. You\'re no longer connected.' : 'Not sent.'}
                      </p>
                      <button type="button" className="text-button" onClick={() => {
                        void (async () => {
                          const result = await sendText(message.key, message.text);
                          if (result.ok) setOutbox((prev) => prev.filter((m) => m.key !== message.key));
                          else if (result.refused !== undefined) {
                            setOutbox((prev) => prev.map((m) => m.key === message.key ? { ...m, state: 'failed', failure: result.refused } : m));
                          }
                        })();
                      }}>Retry sending</button>
                      <button type="button" className="text-button" onClick={() => {
                        setOutbox((prev) => prev.filter((m) => m.key !== message.key));
                      }}>Delete unsent message</button>
                    </>
                  )}
                </div>
              ))}
              {seenTime && (
                <p className="message-status">
                  Seen {new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(seenTime)).replace(/\u202f/g, ' ')}
                </p>
              )}
            </div>
            <p className="typing-status" role="status" aria-live="polite">
              {typingName ? `${firstNameOf(typingName)} is typing…` : ''}
            </p>
            <div role="status" aria-label="Connection" className="message-status">
              {!online ? "You're offline. Messages will send when you reconnect." : ''}
            </div>
            {refusal ? (
              <p>{refusal}</p>
            ) : (
              <div className="message-box">
                <label className="label visually-hidden" htmlFor="message-box">Write a message</label>
                <textarea
                  id="message-box"
                  className="field"
                  rows={3}
                  value={text}
                  onChange={(e) => { setText(e.target.value); typingSignal(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button type="button" className="pink-button" onClick={() => { void send(); }} aria-label="Send">Send</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
