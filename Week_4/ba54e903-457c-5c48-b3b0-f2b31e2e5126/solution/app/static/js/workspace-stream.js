/* The message stream: rows, history paging, scroll behaviour, sending, reactions, editing, deleting. */
import { S, $, h, icon, status, api, newNonce, formatTime, quoteText, durationLabel, EMOJI, emojiName,
  reducedMotion } from './workspace-core.js';

const messages = new Map(); // id -> message
const rows = new Map(); // id -> article element
const sending = new Map(); // nonce -> delivery item
let hasMore = false;
let stick = true;
let loadSeq = 0;
let loadingOlder = false;
let newWhileUp = false;
let lastAcked = 0;
let picker = null;

const box = () => $('messages');
const scroller = () => $('stream');
const can = (key) => S.perms.has(key);

/* ---------- row construction ---------- */

export function buildContent(msg, { lite = false } = {}) {
  const author = msg.author;
  const row = h('article', { class: 'msg' + (lite ? ' compact' : ''), 'data-id': String(msg.id) });
  const r = {
    avatar: h('img', { class: 'avatar', alt: '', width: '40', height: '40', src: author.avatar_url }),
    name: h('span', { class: 'author', text: author.display_name }),
    time: h('time', { datetime: msg.created_at, text: formatTime(msg.created_at) }),
    body: h('span', { class: 'msg-body' }),
    edited: h('span', { class: 'msg-edited', text: '(edited)' }),
    attachments: h('div', { class: 'attachments' }),
    quote: null,
    attachKey: '',
    toolSig: '',
    chips: new Map(),
  };
  r.text = h('div', { class: 'msg-text' }, r.body);
  r.head = h('div', { class: 'msg-head' }, r.name, r.time);
  row.append(r.avatar, r.head, r.text, r.attachments);
  if (!lite) {
    r.reactions = h('div', { class: 'reactions' });
    r.replies = h('button', { type: 'button', class: 'replies-link', hidden: true, onclick: () => S.hooks.openThread(row._msg, r.replies) });
    row.append(r.reactions, r.replies);
  }
  row._r = r;
  row._lite = lite;
  patchRow(row, msg);
  return row;
}

function renderAttachments(r, list) {
  const key = JSON.stringify(list.map((a) => a.id));
  if (key === r.attachKey) return;
  r.attachKey = key;
  r.attachments.replaceChildren(...list.map((a) => {
    const size = {};
    if (a.width) size.width = String(a.width);
    if (a.height) size.height = String(a.height);
    if (a.content_type.startsWith('image/')) return h('img', { alt: a.filename, src: a.url, ...size });
    if (a.content_type.startsWith('video/')) {
      const caption = a.duration_ms === null ? a.filename : `${a.filename} · ${durationLabel(a.duration_ms)}`;
      return h('figure', {}, h('video', { controls: true, preload: 'metadata', src: a.url, ...size }),
        h('figcaption', { text: caption }));
    }
    return h('a', { href: a.url, text: a.filename });
  }));
}

function patchChips(row, msg) {
  const r = row._r;
  const wanted = msg.reactions;
  const seen = new Set();
  for (const reaction of wanted) {
    seen.add(reaction.emoji);
    let chip = r.chips.get(reaction.emoji);
    if (!chip) {
      chip = h('button', { type: 'button', class: 'chip', onclick: () => toggleReaction(row._msg.id, reaction.emoji) });
      chip._glyph = h('span', { 'aria-hidden': 'true' });
      chip._count = h('span', { 'aria-hidden': 'true' });
      chip.append(chip._glyph, chip._count);
      r.chips.set(reaction.emoji, chip);
    }
    const label = `${emojiName(reaction.emoji)}: ${reaction.count}`;
    if (chip.getAttribute('aria-label') !== label) {
      chip.setAttribute('aria-label', label);
      chip._glyph.textContent = reaction.emoji;
      chip._count.textContent = String(reaction.count);
    }
    chip.setAttribute('aria-pressed', String(reaction.me));
    chip.disabled = !reaction.me && !can('add_reactions');
  }
  for (const [emoji, chip] of r.chips) {
    if (!seen.has(emoji)) { chip.remove(); r.chips.delete(emoji); }
  }
  const current = Array.from(r.reactions.children);
  const order = wanted.map((x) => r.chips.get(x.emoji));
  if (current.length !== order.length || current.some((node, i) => node !== order[i])) r.reactions.replaceChildren(...order);
}

function toolButton(name, label, onclick) {
  return h('button', { type: 'button', 'aria-label': label, onclick }, icon(name, 18));
}

