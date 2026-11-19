import { api, apiJson, serverNow, ApiFailure } from './api';
import { el, svgEl, icon, clear } from './dom';
import { chip, stateChip } from './chips';
import { AppState, type PendingSend, type DetailPanel } from './state';
import { initLiveRegions, announceDelivery, announceUpload, announceNotice, onNotice } from './live-regions';
import {
  formatLocal, parseText, checkChosenPhoto, newClientId,
  type MessageView, type UserView, type WorkspaceView, type ChannelView,
  MAX_PHOTOS, MAX_PHOTO_BYTES, ROLE_LABELS, type Role,
} from './types';

const state = new AppState();
let root: HTMLElement;
let channelsNav: HTMLElement;
let mainCol: HTMLElement;
let detailCol: HTMLElement;
let messagesScroll: HTMLElement;
let composerBox: HTMLTextAreaElement | null = null;
let trayFiles: File[] = [];
let focusReturn: HTMLElement | null = null;
let dialogStack: HTMLElement[] = [];
let railOpen = false;
let readTimers = new Map<string, number>();
let deliveredQueue = new Set<string>();
let scrubEl: HTMLElement | null = null;
let scrubHandleEl: HTMLElement | null = null;
let scrubDotEls: HTMLElement[] = [];
let openDialogInfo: { kind: string; data?: unknown } | null = null;
let currentReceipts: {
  sentAt: Date;
  versions: { version: number; created: Date; text: string; editor: string }[];
  recipients: { id: string; name: string; deliveredAt: Date | null; reads: { version: number; readAt: Date }[] }[];
} | null = null;
let scrubInstantMs: number | null = null;
let scrubPinnedToNow = true;
let uploadAbort: AbortController | null = null;
let quoteMessage: MessageView | null = null;

const app = {
  state,
  start,
};

export default app;

async function start(): Promise<void> {
  root = document.getElementById('app') as HTMLElement;
  initLiveRegions();
  state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let me: { user: UserView; workspace: WorkspaceView } | null = null;
  try {
    me = (await api<{ user: UserView; workspace: WorkspaceView }>('/api/me')).data;
  } catch {
    me = null;
  }

  const path = window.location.pathname;
  if (path.startsWith('/join/')) {
    await renderJoin(path.slice('/join/'.length));
    return;
  }
  if (!me) {
    renderSignIn();
    return;
  }
  await renderShell(me.user, me.workspace);
}

/* ---------------- Sign-in ---------------- */

function renderSignIn(message?: string): void {
  clear(root);
  const panel = el('section', { class: 'auth-panel', 'aria-label': 'Sign in' });
  const h = el('h1', { class: 'wordmark', text: 'Rimewire' });
  const sub = el('p', { class: 'sub', text: 'The team messenger for refrigeration and HVAC crews.' });
  const form = el('form') as HTMLFormElement;

  const emailField = el('div', { class: 'field' });
  const emailLabel = el('label', { for: 'email', text: 'Email' });
  const emailInput = el('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'email' }) as HTMLInputElement;
  const emailErr = el('div', { class: 'field-error', id: 'email-error' });
  emailField.append(emailLabel, emailInput, emailErr);

  const passField = el('div', { class: 'field' });
  const passLabel = el('label', { for: 'password', text: 'Password' });
  const passInput = el('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
  const passErr = el('div', { class: 'field-error', id: 'password-error' });
  passField.append(passLabel, passInput, passErr);

  const formError = el('div', { class: 'auth-error', 'aria-live': 'polite' });
  if (message) formError.textContent = message;

  const submit = el('button', { type: 'submit', text: 'Sign in' });

  form.append(emailField, passField, formError, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.textContent = 'Signing in…';
    submit.setAttribute('disabled', 'disabled');
    formError.textContent = '';
    emailErr.textContent = '';
    passErr.textContent = '';
    try {
      const res = await apiJson<{ user: UserView; workspace: WorkspaceView }>('/api/session', 'POST', {
        email: emailInput.value,
        password: passInput.value,
      });
      await renderShell(res.data.user, res.data.workspace);
    } catch (err) {
      submit.textContent = 'Sign in';
      submit.removeAttribute('disabled');
      if (err instanceof ApiFailure) {
        if (err.body.error === 'validation' && err.body.errors) {
          if (err.body.errors.email) emailErr.textContent = err.body.errors.email;
          if (err.body.errors.password) passErr.textContent = err.body.errors.password;
        }
        if (err.body.error === 'invalid_credentials') {
          formError.textContent = 'Email or password is incorrect.';
        }
      } else {
        formError.textContent = 'Something went wrong on our side. Try again.';
      }
    }
  });

  panel.append(h, sub, form);
  const screen = el('div', { class: 'auth-screen' });
  screen.append(panel);
  root.append(screen);
  emailInput.focus();
}

/* ---------------- Join ---------------- */

async function renderJoin(token: string): Promise<void> {
  clear(root);
  const screen = el('div', { class: 'auth-screen' });
  const panel = el('section', { class: 'auth-panel', 'aria-label': 'Join' });
  let info: { workspace_name: string; name: string; email: string } | null = null;
  try {
    info = (await api<{ workspace_name: string; name: string; email: string }>(`/api/invites/${token}`)).data;
  } catch {
    info = null;
  }
  if (!info) {
    panel.append(
      el('h1', { class: 'wordmark', text: 'Rimewire' }),
      el('p', { class: 'auth-error', text: 'This invite link is not valid. Ask your operations manager for a new one.' }),
    );
    screen.append(panel);
    root.append(screen);
    return;
  }
  panel.append(
    el('h1', { class: 'wordmark', text: 'Rimewire' }),
    el('p', { class: 'sub', text: `Joining ${info.workspace_name}` }),
    el('p', { class: 'sub', text: `${info.name} · ${info.email}` }),
  );
  const form = el('form') as HTMLFormElement;
  const field = el('div', { class: 'field' });
  const label = el('label', { for: 'new-password', text: 'New password' });
  const input = el('input', { id: 'new-password', type: 'password', autocomplete: 'new-password' }) as HTMLInputElement;
  const err = el('div', { class: 'field-error', id: 'new-password-error' });
  field.append(label, input, err);
  const submit = el('button', { type: 'submit', text: 'Set password and join' });
  const formError = el('div', { class: 'auth-error' });
  form.append(field, formError, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.textContent = 'Joining…';
    submit.setAttribute('disabled', 'disabled');
    try {
      const res = await apiJson<{ user: UserView; workspace: WorkspaceView }>(`/api/invites/${token}/accept`, 'POST', {
        password: input.value,
      });
      announceNotice(`Password set. Welcome to ${res.data.workspace.name}.`);
      window.history.replaceState(null, '', '/');
      await renderShell(res.data.user, res.data.workspace);
    } catch (err) {
      submit.textContent = 'Set password and join';
      submit.removeAttribute('disabled');
      if (err instanceof ApiFailure) {
        if (err.body.error === 'validation' && err.body.errors?.password) {
        const errField = form.querySelector('#new-password-error');
        if (errField) errField.textContent = err.body.errors.password;
      }
        else if (err.body.error === 'not_found') formError.textContent = 'This invite link is not valid. Ask your operations manager for a new one.';
        else formError.textContent = err.body.message;
      }
    }
  });
  panel.append(form);
  screen.append(panel);
  root.append(screen);
  input.focus();
}

/* ---------------- Shell ---------------- */

async function renderShell(user: UserView, workspace: WorkspaceView): Promise<void> {
  state.me = user;
  state.workspace = workspace;
  clear(root);

  const shell = el('div', { class: 'shell' });

  const skip = el('a', { href: '#messages', class: 'skip-link', text: 'Skip to messages' });
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    messagesScroll.focus();
  });

  const topbar = el('header', { class: 'topbar' });
  const brand = el('span', { class: 'brand', text: 'Rimewire' });
  const channelsBtn = el('button', { class: 'channels-toggle', 'aria-expanded': 'false', text: 'Channels' });
  channelsBtn.addEventListener('click', () => {
    railOpen = !railOpen;
    rail.classList.toggle('open', railOpen);
    channelsBtn.setAttribute('aria-expanded', railOpen ? 'true' : 'false');
    if (railOpen) {
      const backdrop = el('div', { class: 'rail-backdrop' });
      backdrop.addEventListener('click', () => {
        railOpen = false;
        rail.classList.remove('open');
        backdrop.remove();
      });
      document.body.append(backdrop);
      (rail.querySelector('a') as HTMLElement)?.focus();
    } else {
      document.querySelector('.rail-backdrop')?.remove();
    }
  });

  const searchWrap = el('div', { class: 'search-wrap' });
  const searchBox = el('input', {
    class: 'searchbox', type: 'search', role: 'searchbox', 'aria-label': 'Search messages',
    placeholder: 'Search this workspace',
  }) as HTMLInputElement;
  const searchErr = el('div', { class: 'field-error', id: 'search-error' });
  searchWrap.append(searchBox, searchErr);
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchBox.value.trim();
      openSearch(q, searchErr);
    }
  });

  const personLine = el('div', { class: 'person-line' });
  const who = el('span', { class: 'who' });
  const nameEl = el('span', { class: 'name', text: user.name });
  const roleEl = await chip('shield', ROLE_LABELS[user.role]);
  who.append(nameEl, roleEl);
  const signOut = el('button', { text: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await apiJson('/api/session', 'DELETE');
    renderSignIn('Your session has ended. Sign in again.');
  });
  personLine.append(who, signOut);

  topbar.append(channelsBtn, brand, searchWrap, personLine);

  const rail = el('nav', { class: 'rail', 'aria-label': 'Channels' });
  channelsNav = el('ul', { class: 'channel-list' });
  const railHead = el('div', { class: 'rail-head' });
  railHead.append(el('div', { class: 'workspace', text: workspace.name }));
  const railFoot = el('div', { class: 'rail-foot' });
  if (user.role === 'ops_manager') {
    const peopleBtn = el('button', { text: 'Workspace people' });
    peopleBtn.addEventListener('click', () => openWorkspacePeople());
    const inviteBtn = el('button', { text: 'Invite technician' });
    inviteBtn.addEventListener('click', () => openInviteDialog());
    railFoot.append(peopleBtn, inviteBtn);
  }
  rail.append(railHead, channelsNav, railFoot);

  mainCol = el('main', { class: 'main-col' });
  detailCol = el('aside', { class: 'detail-col', role: 'complementary', 'aria-label': 'Details', hidden: 'hidden' });

  shell.append(topbar, rail, mainCol, detailCol);
  root.append(skip, shell);

  onNotice((text) => {
    const notices = document.querySelector('.notices');
    if (notices) notices.textContent = text;
  });

  const res = await api<{ channels: ChannelView[] }>('/api/channels');
  state.channels = res.data.channels;

  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  // `/` opens the first channel by name; an unknown `/c/<id>` shows not found.
  let channelId: string;
  if (path.startsWith('/c/')) {
    channelId = path.slice(3);
  } else {
    channelId = state.channels[0]?.id ?? '';
  }
  if (params.has('q')) {
    searchBox.value = params.get('q') ?? '';
    state.panel = { kind: 'search', query: params.get('q') ?? '' };
  } else if (params.has('thread')) {
    state.panel = { kind: 'thread', threadRootId: params.get('thread') ?? '' };
  } else if (params.has('photo')) {
    state.panel = { kind: 'photos' };
  }

  await openChannel(channelId, { restorePanel: true });
  connectEvents();
}

