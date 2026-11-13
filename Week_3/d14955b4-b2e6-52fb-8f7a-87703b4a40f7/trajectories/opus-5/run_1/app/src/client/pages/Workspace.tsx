import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COPY,
  refusedEventAnnouncement,
  replySentAnnouncement,
  showingThreads,
  waitingAnnouncement,
} from '../../shared/copy';
import { formatAmount } from '../../shared/amount';
import type {
  InboxBody,
  InboxRow,
  ReceiptLookupBody,
  SessionBody,
  ThreadBody,
  ThreadMessage,
  ThreadStatus,
} from '../../shared/types';
import { ApiFailure, api, logout, peekResume, storeSignInNotice, takeResume } from '../lib/api';
import { navigate, useLocation } from '../lib/router';
import { openStream } from '../lib/sse';
import { newIdempotencyKey, useReducedMotion, useSidePane, useThreePanes } from '../lib/media';
import { comparisonWords, eventWords, formatPlayerText, formatText, formatTime, refundWords, statusWords } from '../lib/format';
import { Tamperglass } from './Tamperglass';
import { Overlay } from './Overlay';

type OverlayState = 'closed' | 'open' | 'closing';

interface LookupState {
  kind: 'hidden' | 'pending' | 'ready' | 'outage';
  body: ReceiptLookupBody | null;
}

function parseStatus(raw: string | null): { status: ThreadStatus; known: boolean } {
  if (raw === null || raw === '') return { status: 'waiting', known: true };
  if (raw === 'waiting' || raw === 'answered' || raw === 'closed') return { status: raw, known: true };
  return { status: 'waiting', known: false };
}

