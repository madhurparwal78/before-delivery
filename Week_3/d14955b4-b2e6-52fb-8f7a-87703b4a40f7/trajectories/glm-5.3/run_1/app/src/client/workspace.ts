// The workspace: thread list, thread view and Tamperglass.
import { el } from './publicPage';
import { api, apiStream, onChangeSession, setChangeToken } from './api';
import { announce, registerLiveRegion } from './announce';
import { renderFormatted } from './formatting';
import { formatAmount, formatTime, refundWords, receiptStatusWords, comparisonWords } from './format';
import { buildTamperglass, setChecking, showPrompt, markSettled, verdictSentence, TamperglassElements } from './tamperglass';
import type { ForensicsBody, ForensicsLine, InboxBody, InboxRowBody, Message, ReceiptLookupBody, SessionBody, ThreadBody } from './types';

interface AppElements {
  tabs: Record<'waiting' | 'answered' | 'closed', HTMLButtonElement>;
  search: HTMLInputElement;
  rows: HTMLUListElement;
  moreButton: HTMLButtonElement | null;
  threadPane: HTMLElement;
  tamper: TamperglassElements;
  reply: HTMLTextAreaElement;
  announcements: HTMLElement;
  gameServerStatus: HTMLElement;
  purchasesList: HTMLElement;
  recordList: HTMLElement;
  drawerButton: HTMLButtonElement | null;
  drawer: HTMLElement | null;
  drawerBackdrop: HTMLElement | null;
  sheetButton: HTMLButtonElement | null;
  sheetBackdrop: HTMLElement | null;
  messagesList: HTMLElement;
  closeThreadButton: HTMLButtonElement | null;
  heading: HTMLHeadingElement | null;
}

const state = {
  session: null as SessionBody | null,
  status: 'waiting' as 'waiting' | 'answered' | 'closed',
  query: '',
  rows: [] as InboxRowBody[],
  nextCursor: null as string | null,
  openThreadId: null as string | null,
  thread: null as ThreadBody | null,
  selectedMessage: null as string | null,
  lookup: null as ReceiptLookupBody | null,
  replyKey: null as string | null,
  replyPending: false,
  generation: 0,
  stream: null as null | (() => void),
  overlayOpen: false,
};

function inboxQueryParams(): string {
  const params = new URLSearchParams();
  if (state.status !== 'waiting') params.set('status', state.status);
  if (state.query !== '') params.set('q', state.query);
  return params.toString();
}

function threadUrl(threadId: string | null): string {
  const query = inboxQueryParams();
  const base = threadId === null ? '/inbox' : `/inbox/${threadId}`;
  return query === '' ? base : `${base}?${query}`;
}

function syncUrl(replace: boolean): void {
  const url = threadUrl(state.openThreadId);
  if (replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }
}

let onThreadChosenFromList: () => void = () => {};