function renderRail(): void {
  clear(channelsNav);
  for (const channel of state.channels) {
    const li = el('li');
    const label = channel.unread_count > 0
      ? `${channel.name}, ${channel.unread_count} unread`
      : channel.name;
    const link = el('a', {
      href: `/c/${channel.id}`,
      class: channel.unread_count > 0 ? 'channel-link unread' : 'channel-link',
      'aria-label': label,
    });
    if (channel.id === state.openChannelId) link.setAttribute('aria-current', 'page');
    const hash = el('span', { class: 'hash', text: '#' });
    const nameSpan = el('span', { class: 'label', text: channel.name });
    link.append(hash, nameSpan);
    if (channel.unread_count > 0) {
      link.append(el('span', { class: 'count', text: String(channel.unread_count) }));
    }
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.history.pushState(null, '', `/c/${channel.id}`);
      openChannel(channel.id);
    });
    li.append(link);
    channelsNav.append(li);
  }
}

/* ---------------- Channel column ---------------- */

async function openChannel(channelId: string, opts: { restorePanel?: boolean } = {}): Promise<void> {
  const notFoundCopy = 'That was not found.';
  if (!channelId || !state.channelById(channelId)) {
    state.openChannelId = null;
    clear(mainCol);
    mainCol.append(el('div', { class: 'not-found', text: notFoundCopy }));
    announceNotice(notFoundCopy);
    renderRail();
    if (!opts.restorePanel) closeDetails();
    return;
  }
  state.openChannelId = channelId;
  state.quoteId = null;
  quoteMessage = null;
  renderRail();

  const channel = state.channelById(channelId) as ChannelView;

  clear(mainCol);
  const head = el('div', { class: 'channel-head' });
  const titleRow = el('div', { class: 'title-row' });
  const hashDeco = el('span', { class: 'hash-deco', 'aria-hidden': 'true', text: '#' });
  const title = el('h1', { text: channel.name });
  titleRow.append(hashDeco, title);
  if (channel.kind === 'broadcast') titleRow.append(await chip('bell', 'Broadcast'));
  else titleRow.append(await chip('users', 'Crew'));
  if (channel.private) titleRow.append(await chip('lock', 'Private'));

  const buttons = el('div', { class: 'head-buttons' });
  const photosBtn = el('button', { text: 'Photos' });
  photosBtn.addEventListener('click', () => openPhotosPanel());
  const schedBtn = el('button', { text: 'Scheduled posts' });
  schedBtn.addEventListener('click', () => openScheduledPanel());
  if (state.me?.role === 'dispatcher' || state.me?.role === 'ops_manager') {
    const newSchedBtn = el('button', { text: 'Schedule post' });
    newSchedBtn.addEventListener('click', () => openScheduleDialog(channel.id));
    buttons.append(newSchedBtn);
  }
  const membersBtn = el('button', { text: 'Members' });
  membersBtn.addEventListener('click', () => openMembersPanel(channel.id));
  buttons.append(photosBtn, schedBtn, membersBtn);

  head.append(titleRow, buttons);

  const pinnedStrip = el('section', { class: 'pinned-strip', role: 'region', 'aria-label': 'Pinned' });
  await renderPinnedStrip(pinnedStrip, channel);

  const scroll = el('div', {
    class: 'messages-scroll', tabindex: '0', role: 'region', 'aria-label': 'Messages', id: 'messages',
  });
  messagesScroll = scroll;

  const notices = el('div', { class: 'notices', role: 'status', 'aria-label': 'Notices', text: '' });

  mainCol.append(head, pinnedStrip, scroll, notices);

  const canPostTop = state.me?.role !== 'field_technician' || channel.kind !== 'broadcast';
  if (canPostTop) {
    mainCol.append(await renderComposer(null));
  } else {
    mainCol.append(el('p', { class: 'broadcast-note', text: 'Replies only — open a thread to respond.' }));
  }

  await loadHistory(channelId);
  renderMessages();
  scheduleDeliveryReports();
  if (opts.restorePanel) await restorePanelFromAddress();
}

async function renderPinnedStrip(strip: HTMLElement, channel: ChannelView): Promise<void> {
  clear(strip);
  for (const pinnedId of channel.pinned_message_ids) {
    try {
      const res = await api<{ message: MessageView }>(`/api/messages/${pinnedId}`);
      const message = res.data.message;
      const line = el('div', { class: 'pin-line' });
      const pinSvg = await icon('pin');
      if (pinSvg) line.append(svgEl(pinSvg));
      const body = el('div', { class: 'pin-body' });
      body.append(
        el('div', { class: 'pin-text', text: message.text }),
        el('div', { class: 'pin-by', text: `Pinned by ${message.pinned_by?.name ?? ''}` }),
      );
      line.append(body);
      strip.append(line);
    } catch {
      // a pinned message vanished; skip
    }
  }
}

async function loadHistory(channelId: string, before?: string): Promise<void> {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  params.set('limit', '30');
  const res = await api<{ messages: MessageView[]; next_cursor: string | null }>(
    `/api/channels/${channelId}/messages?${params.toString()}`,
  );
  if (before) {
    state.messages = [...res.data.messages.slice().reverse(), ...state.messages];
  } else {
    state.messages = res.data.messages.slice().reverse();
  }
  state.olderCursor = res.data.next_cursor;
  state.hasOlder = res.data.next_cursor !== null;
}

function renderMessages(): void {
  const list = el('div');
  for (const message of state.messages) {
    list.append(renderMessageRow(message, { inThread: false }));
  }
  const scroll = messagesScroll;
  const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
  const prevHeight = scroll.scrollHeight;
  const prevTop = scroll.scrollTop;
  const wasAwayFromBottom = prevHeight > 0 && !atBottom;
  const newestId = state.messages.length > 0 ? state.messages[state.messages.length - 1].id : null;
  const prevNewest = scroll.querySelector('article:last-of-type')?.getAttribute('data-message-id') ?? null;
  const isNewest = newestId !== null && newestId !== prevNewest;
  clear(scroll);
  scroll.append(list);
  if (state.hasOlder && state.olderCursor) {
    const btn = el('button', { text: 'Load older messages' });
    btn.addEventListener('click', () => loadOlder(btn));
    scroll.prepend(el('div', { class: 'loading-older' }, btn));
  }
  if (atBottom || prevHeight === 0) {
    scroll.scrollTop = scroll.scrollHeight;
  } else {
    scroll.scrollTop = prevTop + (scroll.scrollHeight - prevHeight);
  }
  // New messages that arrived while the person is scrolled up show the jump button.
  if (wasAwayFromBottom && isNewest) {
    showJumpToNewest(newestId as string);
  }
  observeReads();
}

function showJumpToNewest(newestId: string): void {
  if (document.querySelector('.jump-new')) return;
  const btn = el('button', { class: 'jump-new', text: 'Jump to newest messages' });
  btn.addEventListener('click', () => {
    btn.remove();
    messagesScroll.scrollTop = messagesScroll.scrollHeight;
    const newest = messagesScroll.querySelector(`[data-message-id="${newestId}"]`) as HTMLElement | null;
    newest?.focus();
  });
  messagesScroll.parentElement?.append(btn);
}

async function loadOlder(btn: HTMLElement): Promise<void> {
  if (!state.olderCursor) return;
  btn.textContent = 'Loading older messages…';
  try {
    await loadHistory(state.openChannelId as string, state.olderCursor);
    renderMessages();
  } catch {
    const wrap = btn.parentElement as HTMLElement;
    const retry = el('button', { text: 'Try again' });
    retry.addEventListener('click', () => loadOlder(retry));
    clear(wrap);
    wrap.append(el('span', { text: 'Could not load older messages.' }), retry);
  }
}

/* ---------------- Message row ---------------- */

function renderMessageRow(message: MessageView, opts: { inThread: boolean }): HTMLElement {
  const zone = state.workspace?.time_zone ?? 'UTC';
  const when = formatLocal(zone, message.sent_at);
  const article = el('article', {
    class: 'msg-row', tabindex: '-1',
    'data-message-id': message.id,
    'aria-label': `${message.author.name} at ${when}`,
  });

  const rowHead = el('div', { class: 'row-head' });
  rowHead.append(
    el('span', { class: 'author', text: message.author.name }),
    el('span', { class: 'role-chip', text: ROLE_LABELS[message.author.role] }),
  );
  if (message.edited) {
    article.dataset.edited = '1';
    queueMicrotask(async () => {
      const chipEl = await chip('pencil', 'Edited');
      rowHead.append(chipEl);
    });
  }
  if (message.pinned) {
    queueMicrotask(async () => {
      const chipEl = await chip('pin', 'Pinned');
      rowHead.append(chipEl);
    });
  }
  rowHead.append(el('span', { class: 'time', text: when }));

  const body = el('div', { class: 'msg-text' });
  renderTextInto(body, message.text);

  article.append(rowHead, body);

  if (message.quote && !message.quote.deleted) {
    const q = el('div', { class: 'quote-block' });
    q.append(el('div', { class: 'quote-head', text: `${message.quote.author_name ?? ''}${message.quote.edited ? ' · Edited' : ''}` }));
    const qt = el('div', { class: 'quote-text' });
    renderTextInto(qt, message.quote.text ?? '');
    q.append(qt);
    article.append(q);
  } else if (message.quote && message.quote.deleted) {
    const q = el('div', { class: 'quote-block' });
    q.append(el('div', { class: 'quote-head', text: 'Original deleted' }));
    q.append(el('div', { class: 'quote-text', text: 'This message was deleted.' }));
    article.append(q);
  }

  if (message.attachments.length > 0) {
    const att = el('div', { class: 'attachments' });
    for (const file of message.attachments) {
      const img = el('img', {
        src: file.thumb_url, alt: file.filename, 'data-attachment-id': file.id,
      });
      img.addEventListener('click', () => openPhotoDialog(file.id, message.channel_id));
      att.append(img);
    }
    article.append(att);
  }

  const foot = el('div');
  foot.style.display = 'flex';
  foot.style.gap = '8px';
  foot.style.flexWrap = 'wrap';
  foot.style.alignItems = 'center';

  if (!opts.inThread && message.reply_count > 0) {
    const btn = el('button', { class: 'reply-link', text: `View ${message.reply_count} replies` });
    btn.addEventListener('click', () => openThread(message.id));
    foot.append(btn);
  }

  if (message.author.id === state.me?.id) {
    const pending = state.pending.find((p) => p.clientId === message.client_message_id);
    if (pending && pending.status === 'failed') {
      const retry = el('button', { text: 'Retry send' });
      retry.addEventListener('click', () => retrySend(pending.clientId));
      const discard = el('button', { text: 'Discard' });
      discard.addEventListener('click', () => {
        state.pending = state.pending.filter((p) => p.clientId !== pending.clientId);
        state.messages = state.messages.filter((m) => m.client_message_id !== pending.clientId);
        renderMessages();
        if (opts.inThread) refreshOpenThread();
      });
      foot.append(retry, discard);
      const errLine = el('div', { class: 'field-error', text: pending.error ?? '' });
      article.append(foot, errLine);
      queueMicrotask(async () => {
        const chipEl = await chip('alert-triangle', 'Failed', { failed: true });
        rowHead.insertBefore(chipEl, rowHead.querySelector('.time') as Node);
      });
      return article;
    }
    queueMicrotask(async () => {
      const chipEl = await renderDeliveryChip(message);
      rowHead.insertBefore(chipEl, rowHead.querySelector('.time') as Node);
    });
  }

  article.append(foot);

  const actions = el('button', { class: 'msg-actions', 'aria-label': 'Message actions' });
  actions.append(svgInline('ellipsis'));
  actions.addEventListener('click', () => openMessageMenu(actions, message, opts.inThread));
  article.append(actions);

  return article;
}

function svgInline(name: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  queueMicrotask(async () => {
    const svg = await icon(name);
    if (svg) span.innerHTML = svg;
  });
  return span;
}

