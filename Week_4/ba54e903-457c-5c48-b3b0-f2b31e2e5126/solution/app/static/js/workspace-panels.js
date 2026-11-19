/* Side panels: member list, thread, search results and the notification inbox, plus their open/close rules. */
import { S, $, h, icon, status, api, newNonce, formatTime, quoteText, debounce, reducedMotion, afterSlide, slugKnown } from './workspace-core.js';
import { buildContent, patchRow, upsertMessage, getMessage, closePicker, pickerOpen } from './workspace-stream.js';

const PANELS = ['thread', 'search-panel', 'notifications'];
const openers = {}; // panel id -> element that opened it
let membersOpener = null;

/* ---------- opening and closing ---------- */

function reveal(el) {
  el._gen = (el._gen || 0) + 1;
  el.hidden = false;
  el.classList.remove('is-closing');
  el.classList.add('is-open');
  el.addEventListener('animationend', () => el.classList.remove('is-open'), { once: true });
}

function conceal(el, done) {
  const gen = (el._gen = (el._gen || 0) + 1);
  el.classList.remove('is-open');
  const finish = () => {
    if (el._gen !== gen) return;
    el.classList.remove('is-closing');
    el.hidden = true;
    done?.();
  };
  if (reducedMotion()) { finish(); return; }
  el.classList.add('is-closing');
  afterSlide(el, finish);
}

const isOpen = (id) => !$(id).hidden && !$(id).classList.contains('is-closing');

function focusBack(opener) {
  const target = opener?.isConnected ? opener : $('composer');
  if (!target.disabled) target.focus(); else $('stream').focus();
}

function openPanel(id, opener, { focus = true } = {}) {
  for (const other of PANELS) if (other !== id && isOpen(other)) closePanel(other, false);
  closeMembers(false);
  openers[id] = opener;
  const el = $(id);
  if (isOpen(id)) return;
  reveal(el);
  if (focus) {
    const first = id === 'thread' ? $('thread-reply') : el;
    if (!first.hasAttribute('tabindex') && first === el) el.setAttribute('tabindex', '-1');
    first.focus({ preventScroll: true });
  }
  if (id === 'notifications') $('bell').setAttribute('aria-expanded', 'true');
}

export function closePanel(id, restoreFocus = true) {
  if (!isOpen(id)) return;
  const opener = openers[id];
  if (id === 'notifications') $('bell').setAttribute('aria-expanded', 'false');
  conceal($(id), () => {
    if (id === 'thread') { thread = null; $('thread-body').replaceChildren(); }
    if (id === 'search-panel') { searchSeq += 1; search = null; $('search-body').replaceChildren(); $('search-heading').textContent = ''; }
  });
  if (restoreFocus) focusBack(opener);
}

export function closeAllPanels() { for (const id of PANELS) closePanel(id, false); }

export function openMembers(opener) {
  for (const id of PANELS) closePanel(id, false);
  membersOpener = opener;
  const el = $('members');
  if (el.classList.contains('is-open')) return;
  el._gen = (el._gen || 0) + 1;
  el.classList.remove('is-closing');
  el.classList.add('is-open');
  el.setAttribute('tabindex', '-1');
  $('show-members').setAttribute('aria-expanded', 'true');
}

export function closeMembers(restoreFocus = true) {
  const el = $('members');
  if (!el.classList.contains('is-open')) return;
  $('show-members').setAttribute('aria-expanded', 'false');
  const gen = (el._gen = (el._gen || 0) + 1);
  el.classList.remove('is-open');
  if (!reducedMotion()) el.classList.add('is-closing');
  const finish = () => { if (el._gen === gen) el.classList.remove('is-closing'); };
  if (reducedMotion()) finish(); else afterSlide(el, finish);
  if (restoreFocus) focusBack(membersOpener);
}

export function membersOpen() { return $('members').classList.contains('is-open'); }

/* Escape closes the reaction dialog, then an open panel the focus is in, with focus back on its opener. */
export function escapeKey(event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  const active = document.activeElement;
  if (pickerOpen()) { closePicker(true); return true; }
  for (const id of PANELS) {
    if (!isOpen(id)) continue;
    const inside = $(id).contains(active) || (id === 'search-panel' && active === $('search')) || active === document.body;
    if (inside) { closePanel(id, true); return true; }
  }
  if (membersOpen() && ($('members').contains(active) || active === document.body)) { closeMembers(true); return true; }
  return false;
}

/* ---------- member list ---------- */

