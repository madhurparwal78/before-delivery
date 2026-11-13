import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Conversation } from '../../shared/types';
import { composerFocus } from '../lib/focus';
import { slideRow, takeRowSlide } from '../lib/motion';
import { ApiFailure, api } from '../store/api';
import { openConversationWith } from '../store/actions';
import { isMuted, nameOf } from '../store/conversations';
import { navigate } from '../store/router';
import { activityOf, byActivity, lettersOf, lineOf, postmarkOf } from '../store/selectors';
import { useStore } from '../store/state';
import type { LocalLetter, PeerProfile } from '../types';
import { Avatar } from '../ui/Avatar';
import { Link } from '../ui/Link';
import { Postmark } from '../ui/Postmark';
import { EmptySheet, Sheet } from '../ui/Sheet';

interface RowData {
  conversation: Conversation;
  last: LocalLetter | undefined;
  profile: PeerProfile | undefined;
}

function useRows(status: 'accepted' | 'request'): RowData[] {
  const conversations = useStore((state) => state.conversations);
  const letters = useStore((state) => state.letters);
  const hidden = useStore((state) => state.hidden);
  const profiles = useStore((state) => state.profiles);
  return useMemo(() => {
    const rows = Object.values(conversations)
      .filter((conversation) => conversation.status === status)
      .map((conversation) => {
        const own = lettersOf(letters, hidden, conversation.id);
        return { conversation, own, activity: activityOf(conversation, own) };
      })
      .filter((row) => status === 'request' || row.own.length > 0 || row.conversation.last_letter !== null)
      .sort((a, b) => byActivity(a.activity, b.activity));
    return rows.map((row) => ({ conversation: row.conversation, last: row.own.at(-1), profile: profiles[row.conversation.peer.id] }));
  }, [conversations, letters, hidden, profiles, status]);
}

function Row({ data, request }: { data: RowData; request: boolean }) {
  const { conversation, last, profile } = data;
  const name = request ? conversation.peer.username : nameOf(conversation);
  const mark = last ? postmarkOf(last) : null;
  const link = (
    <Link className="row" to={`/letters/${conversation.id}`} {...(request ? {} : { 'data-testid': 'conversation-row', 'data-conversation-id': conversation.id })}>
      <Avatar profile={request ? undefined : profile} />
      <span className="row__body">
        <span className="row__name">{name}</span>
        {!request && isMuted(conversation) && <span className="row__muted">Muted</span>}
        <span className="row__line">{last ? lineOf(last) : ''}</span>
      </span>
      <span className="row__meta">
        {last && mark && <Postmark letterId={last.id} label={mark.label} time={mark.time} />}
        <span className="row__slot">
          {!request && conversation.unread > 0 && (
            <span className="badge" data-testid="unread-badge">
              {conversation.unread > 99 ? '99+' : conversation.unread}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
  return request ? (
    <li data-testid="request-row" data-conversation-id={conversation.id}>
      {link}
    </li>
  ) : (
    <li>{link}</li>
  );
}

export function ChatsList() {
  const rows = useRows('accepted');
  const loaded = useStore((state) => state.conversationsLoaded);
  const requests = useStore((state) => Object.values(state.conversations).filter((conversation) => conversation.status === 'request').length);
  const list = useRef<HTMLUListElement>(null);
  const signature = rows.map((row) => row.conversation.id).join(',');
  useLayoutEffect(() => {
    const slide = takeRowSlide();
    if (!slide || !list.current) return;
    const row = list.current.querySelector<HTMLElement>(`[data-conversation-id="${slide.conversationId}"]`);
    if (row) slideRow(row, slide.before);
  }, [signature]);
  return (
    <div className="list">
      <h1 className="list__title">Chats</h1>
      {requests > 0 && (
        <Link className="requests-link" to="/requests">
          Letter requests ({requests})
        </Link>
      )}
      {rows.length === 0 ? (
        loaded ? (
          <EmptySheet>No letters yet. Find someone by their exact username.</EmptySheet>
        ) : (
          <Sheet className="sheet--list" loading>
            <span />
          </Sheet>
        )
      ) : (
        <ul ref={list} className="rows" aria-label="Conversations">
          {rows.map((row) => (
            <Row key={row.conversation.id} data={row} request={false} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function RequestsList() {
  const rows = useRows('request');
  return (
    <div className="list">
      <Link className="jump-link" to="/letters">
        Back to Chats
      </Link>
      <h1 className="list__title">Letter requests</h1>
      {rows.length === 0 ? (
        <EmptySheet>No letter requests.</EmptySheet>
      ) : (
        <ul className="rows" aria-label="Letter requests">
          {rows.map((row) => (
            <Row key={row.conversation.id} data={row} request />
          ))}
        </ul>
      )}
    </div>
  );
}

interface Found {
  id: string;
  username: string;
}

export function ContactsList() {
  const conversations = useStore((state) => state.conversations);
  const profiles = useStore((state) => state.profiles);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<{ found: Found | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const contacts = useMemo(
    () => Object.values(conversations).filter((conversation) => conversation.status === 'accepted').sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [conversations, profiles],
  );

  async function lookup(event: FormEvent): Promise<void> {
    event.preventDefault();
    const username = name.trim();
    if (!username) return;
    setBusy(true);
    try {
      const found = await api<Found>('GET', `/api/lookup?username=${encodeURIComponent(username)}`);
      setResult({ found });
      setStatus(`Found ${found.username}.`);
    } catch (error) {
      if (!(error instanceof ApiFailure && error.status === 404)) {
        setResult({ found: null });
        setStatus('Something went wrong. Try again.');
        setBusy(false);
        return;
      }
      setResult({ found: null });
      setStatus('No one with that username.');
    }
    setBusy(false);
    setTimeout(() => region.current?.focus(), 0);
    region.current?.focus();
  }

  async function write(found: Found): Promise<void> {
    const id = await openConversationWith(found.id);
    composerFocus.id = id;
    navigate(`/letters/${id}`);
  }

  return (
    <div className="list">
      <h1 className="list__title">Contacts</h1>
      <form className="panel" onSubmit={(event) => void lookup(event)}>
        <label className="field" htmlFor="find">
          Find by username
        </label>
        <div className="well">
          <input id="find" type="text" placeholder="Their exact username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <button type="submit" className="button button--ink" aria-busy={busy || undefined} disabled={busy}>
          Find
        </button>
        <p role="status" aria-label="Lookup status" className="sr-only">
          {status}
        </p>
      </form>
      <div ref={region} role="region" aria-label="Lookup result" tabIndex={-1} className="lookup">
        {result?.found && (
          <div className="lookup__card">
            <Avatar profile={undefined} size={64} />
            <p className="lookup__name">{result.found.username}</p>
            <button type="button" className="button button--ink" onClick={() => void write(result.found!)}>
              Write a letter
            </button>
          </div>
        )}
        {result && !result.found && <p className="lookup__miss">No one with that username.</p>}
      </div>
      {contacts.length === 0 ? (
        <EmptySheet>No contacts yet.</EmptySheet>
      ) : (
        <ul className="rows" aria-label="Contacts">
          {contacts.map((conversation) => (
            <li key={conversation.id}>
              <Link className="row row--contact" to={`/letters/${conversation.id}`}>
                          <Avatar profile={profiles[conversation.peer.id]} />
                <span className="row__body">
                  <span className="row__name">{nameOf(conversation)}</span>
                  <span className="row__line">{conversation.peer.username}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