/** The delivery-state chip derivation, decided in one place. */
async function renderDeliveryChip(message: MessageView): Promise<HTMLElement> {
  const pending = state.pending.find((p) => p.clientId === message.client_message_id);
  if (pending && pending.status === 'pending') {
    return chip('hourglass', 'Pending');
  }
  if (message.delivered_count === 0 && message.read_count === 0) {
    return chip('check', 'Sent');
  }
  if (message.read_count === 0) {
    return chip('check-check', 'Delivered');
  }
  return chip('eye', `Read · ${message.read_count}`);
}

function renderTextInto(target: HTMLElement, text: string): void {
  clear(target);
  const segments = parseText(text);
  for (const seg of segments) {
    if (seg.kind === 'text') target.append(document.createTextNode(seg.value));
    else if (seg.kind === 'br') target.append(el('br'));
    else {
      const a = el('a', { href: seg.href ?? '', target: '_blank', rel: 'noopener noreferrer', text: seg.value });
      target.append(a);
    }
  }
}

async function openMessageMenu(anchor: HTMLElement, message: MessageView, inThread: boolean): Promise<void> {
  closeMenu();
  const menu = el('div', { class: 'menu', role: 'menu' });
  const add = async (label: string, fn: () => void) => {
    const btn = el('button', { role: 'menuitem', text: label });
    btn.addEventListener('click', () => {
      closeMenu();
      fn();
    });
    menu.append(btn);
  };

  const canCorrect = state.me?.role === 'ops_manager' || state.me?.role === 'dispatcher' || state.me?.role === 'crew_lead';
  const isAuthor = message.author.id === state.me?.id;

  if (!inThread) {
    await add('Reply in thread', () => openThread(message.id));
  }
  await add('Quote', () => {
    quoteMessage = message;
    state.quoteId = message.id;
    renderQuotePreview();
  });
  // Edit is listed only while the estimated server time is before editable_until.
  const editable = serverNow().getTime() < Date.parse(message.editable_until);
  const editBtn = el('button', { role: 'menuitem', text: 'Edit' });
  const refreshEdit = (): void => {
    const still = serverNow().getTime() < Date.parse(message.editable_until);
    editBtn.hidden = !still;
  };
  refreshEdit();
  const interval = window.setInterval(refreshEdit, 1000);
  editBtn.addEventListener('click', () => {
    window.clearInterval(interval);
    closeMenu();
    openEditDialog(message);
  });
  menu.append(editBtn);

  if (isAuthor || canCorrect) {
    await add('Delete', () => openDeleteDialog(message));
  }
  if (canCorrect) {
    await add(message.pinned ? 'Unpin' : 'Pin', () => togglePin(message));
  }
  if (isAuthor || canCorrect) {
    await add('Receipts', () => openReceipts(message.id));
  }
  await add('Version history', () => openVersions(message.id));

  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - 210)}px`;
  document.addEventListener('click', menuOutsideClick, { capture: true });
  document.addEventListener('keydown', menuEscape, { capture: true });
  openMenuEl = menu;
  (menu.querySelector('button:not([hidden])') as HTMLElement).focus();
}

let openMenuEl: HTMLElement | null = null;

function closeMenu(): void {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
    document.removeEventListener('click', menuOutsideClick, { capture: true });
    document.removeEventListener('keydown', menuEscape, { capture: true });
  }
}

function menuOutsideClick(event: Event): void {
  if (openMenuEl && !openMenuEl.contains(event.target as Node)) closeMenu();
}

function menuEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeMenu();
  }
}

/* ---------------- Composer and sends ---------------- */

async function renderComposer(threadRootId: string | null): Promise<HTMLElement> {
  const wrap = el('div', { class: 'composer' });

  const quotePreview = el('div', { class: 'quote-block', hidden: 'hidden', id: 'quote-preview' });

  const tray = el('ul', { class: 'photo-tray', 'aria-label': 'Photos to send', id: 'photo-tray' });
  const refusals = el('div', { class: 'refusals', id: 'photo-refusals' });
  const progress = el('div', { class: 'progress-wrap', hidden: 'hidden', id: 'upload-progress' });
  const track = el('div', { class: 'progress-track' });
  const fill = el('div', { class: 'progress-fill' });
  track.append(fill);
  const pct = el('span', { class: 'progress-pct', text: '0%' });
  const bar = el('progress', { class: 'visually-hidden-upload', 'aria-label': 'Upload progress', id: 'upload-bar' }) as HTMLProgressElement;
  bar.style.display = 'none';
  progress.append(track, pct, bar);

  const row = el('div', { class: 'row' });
  const attach = el('button', { text: 'Attach photos', 'aria-label': 'Attach photos' });
  const fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: 'multiple', id: 'attach-input', 'aria-label': 'Attach photos' }) as HTMLInputElement;
  fileInput.style.position = 'absolute';
  fileInput.style.width = '1px';
  fileInput.style.height = '1px';
  fileInput.style.opacity = '0';
  fileInput.addEventListener('change', () => {
    void choosePhotos(Array.from(fileInput.files ?? []), tray, refusals);
    fileInput.value = '';
  });
  attach.addEventListener('click', () => fileInput.click());
  wrap.append(fileInput);

  const text = el('textarea', {
    class: 'msg-input', 'aria-label': threadRootId ? 'Reply' : 'Message',
    placeholder: threadRootId ? 'Write a reply…' : 'Write a message…',
    rows: '1',
  }) as HTMLTextAreaElement;
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitSend(text, threadRootId, progress, fill, pct, tray, refusals);
    }
  });

  const send = el('button', { class: 'send-btn', text: 'Send', 'aria-label': threadRootId ? 'Send reply' : 'Send' });
  send.addEventListener('click', () => submitSend(text, threadRootId, progress, fill, pct, tray, refusals));

  row.append(attach, text, send);
  wrap.append(quotePreview, tray, refusals, progress, row);
  composerBox = text;
  return wrap;
}

function renderQuotePreview(): void {
  const preview = document.getElementById('quote-preview');
  if (!preview) return;
  if (!quoteMessage) {
    preview.hidden = true;
    return;
  }
  preview.hidden = false;
  clear(preview);
  preview.append(el('div', { class: 'quote-head', text: `Quoting ${quoteMessage.author.name}` }));
  preview.append(el('div', { class: 'quote-text', text: quoteMessage.text }));
  const remove = el('button', { text: 'Remove quote' });
  remove.addEventListener('click', () => {
    quoteMessage = null;
    state.quoteId = null;
    renderQuotePreview();
  });
  preview.append(remove);
}

async function choosePhotos(files: File[], tray: HTMLElement, refusals: HTMLElement): Promise<void> {
  clear(refusals);
  const accepted: File[] = [];
  for (const file of files) {
    const kind = await checkChosenPhoto(file);
    if (kind === null) {
      const line = el('div', { class: 'refusal', text: `${file.name} is not a JPEG, PNG or WebP photo.` });
      refusals.append(line);
      announceUpload(`${file.name} is not a JPEG, PNG or WebP photo.`);
      continue;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      refusals.append(el('div', { class: 'refusal', text: `${file.name} is over the photo size limit.` }));
      announceUpload(`${file.name} is over the photo size limit.`);
      continue;
    }
    if (trayFiles.length + accepted.length >= MAX_PHOTOS) {
      refusals.append(el('div', { class: 'refusal', text: 'That is more photos than one message can carry.' }));
      announceUpload('That is more photos than one message can carry.');
      continue;
    }
    accepted.push(file);
  }
  trayFiles = [...trayFiles, ...accepted];
  renderTray(tray);
}

function renderTray(tray: HTMLElement): void {
  clear(tray);
  trayFiles.forEach((file, index) => {
    const li = el('li');
    li.append(el('span', { text: file.name }));
    const remove = el('button', { class: 'remove', 'aria-label': `Remove ${file.name}`, text: '×' });
    remove.addEventListener('click', () => {
      trayFiles = trayFiles.filter((_, i) => i !== index);
      renderTray(tray);
    });
    li.append(remove);
    tray.append(li);
  });
}

async function submitSend(
  text: HTMLTextAreaElement,
  threadRootId: string | null,
  progress: HTMLElement,
  fill: HTMLElement,
  pct: HTMLElement,
  tray: HTMLElement,
  refusals: HTMLElement,
): Promise<void> {
  const body = text.value;
  if (body.trim() === '' && trayFiles.length === 0) return;
  const clientId = newClientId();
  const photos = trayFiles;
  trayFiles = [];
  renderTray(tray);

  const pending: PendingSend = {
    clientId,
    text: body,
    threadRootId,
    quoteId: quoteMessage?.id ?? null,
    status: 'pending',
    photoNames: photos.map((f) => f.name),
  };
  state.pending = [...state.pending, pending];

  const optimistic: MessageView = {
    id: `pending-${clientId}`,
    channel_id: state.openChannelId ?? '',
    client_message_id: clientId,
    author: { id: state.me?.id ?? '', name: state.me?.name ?? '', role: state.me?.role ?? 'field_technician' },
    text: body.trim(),
    version: 1,
    edited: false,
    sent_at: new Date().toISOString(),
    edited_at: null,
    editable_until: new Date(Date.now() + 86400000).toISOString(),
    thread_root_id: threadRootId,
    reply_count: 0,
    quote: quoteMessage
      ? { message_id: quoteMessage.id, author_name: quoteMessage.author.name, text: quoteMessage.text, edited: quoteMessage.edited, deleted: false }
      : null,
    attachments: [],
    pinned: false,
    pinned_by: null,
    recipient_count: 0,
    delivered_count: 0,
    read_count: 0,
    deleted: false,
  };
  if (threadRootId === null) {
    state.messages = [...state.messages, optimistic];
    renderMessages();
    messagesScroll.scrollTop = messagesScroll.scrollHeight;
  }

  text.value = '';
  quoteMessage = null;
  state.quoteId = null;
  renderQuotePreview();
  clear(refusals);

  await sendPending(pending, photos, { progress, fill, pct }, threadRootId === null);
}

async function retrySend(clientId: string): Promise<void> {
  const pending = state.pending.find((p) => p.clientId === clientId);
  if (!pending) return;
  pending.status = 'pending';
  const progress = document.getElementById('upload-progress');
  const fill = progress?.querySelector('.progress-fill') as HTMLElement | null;
  const pct = progress?.querySelector('.progress-pct') as HTMLElement | null;
  const photos: File[] = [];
  await sendPending(pending, photos, { progress: progress ?? null, fill, pct }, true);
}

async function sendPending(
  pending: PendingSend,
  photos: File[],
  ui: { progress: HTMLElement | null; fill: HTMLElement | null; pct: HTMLElement | null },
  topLevel: boolean,
): Promise<void> {
  const channelId = state.openChannelId;
  if (!channelId) return;
  const path = `/api/channels/${channelId}/messages`;
  try {
    let res;
    if (photos.length > 0) {
      const form = new FormData();
      form.append('client_message_id', pending.clientId);
      form.append('text', pending.text);
      if (pending.threadRootId) form.append('thread_root_id', pending.threadRootId);
      if (pending.quoteId) form.append('quoted_message_id', pending.quoteId);
      for (const photo of photos) form.append('file', photo, photo.name);
      if (ui.progress && ui.fill && ui.pct) {
        ui.progress.hidden = false;
        announceUpload(`Uploading ${photos.length} photo${photos.length === 1 ? '' : 's'}: 0%.`);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', path);
        xhr.responseType = 'json';
        const done = new Promise<void>((resolve) => {
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const ratio = e.loaded / e.total;
              const quarter = Math.min(100, Math.floor(ratio * 4) * 25);
              ui.fill!.style.width = `${quarter}%`;
              ui.pct!.textContent = `${quarter}%`;
              const word = photos.length === 1 ? 'photo' : 'photos';
              announceUpload(`Uploading ${photos.length} ${word}: ${quarter}%.`);
            }
          });
          xhr.addEventListener('load', () => resolve());
          xhr.addEventListener('error', () => resolve());
          xhr.addEventListener('abort', () => resolve());
        });
        xhr.send(form);
        await done;
        if (xhr.status >= 500 || xhr.status === 0) {
          throw new ApiFailure(xhr.status || 500, {
            error: 'network',
            message: 'Message failed to send. Use Retry send.',
          });
        }
        const body = (xhr.response ?? { error: 'internal_error', message: 'Something went wrong on our side. Try again.' }) as { error: string; message: string; errors?: Record<string, string> };
        if (xhr.status >= 400) {
          throw new ApiFailure(xhr.status, body);
        }
        res = { data: body as unknown as { message: MessageView }, headers: new Headers() };
      } else {
        res = await api<{ message: MessageView }>(path, { method: 'POST', body: form });
      }
      ui.progress?.setAttribute('hidden', 'hidden');
      announceUpload(`${photos.length} photo${photos.length === 1 ? '' : 's'} sent.`);
    } else {
      const payload: Record<string, unknown> = {
        client_message_id: pending.clientId,
        text: pending.text,
      };
      if (pending.threadRootId) payload.thread_root_id = pending.threadRootId;
      if (pending.quoteId) payload.quoted_message_id = pending.quoteId;
      res = await apiJson<{ message: MessageView }>(path, 'POST', payload);
    }

    state.pending = state.pending.filter((p) => p.clientId !== pending.clientId);
    const message = res.data.message;
    if (topLevel) {
      state.messages = state.messages.filter((m) => m.client_message_id !== pending.clientId);
      state.messages = [...state.messages, message];
      renderMessages();
    } else {
      await refreshOpenThread();
    }
    announceDelivery('Message sent.');
    if (photos.length > 0) announceUpload(`${photos.length} photo${photos.length === 1 ? '' : 's'} sent.`);
  } catch (err) {
    state.pending = state.pending.filter((p) => p.clientId !== pending.clientId);
    const pendingFailed: PendingSend = { ...pending, status: 'failed' };
    let copy = 'Message failed to send. Use Retry send.';
    if (err instanceof ApiFailure) {
      copy = err.body.message;
    }
    pendingFailed.error = copy;
    state.pending = [...state.pending, pendingFailed];
    if (topLevel) {
      renderMessages();
      messagesScroll.scrollTop = messagesScroll.scrollHeight;
    } else {
      await refreshOpenThread();
    }
    announceDelivery(`Message failed to send: ${copy}`);
    if (photos.length > 0 && err instanceof ApiFailure && err.body.error === 'storage_unavailable') {
      announceUpload(`Photo upload stopped: ${err.body.message}`);
    }
  }
}

/* ---------------- Read and delivered reporting ---------------- */

function scheduleDeliveryReports(): void {
  const ids: string[] = [];
  for (const message of state.messages) {
    if (message.author.id !== state.me?.id && !deliveredQueue.has(message.id) && !message.id.startsWith('pending-')) {
      ids.push(message.id);
      deliveredQueue.add(message.id);
    }
  }
  const panelMessages = document.querySelectorAll('[data-message-id]');
  for (const node of panelMessages) {
    const id = node.getAttribute('data-message-id') ?? '';
    if (id && !id.startsWith('pending-') && !deliveredQueue.has(id)) {
      deliveredQueue.add(id);
      ids.push(id);
    }
  }
  if (ids.length > 0) {
    window.setTimeout(async () => {
      try {
        await apiJson('/api/receipts', 'POST', { message_ids: ids.slice(0, 100), state: 'delivered' });
      } catch {
        // retried on next schedule
      }
    }, 1500);
  }
}

function observeReads(): void {
  if (document.hidden) return;
  const rows = messagesScroll.querySelectorAll('article[data-message-id]');
  rows.forEach((row) => {
    const id = row.getAttribute('data-message-id') ?? '';
    if (!id || id.startsWith('pending-')) return;
    if (readTimers.has(id)) return;
    const message = state.messages.find((m) => m.id === id);
    if (!message || message.author.id === state.me?.id) return;
    const timer = window.setTimeout(() => {
      readTimers.delete(id);
      const rect = row.getBoundingClientRect();
      const visible = rect.top < window.innerHeight && rect.bottom > 0;
      if (visible && !document.hidden) reportRead(id);
    }, 1000);
    readTimers.set(id, timer);
  });
}

async function reportRead(messageId: string): Promise<void> {
  try {
    await apiJson('/api/receipts', 'POST', { message_ids: [messageId], state: 'read' });
  } catch {
    // retried next time the message shows
  }
}

/* ---------------- Live events ---------------- */

let eventSource: EventSource | null = null;
let pausedAt = 0;
let lastHeartbeat = Date.now();
let heartbeatWatchdog = 0;

function setNotice(text: string): void {
  const notices = document.querySelector('.notices');
  if (notices) notices.textContent = text;
}

/** Marks the stream paused when the heartbeat stops for 5 seconds. */
function startHeartbeatWatchdog(): void {
  window.clearInterval(heartbeatWatchdog);
  heartbeatWatchdog = window.setInterval(() => {
    if (Date.now() - lastHeartbeat > 5000 && state.live !== 'paused') {
      state.live = 'paused';
      if (pausedAt === 0) pausedAt = Date.now();
      announceNotice('Live updates paused. Reconnecting.');
      setNotice('Live updates paused. Reconnecting.');
    }
  }, 1000);
}

function connectEvents(): void {
  if (eventSource) eventSource.close();
  const url = state.lastEventId > 0 ? `/api/events?last_event_id=${state.lastEventId}` : '/api/events';
  eventSource = new EventSource(url);
  state.live = 'connecting';
  lastHeartbeat = Date.now();
  eventSource.addEventListener('heartbeat', () => {
    lastHeartbeat = Date.now();
    if (state.live === 'paused') {
      state.live = 'live';
      announceNotice('Live updates resumed.');
      setNotice('Live updates resumed.');
      pausedAt = 0;
    }
  });
  eventSource.addEventListener('open', () => {
    if (state.live !== 'live') {
      const wasPaused = state.live === 'paused';
      state.live = 'live';
      lastHeartbeat = Date.now();
      startHeartbeatWatchdog();
      if (wasPaused) {
        announceNotice('Live updates resumed.');
        setNotice('Live updates resumed.');
        pausedAt = 0;
      }
    }
  });
  eventSource.onmessage = (event) => {
    const parsed = JSON.parse(event.data);
    handleEvent(event.type, parsed);
  };
  for (const name of ['message.created', 'message.updated', 'message.deleted', 'receipts.updated', 'channel.updated', 'channel.added', 'channel.revoked', 'stream.reset', 'session.ended']) {
    eventSource.addEventListener(name, (event) => {
      let parsed: unknown = {};
      try {
        parsed = JSON.parse((event as MessageEvent).data);
      } catch {
        parsed = {};
      }
      if (name === 'session.ended') {
        eventSource?.close();
        renderSignIn('Your session has ended. Sign in again.');
        return;
      }
      handleEvent(name, parsed as Record<string, unknown>);
    });
  }
  eventSource.onerror = () => {
    state.live = 'paused';
    if (pausedAt === 0) pausedAt = Date.now();
    eventSource?.close();
    startHeartbeatWatchdog();
    window.setTimeout(() => {
      if (state.live === 'paused') {
        announceNotice('Live updates paused. Reconnecting.');
        setNotice('Live updates paused. Reconnecting.');
      }
    }, 5000);
    window.setTimeout(() => connectEvents(), 2000);
  };
}

async function handleEvent(name: string, data: Record<string, unknown>): Promise<void> {
  if (typeof data.__id === 'number') {
    state.lastEventId = Math.max(state.lastEventId, data.__id as number);
  }
  if (name === 'stream.reset') {
    await refetchAll();
    return;
  }
  if (name === 'message.created' || name === 'message.updated') {
    const message = data.message as MessageView | undefined;
    if (!message) return;
    if (message.channel_id === state.openChannelId) {
      const wasAtBottom = messagesScroll.scrollHeight - messagesScroll.scrollTop - messagesScroll.clientHeight < 80;
      const existing = state.messages.findIndex((m) => m.id === message.id);
      if (name === 'message.created') {
        if (existing === -1 && message.thread_root_id === null) {
          state.messages = [...state.messages, message];
        } else if (existing >= 0) {
          state.messages[existing] = message;
        }
      } else if (existing >= 0) {
        state.messages[existing] = message;
      } else if (name === 'message.updated') {
        const idx = state.messages.findIndex((m) => m.id === message.id);
        if (idx >= 0) state.messages[idx] = message;
      }
      renderMessages();
      if (wasAtBottom) messagesScroll.scrollTop = messagesScroll.scrollHeight;
    }
    if (message.author.id === state.me?.id) {
      const row = messagesScroll.querySelector(`[data-message-id="${message.id}"]`);
      if (row) {
        const prevChip = row.querySelector('.chip');
        const prevText = prevChip?.textContent ?? '';
        const next = message.delivered_count > 0 && message.read_count === 0
          ? 'Delivered'
          : message.read_count > 0 ? `Read · ${message.read_count}` : 'Sent';
        if (prevText !== next) {
          if (next === 'Delivered') announceDelivery('Message delivered.');
          if (next.startsWith('Read')) announceDelivery(`Message read by ${message.read_count}.`);
          renderMessages();
        }
      }
    }
    if (state.panel?.kind === 'thread') await refreshOpenThread();
    if (state.panel?.kind === 'receipts' && state.panel.messageId === message.id) await openReceipts(message.id, false);
    const channel = state.channelById(message.channel_id);
    if (channel && name === 'message.created') {
      channel.unread_count = channel.unread_count; // recomputed from channel.updated
      renderRail();
    }
    return;
  }
  if (name === 'message.deleted') {
    const messageId = data.message_id as string;
    const channelId = data.channel_id as string;
    if (channelId === state.openChannelId) {
      state.messages = state.messages.filter((m) => m.id !== messageId);
      renderMessages();
    }
    if (state.panel?.kind === 'thread' && state.panel.threadRootId === messageId) closeDetails();
    return;
  }
  if (name === 'receipts.updated') {
    const messageId = data.message_id as string;
    const idx = state.messages.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      const message = state.messages[idx];
      const updated = { ...message, delivered_count: data.delivered_count as number, read_count: data.read_count as number, recipient_count: data.recipient_count as number };
      state.messages[idx] = updated;
      if (message.author.id === state.me?.id) {
        const next = updated.delivered_count > 0 && updated.read_count === 0 ? 'Delivered' : updated.read_count > 0 ? `Read · ${updated.read_count}` : 'Sent';
        const row = messagesScroll.querySelector(`[data-message-id="${messageId}"] .chip`);
        const prevText = row?.textContent ?? '';
        if (prevText !== next) {
          renderMessages();
          if (next === 'Delivered') announceDelivery('Message delivered.');
          else if (next.startsWith('Read')) announceDelivery(`Message read by ${updated.read_count}.`);
        }
      }
    }
    if (state.panel?.kind === 'receipts' && state.panel.messageId === messageId) await openReceipts(messageId, false);
    return;
  }
  if (name === 'channel.updated') {
    const channel = data.channel as ChannelView | undefined;
    if (channel) {
      const idx = state.channels.findIndex((c) => c.id === channel.id);
      if (idx >= 0) {
        state.channels[idx] = channel;
        renderRail();
      }
    }
    return;
  }
  if (name === 'channel.added') {
    const channel = data.channel as ChannelView | undefined;
    if (channel && !state.channelById(channel.id)) {
      state.channels = [...state.channels, channel].sort((a, b) => a.name.localeCompare(b.name));
      renderRail();
      const lost = document.querySelector('.lost-access');
      if (lost && channel.id === state.openChannelId) {
        await openChannel(channel.id);
      }
    }
    return;
  }
  if (name === 'channel.revoked') {
    const channelId = data.channel_id as string;
    const channelName = (data.channel_name as string | undefined)
      ?? state.channelById(channelId)?.name
      ?? channelId;
    state.channels = state.channels.filter((c) => c.id !== channelId);
    renderRail();
    if (state.openChannelId === channelId) {
      clear(mainCol);
      mainCol.append(el('div', { class: 'not-found lost-access', text: `You no longer have access to #${channelName}.` }));
      announceNotice(`You no longer have access to #${channelName}.`);
      const notices = document.querySelector('.notices');
      if (notices) notices.textContent = `You no longer have access to #${channelName}.`;
    }
    if (state.panel?.kind === 'thread' || state.panel?.kind === 'photos' || state.panel?.kind === 'search') {
      closeDetails();
    }
    return;
  }
}