export async function workspacePage(root: HTMLElement): Promise<void> {
  document.title = 'Inbox — Hushline';
  const sessionResult = await api<SessionBody>('GET', '/api/auth/session');
  if (!sessionResult.ok) {
    sessionStorage.setItem('hushline_return_thread', window.location.pathname + window.location.search);
    window.location.href = '/signin';
    return;
  }
  state.session = sessionResult.body!;
  setChangeToken(state.session.change_token);

  const container = el('div', { class: 'workspace-shell' });
  const wide = window.matchMedia('(min-width: 1100px)').matches;
  const mid = window.matchMedia('(min-width: 600px) and (max-width: 1099px)').matches;
  void wide;
  void mid;

  const banner = el('header', { role: 'banner', class: 'banner' });
  banner.append(el('a', { href: '/inbox' }, 'Inbox'));
  if (state.session.user.role === 'developer') {
    banner.append(el('a', { href: '/team' }, 'Team'));
  }
  banner.append(el('span', { class: 'spacer' }));
  const signOut = el('button', { type: 'button' }, 'Sign out');
  banner.append(signOut);

  const listPane = el('div', { class: 'workspace-list' });
  const tabs = {
    waiting: el('button', { role: 'tab', type: 'button', class: 'tab' }, 'Waiting 0') as HTMLButtonElement,
    answered: el('button', { role: 'tab', type: 'button', class: 'tab' }, 'Answered 0') as HTMLButtonElement,
    closed: el('button', { role: 'tab', type: 'button', class: 'tab' }, 'Closed 0') as HTMLButtonElement,
  };
  const tablist = el('div', { role: 'tablist', 'aria-label': 'Thread status' }, tabs.waiting, tabs.answered, tabs.closed);
  const search = el('input', { type: 'search', 'aria-label': 'Search threads', placeholder: 'Search threads' }) as HTMLInputElement;
  const rows = el('ul', { 'aria-label': 'Threads', class: 'thread-rows' }) as HTMLUListElement;
  const emptyLine = el('p', { class: 'empty-copy' });
  listPane.append(tablist, search, rows, emptyLine);

  const threadPane = el('section', { class: 'workspace-thread' });
  const announcements = el('div', { role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  registerLiveRegion('inbox', announcements);

  const purchasesList = el('ul', { 'aria-label': 'Purchases', class: 'purchases' });
  const recordList = el('div', { role: 'region', 'aria-label': 'Game server record' });
  const gameServerStatus = el('div', { role: 'status', 'aria-live': 'polite' });
  const messagesList = el('ul', { 'aria-label': 'Messages', class: 'messages' });
  const reply = el('textarea', { 'aria-label': 'Reply', rows: '4', placeholder: 'Reply' }) as HTMLTextAreaElement;
  const sendReply = el('button', { type: 'button', class: 'accent' }, 'Send reply');
  const closeThread = el('button', { type: 'button' }, 'Close thread');
  const drawerButton = el('button', { type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'dialog' }, 'Threads');
  const sheetButton = el('button', { type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'dialog' }, 'Open Tamperglass');

  const tamper = buildTamperglass(false);
  registerLiveRegion('verdicts', tamper.verdicts);
  const sheetPane = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tamperglass', class: 'sheet', hidden: 'hidden' });
  const sheet = { pane: sheetPane, lines: tamper.lines, meter: tamper.meter, verdicts: tamper.verdicts, container: sheetPane };
  const sheetBackdrop = el('div', { class: 'sheet-backdrop', hidden: 'hidden' });
  const drawerBackdrop = el('div', { class: 'drawer-backdrop', hidden: 'hidden' });

  const elements: AppElements = {
    tabs,
    search,
    rows,
    moreButton: null,
    threadPane,
    tamper,
    reply,
    announcements,
    gameServerStatus,
    purchasesList,
    recordList,
    drawerButton,
    drawer: listPane,
    drawerBackdrop,
    sheetButton,
    sheetBackdrop,
    messagesList,
    closeThreadButton: closeThread,
    heading: null,
  };
  const grid = el('div', { class: 'workspace' });
  grid.append(listPane, threadPane, tamper.pane);
  container.append(banner, grid);

  root.textContent = '';
  root.append(container);
  root.append(announcements);
  root.classList.add('workspace-root');
  threadPane.append(drawerButton, sheetButton, purchasesList, recordList, gameServerStatus, messagesList, reply, sendReply, closeThread);
  document.body.append(sheetPane, sheetBackdrop, drawerBackdrop);

  parseCurrentUrl();
  await refreshInbox(elements, false);
  openThreadFromUrl(elements);
  wireEvents(elements, { sendReply, closeThread, signOut, drawerButton, sheetButton, sheet, sheetBackdrop });
  startStream(elements);
  window.addEventListener('popstate', () => {
    parseCurrentUrl();
    void refreshInbox(elements, true).then(() => openThreadFromUrl(elements));
  });

  onChangeSession(() => {
    const replyText = reply.value;
    sessionStorage.setItem('hushline_return_thread', window.location.pathname + window.location.search);
    sessionStorage.setItem('hushline_return_reply', replyText);
    window.location.href = '/signin?notice=session-ended';
  });

  const storedReply = sessionStorage.getItem('hushline_return_reply');
  if (storedReply !== null) {
    reply.value = storedReply;
    sessionStorage.removeItem('hushline_return_reply');
  }
  const notice = new URLSearchParams(window.location.search).get('notice');
  if (notice === 'session-ended') {
    announce('inbox', 'Your session ended. Sign in again.');
  }
}

function parseCurrentUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');
  if (status === 'answered' || status === 'closed') {
    state.status = status;
  } else {
    state.status = 'waiting';
  }
  state.query = params.get('q') ?? '';
  const match = window.location.pathname.match(/^\/inbox\/([^/]+)/);
  state.openThreadId = match ? decodeURIComponent(match[1]) : null;
}

function openThreadFromUrl(elements: AppElements): void {
  if (state.openThreadId) {
    void loadThread(elements, state.openThreadId, false);
  } else {
    renderNoThread(elements);
  }
}

async function refreshInbox(elements: AppElements, keepRows: boolean): Promise<void> {
  const params = new URLSearchParams();
  if (state.status !== 'waiting') params.set('status', state.status);
  if (state.query !== '') params.set('q', state.query);
  const query = params.toString();
  const result = await api<InboxBody>('GET', `/api/inbox${query === '' ? '' : `?${query}`}`);
  if (!result.ok) return;
  const body = result.body!;
  if (!keepRows) state.rows = body.threads;
  state.nextCursor = body.next_cursor;
  for (const status of ['waiting', 'answered', 'closed'] as const) {
    elements.tabs[status].textContent = `${status[0].toUpperCase()}${status.slice(1)} ${body.counts[status]}`;
    elements.tabs[status].setAttribute('aria-selected', state.status === status ? 'true' : 'false');
  }
  if (!keepRows) renderRows(elements);
  elements.search.value = state.query;
}

function renderRows(elements: AppElements): void {
  const focusedThreadId = document.activeElement?.closest('a')?.getAttribute('data-thread');
  const previousSelection = state.rows.find((row) => row.id === state.openThreadId);
  elements.rows.textContent = '';
  const emptyCopy = elements.rows.parentElement?.querySelector('.empty-copy');
  if (state.rows.length === 0) {
    const sentence = state.status === 'waiting' && state.query === ''
      ? 'No one is waiting. Back to the game.'
      : 'No threads here.';
    if (emptyCopy) emptyCopy.textContent = sentence;
    elements.rows.append(el('li', { class: 'visually-hidden' }, sentence));
  } else {
    if (emptyCopy) emptyCopy.textContent = '';
  }
  for (const row of state.rows) {
    const link = el('a', {
      href: threadUrl(row.id),
      class: 'thread-row',
      'data-thread': row.id,
      'aria-current': state.openThreadId === row.id ? 'page' : null,
    },
      el('span', { class: 'player-name' }, row.player.name),
      el('span', { class: 'first-line' }, row.first_line),
      el('span', { class: `status-word ${row.status}` }, row.status),
    );
    elements.rows.append(el('li', {}, link));
  }
  const existingMore = elements.moreButton;
  if (existingMore && existingMore.parentElement) existingMore.remove();
  elements.moreButton = null;
  if (state.nextCursor !== null) {
    const more = el('button', { type: 'button', class: 'text-button' }, 'Show more threads') as HTMLButtonElement;
    more.addEventListener('click', () => void loadMore(elements));
    elements.rows.parentElement?.append(more);
    elements.moreButton = more;
  }
  void previousSelection;
  if (focusedThreadId) {
    const restored = elements.rows.querySelector(`a[data-thread="${focusedThreadId}"]`);
    (restored as HTMLElement | null)?.focus();
  }
}

async function loadMore(elements: AppElements): Promise<void> {
  if (state.nextCursor === null) return;
  announce('inbox', 'Loading more threads...');
  const params = new URLSearchParams();
  params.set('cursor', state.nextCursor);
  if (state.status !== 'waiting') params.set('status', state.status);
  if (state.query !== '') params.set('q', state.query);
  const result = await api<InboxBody>('GET', `/api/inbox?${params.toString()}`);
  if (!result.ok) {
    announce('inbox', "More threads didn't load. Try again.");
    return;
  }
  const body = result.body!;
  const known = new Set(state.rows.map((row) => row.id));
  const appended = body.threads.filter((row) => !known.has(row.id));
  state.rows = [...state.rows, ...appended];
  state.nextCursor = body.next_cursor;
  renderRows(elements);
  announce('inbox', `Showing ${state.rows.length} threads.`);
  const firstAppended = elements.rows.querySelector(`a[data-thread="${appended[0]?.id ?? ''}"]`);
  (firstAppended as HTMLElement | null)?.focus();
}

function renderNoThread(elements: AppElements): void {
  elements.threadPane.setAttribute('aria-busy', 'false');
  elements.heading?.remove();
  elements.heading = null;
  elements.messagesList.textContent = '';
  elements.purchasesList.textContent = '';
  elements.recordList.textContent = '';
  elements.gameServerStatus.textContent = '';
  showPrompt(elements.tamper, 'Select a message to see what was checked.');
}

function messageEntry(message: Message, selected: boolean, staffView: boolean): HTMLLIElement {
  const item = el('li', { tabindex: '0', 'data-message': message.id, 'aria-current': selected ? 'true' : null });
  const meta = el('p', { class: 'message-meta' }, `${message.author.name}, ${formatTime(message.created_at)}`);
  item.append(meta);
  if (message.kind === 'player' || message.kind === 'reply') {
    item.append(el('p', { class: 'message-text' }, renderFormatted(message.body ?? '')));
  } else if (message.event) {
    const event = message.event;
    if (event.verdict === 'refused') {
      if (!staffView) return el('li', { class: 'visually-hidden' });
      item.append(el('p', { class: 'message-text evidence' }, `Refused game-server event: ${event.type}`));
    } else if (event.type === 'purchase.receipt') {
      item.append(el('p', { class: 'message-text' }, `Purchase recorded: ${event.item}, ${formatAmount(Number(event.amount_minor), event.currency ?? '')}`));
    } else if (event.type === 'purchase.refunded') {
      if (event.refund_applied === false) {
        item.append(el('p', { class: 'message-text' }, `Refund not applied: ${event.receipt_id}, currency differs`));
      } else {
        item.append(el('p', { class: 'message-text' }, `Refund recorded: ${event.refund_id}, ${formatAmount(Number(event.amount_minor), event.currency ?? '')}`));
      }
    } else if (event.type === 'match.finished') {
      const minutes = Math.floor(Number(event.duration_seconds) / 60);
      item.append(el('p', { class: 'message-text' }, `Match ${event.result}: ${event.mode}, ${minutes} min`));
    }
  }
  for (const attachment of message.attachments) {
    const line = el('p', { class: 'attachment-line' }, `${attachment.filename} ${attachment.status}`);
    item.append(line);
  }
  if (message.unfurl) {
    const host = new URL(message.unfurl.url).host;
    item.append(el('p', { class: 'preview' }, `${message.unfurl.title}${message.unfurl.description ? `. ${message.unfurl.description}.` : ''} ${host}`));
  }
  return item;
}

async function loadThread(elements: AppElements, threadId: string, announceOpening: boolean): Promise<boolean> {
  const generation = ++state.generation;
  if (announceOpening) announce('inbox', 'Opening thread...');
  const result = await api<ThreadBody>('GET', `/api/threads/${threadId}`);
  if (generation !== state.generation) return false;
  if (!result.ok) {
    if (result.failure?.status === 404) {
      if (state.openThreadId === threadId) {
        state.openThreadId = null;
        state.thread = null;
        syncUrl(true);
        renderNoThread(elements);
        announce('inbox', 'That thread is no longer available.');
        await refreshInbox(elements, false);
      }
    }
    return false;
  }
  const thread = result.body!;
  state.thread = thread;
  state.openThreadId = thread.id;
  state.selectedMessage = null;
  state.lookup = null;
  renderThread(elements, thread);
  void runLookup(elements, thread.id, false);
  announce('inbox', `${thread.player.name}`);
  return true;
}

function renderThread(elements: AppElements, thread: ThreadBody): void {
  const pane = elements.threadPane;
  const existing = pane.querySelector('h2');
  if (existing) existing.remove();
  const heading = el('h2', { tabindex: '-1' }, thread.player.name);
  pane.prepend(heading);
  elements.heading = heading;
  const topicWords = el('span', { class: 'status-word' }, `${thread.topic} ${thread.status}`);
  heading.append(document.createTextNode(' '), topicWords);

  elements.messagesList.textContent = '';
  for (const message of thread.messages) {
    elements.messagesList.append(messageEntry(message, false, true));
  }
  renderPurchases(elements, thread);
  renderRecord(elements, null);
  elements.reply.value = state.replyKey === null ? elements.reply.value : elements.reply.value;
  if (elements.closeThreadButton) {
    elements.closeThreadButton.disabled = false;
  }
  markSelected(elements);
}

function renderPurchases(elements: AppElements, thread: ThreadBody): void {
  elements.purchasesList.textContent = '';
  if (thread.purchases.length === 0) return;
  for (const purchase of thread.purchases) {
    const entry = el('li', {},
      el('span', {}, `${purchase.receipt_id} ${purchase.item} ${formatAmount(purchase.amount_minor, purchase.currency)} `),
      el('span', { class: 'status-word' }, refundWords(purchase)),
      el('span', { class: 'comparison', 'data-receipt': purchase.receipt_id }),
    );
    elements.purchasesList.append(entry);
  }
}

function renderRecord(elements: AppElements, lookup: ReceiptLookupBody | null): void {
  const region = elements.recordList;
  region.textContent = '';
  const button = el('button', { type: 'button', class: 'text-button' }, 'Look up receipts again');
  button.addEventListener('click', () => void runLookup(elements, state.openThreadId!, true));
  region.append(button, el('ul', { class: 'purchases', 'data-record': 'true' }));
  if (lookup && lookup.available) {
    const list = region.querySelector('ul')!;
    for (const receipt of lookup.receipts) {
      list.append(el('li', {}, `${receipt.receipt_id} ${receipt.item} ${formatAmount(receipt.amount_minor, receipt.currency)} ${receiptStatusWords(receipt.status)} ${formatTime(receipt.purchased_at)}`));
    }
    if (lookup.receipts.length === 0) {
      elements.gameServerStatus.textContent = 'The game server lists no receipts for this player.';
    } else {
      elements.gameServerStatus.textContent = '';
    }
  } else if (lookup && !lookup.available) {
    elements.gameServerStatus.textContent = "The game server isn't answering receipt lookups right now. Signed receipts in this thread are still checked.";
  }
  if (lookup) {
    for (const entry of lookup.purchases) {
      const cell = elements.purchasesList.querySelector(`[data-receipt="${entry.receipt_id}"]`);
      if (cell) cell.textContent = comparisonWords(entry);
    }
  }
}

async function runLookup(elements: AppElements, threadId: string, manual: boolean): Promise<void> {
  const generation = state.generation;
  elements.gameServerStatus.textContent = 'Asking the game server...';
  const result = await api<ReceiptLookupBody>('GET', `/api/threads/${threadId}/receipt-lookup`);
  if (generation !== state.generation || state.openThreadId !== threadId) return;
  if (!result.ok) {
    if (result.failure?.status === 403) {
      elements.purchasesList.textContent = '';
      elements.recordList.textContent = '';
      elements.gameServerStatus.textContent = '';
      return;
    }
    state.lookup = { available: false, receipts: [], purchases: [] };
    elements.gameServerStatus.textContent = "The game server isn't answering receipt lookups right now. Signed receipts in this thread are still checked.";
    return;
  }
  state.lookup = result.body!;
  renderRecord(elements, state.lookup);
  void manual;
}

function markSelected(elements: AppElements): void {
  const items = elements.messagesList.querySelectorAll('li[data-message]');
  for (const item of items) {
    if (item.getAttribute('data-message') === state.selectedMessage) {
      item.setAttribute('aria-current', 'true');
    } else {
      item.removeAttribute('aria-current');
    }
  }
}

function stageOrder(stage: ForensicsLine['stage']): number {
  return ['signature', 'bucket', 'sanitiser', 'link'].indexOf(stage);
}

async function selectMessage(elements: AppElements, messageId: string | null): Promise<void> {
  state.selectedMessage = messageId;
  markSelected(elements);
  if (messageId === null) {
    showPrompt(elements.tamper, 'Select a message to see what was checked.');
    return;
  }
  const thread = state.thread;
  const message = thread?.messages.find((entry) => entry.id === messageId);
  if (!thread || !message) return;
  if (message.kind === 'reply') {
    showPrompt(elements.tamper, 'Replies are not checked.');
    return;
  }
  if (message.kind === 'event' && message.event && message.event.verdict === 'refused') {
    showPrompt(elements.tamper, 'Select a message to see what was checked.');
    return;
  }
  setChecking(elements.tamper);
  const streamPath = `/api/messages/${messageId}/forensics/stream`;
  const source = new EventSource(streamPath);
  const stages: ForensicsLine[] = [];
  source.addEventListener('stage', (event) => {
    const line = JSON.parse((event as MessageEvent).data) as ForensicsLine;
    if (state.selectedMessage !== messageId) {
      source.close();
      return;
    }
    settle(elements, line);
    stages.push(line);
  });
  source.addEventListener('settled', (event) => {
    const body = JSON.parse((event as MessageEvent).data) as ForensicsBody;
    if (state.selectedMessage !== messageId) {
      source.close();
      return;
    }
    for (const line of body.lines) {
      if (!stages.some((seen) => seen.stage === line.stage)) settle(elements, line);
    }
    announce('verdicts', verdictSentence(body));
    source.close();
  });
  source.onerror = () => {
    source.close();
  };
}

function settle(elements: AppElements, line: ForensicsLine): void {
  const pane = elements.tamper;
  const element = pane.lines[line.stage];
  const verdict = element.querySelector('.verdict');
  if (verdict) {
    verdict.textContent = line.verdict;
    verdict.classList.remove('line-settle');
    void (verdict as HTMLElement).offsetWidth;
    verdict.classList.add('line-settle');
  }
  if (line.stage === 'bucket') {
    pane.meter.value = line.level ?? 0;
  }
  if (line.stage === 'sanitiser' && line.before && line.after && Array.isArray(line.removed)) {
    const before = element.querySelector('.before');
    if (before) {
      before.textContent = '';
      const beforeElement = document.createElement('blockquote');
      beforeElement.className = 'evidence';
      beforeElement.textContent = line.before;
      const afterElement = document.createElement('blockquote');
      afterElement.className = 'evidence';
      afterElement.textContent = line.after;
      before.append(beforeElement, afterElement);
      for (const span of line.removed) {
        const strike = document.createElement('s');
        strike.textContent = span.text;
        before.append(strike);
      }
    }
  }
  void stageOrder;
}

function focusSelected(elements: AppElements): void {
  const item = elements.messagesList.querySelector(`li[data-message="${state.selectedMessage ?? ''}"]`);
  (item as HTMLElement | null)?.focus();
}

function moveSelection(elements: AppElements, direction: 1 | -1): void {
  const messages = state.thread?.messages.filter((message) => message.kind === 'player' || (message.kind === 'event' && message.event?.verdict === 'accepted') || message.kind === 'reply') ?? [];
  if (messages.length === 0) return;
  const ids = messages.map((message) => message.id);
  if (state.selectedMessage === null) {
    const target = direction === 1 ? ids[0] : ids[ids.length - 1];
    void selectMessage(elements, target).then(() => focusSelected(elements));
    return;
  }
  const current = ids.indexOf(state.selectedMessage);
  if (current === -1) {
    const target = direction === 1 ? ids[0] : ids[ids.length - 1];
    void selectMessage(elements, target).then(() => focusSelected(elements));
    return;
  }
  const next = current + direction;
  if (next < 0 || next >= ids.length) return;
  void selectMessage(elements, ids[next]).then(() => focusSelected(elements));
}

function moveThread(elements: AppElements, direction: 1 | -1): void {
  const index = state.rows.findIndex((row) => row.id === state.openThreadId);
  if (index === -1) {
    if (state.rows.length === 0) return;
    const first = direction === 1 ? state.rows[0] : state.rows[state.rows.length - 1];
    state.openThreadId = first.id;
    syncUrl(false);
    void loadThread(elements, first.id, false).then(() => elements.heading?.focus());
    return;
  }
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= state.rows.length) return;
  const target = state.rows[nextIndex];
  state.openThreadId = target.id;
  syncUrl(false);
  void loadThread(elements, target.id, false).then(() => {
    elements.heading?.focus();
  });
}

function newReplyKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 24).replace(/[^A-Za-z0-9_-]/g, 'x');
}

async function sendReplyAction(elements: AppElements): Promise<void> {
  const thread = state.thread;
  if (!thread || state.replyPending) return;
  const text = elements.reply.value;
  if (text.trim() === '') {
    announce('inbox', 'Write a reply before sending.');
    return;
  }
  if (state.replyKey === null) state.replyKey = newReplyKey();
  const key = state.replyKey;
  state.replyPending = true;
  announce('inbox', 'Sending reply...');
  const result = await api<{ message: Message; thread: { id: string; status: string } }>('POST', `/api/threads/${thread.id}/replies`, { body: text }, { 'idempotency-key': key });
  state.replyPending = false;
  if (result.ok) {
    state.replyKey = null;
    announce('inbox', `Reply sent to ${thread.player.name}.`);
    elements.reply.value = '';
    await loadThread(elements, thread.id, false);
    return;
  }
  const failure = result.failure!;
  if (failure.status === 409 && failure.code === 'thread_closed') {
    announce('inbox', 'This thread is closed. It reopens when the player writes again.');
    return;
  }
  if (failure.status === 409 && failure.code === 'idempotency_in_progress') {
    return;
  }
  if (failure.status === 422 && failure.code === 'idempotency_replay') {
    return;
  }
  announce('inbox', 'Reply not sent. Try again.');
}