export function renderMembers() {
  const online = S.members.filter((m) => m.status !== 'offline');
  const offline = S.members.filter((m) => m.status === 'offline');
  const group = (title, id, list, cls) => [
    h('h2', { id, text: `${title} (${list.length})` }),
    h('ul', { role: 'list', 'aria-labelledby': id }, list.map((m) => h('li', { class: `member ${cls}` },
      h('img', { src: m.user.avatar_url, alt: '', width: '32', height: '32' }),
      h('span', { class: 'name', text: m.user.display_name })))),
  ];
  $('members-body').replaceChildren(...group('Online', 'members-online', online, 'online'),
    ...group('Offline', 'members-offline', offline, 'offline'));
}

export async function loadMembers() {
  const res = await api('GET', `/api/servers/${S.slug}/members`);
  if (res.ok) { S.members = res.data.data; renderMembers(); }
}

/* ---------- thread ---------- */

let thread = null;
let replyNonce = null;

function threadRow(msg) {
  const row = buildContent(msg, { lite: true });
  return row;
}

export async function openThread(msg, opener) {
  openPanel('thread', opener);
  if (thread && thread.id === msg.id) return;
  thread = { id: msg.id, parent: msg, rows: new Map(), seq: (thread?.seq || 0) + 1 };
  replyNonce = null;
  $('thread-reply').value = '';
  const parentRow = threadRow(msg);
  parentRow.classList.add('thread-parent');
  thread.parentRow = parentRow;
  thread.list = h('div', { class: 'thread-replies' });
  thread.title = h('p', { class: 'thread-replies-title' });
  $('thread-body').replaceChildren(parentRow, thread.title, thread.list);
  const mine = thread;
  const res = await api('GET', `/api/messages/${msg.id}/replies`);
  if (thread !== mine || !res.ok) return;
  for (const reply of res.data.data) addThreadReply(reply);
  updateThreadTitle();
}

function updateThreadTitle() {
  if (!thread) return;
  const n = thread.rows.size;
  thread.title.textContent = n === 0 ? 'No replies yet' : n === 1 ? '1 reply' : `${n} replies`;
}

function addThreadReply(reply) {
  let row = thread.rows.get(reply.id);
  if (row) { patchRow(row, reply); return; }
  row = threadRow(reply);
  thread.rows.set(reply.id, row);
  thread.list.append(row);
  updateThreadTitle();
}

/* Live feeds for the open thread. */
export function threadMessage(msg) {
  if (!thread) return;
  if (msg.id === thread.id) { thread.parent = msg; patchRow(thread.parentRow, msg); }
  else if (msg.reply_to_id === thread.id) addThreadReply(msg);
}

export function threadDeleted(id) {
  if (!thread) return;
  if (id === thread.id) { closePanel('thread', false); return; }
  const row = thread.rows.get(id);
  if (row) { row.remove(); thread.rows.delete(id); updateThreadTitle(); }
}

async function sendReply() {
  const field = $('thread-reply');
  const body = field.value.trim();
  if (!body || !thread) return;
  replyNonce ||= newNonce();
  const mine = thread;
  let res;
  try {
    res = await api('POST', `/api/channels/${S.channelId}/messages`, { body: { body, reply_to_id: mine.id, nonce: replyNonce } });
  } catch { res = { ok: false }; }
  if (!res.ok) { status('Message failed to send. Tap to retry.'); return; }
  replyNonce = null;
  if (field.value.trim() === body) field.value = '';
  if (thread === mine) addThreadReply(res.data);
  upsertMessage(res.data, { animate: true });
  const parent = getMessage(mine.id);
  if (parent && parent.reply_count < mine.rows.size) upsertMessage({ ...parent, reply_count: mine.rows.size });
}

/* ---------- search ---------- */

let search = null;
let searchSeq = 0;
const FILTER_KEYS = /^(from|mentions|in|has|before|after|during):/i;

function parseTerms(query) {
  const terms = [];
  for (const found of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    if (found[1] !== undefined) { if (found[1]) terms.push(found[1]); }
    else if (!FILTER_KEYS.test(found[2])) terms.push(found[2]);
  }
  return terms;
}