function buildTools(row, msg) {
  const own = msg.author.id === S.me.id;
  const sig = [can('add_reactions'), own, own || can('manage_messages')].join();
  const r = row._r;
  if (r.toolSig === sig) return;
  r.toolSig = sig;
  r.tools?.remove();
  const tools = h('div', { class: 'msg-tools' });
  if (can('add_reactions')) {
    const add = toolButton('smile', 'Add reaction', () => openPicker(row._msg.id, add));
    tools.append(add);
  }
  const thread = toolButton('reply', 'Reply in thread', () => S.hooks.openThread(row._msg, thread));
  tools.append(thread);
  if (own) tools.append(toolButton('pencil', 'Edit message', () => startEdit(row)));
  if (own || can('manage_messages')) tools.append(toolButton('trash', 'Delete message', () => removeOwn(row._msg.id)));
  r.tools = tools;
  row.append(tools);
}

export function patchRow(row, msg) {
  const r = row._r;
  row._msg = msg;
  const ref = msg.referenced_message;
  row.classList.toggle('has-quote', Boolean(ref));
  if (ref) {
    if (!r.quote) {
      r.quote = h('div', { class: 'msg-quote' });
      row.insertBefore(r.quote, r.head);
    }
    const text = quoteText(ref);
    if (r.quote.textContent !== text) r.quote.textContent = text;
  } else if (r.quote) {
    r.quote.remove();
    r.quote = null;
  }
  if (r.name.textContent !== msg.author.display_name) r.name.textContent = msg.author.display_name;
  if (r.body.textContent !== msg.body) r.body.textContent = msg.body;
  r.text.hidden = msg.body === '' && !msg.edited_at;
  r.body.hidden = msg.body === '';
  // The marker exists only on edited rows, so no row carries an unseen "(edited)".
  if (msg.edited_at) r.text.appendChild(r.edited); else r.edited.remove();
  renderAttachments(r, msg.attachments);
  row.classList.toggle('mentions-me', msg.mentions.includes(S.me.id));
  if (!row._lite) {
    patchChips(row, msg);
    r.replies.hidden = msg.reply_count === 0;
    r.replies.textContent = msg.reply_count === 1 ? '1 reply' : `${msg.reply_count} replies`;
    buildTools(row, msg);
  }
}

/* ---------- inserting and removing ---------- */

const isNearBottom = () => {
  const el = scroller();
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
};

export function scrollToBottom() {
  const el = scroller();
  el.scrollTop = el.scrollHeight;
  stick = true;
  newWhileUp = false;
  $('jump').hidden = true;
}

function updateStart() {
  $('start').hidden = !(messages.size === 0 && sending.size === 0 && !hasMore);
}

function ownInFlight(msg) {
  if (msg.author.id !== S.me.id) return false;
  return Array.from(sending.values()).some((item) => !item.failed && item.body === msg.body);
}

export function upsertMessage(msg, { animate = false } = {}) {
  if (msg.channel_id !== S.channelId) return;
  let row = rows.get(msg.id);
  if (row) {
    messages.set(msg.id, msg);
    patchRow(row, msg);
    return;
  }
  if (animate && ownInFlight(msg)) return;
  const wasBottom = stick || isNearBottom();
  messages.set(msg.id, msg);
  row = buildContent(msg);
  rows.set(msg.id, row);
  let next = null;
  for (const id of rows.keys()) {
    if (id > msg.id && (next === null || id < next)) next = id;
  }
  const firstTemp = box().querySelector('.is-pending');
  box().insertBefore(row, next === null ? firstTemp : rows.get(next));
  if (animate && !reducedMotion()) {
    row.classList.add('msg-enter');
    row.addEventListener('animationend', () => row.classList.remove('msg-enter'), { once: true });
  }
  updateStart();
  const mine = msg.author.id === S.me.id;
  if (next === null && animate) {
    if (wasBottom || mine) scrollToBottom();
    else { newWhileUp = true; $('jump').hidden = false; }
  }
  if (animate && next === null && (wasBottom || mine)) ack();
}

export function removeMessage(id) {
  rows.get(id)?.remove();
  rows.delete(id);
  messages.delete(id);
  updateStart();
}

export function getMessage(id) { return messages.get(id); }
export function allMessages() { return Array.from(messages.values()); }

export function refreshTools() {
  for (const row of rows.values()) {
    row._r.toolSig = '';
    buildTools(row, row._msg);
    patchChips(row, row._msg);
  }
}

/* ---------- history ---------- */

export function resetStream() {
  loadSeq += 1;
  messages.clear();
  rows.clear();
  sending.clear();
  box().replaceChildren();
  hasMore = false;
  lastAcked = 0;
  closePicker(false);
  $('start').hidden = true;
  $('jump').hidden = true;
}

async function fetchPage(query) {
  const res = await api('GET', `/api/channels/${S.channelId}/messages`, { query });
  return res.ok ? res.data : null;
}