async function refetchAll(): Promise<void> {
  const res = await api<{ channels: ChannelView[] }>('/api/channels');
  state.channels = res.data.channels;
  renderRail();
  if (state.openChannelId && state.channelById(state.openChannelId)) {
    await loadHistory(state.openChannelId);
    renderMessages();
    if (state.panel) await restorePanelFromAddress();
  }
}

window.addEventListener('popstate', async () => {
  const path = window.location.pathname;
  const channelId = path.startsWith('/c/') ? path.slice(3) : null;
  if (channelId && state.channelById(channelId)) {
    await openChannel(channelId, { restorePanel: true });
  } else if (channelId) {
    state.openChannelId = null;
    clear(mainCol);
    mainCol.append(el('div', { class: 'not-found', text: 'That was not found.' }));
  }
});

/* ---------------- Detail panels ---------------- */

function closeDetails(): void {
  detailCol.setAttribute('hidden', 'hidden');
  clear(detailCol);
  state.panel = null;
  const url = new URL(window.location.href);
  url.searchParams.delete('q');
  url.searchParams.delete('thread');
  url.searchParams.delete('photo');
  window.history.replaceState(null, '', url.pathname);
}

async function showDetail(title: string): Promise<HTMLElement> {
  detailCol.removeAttribute('hidden');
  clear(detailCol);
  const head = el('div', { class: 'detail-head' });
  const h2 = el('h2', { text: title });
  const closeBtn = el('button', { text: 'Close details' });
  closeBtn.addEventListener('click', () => {
    closeDetails();
    (focusReturn ?? composerBox)?.focus();
  });
  head.append(h2, closeBtn);
  const body = el('div', { class: 'detail-body' });
  detailCol.append(head, body);
  return body;
}