function buildQuery(status: ThreadStatus, q: string): string {
  const params = new URLSearchParams();
  if (status !== 'waiting') params.set('status', status);
  if (q !== '') params.set('q', q);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * The server's answer gives the order of every row still in the shown status.
 * A row whose thread has left that status keeps the place it held.
 */
function mergeRows(existing: InboxRow[], fetched: InboxRow[]): InboxRow[] {
  const fetchedIds = new Set(fetched.map((row) => row.id));
  const result = [...fetched];
  existing.forEach((row, index) => {
    if (fetchedIds.has(row.id)) return;
    result.splice(Math.min(index, result.length), 0, row);
  });
  return result;
}

interface WorkspaceProps {
  session: SessionBody;
  draftRef: React.MutableRefObject<string>;
}

export function WorkspacePage({ session, draftRef }: WorkspaceProps): React.ReactElement {
  const location = useLocation();
  const threePanes = useThreePanes();
  const sidePane = useSidePane();
  const reducedMotion = useReducedMotion();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const statusParam = parseStatus(params.get('status'));
  const status = statusParam.status;
  const q = params.get('q') ?? '';
  const threadId = location.pathname.startsWith('/inbox/') ? location.pathname.slice('/inbox/'.length) : null;

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [counts, setCounts] = useState({ waiting: 0, answered: 0, closed: 0 });
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const [thread, setThread] = useState<ThreadBody | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupState>({ kind: 'pending', body: null });
  const [gameServerNotice, setGameServerNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [draft, setDraft] = useState('');
  const [replyError, setReplyError] = useState('');
  const [replyPending, setReplyPending] = useState(false);
  const [searchText, setSearchText] = useState(q);
  const [drawer, setDrawer] = useState<OverlayState>('closed');
  const [sheet, setSheet] = useState<OverlayState>('closed');
  const [tamperglassFocused, setTamperglassFocused] = useState(false);

  const draftKeyRef = useRef<string | null>(null);
  const listTokenRef = useRef(0);
  const threadTokenRef = useRef(0);
  const lookupTokenRef = useRef(0);
  const focusHeadingRef = useRef(false);
  const keepAnnouncementRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLUListElement>(null);
  const checksRef = useRef<HTMLUListElement>(null);
  const rowsRef = useRef<HTMLUListElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const sheetOpenerRef = useRef<HTMLButtonElement>(null);
  const drawerOpenerRef = useRef<HTMLButtonElement>(null);
  const knownStatus = useRef(new Map<string, ThreadStatus>());
  const rowsStateRef = useRef<InboxRow[]>([]);
  const cursorsRef = useRef<Array<string | null>>([null]);
  const threadIdRef = useRef<string | null>(threadId);

  rowsStateRef.current = rows;
  cursorsRef.current = cursors;
  threadIdRef.current = threadId;
  draftRef.current = draft;

  const threadUrl = (id: string): string => `/inbox/${encodeURIComponent(id)}${buildQuery(status, q)}`;

  useEffect(() => {
    if (!statusParam.known) {
      navigate(`${location.pathname}${buildQuery('waiting', q)}`, { replace: true });
    }
  }, [statusParam.known, location.pathname, q]);

  useEffect(() => {
    setSearchText(q);
  }, [q]);

  const applyInbox = useCallback(
    (body: InboxBody, pageCursors: Array<string | null>, merge: boolean) => {
      setCounts(body.counts);
      setNextCursor(body.next_cursor);
      setCursors(pageCursors);
      setRows((current) => (merge ? mergeRows(current, body.threads) : body.threads));
      for (const row of body.threads) knownStatus.current.set(row.id, row.status);
      setListLoaded(true);
    },
    [status],
  );

  const loadFirstPage = useCallback(async () => {
    listTokenRef.current += 1;
    const token = listTokenRef.current;
    try {
      const body = await api<InboxBody>(
        `/api/inbox?status=${status}&q=${encodeURIComponent(q)}&limit=25`,
      );
      if (token !== listTokenRef.current) return;
      applyInbox(body, [null], false);
    } catch {
      if (token !== listTokenRef.current) return;
      setListLoaded(true);
    }
  }, [status, q, applyInbox]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  /**
   * Re-reads every loaded page. Live rows keep their place by merging; a rule
   * change replaces them, so newly unreadable threads leave the list.
   */
  const refreshLoadedPages = useCallback(async (replace = false) => {
    listTokenRef.current += 1;
    const token = listTokenRef.current;
    const pageCursors = [...cursorsRef.current];
    const collected: InboxRow[] = [];
    let last: InboxBody | null = null;
    try {
      for (const cursor of pageCursors) {
        const query = `/api/inbox?status=${status}&q=${encodeURIComponent(q)}&limit=25${
          cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
        }`;
        const body = await api<InboxBody>(query);
        if (token !== listTokenRef.current) return;
        last = body;
        for (const row of body.threads) {
          if (!collected.some((entry) => entry.id === row.id)) collected.push(row);
        }
      }
    } catch {
      return;
    }
    if (last === null || token !== listTokenRef.current) return;
    setCounts(last.counts);
    setNextCursor(last.next_cursor);
    setRows((current) => (replace ? collected : mergeRows(current, collected)));
    for (const row of collected) knownStatus.current.set(row.id, row.status);
  }, [status, q]);

  const loadThread = useCallback(
    async (id: string, focusHeading: boolean) => {
      threadTokenRef.current += 1;
      const token = threadTokenRef.current;
      focusHeadingRef.current = focusHeading;
      try {
        const body = await api<ThreadBody>(`/api/threads/${encodeURIComponent(id)}`);
        if (token !== threadTokenRef.current) return;
        setThread(body);
      } catch (error) {
        if (token !== threadTokenRef.current) return;
        if (error instanceof ApiFailure && error.status === 404) {
          setThread(null);
          navigate(`/inbox${buildQuery(status, q)}`);
          setAnnouncement(COPY.threadUnavailable);
        }
      }
    },
    [status, q],
  );

  const runLookup = useCallback(async (id: string) => {
    lookupTokenRef.current += 1;
    const token = lookupTokenRef.current;
    setLookup({ kind: 'pending', body: null });
    setGameServerNotice(COPY.lookupPending);
    try {
      const body = await api<ReceiptLookupBody>(`/api/threads/${encodeURIComponent(id)}/receipt-lookup`);
      if (token !== lookupTokenRef.current) return;
      if (!body.available) {
        setLookup({ kind: 'outage', body });
        setGameServerNotice(COPY.lookupOutage);
        return;
      }
      setLookup({ kind: 'ready', body });
      setGameServerNotice(body.receipts.length === 0 ? COPY.lookupEmpty : '');
    } catch (error) {
      if (token !== lookupTokenRef.current) return;
      if (error instanceof ApiFailure && error.status === 403) {
        setLookup({ kind: 'hidden', body: null });
        setGameServerNotice('');
        return;
      }
      setLookup({ kind: 'outage', body: null });
      setGameServerNotice(COPY.lookupOutage);
    }
  }, []);

  useEffect(() => {
    if (threadId === null) {
      setThread(null);
      setSelectedId(null);
      setLookup({ kind: 'hidden', body: null });
      setGameServerNotice('');
      return;
    }
    setSelectedId(null);
    setThread(null);
    if (keepAnnouncementRef.current) keepAnnouncementRef.current = false;
    else setAnnouncement(COPY.openingThread);
    void loadThread(threadId, focusHeadingRef.current);
    void runLookup(threadId);
  }, [threadId, loadThread, runLookup]);

  useEffect(() => {
    const resume = peekResume();
    if (resume !== null && resume.url === `${location.pathname}${location.search}`) {
      takeResume();
      setDraft(resume.reply);
      if (resume.reply !== '') draftKeyRef.current = newIdempotencyKey();
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (thread === null || !focusHeadingRef.current) return;
    focusHeadingRef.current = false;
    headingRef.current?.focus();
  }, [thread]);

  /** One live stream for the workspace. */
  useEffect(() => {
    const controller = new AbortController();
    openStream(
      '/api/stream',
      {
        onEvent: (name, data) => {
          if (name === 'permissions') {
            void refreshLoadedPages(true);
            const open = threadIdRef.current;
            if (open !== null) {
              void loadThread(open, false);
              void runLookup(open);
            }
            return;
          }
          if (name === 'thread') {
            const frame = data as {
              thread_id: string;
              status: ThreadStatus;
              player_name: string;
              reason: string;
            };
            const previous = knownStatus.current.get(frame.thread_id);
            if (frame.reason === 'player_message' && frame.status === 'waiting' && previous !== 'waiting') {
              setAnnouncement(waitingAnnouncement(frame.player_name));
            }
            knownStatus.current.set(frame.thread_id, frame.status);
            setRows((current) =>
              current.map((row) => (row.id === frame.thread_id ? { ...row, status: frame.status } : row)),
            );
            void refreshLoadedPages();
            if (threadIdRef.current === frame.thread_id) void loadThread(frame.thread_id, false);
            return;
          }
          if (name === 'refused') {
            const frame = data as { thread_id: string; player_name: string; reason_words: string };
            setAnnouncement(refusedEventAnnouncement(frame.player_name, frame.reason_words));
            if (threadIdRef.current === frame.thread_id) void loadThread(frame.thread_id, false);
          }
        },
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [refreshLoadedPages, loadThread, runLookup]);

  const openThread = (id: string, fromWorkspace: boolean): void => {
    focusHeadingRef.current = fromWorkspace;
    navigate(threadUrl(id));
  };

  const changeStatus = (next: ThreadStatus): void => {
    const path = threadId === null ? '/inbox' : `/inbox/${encodeURIComponent(threadId)}`;
    navigate(`${path}${buildQuery(next, q)}`);
  };

  const searchTimer = useRef<number | null>(null);
  const changeSearch = (text: string): void => {
    setSearchText(text);
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      const path = threadId === null ? '/inbox' : `/inbox/${encodeURIComponent(threadId)}`;
      navigate(`${path}${buildQuery(status, text)}`, { replace: true });
    }, 250);
  };

  const showMore = async (): Promise<void> => {
    if (nextCursor === null) return;
    setAnnouncement(COPY.loadingMore);
    const cursor = nextCursor;
    try {
      const body = await api<InboxBody>(
        `/api/inbox?status=${status}&q=${encodeURIComponent(q)}&limit=25&cursor=${encodeURIComponent(cursor)}`,
      );
      const firstNew = body.threads[0]?.id;
      setCounts(body.counts);
      setNextCursor(body.next_cursor);
      setCursors((current) => [...current, cursor]);
      let total = 0;
      setRows((current) => {
        const merged = [...current];
        for (const row of body.threads) {
          if (!merged.some((entry) => entry.id === row.id)) merged.push(row);
          knownStatus.current.set(row.id, row.status);
        }
        total = merged.length;
        return merged;
      });
      setAnnouncement(showingThreads(total));
      if (firstNew !== undefined) {
        window.setTimeout(() => {
          rowsRef.current?.querySelector<HTMLAnchorElement>(`a[data-thread="${firstNew}"]`)?.focus();
        }, 0);
      }
    } catch {
      setAnnouncement(COPY.moreFailed);
    }
  };

  const sendReply = async (): Promise<void> => {
    if (replyPending || thread === null) return;
    if (draft.trim() === '') {
      setReplyError(COPY.replyEmpty);
      setAnnouncement(COPY.replyEmpty);
      return;
    }
    setReplyError('');
    if (draftKeyRef.current === null) draftKeyRef.current = newIdempotencyKey();
    const key = draftKeyRef.current;
    setReplyPending(true);
    setAnnouncement(COPY.sendingReply);
    try {
      await api(`/api/threads/${encodeURIComponent(thread.id)}/replies`, {
        method: 'POST',
        body: { body: draft },
        idempotencyKey: key,
      });
      setAnnouncement(replySentAnnouncement(thread.player.name));
      setDraft('');
      draftKeyRef.current = null;
      await loadThread(thread.id, false);
      void refreshLoadedPages();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'idempotency_in_progress') {
        setAnnouncement(replySentAnnouncement(thread.player.name));
      } else if (error instanceof ApiFailure && error.code === 'thread_closed') {
        setAnnouncement(COPY.replyClosed);
      } else if (error instanceof ApiFailure && error.status === 422) {
        setReplyError(error.fields.body ?? COPY.replyEmpty);
        setAnnouncement(error.fields.body ?? COPY.replyEmpty);
      } else {
        setAnnouncement(COPY.replyFailed);
      }
    } finally {
      setReplyPending(false);
    }
  };

  const closeOpenThread = async (): Promise<void> => {
    if (thread === null) return;
    const closingId = thread.id;
    setAnnouncement(COPY.closingThread);
    try {
      await api(`/api/threads/${encodeURIComponent(closingId)}/close`, { method: 'POST', body: {} });
      setAnnouncement(COPY.threadClosed);
      knownStatus.current.set(closingId, 'closed');
      setRows((current) =>
        current.map((row) => (row.id === closingId ? { ...row, status: 'closed' as ThreadStatus } : row)),
      );
      const loaded = rowsStateRef.current;
      const index = loaded.findIndex((row) => row.id === closingId);
      const next = loaded[index + 1] ?? loaded[index - 1] ?? null;
      if (next) {
        keepAnnouncementRef.current = true;
        openThread(next.id, true);
      } else {
        navigate(`/inbox${buildQuery(status, q)}`);
        window.setTimeout(() => {
          const first = rowsRef.current?.querySelector<HTMLAnchorElement>('a[data-thread]');
          if (first) first.focus();
          else emptyRef.current?.focus();
        }, 0);
      }
      void refreshLoadedPages();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'not_answered') setAnnouncement(COPY.closeNotAnswered);
      else if (error instanceof ApiFailure && error.code === 'already_closed') setAnnouncement(COPY.closeAlready);
      else setAnnouncement(COPY.closeNotAnswered);
    }
  };

  const messages = thread?.messages ?? [];
  const selectedMessage = messages.find((message) => message.id === selectedId) ?? null;

  const selectMessage = (id: string): void => {
    setSelectedId(id);
    window.setTimeout(() => {
      const item = messagesRef.current?.querySelector<HTMLLIElement>(`li[data-message="${id}"]`);
      item?.focus();
      item?.scrollIntoView({ block: 'nearest' });
    }, 0);
  };

  const stepMessage = (delta: number): void => {
    if (messages.length === 0) return;
    if (selectedId === null) {
      const target = delta > 0 ? messages[0] : messages[messages.length - 1];
      if (target) selectMessage(target.id);
      return;
    }
    const index = messages.findIndex((message) => message.id === selectedId);
    const next = messages[index + delta];
    if (next) selectMessage(next.id);
  };

  const stepThread = (delta: number): void => {
    const loaded = rowsStateRef.current;
    if (loaded.length === 0) return;
    const index = loaded.findIndex((row) => row.id === threadIdRef.current);
    const target = index === -1 ? loaded[0] : loaded[index + delta];
    if (target) openThread(target.id, true);
  };

  const closeDrawer = useCallback(() => {
    setDrawer((current) => (current === 'open' ? 'closing' : current));
    window.setTimeout(() => {
      setDrawer((current) => (current === 'closing' ? 'closed' : current));
      drawerOpenerRef.current?.focus();
    }, reducedMotion ? 0 : 250);
  }, [reducedMotion]);

  const closeSheet = useCallback(() => {
    setSheet((current) => (current === 'open' ? 'closing' : current));
    window.setTimeout(() => {
      setSheet((current) => (current === 'closing' ? 'closed' : current));
      sheetOpenerRef.current?.focus();
    }, reducedMotion ? 0 : 250);
  }, [reducedMotion]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true;
      if (event.key === 'Escape') {
        if (sheet === 'open') closeSheet();
        else if (drawer === 'open') closeDrawer();
        return;
      }
      if (typing) return;
      const key = event.key.toLowerCase();
      if (drawer === 'open' || sheet === 'open') {
        if (key === 't' && sheet === 'open') {
          event.preventDefault();
          closeSheet();
        }
        return;
      }
      if (key === 'j') {
        event.preventDefault();
        stepMessage(1);
      } else if (key === 'k') {
        event.preventDefault();
        stepMessage(-1);
      } else if (key === 'n') {
        event.preventDefault();
        stepThread(1);
      } else if (key === 'p') {
        event.preventDefault();
        stepThread(-1);
      } else if (key === 'r') {
        event.preventDefault();
        replyRef.current?.focus();
      } else if (key === 'c') {
        event.preventDefault();
        void closeOpenThread();
      } else if (key === 't') {
        event.preventDefault();
        if (sidePane) checksRef.current?.querySelector<HTMLLIElement>('li.check-line')?.focus();
        else setSheet('open');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // re-bound every render so the shortcuts read the current rows and selection
  });

  useEffect(() => {
    if (threePanes && drawer !== 'closed') setDrawer('closed');
    if (sidePane && sheet !== 'closed') setSheet('closed');
  }, [threePanes, sidePane, drawer, sheet]);

  const signOut = async (): Promise<void> => {
    await logout();
    storeSignInNotice(COPY.signedOut);
    navigate('/signin');
  };

  const threadList = (
    <div className="thread-list">
      <div role="tablist" aria-label="Thread status" className="tabs">
        {(['waiting', 'answered', 'closed'] as ThreadStatus[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === status}
            className={tab === status ? 'tab selected' : 'tab'}
            onClick={() => changeStatus(tab)}
          >
            {`${tab.charAt(0).toUpperCase()}${tab.slice(1)} ${counts[tab]}`}
          </button>
        ))}
      </div>
      <input
        className="search"
        type="search"
        aria-label="Search threads"
        value={searchText}
        onChange={(event) => changeSearch(event.target.value)}
      />
      {rows.length === 0 && listLoaded ? (
        <p className="pane-note" tabIndex={-1} ref={emptyRef}>
          {status === 'waiting' && q === '' ? COPY.emptyWaiting : COPY.emptyOther}
        </p>
      ) : (
        <ul className="rows" aria-label="Threads" ref={rowsRef}>
          {rows.map((row) => (
            <li key={row.id}>
              <a
                href={threadUrl(row.id)}
                data-thread={row.id}
                aria-current={row.id === threadId ? 'page' : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  if (drawer === 'open') {
                    focusHeadingRef.current = true;
                    navigate(threadUrl(row.id));
                    closeDrawer();
                  } else {
                    openThread(row.id, false);
                  }
                }}
              >
                <span className="row-player">{row.player.name}</span>
                <span className="row-line">{row.first_line}</span>
                <span className={row.status === 'waiting' ? 'row-status waiting' : 'row-status'}>{row.status}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {nextCursor !== null && (
        <button type="button" className="text-button" onClick={() => void showMore()}>
          Show more threads
        </button>
      )}
    </div>
  );

  const purchases = thread?.purchases ?? [];
  const comparisons = lookup.body?.purchases ?? [];
  const receiptsVisible = lookup.kind !== 'hidden';

  const threadPane = thread === null ? (
    <div className="thread-pane empty" />
  ) : (
    <div className="thread-pane">
      <div className="thread-head">
        <h2 tabIndex={-1} ref={headingRef}>
          {thread.player.name}
        </h2>
        <p className="thread-meta">
          <span>{thread.topic}</span> <span>{thread.status}</span>
        </p>
        <button type="button" className="text-button" onClick={() => void closeOpenThread()}>
          Close thread
        </button>
      </div>
      {receiptsVisible && (
        <ul className="purchases" aria-label="Purchases">
          {purchases.map((purchase) => {
            const words = comparisonWords(comparisons.find((entry) => entry.receipt_id === purchase.receipt_id));
            return (
              <li key={purchase.receipt_id}>
                <span className="purchase-id">{purchase.receipt_id}</span>
                <span className="purchase-item">{purchase.item}</span>
                <span className="figures">{formatAmount(purchase.amount_minor, purchase.currency)}</span>
                <span className="purchase-refund">{refundWords(purchase)}</span>
                {words !== null && <span className="purchase-compare">{words}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <ul className="messages" aria-label="Messages" ref={messagesRef}>
        {messages.map((message) => (
          <li
            key={message.id}
            data-message={message.id}
            tabIndex={0}
            aria-current={message.id === selectedId ? 'true' : undefined}
            className={`message ${message.kind}`}
            onClick={() => setSelectedId(message.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelectedId(message.id);
              }
            }}
          >
            <span className="message-author">{message.author.name}</span>
            <span className="figures message-time">{formatTime(message.created_at)}</span>
            <span className="message-body">{messageWords(message)}</span>
            {message.attachments.map((attachment) => (
              <span className="attachment" key={attachment.id}>
                <span className="attachment-name">{attachment.filename}</span>
                <span className="attachment-status">{attachment.status}</span>
              </span>
            ))}
            {message.unfurl !== null && (
              <span className="unfurl">
                <span className="unfurl-title">{message.unfurl.title}</span>
                {message.unfurl.description !== null && (
                  <span className="unfurl-description">{message.unfurl.description}</span>
                )}
                <span className="unfurl-host">{hostOf(message.unfurl.url)}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="reply-form">
        <label htmlFor="reply-box">Reply</label>
        <textarea
          id="reply-box"
          ref={replyRef}
          value={draft}
          onChange={(event) => {
            if (draftKeyRef.current === null) draftKeyRef.current = newIdempotencyKey();
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void sendReply();
            }
          }}
        />
        {replyError !== '' && <p className="field-error">{replyError}</p>}
        <button
          type="button"
          className={tamperglassFocused ? 'ink-button' : 'accent-button'}
          onClick={() => void sendReply()}
        >
          Send reply
        </button>
      </div>
      {receiptsVisible && (
        <div className="record" role="region" aria-label="Game server record">
          <ul className="receipts">
            {(lookup.body?.receipts ?? []).map((receipt) => (
              <li key={receipt.receipt_id}>
                <span className="purchase-id">{receipt.receipt_id}</span>
                <span className="purchase-item">{receipt.item}</span>
                <span className="figures">{formatAmount(receipt.amount_minor, receipt.currency)}</span>
                <span className="purchase-refund">{statusWords(receipt.status)}</span>
                <span className="figures">{formatTime(receipt.purchased_at)}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="text-button" onClick={() => thread && void runLookup(thread.id)}>
            Look up receipts again
          </button>
          <p className="live-region" role="status" aria-label="Game server" aria-live="polite">
            {gameServerNotice}
          </p>
        </div>
      )}
    </div>
  );

  const pane = (
    <Tamperglass message={selectedMessage} listRef={checksRef} onAccentChange={setTamperglassFocused} />
  );

  return (
    <div className={`workspace ${threePanes ? 'three' : sidePane ? 'two' : 'one'}`}>
      <header className="banner">
        <a href="/inbox" onClick={(event) => { event.preventDefault(); navigate(`/inbox${buildQuery(status, q)}`); }}>
          Inbox
        </a>
        {session.user.role === 'developer' && (
          <a href="/team" onClick={(event) => { event.preventDefault(); navigate('/team'); }}>
            Team
          </a>
        )}
        <button type="button" className="text-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <div className="workspace-tools">
        {!threePanes && (
          <button
            type="button"
            className="text-button"
            ref={drawerOpenerRef}
            onClick={() => setDrawer('open')}
          >
            Threads
          </button>
        )}
        {!sidePane && (
          <button type="button" className="text-button" ref={sheetOpenerRef} onClick={() => setSheet('open')}>
            Open Tamperglass
          </button>
        )}
      </div>
      <div className="workspace-body">
        {threePanes && <div className="list-column">{threadList}</div>}
        <div className="thread-column">{threadPane}</div>
        {sidePane && (
          <aside className="pane-column" role="complementary" aria-label="Tamperglass">
            {pane}
          </aside>
        )}
      </div>
      <p className="live-region" role="status" aria-label="Inbox announcements" aria-live="polite">
        {announcement}
      </p>
      {drawer !== 'closed' && (
        <Overlay label="Threads" className="drawer" state={drawer === 'closing' ? 'closing' : 'open'} onClose={closeDrawer}>
          <button type="button" className="text-button" onClick={closeDrawer}>
            Close threads
          </button>
          {threadList}
        </Overlay>
      )}
      {sheet !== 'closed' && (
        <Overlay label="Tamperglass" className="sheet" state={sheet === 'closing' ? 'closing' : 'open'} onClose={closeSheet}>
          <button type="button" className="text-button" onClick={closeSheet}>
            Close Tamperglass
          </button>
          {pane}
        </Overlay>
      )}
    </div>
  );
}

function messageWords(message: ThreadMessage): React.ReactNode {
  if (message.kind === 'event' && message.event !== null) {
    return <span className={message.event.verdict === 'refused' ? 'refused-event' : ''}>{eventWords(message.event)}</span>;
  }
  if (message.kind === 'player') return formatPlayerText(message.body ?? '');
  return formatText(message.body ?? '');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