export async function loadChannel() {
  resetStream();
  const seq = loadSeq;
  const page = await fetchPage({ limit: 50 });
  if (seq !== loadSeq || !page) return;
  hasMore = page.has_more;
  for (const msg of page.data) upsertMessage(msg);
  updateStart();
  scrollToBottom();
  ack();
}

/* After a dropped connection: make the loaded rows match the channel history, without duplicates. */
export async function catchUp() {
  const seq = loadSeq;
  const page = await fetchPage({ limit: 50 });
  if (seq !== loadSeq || !page) return;
  const newest = Math.max(0, ...rows.keys());
  if (page.data.length && page.has_more && newest < page.data[0].id) {
    await loadChannel();
    return;
  }
  const floor = page.data.length ? page.data[0].id : Infinity;
  const keep = new Set(page.data.map((m) => m.id));
  for (const id of Array.from(rows.keys())) if (id >= floor && !keep.has(id)) removeMessage(id);
  if (!page.data.length) for (const id of Array.from(rows.keys())) removeMessage(id);
  for (const msg of page.data) upsertMessage(msg, { animate: !rows.has(msg.id) });
  updateStart();
}

async function loadOlder() {
  if (loadingOlder || !hasMore || rows.size === 0) return;
  loadingOlder = true;
  const seq = loadSeq;
  const oldest = Math.min(...rows.keys());
  const page = await fetchPage({ limit: 50, before: oldest });
  loadingOlder = false;
  if (seq !== loadSeq || !page) return;
  hasMore = page.has_more;
  const el = scroller();
  const before = el.scrollHeight;
  stick = false;
  const fragment = document.createDocumentFragment();
  for (const msg of page.data) {
    if (rows.has(msg.id)) continue;
    messages.set(msg.id, msg);
    const row = buildContent(msg);
    rows.set(msg.id, row);
    fragment.append(row);
  }
  box().prepend(fragment);
  el.scrollTop += el.scrollHeight - before;
  updateStart();
}

function ack() {
  if (document.visibilityState === 'hidden' || !rows.size) return;
  const newest = Math.max(...rows.keys());
  if (newest <= lastAcked) return;
  lastAcked = newest;
  api('POST', `/api/channels/${S.channelId}/ack`, { body: { message_id: newest } })
    .then(() => S.hooks.readStatesChanged?.());
}

export function initStream() {
  const el = scroller();
  el.addEventListener('scroll', () => {
    stick = isNearBottom();
    if (stick) { newWhileUp = false; $('jump').hidden = true; ack(); }
    if (el.scrollTop < 80) loadOlder();
  });
  el.addEventListener('wheel', (event) => { if (event.deltaY < 0 && el.scrollTop === 0) loadOlder(); }, { passive: true });
  new ResizeObserver(() => { if (stick && !loadingOlder) el.scrollTop = el.scrollHeight; }).observe(box());
  $('jump').addEventListener('click', () => { scrollToBottom(); ack(); });
  box().addEventListener('click', (event) => {
    if (!matchMedia('(hover: none), (max-width: 767px)').matches) return;
    if (event.target.closest('button, a, textarea, video')) return;
    const row = event.target.closest('.msg');
    if (!row) return;
    const open = row.classList.contains('tools-open');
    box().querySelectorAll('.tools-open').forEach((node) => node.classList.remove('tools-open'));
    if (!open) row.classList.add('tools-open');
  });
  document.addEventListener('visibilitychange', ack);
  buildPicker();
}

/* ---------- sending ---------- */

function tempRow(item) {
  const msg = {
    id: 0, channel_id: S.channelId, author: S.me, body: item.body, created_at: new Date(window.Hub.serverNow()).toISOString(),
    edited_at: null, reply_to_id: null, referenced_message: null, reply_count: 0, mentions: [], reactions: [], attachments: [],
  };
  const row = buildContent({ ...msg, author: { ...S.me, avatar_url: S.me.avatar_url } }, { lite: true });
  row.classList.add('is-pending');
  row.classList.remove('compact');
  row.removeAttribute('data-id');
  item.fail = h('div', { class: 'msg-fail', hidden: true },
    h('span', { text: 'Message failed to send. Tap to retry.' }),
    h('button', { type: 'button', class: 'text-btn', text: 'Retry', onclick: () => deliver(item) }));
  row.append(item.fail);
  return row;
}

export function submit({ body, files }) {
  const item = { nonce: newNonce(), body, files, ids: [], channelId: S.channelId, failed: false };
  item.row = tempRow(item);
  sending.set(item.nonce, item);
  box().append(item.row);
  updateStart();
  scrollToBottom();
  deliver(item);
}

