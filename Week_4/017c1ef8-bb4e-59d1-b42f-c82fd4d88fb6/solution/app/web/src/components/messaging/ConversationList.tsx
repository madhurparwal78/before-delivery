import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useConfig, useNow } from '../../clock';
import { relativeTime } from '../../format';
import type { ConversationSummary } from '../../types';

/** Where the list was left when a conversation was opened (phone: Back restores it). */
let leftAt: { conversationId: string; scrollY: number } | null = null;

interface ConversationListProps {
  conversations: ConversationSummary[];
  selectedId: string | null;
  /** The list is the only screen (phone), so Back restores its scroll position and focus. */
  restoreOnReturn: boolean;
}

export function ConversationList({ conversations, selectedId, restoreOnReturn }: ConversationListProps) {
  const config = useConfig();
  const now = useNow();
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!restoreOnReturn || !leftAt) return;
    const place = leftAt;
    leftAt = null;
    window.scrollTo(0, place.scrollY);
    list.current?.querySelector<HTMLElement>(`[data-conversation-id="${place.conversationId}"]`)?.focus({ preventScroll: true });
  }, [restoreOnReturn]);

  return (
    <ul className="plain-list conversation-list" aria-label="Conversations" ref={list}>
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <Link
            to={`/messaging/${conversation.id}`}
            className="conversation-link surface"
            data-conversation-id={conversation.id}
            data-unread={conversation.unread_count}
            aria-current={conversation.id === selectedId ? 'page' : undefined}
            onClick={() => {
              leftAt = { conversationId: conversation.id, scrollY: window.scrollY };
            }}
          >
            <span className="conversation-name t-heading">{conversation.other.name}</span>
            {conversation.last_message ? (
              <span className="conversation-preview muted">
                {conversation.last_message.text} · {relativeTime(conversation.last_message.sent_at, now, config.time_zone)}
              </span>
            ) : null}
            {conversation.unread_count > 0 ? <span className="conversation-unread">{conversation.unread_count} unread</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