async function restorePanelFromAddress(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.has('q')) {
    await openSearch(params.get('q') ?? '', document.getElementById('search-error') as HTMLElement, { push: false });
    return;
  }
  if (params.has('thread')) {
    await openThread(params.get('thread') ?? '', { push: false });
    return;
  }
  if (params.has('photo')) {
    await openPhotosPanel({ push: false });
    await openPhotoDialog(params.get('photo') ?? '', state.openChannelId ?? '');
    return;
  }
  if (state.panel) {
    switch (state.panel.kind) {
      case 'photos': await openPhotosPanel({ push: false }); break;
      case 'scheduled': await openScheduledPanel({ push: false }); break;
      case 'members': await openMembersPanel(state.openChannelId ?? '', { push: false }); break;
      default: break;
    }
  }
}

async function openThread(rootId: string, opts: { push?: boolean } = { push: true }): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  state.panel = { kind: 'thread', threadRootId: rootId };
  if (opts.push !== false) {
    const url = new URL(window.location.href);
    url.search = `?thread=${rootId}`;
    window.history.pushState(null, '', url.pathname + url.search);
  }
  const body = await showDetail('Thread');
  try {
    const res = await api<{ root: MessageView; replies: MessageView[] }>(`/api/messages/${rootId}/thread`);
    const rootArticle = renderMessageRow(res.data.root, { inThread: true });
    body.append(el('div', { class: 'thread-root' }, rootArticle));
    const repliesWrap = el('div', { class: 'thread-replies' });
    for (const reply of res.data.replies.slice().reverse()) {
      repliesWrap.append(renderMessageRow(reply, { inThread: true }));
    }
    body.append(repliesWrap);
    const composer = await renderComposer(rootId);
    composer.querySelector('textarea')?.setAttribute('aria-label', 'Reply');
    const sendBtn = composer.querySelector('.send-btn');
    sendBtn?.setAttribute('aria-label', 'Send reply');
    body.append(composer);
    (composer.querySelector('textarea') as HTMLElement).focus();
  } catch {
    body.append(el('p', { class: 'not-found', text: 'That was not found.' }));
  }
}

async function refreshOpenThread(): Promise<void> {
  if (state.panel?.kind !== 'thread' || !state.panel.threadRootId) return;
  await openThread(state.panel.threadRootId, { push: false });
}

async function openVersions(messageId: string): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  state.panel = { kind: 'versions', messageId };
  const body = await showDetail('Version history');
  try {
    const res = await api<{ versions: { version: number; text: string; edited_by: { name: string }; created_at: string }[] }>(`/api/messages/${messageId}/versions`);
    const list = el('ul', { class: 'versions-list', 'aria-label': 'Versions' });
    for (const v of res.data.versions) {
      const li = el('li');
      const line = el('div', { class: 'v-line' });
      line.append(el('span', { class: 'v-num', text: `v${v.version}` }));
      line.append(el('span', { text: v.edited_by.name }));
      line.append(el('span', { class: 'time mono', text: formatLocal(state.workspace?.time_zone ?? 'UTC', v.created_at) }));
      li.append(line, el('div', { class: 'v-text', text: v.text }));
      list.append(li);
    }
    body.append(list);
  } catch {
    body.append(el('p', { class: 'not-found', text: 'That was not found.' }));
  }
}

async function openPhotosPanel(opts: { push?: boolean } = { push: true }): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  state.panel = { kind: 'photos' };
  if (opts.push !== false) {
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    url.searchParams.delete('thread');
    window.history.replaceState(null, '', url.pathname);
  }
  const body = await showDetail('Photos');
  try {
    const res = await api<{ photos: { attachment_id: string; message_id: string; filename: string; uploaded_by: { name: string }; thumb_url: string; uploaded_at: string }[]; next_cursor: string | null }>(
      `/api/channels/${state.openChannelId}/gallery`,
    );
    const list = el('ul', { class: 'gallery-list', 'aria-label': 'Photos' });
    for (const photo of res.data.photos) {
      const li = el('li');
      const link = el('a', {
        href: `?photo=${photo.attachment_id}`,
        'aria-label': `Photo ${photo.filename} by ${photo.uploaded_by.name}`,
      });
      const img = el('img', { src: photo.thumb_url, alt: photo.filename });
      link.append(img, el('span', { class: 'g-name', text: photo.filename }));
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = new URL(window.location.href);
        url.searchParams.set('photo', photo.attachment_id);
        window.history.pushState(null, '', url.pathname + url.search);
        await openPhotoDialog(photo.attachment_id, state.openChannelId ?? '');
      });
      li.append(link);
      list.append(li);
    }
    if (res.data.photos.length === 0) {
      body.append(el('p', { class: 'searching-line', text: 'No photos yet in this channel.' }));
    }
    body.append(list);
  } catch {
    body.append(el('p', { class: 'not-found', text: 'That was not found.' }));
  }
}

async function openPhotoDialog(attachmentId: string, channelId: string): Promise<void> {
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Photo' });
  const head = el('div', { class: 'dialog-head' });
  head.append(el('h2', { text: 'Photo' }));
  const closeBtn = el('button', { text: 'Close', 'aria-label': 'Close' });
  const body = el('div', { class: 'dialog-body dialog-overlay-photo' });
  const img = el('img', { src: `/api/attachments/${attachmentId}`, alt: 'Photo' });
  img.addEventListener('error', () => {
    clear(body);
    body.append(el('p', { class: 'field-error', text: 'That was not found.' }));
  });
  body.append(img);
  const foot = el('div', { class: 'dialog-foot' });
  const goBtn = el('button', { text: 'Go to message' });
  goBtn.addEventListener('click', async () => {
    closeDialog(backdrop);
    try {
      const res = await api<{ photos: { attachment_id: string; message_id: string }[] }>(`/api/channels/${channelId}/gallery`);
      const hit = res.data.photos.find((p) => p.attachment_id === attachmentId);
      if (hit) {
        const msgRes = await api<{ message: MessageView }>(`/api/messages/${hit.message_id}`);
        const message = msgRes.data.message;
        if (message.channel_id !== state.openChannelId) {
          await openChannel(message.channel_id);
        }
        const row = messagesScroll.querySelector(`[data-message-id="${hit.message_id}"]`) as HTMLElement | null;
        if (row) {
          row.scrollIntoView({ block: 'center' });
          row.focus();
        } else if (message.thread_root_id) {
          await openThread(message.thread_root_id);
        }
      }
    } catch {
      // photo vanished
    }
  });
  foot.append(goBtn, closeBtn);
  dialog.append(head, body, foot);
  backdrop.append(dialog);
  document.body.append(backdrop);
  dialogStack.push(backdrop);
  closeBtn.addEventListener('click', () => {
    closeDialog(backdrop);
    const url = new URL(window.location.href);
    if (url.searchParams.has('photo')) {
      url.searchParams.delete('photo');
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
    }
  });
  closeBtn.focus();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeDialog(backdrop);
    }
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeBtn.click();
    }
  });
}

function closeDialog(backdrop: HTMLElement): void {
  backdrop.remove();
  dialogStack = dialogStack.filter((d) => d !== backdrop);
}

/* ---------------- Receipts scrubber ---------------- */

