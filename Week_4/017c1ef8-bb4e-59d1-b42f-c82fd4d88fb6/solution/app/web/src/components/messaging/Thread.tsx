import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useConfig, useNow } from '../../clock';
import { firstName, formatTime, relativeTime } from '../../format';
import type { Message } from '../../types';
import { Button, LinkButton } from '../../ui';
import { RichText } from '../RichText';
import { useConnected } from './useConnected';
import { useOutbox, type OutgoingMessage } from './useOutbox';
import { useThread } from './useThread';

export interface ThreadOther {
  id: string;
  name: string;
  handle: string;
}

interface ThreadProps {
  conversationId: string;
  other: ThreadOther;
  memberId: string;
  /** On phone the thread is its own screen with a way back to the list. */
  withBack: boolean;
}

const TYPING_SIGNAL_GAP_MS = 1000;
const NEAR_BOTTOM_PX = 160;

function OutgoingItem({ item, onRetry, onDiscard, memberId }: { item: OutgoingMessage; onRetry: () => void; onDiscard: () => void; memberId: string }) {
  const failed = item.state === 'failed';
  return (
    <div
      className="message mine"
      data-sender-id={memberId}
      data-read="false"
      data-pending={failed ? 'false' : item.state === 'waiting' ? 'true' : undefined}
      data-failed={failed ? 'true' : undefined}
    >
      <p className="message-text">
        <RichText text={item.text} />
      </p>
      {item.state === 'sending' ? <p className="message-note muted">Sending…</p> : null}
      {item.state === 'waiting' ? <p className="message-note muted">Waiting to send</p> : null}
      {failed ? (
        <>
          <p className="message-note muted">{item.reason === 'not_connected' ? "Not sent. You're no longer connected." : 'Not sent.'}</p>
          <div className="row">
            <LinkButton onClick={onRetry}>Retry sending</LinkButton>
            <LinkButton onClick={onDiscard}>Delete unsent message</LinkButton>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** One open conversation: its messages, the other member's typing status, the outbox and the message box (or the refusal). */
export function Thread({ conversationId, other, memberId, withBack }: ThreadProps) {
  const config = useConfig();
  const now = useNow();
  const navigate = useNavigate();
  const thread = useThread(conversationId, memberId, other.id);
  const outbox = useOutbox(conversationId, thread.addStored);
  const connected = useConnected(other.handle);
  const [draft, setDraft] = useState('');
  const lastTypingSignal = useRef(Number.NEGATIVE_INFINITY);
  const bottom = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const stored: Message[] = thread.messages ?? [];

  useEffect(() => {
    const track = () => {
      stickToBottom.current = document.documentElement.scrollHeight - window.scrollY - window.innerHeight < NEAR_BOTTOM_PX;
    };
    window.addEventListener('scroll', track, { passive: true });
    return () => window.removeEventListener('scroll', track);
  }, []);

  useLayoutEffect(() => {
    if (stickToBottom.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [stored.length, outbox.items.length, thread.typing, thread.messages === null]);

  const lastSeen = [...stored].reverse().find((message) => message.sender_id === memberId && message.read_at !== null);

  const submit = () => {
    if (draft.trim() === '') return;
    stickToBottom.current = true;
    outbox.send(draft);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const onChange = (text: string) => {
    setDraft(text);
    const at = performance.now();
    if (text.trim() !== '' && !outbox.offline && at - lastTypingSignal.current >= TYPING_SIGNAL_GAP_MS) {
      lastTypingSignal.current = at;
      void api.post(`/api/conversations/${conversationId}/typing`).catch(() => undefined);
    }
  };

  return (
    <section className="thread" aria-label={`Conversation with ${other.name}`}>
      <header className="thread-header">
        {withBack ? <Button onClick={() => navigate('/messaging')}>Back to conversations</Button> : null}
        {withBack ? <h1 className="t-heading">{other.name}</h1> : <h2 className="t-heading">{other.name}</h2>}
      </header>
      <div role="log" aria-label="Messages" className="message-log">
        {thread.hasOlder ? <LinkButton onClick={() => void thread.loadOlder()}>Earlier messages</LinkButton> : null}
        {stored.map((message) => (
          <div
            key={message.id}
            className={message.sender_id === memberId ? 'message mine' : 'message'}
            data-message-id={message.id}
            data-sender-id={message.sender_id}
            data-read={message.read_at !== null ? 'true' : 'false'}
          >
            <p className="message-text">
              <RichText text={message.text} />
            </p>
            <p className="message-note muted">
              <time dateTime={message.sent_at}>{relativeTime(message.sent_at, now, config.time_zone)}</time>
            </p>
            {lastSeen?.id === message.id && message.read_at ? <p className="message-note muted">Seen {formatTime(message.read_at, config.time_zone)}</p> : null}
          </div>
        ))}
        {outbox.items.map((item) => (
          <OutgoingItem key={item.id} item={item} memberId={memberId} onRetry={() => outbox.retry(item.id)} onDiscard={() => outbox.discard(item.id)} />
        ))}
      </div>
      <p role="status" className="thread-typing muted">
        {thread.typing ? `${firstName(other.name)} is typing…` : ''}
      </p>
      <p role="status" aria-label="Connection" className="thread-connection muted">
        {outbox.offline ? "You're offline. Messages will send when you reconnect." : ''}
      </p>
      {connected === false ? (
        <p className="thread-refusal t-larger">{`You can message ${other.name} once you're connected.`}</p>
      ) : connected ? (
        <div className="composer-row">
          <textarea
            className="input composer-box"
            aria-label="Write a message"
            rows={2}
            value={draft}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button onClick={submit} disabled={draft.trim() === ''}>
            Send
          </Button>
        </div>
      ) : null}
      <div ref={bottom} />
    </section>
  );
}

/** The thread of someone the viewer cannot message and has never talked to: the refusal in place of the message box. */
export function RefusedThread({ name, withBack }: { name: string; withBack: boolean }) {
  const navigate = useNavigate();
  return (
    <section className="thread" aria-label={`Conversation with ${name}`}>
      <header className="thread-header">
        {withBack ? <Button onClick={() => navigate('/messaging')}>Back to conversations</Button> : null}
        {withBack ? <h1 className="t-heading">{name}</h1> : <h2 className="t-heading">{name}</h2>}
      </header>
      <p className="thread-refusal t-larger">{`You can message ${name} once you're connected.`}</p>
    </section>
  );
}