function highlight(text, terms) {
  if (!terms.length) return [text];
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const parts = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    if (found.index > last) parts.push(text.slice(last, found.index));
    parts.push(h('mark', { text: found[0] }));
    last = found.index + found[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function fillResult(li, msg) {
  const channel = S.channels.find((c) => c.id === msg.channel_id);
  li.replaceChildren(
    h('div', { class: 'result-meta' },
      h('span', { class: 'author', text: msg.author.display_name }),
      h('span', { class: 'channel', text: `#${channel ? channel.name : ''}` }),
      h('time', { datetime: msg.created_at, text: formatTime(msg.created_at) })),
    msg.referenced_message ? h('div', { class: 'msg-quote', text: quoteText(msg.referenced_message) }) : null,
    h('div', { class: 'msg-text' },
      h('span', { class: 'msg-body' }, ...highlight(msg.body, search.terms)),
      msg.edited_at ? h('span', { class: 'msg-edited', text: '(edited)' }) : null));
}

function renderSearchHeading() {
  $('search-heading').textContent = search.total === 1 ? '1 result' : `${search.total} results`;
}

function renderSearch() {
  const body = $('search-body');
  const list = h('ul', { class: 'results', role: 'list' });
  search.list = list;
  search.items = new Map();
  for (const msg of search.results) {
    const li = h('li', { 'data-id': String(msg.id) });
    search.items.set(msg.id, li);
    fillResult(li, msg);
    list.append(li);
  }
  search.more = h('button', { type: 'button', class: 'text-btn wide', text: 'Show more results', onclick: () => fetchSearch(search.loaded) });
  search.more.hidden = search.loaded >= search.total;
  body.replaceChildren(list, search.more);
  renderSearchHeading();
}

async function fetchSearch(offset) {
  const mine = search;
  const seq = searchSeq;
  let res;
  try {
    await slugKnown; // an Enter pressed while the workspace is still starting searches once the community is known
    res = await api('GET', `/api/servers/${S.slug}/messages/search`, { query: { q: mine.q, offset: offset || undefined } });
  } catch { res = { ok: false }; }
  if (seq !== searchSeq || search !== mine) return;
  if (!res.ok) {
    $('search-heading').textContent = 'Search results';
    $('search-body').replaceChildren(h('p', { class: 'panel-note', text: 'That search could not be run.' }));
    return;
  }
  mine.total = res.data.total_results;
  mine.loaded = (offset || 0) + res.data.data.length;
  for (const msg of res.data.data) if (!mine.results.some((x) => x.id === msg.id)) mine.results.push(msg);
  renderSearch();
}

export function runSearch(query) {
  const q = query.trim();
  if (!q) return;
  searchSeq += 1;
  search = { q, terms: parseTerms(q), results: [], total: 0, loaded: 0 };
  openPanel('search-panel', $('search'), { focus: false });
  $('search-heading').textContent = 'Searching…';
  $('search-body').replaceChildren();
  fetchSearch(0);
}

/* The open search panel follows edits, deletions and lost channels without a new search or a refocus. */
export function searchMessage(msg) {
  if (!search || !search.items) return;
  const index = search.results.findIndex((x) => x.id === msg.id);
  if (index === -1) return;
  search.results[index] = msg;
  fillResult(search.items.get(msg.id), msg);
}

export function searchDeleted(id) {
  if (!search || !search.items || !search.items.has(id)) return;
  search.items.get(id).remove();
  search.items.delete(id);
  search.results = search.results.filter((x) => x.id !== id);
  search.total = Math.max(0, search.total - 1);
  renderSearchHeading();
}

export function searchPrune() {
  if (!search || !search.items) return;
  const viewable = new Set(S.channels.map((c) => c.id));
  for (const msg of [...search.results]) if (!viewable.has(msg.channel_id)) searchDeleted(msg.id);
}

/* ---------- notifications ---------- */

const inbox = { rows: [], cursor: null, more: false, unread: 0, items: new Map() };

function entryText(entry) {
  const name = entry.actor ? entry.actor.display_name : '';
  if (entry.kind === 'mention') return `${name} mentioned you`;
  if (entry.kind === 'reply') return `${name} replied to you`;
  if (entry.kind === 'message') return `${name} posted a new message`;
  const community = S.communities.find((c) => c.id === entry.community_id);
  return `Welcome to ${community ? community.name : 'the community'}`;
}

function entrySub(entry) {
  const community = S.communities.find((c) => c.id === entry.community_id);
  const channel = entry.community_id === S.communityId ? S.channels.find((c) => c.id === entry.channel_id) : null;
  return [community?.name, channel ? `#${channel.name}` : null, formatTime(entry.created_at)].filter(Boolean).join(' · ');
}

function updateBell() {
  const bell = $('bell');
  bell.setAttribute('aria-label', inbox.unread > 0 ? `Notifications, ${inbox.unread} unread` : 'Notifications');
  let badge = bell.querySelector('.bell-count');
  if (inbox.unread > 0) {
    if (!badge) { badge = h('span', { class: 'bell-count', 'aria-hidden': 'true' }); bell.append(badge); }
    badge.textContent = inbox.unread > 99 ? '99+' : String(inbox.unread);
  } else badge?.remove();
}

function entryItem(entry) {
  let li = inbox.items.get(entry.id);
  if (!li) {
    li = h('li', { 'data-id': String(entry.id) });
    li._button = h('button', { type: 'button', class: 'notif', onclick: () => openEntry(li._entry) },
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
      h('span', {}, (li._text = h('span', {})), (li._sub = h('span', { class: 'sub' }))));
    li.append(li._button);
    inbox.items.set(entry.id, li);
  }
  li._entry = entry;
  const text = entryText(entry);
  if (li._text.textContent !== text) li._text.textContent = text;
  li._sub.textContent = entrySub(entry);
  li._button.classList.toggle('is-unread', !entry.read);
  return li;
}

function renderInbox() {
  const list = $('notification-list');
  const wanted = inbox.rows.map(entryItem);
  const keep = new Set(wanted);
  for (const [id, li] of inbox.items) if (!keep.has(li)) { li.remove(); inbox.items.delete(id); }
  let ref = list.firstElementChild;
  for (const li of wanted) {
    if (li === ref) ref = ref.nextElementSibling;
    else list.insertBefore(li, ref);
  }
  $('older').hidden = !inbox.more;
  updateBell();
}

async function fetchInbox(query) {
  const res = await api('GET', '/api/notifications', { query });
  return res.ok ? res.data : null;
}

async function loadInbox() {
  const page = await fetchInbox({ limit: 20 });
  if (!page) return;
  inbox.rows = page.data;
  inbox.cursor = page.data.length ? page.data[page.data.length - 1].id : null;
  inbox.more = page.has_more;
  inbox.unread = page.unread_count;
  renderInbox();
}

async function loadOlder() {
  if (inbox.cursor === null) return;
  const page = await fetchInbox({ limit: 20, before: inbox.cursor });
  if (!page) return;
  const known = new Set(inbox.rows.map((r) => r.id));
  const fresh = page.data.filter((r) => !known.has(r.id));
  inbox.rows = [...inbox.rows, ...fresh];
  if (page.data.length) inbox.cursor = page.data[page.data.length - 1].id;
  inbox.more = page.has_more;
  inbox.unread = page.unread_count;
  const refocus = !inbox.more && document.activeElement === $('older');
  renderInbox();
  if (refocus && fresh.length) inbox.items.get(fresh[0].id)._button.focus();
}

/* Re-read the loaded range in place: new entries at the top, deleted or hidden ones gone, nothing else moves. */
async function refreshInbox() {
  if (inbox.cursor === null) { await loadInbox(); return; }
  const floor = inbox.cursor;
  const fetched = [];
  let before;
  let page;
  do {
    page = await fetchInbox({ limit: 50, before });
    if (!page) return;
    fetched.push(...page.data);
    before = page.data.length ? page.data[page.data.length - 1].id : undefined;
  } while (page.has_more && page.data.length && before > floor);
  const inRange = fetched.filter((e) => e.id >= floor);
  const known = new Set(inRange.map((e) => e.id));
  const olderRows = inbox.rows.filter((e) => e.id < floor);
  inbox.rows = [...inRange, ...olderRows.filter((e) => !known.has(e.id))];
  inbox.more = page.has_more || fetched.some((e) => e.id < floor);
  inbox.unread = page.unread_count;
  renderInbox();
}

async function openEntry(entry) {
  if (!entry.read) {
    entry.read = true;
    inbox.unread = Math.max(0, inbox.unread - 1);
    renderInbox();
    await api('POST', `/api/notifications/${entry.id}/read`);
  }
  if (entry.channel_id === null || entry.community_id === null) return;
  S.hooks.navigate(entry.community_id, entry.channel_id);
}

async function markAll() {
  const res = await api('POST', '/api/notifications/read-all');
  if (!res.ok) return;
  inbox.rows.forEach((r) => { r.read = true; });
  inbox.unread = 0;
  renderInbox();
}

export async function refreshNotifications() {
  if (isOpen('notifications')) { await refreshInbox(); return; }
  const page = await fetchInbox({ limit: 1 });
  if (page) { inbox.unread = page.unread_count; updateBell(); }
}

/* ---------- wiring ---------- */

export function initPanels() {
  $('bell').append(icon('bell'));
  $('show-members').append(icon('users'));
  $('close-thread').append(icon('x'));
  $('close-search').append(icon('x'));
  $('bell').addEventListener('click', () => {
    if (isOpen('notifications')) { closePanel('notifications', true); return; }
    openPanel('notifications', $('bell'), { focus: false });
    loadInbox();
  });
  $('older').addEventListener('click', loadOlder);
  $('read-all').addEventListener('click', markAll);
  $('close-thread').addEventListener('click', () => closePanel('thread', true));
  $('close-search').addEventListener('click', () => closePanel('search-panel', true));
  $('show-members').addEventListener('click', () => {
    if (membersOpen()) closeMembers(true); else openMembers($('show-members'));
  });
  $('search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); runSearch($('search').value); }
  });
  const reply = $('thread-reply');
  reply.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendReply(); }
  });
  reply.addEventListener('input', () => { replyNonce = null; });
  S.hooks.openThread = openThread;
}

export const debouncedMembers = debounce(loadMembers, 150);
