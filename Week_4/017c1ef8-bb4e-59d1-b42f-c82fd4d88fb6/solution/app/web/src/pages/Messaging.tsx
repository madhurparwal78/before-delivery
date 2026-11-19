import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { announce } from '../announce';
import { api, ApiError } from '../api';
import { ConversationList } from '../components/messaging/ConversationList';
import { RefusedThread, Thread, type ThreadOther } from '../components/messaging/Thread';
import '../components/messaging/messaging.css';
import { useManagedFocus } from '../Layout';
import { useLive } from '../live';
import { useMember } from '../session';
import type { ConversationSummary, Profile } from '../types';
import { EmptyState, useMediaLayout } from '../ui';

type Started =
  | { status: 'loading' }
  | { status: 'refused'; name: string }
  | { status: 'unavailable' }
  | { status: 'ready'; conversationId: string; other: ThreadOther };

/** `/messaging/with/<handle>`: finds or starts the conversation with that member. */
function useStarted(handle: string | undefined): Started | null {
  const [started, setStarted] = useState<Started>({ status: 'loading' });

  useEffect(() => {
    if (!handle) return undefined;
    let cancelled = false;
    setStarted({ status: 'loading' });
    void (async () => {
      try {
        const profile = await api.get<Profile>(`/api/profiles/${encodeURIComponent(handle)}`);
        try {
          const opened = await api.post<{ id: string }>('/api/conversations', { member_id: profile.id });
          if (!cancelled) setStarted({ status: 'ready', conversationId: opened.id, other: { id: profile.id, name: profile.name, handle: profile.handle } });
        } catch (error) {
          if (error instanceof ApiError && error.status === 403 && !cancelled) setStarted({ status: 'refused', name: profile.name });
          else throw error;
        }
      } catch {
        if (!cancelled) setStarted({ status: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return handle ? started : null;
}

export default function Messaging() {
  const { conversationId, handle } = useParams();
  const member = useMember();
  const layout = useMediaLayout();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const started = useStarted(handle);
  useManagedFocus();

  const refresh = useCallback(async () => {
    const result = await api.get<{ conversations: ConversationSummary[] }>('/api/conversations');
    setConversations(result.conversations);
    return result.conversations;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLive(['message', 'read', 'reconnected'], (event) => {
    void refresh().then((current) => {
      if (event.type !== 'message' || event.sender_id === member.id) return;
      const from = current.find((conversation) => conversation.id === event.conversation_id);
      if (from) announce('Messaging announcements', `New message from ${from.other.name}`);
    });
  });

  const selectedId = conversationId ?? (started?.status === 'ready' ? started.conversationId : null);
  const phone = layout === 'phone';
  const opened = conversationId ?? handle ?? null;
  const other: ThreadOther | undefined =
    started?.status === 'ready' ? started.other : conversations?.find((conversation) => conversation.id === conversationId)?.other;

  useEffect(() => {
    if (phone && opened) window.scrollTo(0, 0);
  }, [phone, opened]);

  let thread = null;
  if (started?.status === 'refused') thread = <RefusedThread name={started.name} withBack={phone} />;
  else if (started?.status === 'unavailable') thread = <EmptyState heading="h1" sentence="This profile isn't available" action={{ label: 'Go to Home', to: '/feed' }} />;
  else if (selectedId && other) thread = <Thread key={selectedId} conversationId={selectedId} other={other} memberId={member.id} withBack={phone} />;
  else if (conversationId && conversations) thread = <EmptyState heading="h1" sentence="We couldn't find that page." action={{ label: 'Go to Home', to: '/feed' }} />;

  const showList = !phone || !opened;
  const empty = conversations !== null && conversations.length === 0;

  return (
    <div className={`messaging${opened ? ' has-thread' : ''}`}>
      {showList ? (
        <div className="messaging-list">
          <h1 className="page-title">Messaging</h1>
          {conversations && !empty ? <ConversationList conversations={conversations} selectedId={selectedId} restoreOnReturn={phone} /> : null}
          {empty && !opened ? <EmptyState sentence="No conversations yet." action={{ label: 'Go to My network', to: '/network' }} /> : null}
        </div>
      ) : null}
      {!phone || opened ? (
        <div className="messaging-thread">
          {thread}
          {!opened && !phone && !empty && conversations ? <p className="messaging-idle step-1">Choose a conversation.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
