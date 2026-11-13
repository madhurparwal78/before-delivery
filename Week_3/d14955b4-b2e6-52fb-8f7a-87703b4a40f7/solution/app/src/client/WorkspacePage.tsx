import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { formatAmount } from '../shared/amount.js';
import { THREAD_STATUSES } from '../shared/types.js';
import type { InboxRow, MessageBody, PurchaseBody, ThreadStatus } from '../shared/types.js';
import { announce, useAnnouncement } from './announce.js';
import { RETURN_KEY, api, setSession, useSession } from './api.js';
import { Overlay, useOverlay } from './overlay.js';
import { inboxUrl, navigate, parseInbox } from './router.js';
import { TamperglassBody, useForensics } from './tamperglass.js';
import { Formatted, LinkPreview, eventWords, formatTime, purchaseStatusWords, statusWord } from './text.js';
import { Workspace } from './workspace.js';
import type { WorkspaceState } from './workspace.js';

type Layout = 'wide' | 'mid' | 'narrow';

function useLayout(): Layout {
  const subscribe = useCallback((listener: () => void) => {
    const queries = [window.matchMedia('(min-width: 1100px)'), window.matchMedia('(min-width: 600px)')];
    for (const query of queries) query.addEventListener('change', listener);
    return () => {
      for (const query of queries) query.removeEventListener('change', listener);
    };
  }, []);
  const read = (): Layout => (window.matchMedia('(min-width: 1100px)').matches ? 'wide' : window.matchMedia('(min-width: 600px)').matches ? 'mid' : 'narrow');
  return useSyncExternalStore(subscribe, read);
}

export function Link({ href, children, className, onNavigate }: { href: string; children: string; className?: string; onNavigate?: () => void }) {
  const go = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate?.();
    navigate(href);
  };
  return (
    <a href={href} className={className} onClick={go}>
      {children}
    </a>
  );
}

async function signOut(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST', staff: false }).catch(() => undefined);
  window.sessionStorage.removeItem(RETURN_KEY);
  setSession(null);
  announce('Sign-in announcements', "You're signed out.");
  navigate('/signin');
}

export function Banner({ developer }: { developer: boolean }) {
  return (
    <header className="banner">
      <Link href="/inbox">Inbox</Link>
      {developer ? <Link href="/team">Team</Link> : null}
      <button type="button" className="text-button" onClick={() => void signOut()}>
        Sign out
      </button>
    </header>
  );
}

const STATUS_LABELS: Record<ThreadStatus, string> = { waiting: 'Waiting', answered: 'Answered', closed: 'Closed' };

function ThreadList({
  ws, state, searchText, onSearch, onChoose,
}: { ws: Workspace; state: WorkspaceState; searchText: string; onSearch: (value: string) => void; onChoose?: () => void }) {
  const { route } = state;
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.focusRowId === null) return;
    const row = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(state.focusRowId)}"]`);
    if (!row) return;
    row.focus();
    ws.clearFocusRequests();
  }, [state.focusRowId, state.rows, ws]);
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [...(tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const next = buttons[(buttons.indexOf(event.currentTarget) + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    next?.focus();
    next?.click();
  };
  const empty = state.listReady && state.rows.length === 0;
  return (
    <div className="thread-list">
      <div className="tabs" role="tablist" aria-label="Thread status" ref={tabs}>
        {THREAD_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            className="tab"
            aria-selected={route.status === status}
            tabIndex={route.status === status ? 0 : -1}
            onKeyDown={onTabKey}
            onClick={() => navigate(inboxUrl({ ...route, status }))}
          >
            {`${STATUS_LABELS[status]} ${state.counts[status]}`}
          </button>
        ))}
      </div>
      <input
        type="search"
        className="field search"
        aria-label="Search threads"
        placeholder="Search threads"
        value={searchText}
        onChange={(event) => onSearch(event.target.value)}
      />
      {empty ? (
        <p className="note">{route.status === 'waiting' && route.q === '' ? 'No one is waiting. Back to the game.' : 'No threads here.'}</p>
      ) : (
        <ul className="rows" role="list" aria-label="Threads">
          {state.rows.map((row) => (
            <ThreadRow key={row.id} row={row} current={row.id === route.threadId} href={inboxUrl({ ...route, threadId: row.id })} ws={ws} onChoose={onChoose} />
          ))}
        </ul>
      )}
      {state.nextCursor ? (
        <button type="button" className="text-button more" onClick={() => void ws.loadMore()}>
          Show more threads
        </button>
      ) : null}
    </div>
  );
}