async function openReceipts(messageId: string, open = true): Promise<void> {
  if (open) focusReturn = document.activeElement as HTMLElement;
  state.panel = { kind: 'receipts', messageId };
  const body = await showDetail('Receipts');
  let data;
  try {
    const res = await api<import('./types').ReceiptsView>(`/api/messages/${messageId}/receipts`);
    data = res.data;
  } catch {
    body.append(el('p', { class: 'not-found', text: 'That was not found.' }));
    return;
  }
  const zone = state.workspace?.time_zone ?? 'UTC';
  currentReceipts = {
    sentAt: new Date(data.sent_at),
    versions: data.versions.map((v) => ({ version: v.version, created: new Date(v.created_at), text: v.text, editor: v.edited_by.name })),
    recipients: data.recipients.map((r) => ({
      id: r.user.id,
      name: r.user.name,
      deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
      reads: r.reads.map((rd) => ({ version: rd.version, readAt: new Date(rd.read_at) })),
    })),
  };
  if (scrubPinnedToNow) scrubInstantMs = null;

  const scrub = el('div', { class: 'scrubber' });
  scrubEl = scrub;

  const trackWrap = el('div', { class: 'scrub-track-wrap' });
  const track = el('div', { class: 'scrub-track', role: 'slider', tabindex: '0', 'aria-label': 'Receipts time', 'aria-valuemin': '0', 'aria-valuemax': '100' });
  scrubHandleEl = el('div', { class: 'scrub-handle' });
  const handleGlyph = svgInline('chevron-left');
  scrubHandleEl.append(handleGlyph);
  scrubDotEls = [];
  track.append(scrubHandleEl);
  trackWrap.append(track);
  scrub.append(trackWrap);

  const versionAt = el('div', { class: 'version-at', role: 'region', 'aria-label': 'Version at selected time' });
  const vchip = el('span', { class: 'vchip' });
  const vtext = el('div', { class: 'msg-text' });
  versionAt.append(vchip, vtext);
  scrub.append(versionAt);

  const lanes = el('div', { class: 'lanes' });
  const readLane = el('div', { class: 'lane read-lane' });
  readLane.append(el('h3', { text: 'Read' }));
  const readList = el('ul', { 'aria-label': 'Read' });
  readLane.append(readList);
  const notLane = el('div', { class: 'lane not-lane' });
  notLane.append(el('h3', { text: 'Not yet' }));
  const notList = el('ul', { 'aria-label': 'Not yet' });
  notLane.append(notList);
  lanes.append(readLane, notLane);
  scrub.append(lanes);

  const countLine = el('div', { class: 'read-count-line' });
  scrub.append(countLine);

  const eventToggle = el('button', { class: 'event-list-toggle', text: state.reducedMotion ? 'Hide event list' : 'Show event list' });
  const eventList = el('select', { class: 'event-options', 'aria-label': 'Edit and read events', size: '6' }) as HTMLSelectElement;
  eventList.hidden = state.reducedMotion ? false : true;
  eventToggle.addEventListener('click', () => {
    eventList.hidden = !eventList.hidden;
    eventToggle.textContent = eventList.hidden ? 'Show event list' : 'Hide event list';
  });
  scrub.append(eventToggle, eventList);

  body.append(scrub);

  const update = (): void => {
    const now = Date.now();
    const sentMs = currentReceipts!.sentAt.getTime();
    const end = Math.max(now, sentMs + 1000);
    const instant = scrubInstantMs ?? end;
    const pct = Math.min(100, Math.max(0, ((instant - sentMs) / (end - sentMs)) * 100));

    // handle position
    scrubHandleEl!.style.left = `${pct}%`;
    track.setAttribute('aria-valuenow', String(Math.round(pct * 100) / 100));

    // ticks and dots
    clear(track);
    track.append(scrubHandleEl as Node);
    for (const v of currentReceipts!.versions) {
      if (v.version === 1) continue;
      const tick = el('div', { class: 'scrub-tick' });
      const tp = Math.min(100, Math.max(0, ((v.created.getTime() - sentMs) / (end - sentMs)) * 100));
      tick.style.left = `${tp}%`;
      const label = el('span', { class: 'tick-label', text: `v${v.version}` });
      tick.append(label);
      track.append(tick);
    }
    for (const recipient of currentReceipts!.recipients) {
      const firstRead = recipient.reads[0];
      if (!firstRead) continue;
      const dot = el('div', { class: 'scrub-dot' });
      const dp = Math.min(100, Math.max(0, ((firstRead.readAt.getTime() - sentMs) / (end - sentMs)) * 100));
      dot.style.left = `${dp}%`;
      dot.title = recipient.name;
      track.append(dot);
    }

    // version at instant
    let versionAtInstant = currentReceipts!.versions[0];
    for (const v of currentReceipts!.versions) {
      if (v.created.getTime() <= instant) versionAtInstant = v;
    }
    vchip.textContent = `v${versionAtInstant.version}`;
    renderTextInto(vtext, versionAtInstant.text);

    // lanes
    clear(readList);
    clear(notList);
    const readPeople: { name: string; chip: string | null }[] = [];
    const notPeople: string[] = [];
    for (const recipient of currentReceipts!.recipients) {
      const readsUpTo = recipient.reads.filter((r) => r.readAt.getTime() <= instant);
      if (readsUpTo.length === 0) {
        notPeople.push(recipient.name);
      } else {
        const latestRead = readsUpTo.reduce((a, b) => (b.version > a.version ? b : a));
        const chipLabel = latestRead.version < versionAtInstant.version ? `read v${latestRead.version}` : null;
        readPeople.push({ name: recipient.name, chip: chipLabel });
      }
    }
    readPeople.sort((a, b) => {
      const ra = currentReceipts!.recipients.find((r) => r.name === a.name)?.reads[0]?.readAt.getTime() ?? 0;
      const rb = currentReceipts!.recipients.find((r) => r.name === b.name)?.reads[0]?.readAt.getTime() ?? 0;
      return ra - rb;
    });
    for (const person of readPeople) {
      const li = el('li');
      li.append(el('span', { text: person.name }));
      if (person.chip) li.append(el('span', { class: 'rvchip', text: person.chip }));
      readList.append(li);
    }
    for (const name of notPeople) {
      notList.append(el('li', {}, el('span', { text: name })));
    }

    const readTotal = readPeople.length;
    const total = currentReceipts!.recipients.length;
    countLine.textContent = `${readTotal} of ${total} read`;
    track.setAttribute('aria-valuetext', `${formatLocal(zone, new Date(instant))} — ${readTotal} of ${total} read, version ${versionAtInstant.version}`);

    // event list
    clear(eventList);
    const events: { at: number; label: string }[] = [];
    for (const v of currentReceipts!.versions) {
      if (v.version > 1) events.push({ at: v.created.getTime(), label: `${formatLocal(zone, v.created)} · v${v.version} edit by ${v.editor}` });
    }
    for (const recipient of currentReceipts!.recipients) {
      for (const r of recipient.reads) {
        events.push({ at: r.readAt.getTime(), label: `${formatLocal(zone, r.readAt)} · ${recipient.name} read v${r.version}` });
      }
    }
    events.sort((a, b) => a.at - b.at);
    for (const event of events) {
      const option = el('option', { text: event.label });
      (option as HTMLOptionElement).value = String(event.at);
      eventList.append(option);
    }
  };

  update();
  window.setInterval(() => {
    if (state.panel?.kind === 'receipts' && scrubEl) {
      if (scrubPinnedToNow) scrubInstantMs = null;
      update();
    }
  }, 1000);

  const setFromClientX = (clientX: number): void => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const sentMs = currentReceipts!.sentAt.getTime();
    const end = Math.max(Date.now(), sentMs + 1000);
    scrubInstantMs = sentMs + ratio * (end - sentMs);
    scrubPinnedToNow = ratio >= 0.999;
    if (scrubPinnedToNow) scrubInstantMs = null;
    update();
  };

  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    track.focus();
    setFromClientX(e.clientX);
    const move = (ev: PointerEvent): void => {
      setFromClientX(ev.clientX);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  track.addEventListener('keydown', (e) => {
    const sentMs = currentReceipts!.sentAt.getTime();
    const end = Math.max(Date.now(), sentMs + 1000);
    const current = scrubInstantMs ?? end;
    const step = e.shiftKey ? (end - sentMs) * 0.1 : (end - sentMs) * 0.01;
    let next = current;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = current - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = current + step;
    else if (e.key === 'Home') next = sentMs;
    else if (e.key === 'End') next = end;
    else return;
    e.preventDefault();
    scrubInstantMs = Math.min(end, Math.max(sentMs, next));
    scrubPinnedToNow = scrubInstantMs >= end - 1;
    if (scrubPinnedToNow) scrubInstantMs = null;
    update();
  });

  eventList.addEventListener('change', () => {
    const at = Number(eventList.value);
    if (Number.isFinite(at)) {
      scrubInstantMs = at;
      scrubPinnedToNow = false;
      update();
    }
  });
}

/* ---------------- Search ---------------- */

async function openSearch(q: string, errBox: HTMLElement | null, opts: { push?: boolean } = { push: true }): Promise<void> {
  const trimmed = q.trim();
  if (errBox) clear(errBox);
  if (trimmed.length < 2 || trimmed.length > 200 || trimmed.split(/\s+/).filter(Boolean).length > 8) {
    const copy = trimmed.length < 2
      ? 'Search for at least 2 characters.'
      : trimmed.length > 200 ? 'Search for at most 200 characters.' : 'Search for at most 8 words.';
    if (errBox) errBox.textContent = copy;
    return;
  }
  focusReturn = document.activeElement as HTMLElement;
  state.panel = { kind: 'search', query: trimmed };
  if (opts.push !== false) {
    const url = new URL(window.location.href);
    url.search = `?q=${encodeURIComponent(trimmed)}`;
    window.history.pushState(null, '', url.pathname + url.search);
  }
  const body = await showDetail('Search results');
  body.append(el('p', { class: 'searching-line', text: 'Searching…' }));
  try {
    const res = await api<{ query: string; total: number; results: import('./types').SearchResultView[] }>(
      `/api/search?q=${encodeURIComponent(trimmed)}`,
    );
    clear(body);
    const total = res.data.total;
    announceNotice(total === 0
      ? `No results for “${trimmed}”.`
      : `${total} result${total === 1 ? '' : 's'} for “${trimmed}”.`);
    const notices = document.querySelector('.notices');
    if (notices) notices.textContent = total === 0 ? `No results for “${trimmed}”.` : `${total} result${total === 1 ? '' : 's'} for “${trimmed}”.`;
    const list = el('ul', { class: 'search-results-list' });
    for (const result of res.data.results) {
      const li = el('li');
      const link = el('a', { href: `/c/${result.channel.id}`, text: `#${result.channel.name}` });
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = new URL(window.location.href);
        url.pathname = `/c/${result.channel.id}`;
        if (result.thread_root_id) url.search = `?thread=${result.thread_root_id}`;
        else if (result.kind === 'photo' && result.attachment_id) url.search = `?photo=${result.attachment_id}`;
        else url.search = '';
        window.history.pushState(null, '', url.pathname + (url.search ? url.search : ''));
        if (result.channel.id !== state.openChannelId) {
          await openChannel(result.channel.id, { restorePanel: true });
        } else {
          await restorePanelFromAddress();
        }
      });
      const meta = el('div', { class: 'meta', text: `${result.author_name} · ${formatLocal(state.workspace?.time_zone ?? 'UTC', result.sent_at)}${result.kind === 'photo' ? ' · photo' : ''}` });
      li.append(link, meta, el('div', { class: 'snippet', text: result.snippet }));
      list.append(li);
    }
    body.append(list);
  } catch (err) {
    clear(body);
    if (err instanceof ApiFailure && err.body.errors?.q && errBox) {
      errBox.textContent = err.body.errors.q;
      closeDetails();
    } else {
      body.append(el('p', { class: 'not-found', text: 'That was not found.' }));
    }
  }
}

/* ---------------- Scheduled posts ---------------- */

let schedTimer = 0;

async function openScheduledPanel(opts: { push?: boolean } = { push: true }): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  state.panel = { kind: 'scheduled' };
  const body = await showDetail('Scheduled posts');
  await renderScheduledList(body);
  window.clearInterval(schedTimer);
  schedTimer = window.setInterval(async () => {
    if (state.panel?.kind === 'scheduled') {
      clear(body);
      await renderScheduledList(body);
    } else {
      window.clearInterval(schedTimer);
    }
  }, 10000);
}