async function deliver(item) {
  item.failed = false;
  item.fail.hidden = true;
  item.row.classList.add('is-pending');
  try {
    for (let i = item.ids.length; i < item.files.length; i++) {
      const form = new FormData();
      form.append('file', item.files[i]);
      const res = await api('POST', '/api/attachments', { formData: form });
      if (!res.ok) throw new Error('upload');
      item.ids.push(res.data.id);
    }
    const payload = { body: item.body, nonce: item.nonce };
    if (item.ids.length) payload.attachment_ids = item.ids;
    const res = await api('POST', `/api/channels/${item.channelId}/messages`, { body: payload });
    if (!res.ok) throw new Error('post');
    sending.delete(item.nonce);
    item.row.remove();
    if (item.channelId === S.channelId) upsertMessage(res.data, { animate: true });
    updateStart();
  } catch {
    item.failed = true;
    item.row.classList.remove('is-pending');
    item.fail.hidden = false;
  }
}

/* ---------- reactions ---------- */

async function toggleReaction(id, emoji) {
  const msg = messages.get(id);
  if (!msg) return;
  const before = JSON.parse(JSON.stringify(msg.reactions));
  const next = JSON.parse(JSON.stringify(msg.reactions));
  const existing = next.find((x) => x.emoji === emoji);
  const removing = Boolean(existing && existing.me);
  if (removing) {
    existing.count -= 1;
    existing.me = false;
    if (existing.count <= 0) next.splice(next.indexOf(existing), 1);
  } else if (existing) {
    existing.count += 1;
    existing.me = true;
  } else {
    next.push({ emoji, count: 1, me: true });
  }
  const optimistic = { ...msg, reactions: next };
  messages.set(id, optimistic);
  patchRow(rows.get(id), optimistic);
  let accepted = false;
  try {
    const res = await api(removing ? 'DELETE' : 'PUT', `/api/messages/${id}/reactions/${encodeURIComponent(emoji)}`);
    accepted = res.ok || (removing && res.status === 404);
  } catch { accepted = false; }
  if (!accepted && rows.has(id)) {
    const reverted = { ...messages.get(id), reactions: before };
    messages.set(id, reverted);
    patchRow(rows.get(id), reverted);
    status('Your reaction could not be saved.');
  }
}

function buildPicker() {
  picker = h('div', { class: 'picker', role: 'dialog', 'aria-label': 'Choose a reaction', hidden: true });
  for (const [name, glyph] of EMOJI) {
    picker.append(h('button', { type: 'button', 'aria-label': name, text: glyph, onclick: () => choose(glyph) }));
  }
  $('app').append(picker);
  document.addEventListener('pointerdown', (event) => {
    if (!picker.hidden && !picker.contains(event.target) && !event.target.closest('[aria-label="Add reaction"]')) closePicker(false);
  });
}

function openPicker(id, opener) {
  picker._target = id;
  picker._opener = opener;
  picker.hidden = false;
  const rect = opener.getBoundingClientRect();
  const width = picker.offsetWidth;
  const height = picker.offsetHeight;
  picker.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.right - width))}px`;
  const below = rect.bottom + 6;
  picker.style.top = `${below + height > innerHeight ? Math.max(8, rect.top - height - 6) : below}px`;
  picker.style.position = 'fixed';
  picker.firstElementChild.focus();
}

export function pickerOpen() { return !picker.hidden; }

export function closePicker(restoreFocus = true) {
  if (!picker || picker.hidden) return;
  picker.hidden = true;
  if (restoreFocus && picker._opener?.isConnected) picker._opener.focus();
}

function choose(glyph) {
  const id = picker._target;
  const existing = messages.get(id)?.reactions.find((x) => x.emoji === glyph);
  closePicker(true);
  if (!existing || !existing.me) toggleReaction(id, glyph);
}

/* ---------- editing and deleting ---------- */

function startEdit(row) {
  const msg = row._msg;
  const r = row._r;
  if (row.querySelector('.msg-edit')) return;
  const field = h('textarea', { 'aria-label': 'Edit message text', rows: '1' });
  field.value = msg.body;
  const holder = h('div', { class: 'msg-edit' }, field);
  r.text.hidden = true;
  r.text.after(holder);
  const close = () => { holder.remove(); r.text.hidden = false; patchRow(row, row._msg); };
  field.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    const text = field.value.trim();
    if (text === msg.body) { close(); return; }
    let res;
    try { res = await api('PATCH', `/api/messages/${msg.id}`, { body: { body: text } }); } catch { res = { ok: false }; }
    if (!res.ok) { status('Your edit could not be saved.'); return; }
    messages.set(msg.id, res.data);
    holder.remove();
    r.text.hidden = false;
    patchRow(row, res.data);
  });
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

async function removeOwn(id) {
  let res;
  try { res = await api('DELETE', `/api/messages/${id}`); } catch { res = { ok: false }; }
  if (res.ok) removeMessage(id);
  else status('Your message could not be deleted.');
}