function ThreadRow({ row, current, href, ws, onChoose }: { row: InboxRow; current: boolean; href: string; ws: Workspace; onChoose?: () => void }) {
  const open = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onChoose?.();
    ws.openThreadFromList(row.id, { focusHeading: true });
  };
  return (
    <li>
      <a href={href} className="row" data-row={row.id} aria-current={current ? 'page' : undefined} onClick={open}>
        <span className="row-name">{row.player.name}</span>
        <span className="row-line">{row.first_line}</span>
        <span className={`status status-${row.status}`}>{row.status}</span>
      </a>
    </li>
  );
}

function usePersistedDraft(threadId: string | null): { text: string; setText: (value: string) => void; key: () => string; clear: () => void } {
  const storageKey = `hl:draft:${threadId}`;
  const [text, setTextState] = useState('');
  const key = useRef('');
  useEffect(() => {
    if (threadId === null) return;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as { text: string; key: string } | null;
      setTextState(saved?.text ?? '');
      key.current = saved?.key ?? '';
    } catch {
      setTextState('');
      key.current = '';
    }
  }, [threadId, storageKey]);
  const ensureKey = useCallback(() => (key.current ||= `hl-${crypto.randomUUID()}`), []);
  const setText = useCallback(
    (value: string) => {
      setTextState(value);
      if (threadId === null) return;
      if (value === '') window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, JSON.stringify({ text: value, key: ensureKey() }));
    },
    [threadId, storageKey, ensureKey],
  );
  const clear = useCallback(() => {
    setTextState('');
    key.current = '';
    window.sessionStorage.removeItem(storageKey);
  }, [storageKey]);
  return { text, setText, key: ensureKey, clear };
}

function PurchaseItem({ purchase, comparison }: { purchase: PurchaseBody; comparison: string }) {
  return (
    <li className="purchase ledger-entry">
      <span className="ledger-receipt">{purchase.receipt_id}</span> <span className="ledger-item">{purchase.item}</span>{' '}
      <span className="figures ledger-amount">{formatAmount(purchase.amount_minor, purchase.currency)}</span>{' '}
      <span className="word ledger-words">{purchaseStatusWords(purchase)}</span>
      <span className="word comparison">{comparison ? ` ${comparison}` : ''}</span>
    </li>
  );
}

function comparisonWords(state: WorkspaceState, purchase: PurchaseBody): string {
  const data = state.lookup && state.lookup.threadId === state.threadId ? state.lookup.data : null;
  if (!data?.available) return '';
  const found = data.purchases.find((entry) => entry.receipt_id === purchase.receipt_id);
  if (!found || found.on_game_server === null) return '';
  if (!found.on_game_server) return 'not on the game server';
  return found.differences.length > 0 ? `on the game server, differs: ${found.differences.join(', ')}` : 'on the game server';
}