async function renderScheduledList(body: HTMLElement): Promise<void> {
  const zone = state.workspace?.time_zone ?? 'UTC';
  try {
    const res = await api<{ scheduled: import('./types').ScheduledView[] }>(`/api/channels/${state.openChannelId}/scheduled`);
    const list = el('ul', { class: 'sched-list', 'aria-label': 'Scheduled posts' });
    for (const post of res.data.scheduled) {
      const li = el('li');
      const line = el('div', { class: 's-line' });
      const stateChipEl = el('span', { class: 'chip', text: post.state.charAt(0).toUpperCase() + post.state.slice(1) });
      line.append(stateChipEl, el('span', { class: 's-when', text: post.next_fire_local ? formatLocal(zone, post.next_fire_local) : '' }));
      li.append(line, el('div', { class: 's-text', text: post.text }));
      if (post.upcoming_local.length > 0) {
        const up = el('ul', { class: 'upcoming-list', 'aria-label': 'Upcoming' });
        for (const when of post.upcoming_local) {
          up.append(el('li', { text: formatLocal(zone, when) }));
        }
        li.append(up);
      }
      const canCancel = (state.me?.role === 'dispatcher' || state.me?.role === 'ops_manager') && post.state === 'scheduled';
      if (canCancel) {
        const cancelBtn = el('button', { text: 'Cancel scheduled post' });
        cancelBtn.addEventListener('click', async () => {
          cancelBtn.textContent = 'Cancelling…';
          try {
            await apiJson(`/api/scheduled/${post.id}`, 'DELETE');
            announceNotice('Scheduled post cancelled.');
            const notices = document.querySelector('.notices');
            if (notices) notices.textContent = 'Scheduled post cancelled.';
            clear(body);
            await renderScheduledList(body);
          } catch (err) {
            if (err instanceof ApiFailure) {
              announceNotice(err.body.message);
              const notices = document.querySelector('.notices');
              if (notices) notices.textContent = err.body.message;
            }
            cancelBtn.textContent = 'Cancel scheduled post';
          }
        });
        li.append(cancelBtn);
      }
      list.append(li);
    }
    body.append(list);
  } catch {
    body.append(el('p', { class: 'not-found', text: 'That was not found.' }));
  }
}

/* ---------------- Members ---------------- */

async function openMembersPanel(channelId: string, opts: { push?: boolean } = { push: true }): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  state.panel = { kind: 'members' };
  const channel = state.channelById(channelId);
  const body = await showDetail(`Members of ${channel?.name ?? ''}`);
  const res = await api<{ channel: ChannelView; members: { user: import('./types').UserView; joined_at: string }[] }>(`/api/channels/${channelId}`);
  const list = el('ul', { class: 'members-list', 'aria-label': 'Current members' });
  for (const member of res.data.members) {
    const li = el('li');
    li.append(el('span', { text: member.user.name }));
    li.append(el('span', { class: 'm-handle', text: `@${member.user.handle}` }));
    li.append(el('span', { class: 'role-chip', text: ROLE_LABELS[member.user.role] }));
    if (member.user.email) li.append(el('span', { class: 'm-email', text: member.user.email }));
    if (state.me?.role === 'ops_manager' && member.user.id !== state.me.id) {
      const removeBtn = el('button', { text: `Remove ${member.user.name}` });
      removeBtn.addEventListener('click', async () => {
        removeBtn.textContent = 'Saving…';
        try {
          await apiJson(`/api/channels/${channelId}/members/${member.user.id}`, 'DELETE');
          announceNotice(`${member.user.name} removed from #${channel?.name ?? ''}.`);
          const notices = document.querySelector('.notices');
          if (notices) notices.textContent = `${member.user.name} removed from #${channel?.name ?? ''}.`;
          await openMembersPanel(channelId, { push: false });
        } catch (err) {
          if (err instanceof ApiFailure) announceNotice(err.body.message);
          removeBtn.textContent = `Remove ${member.user.name}`;
        }
      });
      li.append(removeBtn);
    }
    list.append(li);
  }
  body.append(list);

  if (state.me?.role === 'ops_manager') {
    const addWrap = el('div');
    const combo = el('select', { 'aria-label': 'Add a person' }) as HTMLSelectElement;
    const peopleRes = await api<{ members: import('./types').UserView[] }>('/api/workspace/members');
    const existing = new Set(res.data.members.map((m) => m.user.id));
    combo.append(el('option', { text: 'Pick a person', value: '' }));
    for (const person of peopleRes.data.members) {
      if (person.status !== 'active' || existing.has(person.id)) continue;
      const option = el('option', { text: `${person.name} (${person.email ?? ''})` }) as HTMLOptionElement;
      option.value = person.id;
      combo.append(option);
    }
    const addBtn = el('button', { text: 'Add to channel' });
    addBtn.addEventListener('click', async () => {
      if (!combo.value) return;
      addBtn.textContent = 'Saving…';
      try {
        await apiJson(`/api/channels/${channelId}/members`, 'POST', { user_id: combo.value });
        const person = peopleRes.data.members.find((p) => p.id === combo.value);
        announceNotice(`${person?.name ?? ''} added to #${channel?.name ?? ''}.`);
        const notices = document.querySelector('.notices');
        if (notices) notices.textContent = `${person?.name ?? ''} added to #${channel?.name ?? ''}.`;
        await openMembersPanel(channelId, { push: false });
      } catch (err) {
        if (err instanceof ApiFailure) {
          announceNotice(err.body.message);
          const notices = document.querySelector('.notices');
          if (notices) notices.textContent = err.body.message;
        }
        addBtn.textContent = 'Add to channel';
      }
    });
    addWrap.append(combo, addBtn);
    body.append(addWrap);
  }
}

/* ---------------- Dialogs ---------------- */

function openDialogShell(title: string, label: string): { backdrop: HTMLElement; dialog: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-label': label });
  const head = el('div', { class: 'dialog-head' });
  head.append(el('h2', { text: title }));
  const body = el('div', { class: 'dialog-body' });
  const foot = el('div', { class: 'dialog-foot' });
  dialog.append(head, body, foot);
  backdrop.append(dialog);
  document.body.append(backdrop);
  dialogStack.push(backdrop);
  return { backdrop, dialog, body, foot };
}

function renderErrorSummary(body: HTMLElement, errors: Record<string, string>, focusTargets: Record<string, HTMLElement>): void {
  const existing = body.querySelector('.error-summary');
  if (existing) existing.remove();
  const summary = el('div', { class: 'error-summary' });
  summary.append(el('h3', { text: 'Check the highlighted fields.' }));
  const ul = el('ul');
  for (const [field, copy] of Object.entries(errors)) {
    const link = el('a', { href: '#', text: copy });
    link.addEventListener('click', (e) => {
      e.preventDefault();
      focusTargets[field]?.focus();
    });
    ul.append(el('li', {}, link));
  }
  summary.append(ul);
  body.prepend(summary);
}

async function openEditDialog(message: MessageView): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  const { backdrop, dialog, body, foot } = openDialogShell('Edit message', 'Edit message');
  const field = el('div', { class: 'field' });
  const label = el('label', { for: 'edit-text', text: 'Message text' });
  const input = el('textarea', { id: 'edit-text' }) as HTMLTextAreaElement;
  input.value = message.text;
  const err = el('div', { class: 'field-error', id: 'edit-text-error' });
  field.append(label, input, err);
  body.append(field);
  let newerRegion: HTMLElement | null = null;

  const save = el('button', { text: 'Save edit' });
  const saveOver = el('button', { text: 'Save over it', hidden: 'hidden' });
  const useNewer = el('button', { text: 'Use newer text', hidden: 'hidden' });
  const cancel = el('button', { text: 'Cancel' });
  foot.append(save, saveOver, useNewer, cancel);

  let currentVersion = message.version;
  let newerText = '';
  const doSave = async (expectedVersion: number): Promise<void> => {
    save.textContent = 'Saving…';
    save.setAttribute('disabled', 'disabled');
    err.textContent = '';
    try {
      const res = await apiJson<{ message: MessageView }>(`/api/messages/${message.id}`, 'PATCH', {
        text: input.value,
        expected_version: expectedVersion,
      });
      announceNotice(`Edit saved as version ${res.data.message.version}.`);
      const notices = document.querySelector('.notices');
      if (notices) notices.textContent = `Edit saved as version ${res.data.message.version}.`;
      closeDialog(backdrop);
      await reloadMessages();
      focusReturn?.focus();
    } catch (error) {
      save.textContent = 'Save edit';
      save.removeAttribute('disabled');
      if (error instanceof ApiFailure) {
        if (error.body.error === 'stale_version' && error.body.current) {
          currentVersion = error.body.current.version;
          newerText = error.body.current.text;
          if (!newerRegion) {
            newerRegion = el('div', { class: 'newer-version', role: 'region', 'aria-label': 'Newer version' });
            body.append(newerRegion);
          }
          clear(newerRegion);
          newerRegion.append(
            el('h3', { text: 'Newer version' }),
            el('div', { class: 'msg-text', text: newerText }),
            el('div', { class: 'mono', text: `Saved by ${error.body.current.edited_by.name} at ${formatLocal(state.workspace?.time_zone ?? 'UTC', error.body.current.edited_at)}` }),
          );
          saveOver.removeAttribute('hidden');
          useNewer.removeAttribute('hidden');
          announceNotice('Someone saved a newer version. Your draft is still here.');
          const notices = document.querySelector('.notices');
          if (notices) notices.textContent = 'Someone saved a newer version. Your draft is still here.';
        } else if (error.body.error === 'edit_window_closed') {
          err.textContent = error.body.message;
          save.setAttribute('hidden', 'hidden');
          saveOver.setAttribute('hidden', 'hidden');
          useNewer.setAttribute('hidden', 'hidden');
        } else if (error.body.error === 'validation' && error.body.errors) {
          err.textContent = error.body.errors.text ?? error.body.errors.expected_version ?? error.body.message;
          renderErrorSummary(body, error.body.errors, { text: input, expected_version: input });
        } else {
          err.textContent = error.body.message;
        }
      } else {
        err.textContent = 'Something went wrong on our side. Try again.';
      }
    }
  };

  save.addEventListener('click', () => doSave(currentVersion));
  saveOver.addEventListener('click', () => doSave(currentVersion));
  useNewer.addEventListener('click', () => {
    input.value = newerText;
  });
  cancel.addEventListener('click', () => {
    closeDialog(backdrop);
    focusReturn?.focus();
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog(backdrop);
      focusReturn?.focus();
    }
  });
  input.focus();
}

async function reloadMessages(): Promise<void> {
  if (!state.openChannelId) return;
  await loadHistory(state.openChannelId);
  renderMessages();
  const channel = state.channelById(state.openChannelId);
  if (channel) {
    const pinned = document.querySelector('.pinned-strip');
    if (pinned) await renderPinnedStrip(pinned as HTMLElement, channel);
  }
  if (state.panel?.kind === 'thread' && state.panel.threadRootId) {
    await openThread(state.panel.threadRootId, { push: false });
  }
}

async function openDeleteDialog(message: MessageView): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  const { backdrop, body, foot } = openDialogShell('Delete this message?', 'Delete this message?');
  body.append(el('p', { text: 'Delete this message for everyone in the channel?' }));
  const del = el('button', { text: 'Delete for everyone' });
  const keep = el('button', { text: 'Keep it' });
  foot.append(del, keep);
  del.addEventListener('click', async () => {
    del.textContent = 'Deleting…';
    del.setAttribute('disabled', 'disabled');
    try {
      await apiJson(`/api/messages/${message.id}`, 'DELETE');
      announceNotice('Message deleted.');
      const notices = document.querySelector('.notices');
      if (notices) notices.textContent = 'Message deleted.';
      closeDialog(backdrop);
      await reloadMessages();
      focusReturn?.focus();
    } catch (error) {
      del.textContent = 'Delete for everyone';
      del.removeAttribute('disabled');
      if (error instanceof ApiFailure) {
        announceNotice(error.body.message);
        const notices = document.querySelector('.notices');
        if (notices) notices.textContent = error.body.message;
      }
    }
  });
  keep.addEventListener('click', () => {
    closeDialog(backdrop);
    focusReturn?.focus();
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog(backdrop);
      focusReturn?.focus();
    }
  });
  del.focus();
}

