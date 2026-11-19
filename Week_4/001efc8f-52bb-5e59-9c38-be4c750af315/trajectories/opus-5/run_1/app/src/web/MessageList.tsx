import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ROLE_LABELS, type Message, type MessageOrPlaceholder, type User } from '../shared/api';
import { chipForCounts } from '../shared/chips';
import { DeliveryStateChip, EditedChip, PinnedChip, RoleChip } from './Chips';
import { MessageText } from './MessageText';
import { MoreGlyph } from './Icons';
import { when } from './format';
import { serverNow } from './api';

export interface PendingSend {
  clientMessageId: string;
  text: string;
  files: File[];
  quotedMessageId: string | null;
  threadRootId: string | null;
  createdAt: number;
  state: 'pending' | 'failed';
  error: string | null;
}

export type MessageAction =
  | 'reply'
  | 'quote'
  | 'edit'
  | 'delete'
  | 'pin'
  | 'unpin'
  | 'receipts'
  | 'versions';

export interface MessageListProps {
  messages: MessageOrPlaceholder[];
  pending: PendingSend[];
  me: User;
  dimmedPins: Set<string>;
  onAction: (action: MessageAction, message: Message) => void;
  onOpenThread: (rootId: string) => void;
  onOpenPhoto: (attachmentId: string) => void;
  onRetry: (send: PendingSend) => void;
  onDiscard: (send: PendingSend) => void;
}

function canModerate(role: string): boolean {
  return role === 'crew_lead' || role === 'dispatcher' || role === 'ops_manager';
}