async function closeThreadAction(elements: AppElements): Promise<void> {
  const thread = state.thread;
  if (!thread) return;
  announce('inbox', 'Closing thread...');
  const result = await api<{ thread: { id: string; status: string } }>('POST', `/api/threads/${thread.id}/close`, {});
  if (result.ok) {
    announce('inbox', 'Thread closed.');
    const index = state.rows.findIndex((row) => row.id === thread.id);
    if (index !== -1) {
      state.rows[index] = { ...state.rows[index], status: 'closed' };
    }
    const candidates = [...state.rows];
    const next = candidates[index + 1] ?? candidates[index - 1];
    if (next) {
      state.openThreadId = next.id;
      syncUrl(false);
      await loadThread(elements, next.id, false);
      elements.heading?.focus();
    } else {
      state.openThreadId = null;
      syncUrl(false);
      renderNoThread(elements);
      const firstRow = elements.rows.querySelector('a');
      (firstRow as HTMLElement | null)?.focus();
    }
    void refreshInbox(elements, false);
    return;
  }
  const failure = result.failure!;
  if (failure.code === 'not_answered') {
    announce('inbox', 'Answer the player before closing.');
  } else if (failure.code === 'already_closed') {
    announce('inbox', 'This thread is already closed.');
  } else {
    announce('inbox', 'Thread not closed. Try again.');
  }
}