function MessageItem({ message, selected, onSelect }: { message: MessageBody; selected: boolean; onSelect: () => void }) {
  const onKey = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };
  return (
    <li id={`message-${message.id}`} className={`message message-${message.kind}`} tabIndex={0} aria-current={selected ? 'true' : undefined} onClick={onSelect} onKeyDown={onKey}>
      <p className="message-meta">
        <span className="author">{message.author.name}</span> <time className="figures" dateTime={message.created_at}>{formatTime(message.created_at)}</time>
      </p>
      <p className="message-body">{message.event ? eventWords(message.event) : <Formatted text={message.body ?? ''} />}</p>
      {message.attachments.length > 0 ? (
        <ul className="attachments" role="list">
          {message.attachments.map((attachment) => (
            <li key={attachment.id}>
              <span>{attachment.filename}</span> <span className="word">{attachment.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {message.unfurl ? <LinkPreview preview={message.unfurl} /> : null}
    </li>
  );
}

function ThreadPane({
  ws, state, toolbar,
}: { ws: Workspace; state: WorkspaceState; toolbar: ReactNode }) {
  const { thread } = state;
  const heading = useRef<HTMLHeadingElement>(null);
  const draft = usePersistedDraft(thread?.id ?? null);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const lookup = state.lookup && state.lookup.threadId === state.threadId ? state.lookup : null;
  const receipts = thread !== null && lookup !== null && lookup.phase !== 'forbidden';
  const gameServer = useAnnouncement('Game server');
  useEffect(() => {
    if (thread && state.focusHeadingFor === thread.id && heading.current) {
      heading.current.focus();
      ws.clearFocusRequests();
    }
  }, [thread, state.focusHeadingFor, ws]);
  const send = async (): Promise<void> => {
    if (sending.current || !thread) return;
    if (draft.text.trim() === '') {
      setError('Write a reply before sending.');
      return;
    }
    setError('');
    sending.current = true;
    const result = await ws.sendReply({ text: draft.text, key: draft.key(), playerName: thread.player.name });
    sending.current = false;
    if (result === 'sent') draft.clear();
  };
  const onReplyKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  };
  if (!thread) return <section className="thread" aria-label="Thread">{toolbar}</section>;
  return (
    <section className="thread" aria-label="Thread">
      {toolbar}
      <h2 tabIndex={-1} ref={heading} className="thread-heading">{thread.player.name}</h2>
      <p className="meta">
        <span className="topic">{thread.topic}</span> <span className={`status status-${thread.status}`}>{thread.status}</span>
      </p>
      <button type="button" className="button compact close" onClick={() => void ws.closeThread()}>
        Close thread
      </button>
      {receipts && thread.purchases.length > 0 ? (
        <p className="list-label purchases-label" aria-hidden="true">Purchases</p>
      ) : null}
      {receipts && thread.purchases.length > 0 ? (
        <ul className="purchases" role="list" aria-label="Purchases">
          {thread.purchases.map((purchase) => (
            <PurchaseItem key={purchase.receipt_id} purchase={purchase} comparison={comparisonWords(state, purchase)} />
          ))}
        </ul>
      ) : null}
      <ul className="messages" role="list" aria-label="Messages">
        {thread.messages.map((message) => (
          <MessageItem key={message.id} message={message} selected={state.selectedMessageId === message.id} onSelect={() => ws.selectMessage(message.id)} />
        ))}
      </ul>
      <form className="reply" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="reply" className="label">Reply</label>
        <textarea id="reply" className="field reply-field" rows={4} value={draft.text} onChange={(event) => draft.setText(event.target.value)} onKeyDown={onReplyKey} aria-describedby={error ? 'reply-error' : undefined} />
        {error ? <p className="error" id="reply-error">{error}</p> : null}
        <button type="button" className="button primary send-reply" onClick={() => void send()}>
          Send reply
        </button>
      </form>
      {receipts ? (
        <section className="record" aria-label="Game server record">
          <p className="list-label" aria-hidden="true">Game server record</p>
          <button type="button" className="button compact" onClick={() => void ws.lookup(thread.id)}>
            Look up receipts again
          </button>
          <div role="status" aria-label="Game server" aria-live="polite" className="game-server">{gameServer}</div>
          {lookup?.data?.available && lookup.data.receipts.length > 0 ? (
            <ul className="record-list" role="list">
              {lookup.data.receipts.map((receipt) => (
                <li key={receipt.receipt_id} className="ledger-entry">
                  <span className="ledger-receipt">{receipt.receipt_id}</span> <span className="ledger-item">{receipt.item}</span>{' '}
                  <span className="figures ledger-amount">{formatAmount(receipt.amount_minor, receipt.currency)}</span>{' '}
                  <span className="word ledger-words">
                    {statusWord(receipt.status)} <time className="figures">{formatTime(receipt.purchased_at)}</time>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="searchbox"], [role="textbox"]') !== null;
}

export function WorkspacePage({ location }: { location: string }) {
  const session = useSession();
  const [ws] = useState(() => new Workspace());
  const state = useSyncExternalStore(ws.subscribe, ws.getSnapshot);
  const layout = useLayout();
  const inboxStatus = useAnnouncement('Inbox announcements');
  const { route, statusKnown } = parseInbox(location);
  const threadsButton = useRef<HTMLButtonElement>(null);
  const sheetButton = useRef<HTMLButtonElement>(null);
  const drawer = useOverlay(threadsButton);
  const sheet = useOverlay(sheetButton);

  useEffect(() => {
    if (!statusKnown) navigate(inboxUrl(route), { replace: true });
  }, [statusKnown, route.status, route.q, route.threadId]);
  useEffect(() => {
    ws.applyRoute(route);
  }, [ws, route.status, route.q, route.threadId]);
  useEffect(() => {
    document.title = 'Inbox · Hushline';
  }, []);
  useEffect(() => {
    ws.start();
    return () => ws.dispose();
  }, [ws]);

  const [searchText, setSearchText] = useState(route.q);
  const committed = useRef(route.q);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (route.q !== committed.current) {
      committed.current = route.q;
      setSearchText(route.q);
    }
  }, [route.q]);
  const onSearch = (value: string): void => {
    setSearchText(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      committed.current = value;
      const current = parseInbox(`${window.location.pathname}${window.location.search}`).route;
      navigate(inboxUrl({ ...current, q: value }), { replace: true });
    }, 200);
  };

  const messages = state.thread?.messages ?? [];
  const selected = messages.find((message) => message.id === state.selectedMessageId) ?? null;
  const lines = useForensics(selected?.id ?? null, selected?.kind === 'reply');

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === 'Escape') {
        if (sheet.open) sheet.hide();
        else if (drawer.open) drawer.hide();
        return;
      }
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (drawer.open) return;
      if (sheet.open) {
        if (key === 't') sheet.hide();
        return;
      }
      if (!'jknprct'.includes(key) || key.length !== 1) return;
      event.preventDefault();
      const index = messages.findIndex((message) => message.id === state.selectedMessageId);
      if (key === 'j' || key === 'k') {
        const target = messages[key === 'j' ? index + 1 : index === -1 ? messages.length - 1 : index - 1];
        if (!target) return;
        ws.selectMessage(target.id);
        const element = document.getElementById(`message-${target.id}`);
        element?.focus();
        element?.scrollIntoView({ block: 'nearest' });
      } else if (key === 'n' || key === 'p') ws.step(key === 'n' ? 1 : -1);
      else if (key === 'r') document.getElementById('reply')?.focus();
      else if (key === 'c') void ws.closeThread();
      else if (key === 't') {
        if (layout === 'narrow') sheet.show();
        else document.querySelector<HTMLElement>('.tamperglass .check')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws, messages, state.selectedMessageId, drawer, sheet, layout]);

  const developer = session?.user.role === 'developer';
  const list = <ThreadList ws={ws} state={state} searchText={searchText} onSearch={onSearch} onChoose={drawer.open ? drawer.hide : undefined} />;
  const toolbar =
    layout === 'wide' ? null : (
      <div className="toolbar">
        <button type="button" className="button compact" ref={threadsButton} onClick={drawer.show}>
          Threads
        </button>
        {layout === 'narrow' ? (
          <button type="button" className="button compact" ref={sheetButton} onClick={sheet.show}>
            Open Tamperglass
          </button>
        ) : null}
      </div>
    );
  const body = <TamperglassBody selected={selected !== null} replySelected={selected?.kind === 'reply'} lines={lines} />;

  return (
    <>
      <div className="workspace" data-layout={layout} inert={drawer.open || sheet.open}>
        <Banner developer={developer} />
        <div role="status" aria-label="Inbox announcements" aria-live="polite" className="announcements workspace-status">{inboxStatus}</div>
        <div className="panes">
          {layout === 'wide' ? <div className="pane-list">{list}</div> : null}
          <ThreadPane ws={ws} state={state} toolbar={toolbar} />
          {layout !== 'narrow' ? (
            <aside className="tamperglass" aria-label="Tamperglass">
              {body}
            </aside>
          ) : null}
        </div>
      </div>
      {drawer.mounted && layout !== 'wide' ? (
        <Overlay label="Threads" side="left" control={drawer}>
          <button type="button" className="text-button overlay-close" onClick={drawer.hide}>
            Close threads
          </button>
          {list}
        </Overlay>
      ) : null}
      {sheet.mounted && layout === 'narrow' ? (
        <Overlay label="Tamperglass" side="bottom" control={sheet}>
          <button type="button" className="text-button overlay-close" onClick={sheet.hide}>
            Close Tamperglass
          </button>
          <div className="tamperglass">{body}</div>
        </Overlay>
      ) : null}
    </>
  );
}