function ActionsMenu({
  message,
  me,
  onAction,
}: {
  message: Message;
  me: User;
  onAction: (action: MessageAction, message: Message) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (event: MouseEvent): void => {
      if (container.current !== null && !container.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    return () => document.removeEventListener('mousedown', onDocument);
  }, [open]);

  const moderator = canModerate(me.role);
  const mine = message.author.id === me.id;
  const withinWindow = serverNow() < new Date(message.editable_until).getTime();
  const items: { action: MessageAction; label: string }[] = [];
  if (message.thread_root_id === null) items.push({ action: 'reply', label: 'Reply in thread' });
  items.push({ action: 'quote', label: 'Quote' });
  if ((mine || moderator) && withinWindow) items.push({ action: 'edit', label: 'Edit' });
  if (mine || moderator) items.push({ action: 'delete', label: 'Delete' });
  if (moderator && !message.pinned) items.push({ action: 'pin', label: 'Pin' });
  if (moderator && message.pinned) items.push({ action: 'unpin', label: 'Unpin' });
  if (mine || moderator) items.push({ action: 'receipts', label: 'Receipts' });
  items.push({ action: 'versions', label: 'Version history' });

  return (
    <div className="actions" ref={container}>
      <button
        type="button"
        className="icon-button"
        aria-label="Message actions"
        aria-expanded={open}
        ref={trigger}
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          if (rect !== undefined) {
            const height = Math.min(items.length * 46 + 8, window.innerHeight - 16);
            setAnchor({
              top: Math.max(8, Math.min(rect.bottom, window.innerHeight - height - 8)),
              left: Math.max(8, Math.min(rect.right - 192, window.innerWidth - 200)),
            });
          }
          setOpen((value) => !value);
        }}
      >
        <MoreGlyph />
      </button>
      {open ? (
        <div role="menu" className="menu" style={{ top: `${anchor.top}px`, left: `${anchor.left}px` }}>
          {items.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onAction(item.action, message);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuoteBlock({ message }: { message: Message }): ReactElement | null {
  const quote = message.quote;
  if (quote === null) return null;
  if (quote.deleted) return <blockquote className="quote quote-deleted">That message was deleted.</blockquote>;
  return (
    <blockquote className="quote">
      <span className="quote-author">{quote.author_name}</span>
      <span className="quote-text">
        <MessageText text={quote.text} />
      </span>
      {quote.edited ? <EditedChip /> : null}
    </blockquote>
  );
}

export function MessageArticle({
  message,
  me,
  dimmedPin,
  onAction,
  onOpenThread,
  onOpenPhoto,
}: {
  message: Message;
  me: User;
  dimmedPin: boolean;
  onAction: (action: MessageAction, message: Message) => void;
  onOpenThread: (rootId: string) => void;
  onOpenPhoto: (attachmentId: string) => void;
}): ReactElement {
  const mine = message.author.id === me.id;
  return (
    <article className="message" aria-label={`${message.author.name} at ${when(message.sent_at)}`} tabIndex={-1} id={`message-${message.id}`}>
      <div className="message-head">
        <span className="message-author">{message.author.name}</span>
        <RoleChip label={ROLE_LABELS[message.author.role]} />
        {message.version > 1 ? <EditedChip /> : null}
        {message.pinned || dimmedPin ? <PinnedChip dimmed={dimmedPin} /> : null}
        <time className="mono message-time">{when(message.sent_at)}</time>
        <ActionsMenu message={message} me={me} onAction={onAction} />
      </div>
      <QuoteBlock message={message} />
      {message.text.length > 0 ? (
        <p className="message-text">
          <MessageText text={message.text} />
        </p>
      ) : null}
      {message.attachments.length > 0 ? (
        <div className="thumbs">
          {message.attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              className="thumb-button"
              onClick={() => onOpenPhoto(attachment.id)}
            >
              <img src={attachment.thumb_url} alt={attachment.filename} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="message-foot">
        {message.reply_count > 0 ? (
          <button type="button" className="link-button" onClick={() => onOpenThread(message.id)}>
            {`View ${message.reply_count} replies`}
          </button>
        ) : null}
        {mine ? <DeliveryStateChip chip={chipForCounts(message.delivered_count, message.read_count)} /> : null}
      </div>
    </article>
  );
}

function PendingArticle({
  send,
  me,
  onRetry,
  onDiscard,
}: {
  send: PendingSend;
  me: User;
  onRetry: (send: PendingSend) => void;
  onDiscard: (send: PendingSend) => void;
}): ReactElement {
  return (
    <article className="message" aria-label={`${me.name} at ${when(send.createdAt)}`} tabIndex={-1}>
      <div className="message-head">
        <span className="message-author">{me.name}</span>
        <RoleChip label={ROLE_LABELS[me.role]} />
        <time className="mono message-time">{when(send.createdAt)}</time>
      </div>
      {send.text.length > 0 ? <p className="message-text">{send.text}</p> : null}
      <div className="message-foot">
        <DeliveryStateChip chip={{ state: send.state === 'failed' ? 'failed' : 'pending' }} />
      </div>
      {send.state === 'failed' ? (
        <div className="failed-block">
          <p className="alert-text">{send.error}</p>
          <button type="button" onClick={() => onRetry(send)}>
            Retry send
          </button>
          <button type="button" onClick={() => onDiscard(send)}>
            Discard
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function MessageList(props: MessageListProps): ReactElement {
  return (
    <>
      {props.messages.map((message) =>
        message.deleted ? (
          <article key={message.id} className="message message-deleted" aria-label={`Deleted message at ${when(message.sent_at)}`} tabIndex={-1}>
            <p className="message-text">That message was deleted.</p>
            {message.reply_count > 0 ? (
              <button type="button" className="link-button" onClick={() => props.onOpenThread(message.id)}>
                {`View ${message.reply_count} replies`}
              </button>
            ) : null}
          </article>
        ) : (
          <MessageArticle
            key={message.id}
            message={message}
            me={props.me}
            dimmedPin={props.dimmedPins.has(message.id)}
            onAction={props.onAction}
            onOpenThread={props.onOpenThread}
            onOpenPhoto={props.onOpenPhoto}
          />
        ),
      )}
      {props.pending.map((send) => (
        <PendingArticle
          key={send.clientMessageId}
          send={send}
          me={props.me}
          onRetry={props.onRetry}
          onDiscard={props.onDiscard}
        />
      ))}
    </>
  );
}