function startStream(elements: AppElements): void {
  const source = new EventSource('/api/stream');
  const handler = (data: Record<string, unknown>): void => {
    const threadId = typeof data.thread_id === 'string' ? data.thread_id : null;
    if (threadId && state.openThreadId === threadId && state.thread) {
      void loadThread(elements, threadId, false);
    }
    if (!threadId || threadId === state.openThreadId || true) {
      void refreshInbox(elements, false);
    }
  };
  source.addEventListener('message', (event) => handler(JSON.parse((event as MessageEvent).data) as Record<string, unknown>));
  source.addEventListener('thread_status', (event) => handler(JSON.parse((event as MessageEvent).data) as Record<string, unknown>));
  source.addEventListener('attachment', (event) => handler(JSON.parse((event as MessageEvent).data) as Record<string, unknown>));
  source.addEventListener('rules_changed', () => {
    void refreshInbox(elements, false);
    if (state.openThreadId) {
      void loadThread(elements, state.openThreadId, false);
    }
  });
  source.onerror = () => {
    source.close();
  };
  void apiStream;
}

function wireEvents(elements: AppElements, controls: {
  sendReply: HTMLButtonElement;
  closeThread: HTMLButtonElement;
  signOut: HTMLButtonElement;
  drawerButton: HTMLButtonElement;
  sheetButton: HTMLButtonElement;
  sheet: TamperglassElements;
  sheetBackdrop: HTMLElement;
}): void {
  for (const status of ['waiting', 'answered', 'closed'] as const) {
    elements.tabs[status].addEventListener('click', () => {
      state.status = status;
      state.rows = [];
      syncUrl(false);
      void refreshInbox(elements, false);
    });
  }
  let searchTimer: number | undefined;
  elements.search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = elements.search.value;
      state.rows = [];
      syncUrl(true);
      void refreshInbox(elements, false);
    }, 250);
  });
  elements.rows.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('a[data-thread]');
    if (!target) return;
    event.preventDefault();
    const id = target.getAttribute('data-thread')!;
    state.openThreadId = id;
    syncUrl(false);
    onThreadChosenFromList();
    void loadThread(elements, id, false).then(() => elements.heading?.focus());
  });
  elements.messagesList.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest('li[data-message]');
    if (!item) return;
    void selectMessage(elements, item.getAttribute('data-message'));
  });
  elements.messagesList.addEventListener('keydown', (event) => {
    const item = (event.target as HTMLElement).closest('li[data-message]');
    if (!item) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void selectMessage(elements, item.getAttribute('data-message')).then(() => (item as HTMLElement).focus());
    }
  });
  controls.sendReply.addEventListener('click', () => void sendReplyAction(elements));
  controls.closeThread.addEventListener('click', () => void closeThreadAction(elements));
  elements.reply.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void sendReplyAction(elements);
    }
  });

  controls.signOut.addEventListener('click', async () => {
    await api('POST', '/api/auth/logout', {});
    window.location.href = '/signin?notice=signed-out';
  });

  const drawer = elements.drawer;
  const drawerIsOverlay = () => window.innerWidth < 1100;
  onThreadChosenFromList = () => {
    if (drawer?.classList.contains('open')) closeDrawer();
  };
  if (drawerIsOverlay()) drawer?.setAttribute('inert', 'inert');
  window.addEventListener('resize', () => {
    if (!drawer?.classList.contains('open')) {
      if (drawerIsOverlay()) drawer?.setAttribute('inert', 'inert');
      else drawer?.removeAttribute('inert');
    }
  });
  const openDrawer = () => {
    if (!drawer) return;
    state.overlayOpen = true;
    drawer.classList.add('open');
    drawer.removeAttribute('inert');
    controls.drawerButton.setAttribute('aria-expanded', 'true');
    elements.drawerBackdrop?.removeAttribute('hidden');
    const first = drawer.querySelector('button, input, a');
    (first as HTMLElement | null)?.focus();
  };
  const closeDrawer = () => {
    if (!drawer) return;
    state.overlayOpen = false;
    drawer.classList.remove('open');
    if (drawerIsOverlay()) drawer.setAttribute('inert', 'inert');
    controls.drawerButton.setAttribute('aria-expanded', 'false');
    elements.drawerBackdrop?.setAttribute('hidden', 'hidden');
    controls.drawerButton.focus();
  };
  controls.drawerButton.addEventListener('click', () => {
    if (drawer?.classList.contains('open')) closeDrawer();
    else openDrawer();
  });
  elements.drawerBackdrop?.addEventListener('click', closeDrawer);

  const sheetPane = controls.sheet.pane;
  const openSheet = () => {
    state.overlayOpen = true;
    sheetPane.removeAttribute('hidden');
    controls.sheetButton.setAttribute('aria-expanded', 'true');
    controls.sheetBackdrop.removeAttribute('hidden');
    sheetPane.append(...Array.from(elements.tamper.container.childNodes));
    const first = sheetPane.querySelector('button, [tabindex]');
    (first as HTMLElement | null)?.focus();
  };
  const closeSheet = () => {
    state.overlayOpen = false;
    sheetPane.setAttribute('hidden', 'hidden');
    controls.sheetButton.setAttribute('aria-expanded', 'false');
    controls.sheetBackdrop.setAttribute('hidden', 'hidden');
    elements.tamper.container.append(...Array.from(sheetPane.childNodes));
    controls.sheetButton.focus();
  };
  controls.sheetButton.addEventListener('click', () => {
    if (sheetPane.hasAttribute('hidden')) openSheet();
    else closeSheet();
  });
  controls.sheetBackdrop.addEventListener('click', closeSheet);

  sheetPane.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      const focusables = Array.from(sheetPane.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const focusables = Array.from(sheetPane.querySelectorAll<HTMLElement>('[tabindex]:not([tabindex="-1"])'));
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'ArrowDown' ? Math.min(focusables.length - 1, index + 1) : Math.max(0, index - 1);
      focusables[next]?.focus();
      event.preventDefault();
    }
  });
  elements.tamper.pane.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const focusables = Array.from(elements.tamper.pane.querySelectorAll<HTMLElement>('[tabindex]:not([tabindex="-1"])'));
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'ArrowDown' ? Math.min(focusables.length - 1, index + 1) : Math.max(0, index - 1);
      focusables[next]?.focus();
      event.preventDefault();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
    if (event.key === 'Escape') {
      if (!sheetPane.hasAttribute('hidden')) {
        closeSheet();
        return;
      }
      if (drawer?.classList.contains('open')) {
        closeDrawer();
        return;
      }
    }
    if (state.overlayOpen) {
      if (event.key.toUpperCase() === 'T' && !sheetPane.hasAttribute('hidden')) {
        closeSheet();
      }
      return;
    }
    switch (event.key.toUpperCase()) {
      case 'J': moveSelection(elements, 1); break;
      case 'K': moveSelection(elements, -1); break;
      case 'N': moveThread(elements, 1); break;
      case 'P': moveThread(elements, -1); break;
      case 'R': elements.reply.focus(); break;
      case 'C': void closeThreadAction(elements); break;
      case 'T':
        if (window.innerWidth < 600) openSheet();
        else elements.tamper.lines.signature.focus();
        break;
      default: break;
    }
  });
}

export { loadThread };