async function togglePin(message: MessageView): Promise<void> {
  const channelId = state.openChannelId as string;
  try {
    if (message.pinned) {
      await apiJson(`/api/channels/${channelId}/pins/${message.id}`, 'DELETE');
      announceNotice('Unpinned.');
    } else {
      await apiJson(`/api/channels/${channelId}/pins`, 'POST', { message_id: message.id });
      announceNotice('Pinned.');
    }
    const notices = document.querySelector('.notices');
    if (notices) notices.textContent = message.pinned ? 'Unpinned.' : 'Pinned.';
    const channel = state.channelById(channelId);
    if (channel) {
      const res = await api<{ channel: ChannelView }>(`/api/channels/${channelId}`);
      channel.pinned_message_ids = res.data.channel.pinned_message_ids;
      const pinned = document.querySelector('.pinned-strip');
      if (pinned) await renderPinnedStrip(pinned as HTMLElement, channel);
    }
    await reloadMessages();
  } catch (error) {
    if (error instanceof ApiFailure) {
      announceNotice(error.body.message);
      const notices = document.querySelector('.notices');
      if (notices) notices.textContent = error.body.message;
    }
  }
}

async function openScheduleDialog(channelId: string): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  const zone = state.workspace?.time_zone ?? 'UTC';
  const { backdrop, body, foot } = openDialogShell('Schedule post', 'Schedule post');
  const textField = el('div', { class: 'field' });
  const textLabel = el('label', { for: 'sched-text', text: 'Post text' });
  const textInput = el('textarea', { id: 'sched-text' }) as HTMLTextAreaElement;
  const textErr = el('div', { class: 'field-error' });
  textField.append(textLabel, textInput, textErr);

  const dateField = el('div', { class: 'field' });
  const dateLabel = el('label', { for: 'sched-date', text: 'Date' });
  const dateInput = el('input', { id: 'sched-date', type: 'date' }) as HTMLInputElement;
  const dateErr = el('div', { class: 'field-error' });
  dateField.append(dateLabel, dateInput, dateErr);

  const timeField = el('div', { class: 'field' });
  const timeLabel = el('label', { for: 'sched-time', text: 'Time' });
  const timeInput = el('input', { id: 'sched-time', type: 'time' }) as HTMLInputElement;
  const timeErr = el('div', { class: 'field-error' });
  timeField.append(timeLabel, timeInput, timeErr);

  const repeatField = el('div', { class: 'field' });
  const repeatInput = el('input', { id: 'sched-repeat', type: 'checkbox' }) as HTMLInputElement;
  const repeatLabel = el('label', { for: 'sched-repeat', text: 'Repeat weekly' });
  repeatLabel.prepend(repeatInput);
  const repeatErr = el('div', { class: 'field-error' });
  repeatField.append(repeatLabel, repeatErr);

  body.append(textField, dateField, timeField, repeatField, el('p', { text: `Times are in ${zone}` }));

  const schedule = el('button', { text: 'Schedule' });
  const cancel = el('button', { text: 'Cancel' });
  foot.append(schedule, cancel);

  schedule.addEventListener('click', async () => {
    schedule.textContent = 'Scheduling…';
    schedule.setAttribute('disabled', 'disabled');
    textErr.textContent = '';
    dateErr.textContent = '';
    timeErr.textContent = '';
    repeatErr.textContent = '';
    try {
      const res = await apiJson<{ scheduled: import('./types').ScheduledView }>(`/api/channels/${channelId}/scheduled`, 'POST', {
        text: textInput.value,
        local_date: dateInput.value,
        local_time: timeInput.value,
        repeat: repeatInput.checked ? 'weekly' : 'none',
      });
      const when = res.data.scheduled.next_fire_local
        ? formatLocal(zone, res.data.scheduled.next_fire_local)
        : '';
      announceNotice(`Scheduled for ${when}.`);
      const notices = document.querySelector('.notices');
      if (notices) notices.textContent = `Scheduled for ${when}.`;
      closeDialog(backdrop);
      await openScheduledPanel({ push: false });
      focusReturn?.focus();
    } catch (error) {
      schedule.textContent = 'Schedule';
      schedule.removeAttribute('disabled');
      if (error instanceof ApiFailure && error.body.error === 'validation' && error.body.errors) {
        const errors = error.body.errors;
        if (errors.text) textErr.textContent = errors.text;
        if (errors.local_date) dateErr.textContent = errors.local_date;
        if (errors.local_time) timeErr.textContent = errors.local_time;
        if (errors.repeat) repeatErr.textContent = errors.repeat;
        renderErrorSummary(body, errors, {
          text: textInput, local_date: dateInput, local_time: timeInput, repeat: repeatInput,
        });
      } else if (error instanceof ApiFailure) {
        announceNotice(error.body.message);
      }
    }
  });
  cancel.addEventListener('click', () => {
    closeDialog(backdrop);
    focusReturn?.focus();
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog(backdrop);
      focusReturn?.focus();
    }
  });
  textInput.focus();
}

async function openInviteDialog(): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  const { backdrop, body, foot } = openDialogShell('Invite technician', 'Invite technician');
  const nameField = el('div', { class: 'field' });
  const nameLabel = el('label', { for: 'invite-name', text: 'Name' });
  const nameInput = el('input', { id: 'invite-name', type: 'text' }) as HTMLInputElement;
  const nameErr = el('div', { class: 'field-error' });
  nameField.append(nameLabel, nameInput, nameErr);

  const emailField = el('div', { class: 'field' });
  const emailLabel = el('label', { for: 'invite-email', text: 'Email' });
  const emailInput = el('input', { id: 'invite-email', type: 'email' }) as HTMLInputElement;
  const emailErr = el('div', { class: 'field-error' });
  emailField.append(emailLabel, emailInput, emailErr);

  const roleField = el('div', { class: 'field' });
  const roleLabel = el('label', { for: 'invite-role', text: 'Role' });
  const roleSelect = el('select', { id: 'invite-role' }) as HTMLSelectElement;
  roleSelect.append(el('option', { text: '', value: '' }));
  roleSelect.append(el('option', { text: 'Dispatcher', value: 'dispatcher' }));
  roleSelect.append(el('option', { text: 'Field technician', value: 'field_technician' }));
  roleSelect.append(el('option', { text: 'Crew lead', value: 'crew_lead' }));
  roleSelect.append(el('option', { text: 'Operations manager', value: 'ops_manager' }));
  const roleErr = el('div', { class: 'field-error' });
  roleField.append(roleLabel, roleSelect, roleErr);

  body.append(nameField, emailField, roleField);

  const send = el('button', { text: 'Send invite' });
  const cancel = el('button', { text: 'Cancel' });
  foot.append(send, cancel);

  send.addEventListener('click', async () => {
    send.textContent = 'Sending…';
    send.setAttribute('disabled', 'disabled');
    nameErr.textContent = '';
    emailErr.textContent = '';
    roleErr.textContent = '';
    try {
      const res = await apiJson<{ member: import('./types').UserView; invite_email: string }>('/api/workspace/members', 'POST', {
        name: nameInput.value,
        email: emailInput.value,
        role: roleSelect.value,
      });
      if (res.data.invite_email === 'sent') {
        announceNotice(`Invite emailed to ${emailInput.value}.`);
        const notices = document.querySelector('.notices');
        if (notices) notices.textContent = `Invite emailed to ${emailInput.value}.`;
      } else {
        announceNotice(`Invite saved. The email to ${emailInput.value} is queued until mail is reachable.`);
        const notices = document.querySelector('.notices');
        if (notices) notices.textContent = `Invite saved. The email to ${emailInput.value} is queued until mail is reachable.`;
      }
      closeDialog(backdrop);
      focusReturn?.focus();
    } catch (error) {
      send.textContent = 'Send invite';
      send.removeAttribute('disabled');
      if (error instanceof ApiFailure && error.body.error === 'validation' && error.body.errors) {
        const errors = error.body.errors;
        for (const [key, copy] of Object.entries(errors)) {
          if (key === 'name') nameErr.textContent = copy;
          else if (key === 'email') emailErr.textContent = copy;
          else if (key === 'role') roleErr.textContent = copy;
        }
        renderErrorSummary(body, errors, { name: nameInput, email: emailInput, role: roleSelect });
      } else if (error instanceof ApiFailure) {
        announceNotice(error.body.message);
        const notices = document.querySelector('.notices');
        if (notices) notices.textContent = error.body.message;
      }
    }
  });
  cancel.addEventListener('click', () => {
    closeDialog(backdrop);
    focusReturn?.focus();
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog(backdrop);
      focusReturn?.focus();
    }
  });
  nameInput.focus();
}

async function openWorkspacePeople(): Promise<void> {
  focusReturn = document.activeElement as HTMLElement;
  const { backdrop, body, foot } = openDialogShell('Workspace people', 'Workspace people');
  foot.remove();
  const res = await api<{ members: import('./types').UserView[] }>('/api/workspace/members');
  const list = el('ul', { class: 'members-list', 'aria-label': 'Workspace people' });
  for (const person of res.data.members) {
    const li = el('li');
    li.append(
      el('span', { text: person.name }),
      el('span', { class: 'm-handle', text: `@${person.handle}` }),
      el('span', { class: 'role-chip', text: ROLE_LABELS[person.role] }),
    );
    if (person.email) li.append(el('span', { class: 'm-email', text: person.email }));
    if (state.me?.role === 'ops_manager' && person.id !== state.me.id && person.status === 'active') {
      const deactivate = el('button', { text: `Deactivate ${person.name}` });
      deactivate.addEventListener('click', () => {
        openDeactivateConfirm(person, li);
      });
      li.append(deactivate);
    }
    if (person.status !== 'active') {
      li.append(el('span', { class: 'chip', text: person.status }));
    }
    list.append(li);
  }
  body.append(list);
  const close = el('button', { text: 'Close' });
  close.addEventListener('click', () => {
    closeDialog(backdrop);
    focusReturn?.focus();
  });
  body.append(close);
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog(backdrop);
      focusReturn?.focus();
    }
  });
}

async function openDeactivateConfirm(person: import('./types').UserView, row: HTMLElement): Promise<void> {
  const { backdrop, body, foot } = openDialogShell(`Deactivate ${person.name}?`, `Deactivate ${person.name}?`);
  body.append(el('p', { text: `${person.name} will no longer be able to sign in.` }));
  const yes = el('button', { text: 'Deactivate' });
  const no = el('button', { text: 'Keep access' });
  foot.append(yes, no);
  yes.addEventListener('click', async () => {
    yes.textContent = 'Deactivating…';
    yes.setAttribute('disabled', 'disabled');
    try {
      await apiJson(`/api/workspace/members/${person.id}`, 'DELETE');
      announceNotice(`${person.name} can no longer sign in.`);
      const notices = document.querySelector('.notices');
      if (notices) notices.textContent = `${person.name} can no longer sign in.`;
      closeDialog(backdrop);
      await openWorkspacePeople();
    } catch (error) {
      yes.textContent = 'Deactivate';
      yes.removeAttribute('disabled');
      if (error instanceof ApiFailure) {
        announceNotice(error.body.message);
        const notices = document.querySelector('.notices');
        if (notices) notices.textContent = error.body.message;
      }
    }
  });
  no.addEventListener('click', () => {
    closeDialog(backdrop);
  });
  yes.focus();
  void row;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) observeReads();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const topDialog = dialogStack[dialogStack.length - 1];
  if (topDialog) {
    event.preventDefault();
    closeDialog(topDialog);
    focusReturn?.focus();
    return;
  }
  if (openMenuEl) {
    event.preventDefault();
    closeMenu();
    return;
  }
  if (railOpen) {
    event.preventDefault();
    railOpen = false;
    document.querySelector('.rail')?.classList.remove('open');
    document.querySelector('.rail-backdrop')?.remove();
    return;
  }
  if (state.panel) {
    event.preventDefault();
    closeDetails();
    focusReturn?.focus();
  }
});

app.start();
