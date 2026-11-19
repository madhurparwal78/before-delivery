// The signed-in workspace: the rail, the channel list, the stream and every panel.

import {
  api, clockText, element, encodeNext, latestInputGuard, localTime, markSessionEnded,
  rememberChannel, serverNow, token,
} from './api.js';
import { closeTopPanel, openPanel, closePanel } from './panels.js';

const body = document.body;
const railNav = document.getElementById('community-rail');
const sidebar = document.getElementById('channel-sidebar');
const channelName = document.getElementById('channel-name');
const slowmodeLine = document.getElementById('slowmode-line');
const messageList = document.getElementById('message-list');
const streamEmpty = document.getElementById('stream-empty');
const stream = document.getElementById('stream');
const composer = document.getElementById('composer-input');
const attachButton = document.getElementById('attach-files');
const fileInput = document.getElementById('file-input');
const pendingList = document.getElementById('pending-attachments');
const statusLine = document.getElementById('workspace-status');
const jumpButton = document.getElementById('jump-to-new');
const searchBox = document.getElementById('message-search');
const searchPanel = document.getElementById('search-panel');
const searchHeading = document.getElementById('search-heading');
const searchResults = document.getElementById('search-results');
const threadPanel = document.getElementById('thread-panel');
const threadParent = document.getElementById('thread-parent');
const threadReplies = document.getElementById('thread-replies');
const threadInput = document.getElementById('thread-input');
const notificationsButton = document.getElementById('notifications-button');
const notificationsPanel = document.getElementById('notifications-panel');
const notificationList = document.getElementById('notification-list');
const showOlder = document.getElementById('show-older');
const memberList = document.getElementById('member-list');
const onlineList = document.getElementById('online-list');
const offlineList = document.getElementById('offline-list');
const showMembers = document.getElementById('show-members');
const openChannels = document.getElementById('open-channels');
const channelColumn = document.getElementById('channel-column');
const reactionDialog = document.getElementById('reaction-dialog');
const reactionButtons = document.getElementById('reaction-buttons');

const EMOJI = [
  ['thumbs up', '\u{1F44D}'], ['heart', '\u2764\uFE0F'], ['laughing', '\u{1F602}'],
  ['party', '\u{1F389}'], ['surprised', '\u{1F62E}'], ['sad', '\u{1F622}'],
  ['fire', '\u{1F525}'], ['eyes', '\u{1F440}'],
];
const EMOJI_NAMES = new Map(EMOJI.map(([name, glyph]) => [glyph, name]));
const CACHE_KEY = 'hub_community_slugs';
const searchGuard = latestInputGuard();

const state = {
  self: null,
  communityId: Number(body.dataset.community),
  channelId: Number(body.dataset.channel),
  slug: null,
  community: null,
  permissions: new Set(),
  messages: new Map(),
  order: [],
  live: null,
  liveReady: false,
  buffered: [],
  connected: false,
  timeoutUntil: null,
  notifications: [],
  notificationsMore: false,
  searchQuery: '',
  searchIds: [],
  pending: [],
  threadParentId: null,
};

function slugCache() {
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function rememberSlug(id, slug) {
  const cache = slugCache();
  cache[String(id)] = slug;
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function toLogin() {
  markSessionEnded();
  window.location.replace('/login?next=' + encodeNext(window.location.pathname));
}

async function call(path, options) {
  const answer = await api(path, options);
  if (answer.status === 401) {
    toLogin();
    throw new Error('session ended');
  }
  return answer;
}

function say(line) {
  statusLine.textContent = line;
}

// --- message rows ---------------------------------------------------------

function quoteLine(message) {
  if (!message.referenced_message) return null;
  const parent = message.referenced_message;
  const characters = Array.from(parent.body);
  const shown = characters.length > 100
    ? characters.slice(0, 100).join('') + '\u2026'
    : parent.body;
  const suffix = parent.edited_at ? ' (edited)' : '';
  return element('p', {
    class: 'quote-line',
    text: 'Replying to ' + parent.author.display_name + ': ' + shown + suffix,
  });
}

function reactionChip(message, reaction) {
  const name = EMOJI_NAMES.get(reaction.emoji) || reaction.emoji;
  const chip = element('button', {
    type: 'button',
    class: 'reaction-chip',
    'aria-pressed': reaction.me ? 'true' : 'false',
    'data-emoji': reaction.emoji,
    text: name + ': ' + reaction.count,
  });
  chip.addEventListener('click', () => toggleReaction(message.id, reaction.emoji));
  return chip;
}

function attachmentNode(file) {
  if (file.content_type.startsWith('image/')) {
    return element('img', {
      src: file.url, alt: file.filename,
      width: file.width || 320, height: file.height || 200,
    });
  }
  if (file.content_type.startsWith('video/')) {
    const video = element('video', {
      controls: true, preload: 'metadata', src: file.url,
      width: file.width || 320, height: file.height || 200,
    });
    const seconds = Math.floor((file.duration_ms || 0) / 1000);
    const caption = element('p', {
      class: 'attachment-caption',
      text: file.filename + ' \u00b7 ' + Math.floor(seconds / 60) + ':' +
        String(seconds % 60).padStart(2, '0'),
    });
    return element('div', { class: 'attachment' }, [video, caption]);
  }
  return element('a', { href: file.url, text: file.filename });
}

function messageRow(message, options = {}) {
  const row = element('li', { class: 'message-row', 'data-id': message.id });
  if (options.entering) row.classList.add('entering');
  row.appendChild(element('img', {
    class: 'avatar', src: message.author.avatar_url, alt: '', width: 40, height: 40,
  }));
  const content = element('div', { class: 'message-content' });
  const head = element('p', { class: 'message-head' }, [
    element('span', { class: 'author', text: message.author.display_name }),
    element('time', { datetime: message.created_at, text: localTime(message.created_at) }),
  ]);
  content.appendChild(head);
  const quote = quoteLine(message);
  if (quote) content.insertBefore(quote, head);
  const text = element('p', { class: 'message-body', text: message.body });
  if (message.edited_at) text.appendChild(element('span', { class: 'edited', text: ' (edited)' }));
  content.appendChild(text);
  for (const file of message.attachments) content.appendChild(attachmentNode(file));
  if (message.reply_count > 0) {
    content.appendChild(element('p', {
      class: 'reply-count',
      text: message.reply_count === 1 ? '1 reply' : message.reply_count + ' replies',
    }));
  }
  if (message.reactions.length) {
    content.appendChild(element('p', { class: 'chips' },
      message.reactions.map((reaction) => reactionChip(message, reaction))));
  }
  content.appendChild(rowActions(message));
  row.appendChild(content);
  return row;
}

function rowActions(message) {
  const actions = element('p', { class: 'row-actions' });
  if (state.permissions.has('add_reactions')) {
    const add = element('button', { type: 'button', text: 'Add reaction' });
    add.addEventListener('click', () => openReactionDialog(message.id, add));
    actions.appendChild(add);
  }
  const reply = element('button', { type: 'button', text: 'Reply in thread' });
  reply.addEventListener('click', () => openThread(message.id, reply));
  actions.appendChild(reply);
  if (state.self && message.author.id === state.self.id) {
    const edit = element('button', { type: 'button', text: 'Edit message' });
    edit.addEventListener('click', () => startEdit(message.id));
    actions.appendChild(edit);
  }
  if ((state.self && message.author.id === state.self.id) ||
      state.permissions.has('manage_messages')) {
    const remove = element('button', { type: 'button', text: 'Delete message' });
    remove.addEventListener('click', () => removeMessage(message.id));
    actions.appendChild(remove);
  }
  return actions;
}

function drawStream() {
  messageList.replaceChildren(...state.order.map((id) => messageRow(state.messages.get(id))));
  streamEmpty.hidden = state.order.length > 0;
}

function atBottom() {
  return stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
}

function putMessage(message, { entering = false } = {}) {
  const known = state.messages.has(message.id);
  state.messages.set(message.id, message);
  if (!known) {
    state.order.push(message.id);
    state.order.sort((left, right) => left - right);
  }
  const existing = messageList.querySelector(`[data-id="${message.id}"]`);
  const row = messageRow(message, { entering: entering && !known });
  if (existing) {
    existing.replaceWith(row);
  } else {
    const stuck = atBottom();
    const index = state.order.indexOf(message.id);
    const nextRow = messageList.children[index];
    messageList.insertBefore(row, nextRow || null);
    streamEmpty.hidden = true;
    if (stuck) stream.scrollTop = stream.scrollHeight;
    else if (entering) jumpButton.hidden = false;
  }
  if (state.threadParentId === message.id) drawThreadParent(message);
  refreshSearchRow(message);
}

function dropMessage(id) {
  state.messages.delete(id);
  state.order = state.order.filter((entry) => entry !== id);
  const row = messageList.querySelector(`[data-id="${id}"]`);
  if (row) row.remove();
  streamEmpty.hidden = state.order.length > 0;
  removeSearchRow(id);
  if (state.threadParentId === id) closeThread();
}

// --- the rail, the channels and the members -------------------------------

async function loadSelf() {
  const answer = await call('/api/users/@me');
  if (!answer.ok) throw new Error('no session');
  state.self = answer.data;
  for (const key of Object.keys(window.sessionStorage)) {
    if (key.startsWith('hub_draft:') && !key.startsWith(`hub_draft:${state.self.id}:`)) {
      window.sessionStorage.removeItem(key);
    }
  }
}

async function candidateSlugs() {
  const cache = slugCache();
  const slugs = new Set(Object.values(cache));
  const answer = await api('/api/servers?per_page=50');
  if (answer.ok) for (const community of answer.data.data) slugs.add(community.slug);
  return Array.from(slugs);
}

async function loadRail() {
  const slugs = await candidateSlugs();
  const joined = [];
  const answers = await Promise.all(
    slugs.map((slug) => api('/api/servers/' + slug).catch(() => null))
  );
  answers.forEach((answer, index) => {
    if (!answer || !answer.ok || !answer.data.me) return;
    rememberSlug(answer.data.id, slugs[index]);
    joined.push(answer.data);
    if (answer.data.id === state.communityId) state.community = answer.data;
  });
  joined.sort((left, right) => left.id - right.id);
  railNav.replaceChildren(...joined.map((community) => {
    const channel = community.channels.find((entry) => entry.type === 'text');
    const link = element('a', {
      href: `/channels/${community.id}/${channel ? channel.id : state.channelId}`,
      class: 'rail-link',
      'aria-current': community.id === state.communityId ? 'true' : null,
    }, [element('img', {
      src: community.icon_url, alt: community.name, width: 48, height: 48,
    })]);
    return link;
  }));
  return joined;
}

async function loadCommunity() {
  const cache = slugCache();
  state.slug = cache[String(state.communityId)] || state.slug;
  if (!state.slug) return false;
  const answer = await call('/api/servers/' + state.slug);
  if (!answer.ok || !answer.data.me) return false;
  state.community = answer.data;
  drawChannels();
  return true;
}

function drawChannels() {
  const groups = [['Text Channels', 'text'], ['Voice Channels', 'voice']];
  const nodes = [];
  for (const [heading, kind] of groups) {
    const channels = state.community.channels.filter((channel) => channel.type === kind);
    if (!channels.length) continue;
    nodes.push(element('h2', { text: heading }));
    nodes.push(element('ul', {}, channels.map((channel) => element('li', {}, [
      element('a', {
        href: `/channels/${state.community.id}/${channel.id}`,
        'aria-current': channel.id === state.channelId ? 'page' : null,
        'data-channel': channel.id,
        'data-type': channel.type,
      }, [
        element('span', { 'aria-hidden': 'true', class: 'hash', text: '#' }),
        element('span', { text: channel.name }),
      ]),
    ]))));
  }
  sidebar.replaceChildren(...nodes);
  const open = state.community.channels.find((channel) => channel.id === state.channelId);
  if (open) {
    channelName.textContent = open.name;
    document.title = '#' + open.name + ' - Community Hub';
    composer.setAttribute('aria-label', 'Message #' + open.name);
    slowmodeLine.hidden = open.slowmode_seconds <= 0;
    if (open.slowmode_seconds > 0) {
      slowmodeLine.textContent =
        'Slowmode is on: one message every ' + open.slowmode_seconds + ' seconds.';
    }
  }
}

async function loadMembers() {
  const answer = await api('/api/servers/' + state.slug + '/members');
  if (!answer.ok) return;
  const online = answer.data.data.filter((entry) => entry.status !== 'offline');
  const offline = answer.data.data.filter((entry) => entry.status === 'offline');
  const row = (entry) => element('li', {}, [
    element('img', { src: entry.user.avatar_url, alt: '', width: 32, height: 32 }),
    element('span', { text: entry.user.display_name }),
  ]);
  onlineList.replaceChildren(...online.map(row));
  offlineList.replaceChildren(...offline.map(row));
  onlineList.setAttribute('aria-label', `Online (${online.length})`);
  offlineList.setAttribute('aria-label', `Offline (${offline.length})`);
}

// --- permissions and the composer -----------------------------------------

async function loadPermissions() {
  const [permissions, community] = await Promise.all([
    call('/api/channels/' + state.channelId + '/permissions'),
    call('/api/servers/' + state.slug),
  ]);
  if (permissions.ok) state.permissions = new Set(permissions.data.permissions);
  if (community.ok && community.data.me) {
    state.community = community.data;
    state.timeoutUntil = community.data.me.communication_disabled_until;
  }
  applyComposerState();
  drawStream();
}

function timeoutSecondsLeft() {
  if (!state.timeoutUntil) return 0;
  const until = Date.parse(state.timeoutUntil);
  return Math.max(0, (until - serverNow()) / 1000);
}

function applyComposerState() {
  const left = timeoutSecondsLeft();
  const maySend = state.permissions.has('send_messages') && left <= 0;
  composer.disabled = !maySend;
  attachButton.disabled = !maySend || !state.permissions.has('attach_files');
  const open = state.community
    ? state.community.channels.find((channel) => channel.id === state.channelId)
    : null;
  if (left > 0) {
    composer.placeholder = 'You are timed out for ' + clockText(left) + ' more.';
  } else if (!state.permissions.has('send_messages')) {
    composer.placeholder = 'You do not have permission to send messages in this channel.';
  } else if (open) {
    composer.placeholder = 'Message #' + open.name;
  }
}

// The remaining time is counted against the server's clock, never the device's.
window.setInterval(() => {
  if (!state.timeoutUntil) return;
  if (timeoutSecondsLeft() > 0) {
    applyComposerState();
    return;
  }
  state.timeoutUntil = null;
  loadPermissions();
}, 500);

function draftKey() {
  return `hub_draft:${state.self.id}:${state.channelId}`;
}

function saveDraft() {
  if (!state.self) return;
  if (composer.value) window.sessionStorage.setItem(draftKey(), composer.value);
  else window.sessionStorage.removeItem(draftKey());
}

function restoreDraft() {
  const saved = window.sessionStorage.getItem(draftKey());
  if (saved) {
    composer.value = saved;
    composer.setSelectionRange(saved.length, saved.length);
  }
}

// --- posting, editing, reactions and threads ------------------------------

function newNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function uploadPending() {
  const ids = [];
  for (const file of state.pending) {
    const form = new FormData();
    form.append('file', file);
    const answer = await call('/api/attachments', { method: 'POST', form });
    if (answer.status === 201) ids.push(answer.data.id);
    else if (answer.status === 413) say(file.name + ' is larger than your upload limit.');
  }
  state.pending = [];
  drawPending();
  return ids;
}

function drawPending() {
  pendingList.replaceChildren(...state.pending.map((file) => {
    const remove = element('button', { type: 'button', text: 'Remove ' + file.name });
    remove.addEventListener('click', () => {
      state.pending = state.pending.filter((entry) => entry !== file);
      drawPending();
    });
    return element('li', {}, [element('span', { text: file.name }), remove]);
  }));
}

function failedRow(text, nonce, attachmentIds) {
  const retry = element('button', { type: 'button', text: 'Retry' });
  const row = element('li', { class: 'message-row failed' }, [
    element('p', { class: 'message-body', text }),
    element('p', { class: 'failure', text: 'Message failed to send. Tap to retry.' }),
    retry,
  ]);
  retry.addEventListener('click', async () => {
    row.remove();
    await send(text, nonce, attachmentIds);
  });
  messageList.appendChild(row);
  stream.scrollTop = stream.scrollHeight;
}

async function send(text, nonce, attachmentIds) {
  let answer;
  try {
    answer = await call('/api/channels/' + state.channelId + '/messages', {
      method: 'POST',
      body: { body: text, nonce, attachment_ids: attachmentIds },
    });
  } catch (error) {
    failedRow(text, nonce, attachmentIds);
    return;
  }
  if (answer.status === 201 || answer.status === 200) {
    putMessage(answer.data, { entering: true });
    stream.scrollTop = stream.scrollHeight;
    return;
  }
  failedRow(text, nonce, attachmentIds);
}

async function sendFromComposer() {
  const text = composer.value.trim();
  if (!text && !state.pending.length) return;
  const attachmentIds = await uploadPending();
  if (!text && !attachmentIds.length) return;
  composer.value = '';
  saveDraft();
  await send(text, newNonce(), attachmentIds);
}

async function toggleReaction(messageId, emoji) {
  const message = state.messages.get(messageId);
  if (!message) return;
  const before = JSON.parse(JSON.stringify(message.reactions));
  const found = message.reactions.find((reaction) => reaction.emoji === emoji);
  const adding = !found || !found.me;
  if (adding) {
    if (found) {
      found.count += 1;
      found.me = true;
    } else {
      message.reactions.push({ emoji, count: 1, me: true });
    }
  } else {
    found.count -= 1;
    found.me = false;
    if (found.count <= 0) {
      message.reactions = message.reactions.filter((reaction) => reaction.emoji !== emoji);
    }
  }
  putMessage(message);
  const path = `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`;
  let answer;
  try {
    answer = await call(path, { method: adding ? 'PUT' : 'DELETE' });
  } catch (error) {
    answer = { ok: false };
  }
  if (!answer.ok) {
    message.reactions = before;
    putMessage(message);
    say('Your reaction could not be saved.');
  }
}

function openReactionDialog(messageId, opener) {
  reactionButtons.replaceChildren(...EMOJI.map(([name, glyph]) => {
    const button = element('button', { type: 'button', text: name });
    button.addEventListener('click', () => {
      closePanel(reactionDialog);
      toggleReaction(messageId, glyph);
    });
    return button;
  }));
  openPanel(reactionDialog, opener, reactionButtons.firstElementChild);
}

function startEdit(messageId) {
  const row = messageList.querySelector(`[data-id="${messageId}"]`);
  const message = state.messages.get(messageId);
  if (!row || !message) return;
  const bodyNode = row.querySelector('.message-body');
  const editor = element('textarea', { class: 'inline-editor', 'aria-label': 'Edit message text' });
  editor.value = message.body;
  bodyNode.after(editor);
  editor.focus();
  editor.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      editor.remove();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    let answer;
    try {
      answer = await call('/api/messages/' + messageId, {
        method: 'PATCH', body: { body: editor.value.trim() },
      });
    } catch (error) {
      answer = { ok: false };
    }
    if (answer.ok) {
      editor.remove();
      putMessage(answer.data);
    } else {
      say('Your edit could not be saved.');
    }
  });
}

async function removeMessage(messageId) {
  const answer = await call('/api/messages/' + messageId, { method: 'DELETE' });
  if (answer.status === 204) dropMessage(messageId);
}

function drawThreadParent(message) {
  threadParent.replaceChildren(messageRow(message));
}

async function openThread(messageId, opener) {
  const message = state.messages.get(messageId);
  if (!message) return;
  state.threadParentId = messageId;
  drawThreadParent(message);
  const answer = await call('/api/messages/' + messageId + '/replies');
  if (answer.ok) {
    threadReplies.replaceChildren(...answer.data.data.map((reply) => messageRow(reply)));
  }
  openPanel(threadPanel, opener, threadInput);
}

function closeThread() {
  state.threadParentId = null;
  closePanel(threadPanel);
}

document.getElementById('close-thread').addEventListener('click', closeThread);

threadInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  const text = threadInput.value.trim();
  if (!text || !state.threadParentId) return;
  threadInput.value = '';
  const answer = await call('/api/channels/' + state.channelId + '/messages', {
    method: 'POST',
    body: { body: text, reply_to_id: state.threadParentId, nonce: newNonce() },
  });
  if (answer.status === 201) {
    putMessage(answer.data, { entering: true });
    threadReplies.appendChild(messageRow(answer.data));
  }
});

// --- search ---------------------------------------------------------------

function markBody(text, terms) {
  const node = element('p', { class: 'message-body' });
  if (!terms.length) {
    node.textContent = text;
    return node;
  }
  const pattern = new RegExp(
    '(?<![0-9A-Za-z])(' + terms.map(escapeRegExp).join('|') + ')(?![0-9A-Za-z])', 'gi'
  );
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    node.appendChild(document.createTextNode(text.slice(last, match.index)));
    node.appendChild(element('mark', { text: match[0] }));
    last = match.index + match[0].length;
  }
  node.appendChild(document.createTextNode(text.slice(last)));
  return node;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function searchTerms(query) {
  const terms = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    const term = match[1] !== undefined ? match[1] : match[2];
    if (match[1] === undefined && /^(from|mentions|in|has|before|after|during):/i.test(term)) {
      continue;
    }
    if (term) terms.push(term);
  }
  return terms;
}

function searchResultRow(message) {
  const channel = state.community.channels.find((entry) => entry.id === message.channel_id);
  const item = element('li', { class: 'search-result', 'data-id': message.id });
  item.appendChild(element('p', { class: 'result-head' }, [
    element('span', { text: message.author.display_name }),
    element('span', { text: '#' + (channel ? channel.name : '') }),
    element('time', { datetime: message.created_at, text: localTime(message.created_at) }),
  ]));
  const quote = quoteLine(message);
  if (quote) item.appendChild(quote);
  const bodyNode = markBody(message.body, searchTerms(state.searchQuery));
  if (message.edited_at) bodyNode.appendChild(element('span', { class: 'edited', text: ' (edited)' }));
  item.appendChild(bodyNode);
  return item;
}

function drawSearchHeading() {
  const count = state.searchIds.length;
  searchHeading.textContent = count === 1 ? '1 result' : count + ' results';
}

function refreshSearchRow(message) {
  if (searchPanel.hidden) return;
  const row = searchResults.querySelector(`[data-id="${message.id}"]`);
  if (!row) return;
  row.replaceWith(searchResultRow(message));
}

function removeSearchRow(id) {
  if (!state.searchIds.includes(id)) return;
  state.searchIds = state.searchIds.filter((entry) => entry !== id);
  const row = searchResults.querySelector(`[data-id="${id}"]`);
  if (row) row.remove();
  drawSearchHeading();
}

async function runSearch(query, opener) {
  const ticket = searchGuard.start();
  state.searchQuery = query;
  openPanel(searchPanel, opener, null);
  searchHeading.textContent = 'Searching…';
  searchResults.replaceChildren();
  let answer;
  try {
    answer = await call('/api/servers/' + state.slug + '/messages/search?q=' +
      encodeURIComponent(query));
  } catch (error) {
    return;
  }
  if (!searchGuard.current(ticket)) return;
  if (!answer.ok) {
    searchHeading.textContent = 'That search could not be run.';
    return;
  }
  const messages = answer.data.data;
  state.searchIds = messages.map((message) => message.id);
  for (const message of messages) {
    if (!state.messages.has(message.id)) state.messages.set(message.id, message);
  }
  searchResults.replaceChildren(...messages.map(searchResultRow));
  drawSearchHeading();
}

searchBox.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const query = searchBox.value.trim();
  if (query) runSearch(query, searchBox);
});

document.getElementById('close-search').addEventListener('click', () => {
  closePanel(searchPanel);
  searchBox.focus();
});

// --- notifications --------------------------------------------------------

function notificationSentence(entry) {
  const actor = entry.actor ? entry.actor.display_name : 'Community Hub';
  if (entry.kind === 'mention') return actor + ' mentioned you';
  if (entry.kind === 'reply') return actor + ' replied to you';
  if (entry.kind === 'welcome') return 'Welcome to Community Hub';
  return actor + ' posted a message';
}

function notificationRow(entry) {
  const button = element('button', { type: 'button', text: notificationSentence(entry) });
  button.addEventListener('click', async () => {
    await call('/api/notifications/' + entry.id + '/read', { method: 'POST' });
    entry.read = true;
    updateNotificationButton();
    if (entry.channel_id && entry.community_id) {
      window.location.href = `/channels/${entry.community_id}/${entry.channel_id}`;
    }
  });
  return element('li', { 'data-id': entry.id, class: entry.read ? 'read' : 'unread' }, [button]);
}

function drawNotifications() {
  notificationList.replaceChildren(...state.notifications.map(notificationRow));
  showOlder.hidden = !state.notificationsMore;
}

function updateNotificationButton() {
  const unread = state.unreadCount || 0;
  notificationsButton.textContent = unread > 0
    ? `Notifications, ${unread} unread`
    : 'Notifications';
}

async function loadNotifications(before) {
  const query = new URLSearchParams({ limit: '20' });
  if (before) query.set('before', String(before));
  const answer = await call('/api/notifications?' + query.toString());
  if (!answer.ok) return;
  state.unreadCount = answer.data.unread_count;
  state.notificationsMore = answer.data.has_more;
  if (before) state.notifications = state.notifications.concat(answer.data.data);
  else state.notifications = answer.data.data;
  updateNotificationButton();
  if (!notificationsPanel.hidden || !before) drawNotifications();
}

// Entries arrive and leave in place: no row is duplicated, lost or refocused.
async function refreshInboxInPlace() {
  const answer = await call('/api/notifications?limit=20');
  if (!answer.ok) return;
  state.unreadCount = answer.data.unread_count;
  updateNotificationButton();
  if (notificationsPanel.hidden) return;

  const loaded = state.notifications;
  const oldestLoaded = loaded.length ? loaded[loaded.length - 1].id : 0;
  const visible = [];
  let cursor = 0;
  let more = true;
  while (more) {
    const page = cursor
      ? await call('/api/notifications?limit=50&before=' + cursor)
      : await call('/api/notifications?limit=50');
    if (!page.ok) return;
    visible.push(...page.data.data);
    const last = page.data.data[page.data.data.length - 1];
    cursor = last ? last.id : 0;
    more = Boolean(page.data.has_more && last && last.id > oldestLoaded);
  }
  const wanted = visible.filter((entry) => entry.id >= oldestLoaded);
  const wantedIds = new Set(wanted.map((entry) => entry.id));

  for (const entry of loaded) {
    if (wantedIds.has(entry.id)) continue;
    const row = notificationList.querySelector(`[data-id="${entry.id}"]`);
    if (row) row.remove();
  }
  const rows = new Map(
    Array.from(notificationList.children).map((row) => [Number(row.dataset.id), row])
  );
  let previous = null;
  for (const entry of wanted) {
    let row = rows.get(entry.id);
    if (!row) {
      row = notificationRow(entry);
      notificationList.insertBefore(row, previous ? previous.nextSibling : notificationList.firstChild);
    }
    previous = row;
  }
  state.notifications = wanted;
  showOlder.hidden = visible.length <= wanted.length && !state.notificationsMore;
}

notificationsButton.addEventListener('click', async () => {
  if (notificationsPanel.hidden) {
    await loadNotifications(null);
    openPanel(notificationsPanel, notificationsButton, null);
  } else {
    closePanel(notificationsPanel);
  }
});

showOlder.addEventListener('click', async () => {
  const last = state.notifications[state.notifications.length - 1];
  await loadNotifications(last ? last.id : null);
  if (showOlder.hidden) {
    const first = notificationList.querySelector('li button');
    if (first) first.focus();
  } else {
    showOlder.focus();
  }
});

document.getElementById('mark-all-read').addEventListener('click', async () => {
  await call('/api/notifications/read-all', { method: 'POST' });
  for (const entry of state.notifications) entry.read = true;
  state.unreadCount = 0;
  updateNotificationButton();
  drawNotifications();
});

// --- mentions -------------------------------------------------------------

const mentionBox = element('ul', {
  class: 'mention-list', role: 'listbox', 'aria-label': 'Mention a member', hidden: true,
});
document.querySelector('.composer').appendChild(mentionBox);
let mentionOptions = [];
let mentionActive = 0;

function closeMentions() {
  mentionBox.hidden = true;
  mentionOptions = [];
}

function drawMentions(matches) {
  mentionOptions = matches;
  mentionActive = 0;
  mentionBox.replaceChildren(...matches.map((member, index) => element('li', {
    role: 'option',
    'aria-selected': index === 0 ? 'true' : 'false',
    text: member.user.username,
  })));
  mentionBox.hidden = matches.length === 0;
}

function applyMention(member) {
  const value = composer.value;
  composer.value = value.replace(/@([0-9A-Za-z_.]*)$/, '@' + member.user.username + ' ');
  closeMentions();
  composer.focus();
  saveDraft();
}

function updateMentions() {
  const match = /@([0-9A-Za-z_.]*)$/.exec(composer.value);
  if (!match || !state.members) {
    closeMentions();
    return;
  }
  const prefix = match[1].toLowerCase();
  const matches = state.members
    .filter((member) => member.user.id !== state.self.id &&
      member.user.username.toLowerCase().startsWith(prefix))
    .slice(0, 8);
  drawMentions(matches);
}

// --- live delivery --------------------------------------------------------

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function handleEvent(event) {
  if (!state.liveReady) {
    state.buffered.push(event);
    return;
  }
  const data = event.data || {};
  switch (event.type) {
    case 'message_create':
    case 'message_update': {
      const message = data.message;
      if (!message) return;
      if (message.channel_id === state.channelId) {
        putMessage(message, { entering: event.type === 'message_create' });
      } else if (state.messages.has(message.id)) {
        state.messages.set(message.id, message);
        refreshSearchRow(message);
      }
      if (state.threadParentId === message.id) drawThreadParent(message);
      break;
    }
    case 'message_delete':
      dropMessage(data.message_id);
      break;
    case 'reaction_update': {
      const message = state.messages.get(data.message_id);
      if (message) {
        message.reactions = data.reactions;
        putMessage(message);
      }
      break;
    }
    case 'notification_create':
    case 'notification_remove':
      await refreshInboxInPlace();
      break;
    case 'presence_update':
    case 'membership_update':
      await loadMembers();
      break;
    case 'timeout_update':
      if (state.self && data.user_id === state.self.id) {
        state.timeoutUntil = data.communication_disabled_until;
        applyComposerState();
      }
      break;
    case 'access_update':
      await followAccessChange();
      break;
    default:
      break;
  }
}

async function followAccessChange() {
  const answer = await call('/api/servers/' + state.slug);
  if (!answer.ok || !answer.data.me) {
    window.location.href = '/servers';
    return;
  }
  state.community = answer.data;
  drawChannels();
  const stillThere = answer.data.channels.some((channel) => channel.id === state.channelId);
  if (!stillThere) {
    const first = answer.data.channels.find((channel) => channel.type === 'text');
    if (first) window.location.href = `/channels/${state.community.id}/${first.id}`;
    else window.location.href = '/servers';
    return;
  }
  await loadPermissions();
  await loadRail();
  await refreshInboxInPlace();
}

async function resync() {
  const answer = await call('/api/channels/' + state.channelId + '/messages?limit=50');
  if (!answer.ok) return;
  const fresh = answer.data.data;
  const keep = new Set(fresh.map((message) => message.id));
  const oldest = fresh.length ? fresh[0].id : 0;
  for (const id of state.order.slice()) {
    if (id >= oldest && !keep.has(id)) dropMessage(id);
  }
  for (const message of fresh) putMessage(message, { entering: !state.messages.has(message.id) });
}

function liveAddress() {
  const scheme = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  return scheme + window.location.host + '/api/live';
}

// One live connection, reopened at least every two seconds while it is down.
async function connectLive() {
  while (true) {
    state.liveReady = false;
    await new Promise((resolve) => {
      let socket;
      try {
        socket = new WebSocket(liveAddress(), ['bearer', token()]);
      } catch (error) {
        resolve('failed');
        return;
      }
      state.live = socket;
      socket.addEventListener('open', async () => {
        try {
          await resync();
          await followAccessChange();
        } catch (error) {
          // whatever was missed is caught up by the next connection
        }
        state.liveReady = true;
        const buffered = state.buffered.slice();
        state.buffered = [];
        for (const event of buffered) await handleEvent(event);
        if (state.connected) say('Connected.');
        state.connected = true;
      });
      socket.addEventListener('message', (event) => {
        handleEvent(JSON.parse(event.data));
      });
      socket.addEventListener('close', () => resolve('closed'));
      socket.addEventListener('error', () => resolve('failed'));
    });
    state.liveReady = false;
    say('Reconnecting…');
    try {
      const answer = await api('/api/users/@me');
      if (answer.status === 401) {
        toLogin();
        return;
      }
    } catch (error) {
      // still offline: the loop tries again below
    }
    await sleep(1000);
  }
}

// The browser reporting itself offline is a dropped connection, whatever the socket says.
window.addEventListener('offline', () => {
  state.liveReady = false;
  say('Reconnecting…');
});

window.addEventListener('online', () => {
  if (state.live) state.live.close();
});

// --- layout and panels ----------------------------------------------------

function layout() {
  if (window.matchMedia('(min-width: 1280px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'phone';
}

function applyLayout() {
  const size = layout();
  body.dataset.layout = size;
  openChannels.hidden = size !== 'phone';
  showMembers.hidden = size !== 'tablet';
  if (size === 'phone') {
    channelColumn.hidden = openChannels.getAttribute('aria-expanded') !== 'true';
  } else {
    channelColumn.hidden = false;
    openChannels.setAttribute('aria-expanded', 'false');
  }
  if (size === 'tablet') {
    memberList.hidden = showMembers.getAttribute('aria-expanded') !== 'true';
  } else if (size === 'desktop') {
    memberList.hidden = false;
    showMembers.setAttribute('aria-expanded', 'false');
  } else {
    memberList.hidden = true;
  }
}

showMembers.addEventListener('click', () => {
  const open = showMembers.getAttribute('aria-expanded') === 'true';
  showMembers.setAttribute('aria-expanded', open ? 'false' : 'true');
  applyLayout();
  if (!open) memberList.focus();
});

openChannels.addEventListener('click', () => {
  const open = openChannels.getAttribute('aria-expanded') === 'true';
  openChannels.setAttribute('aria-expanded', open ? 'false' : 'true');
  applyLayout();
});

channelColumn.addEventListener('click', (event) => {
  if (event.target.closest('a') && layout() === 'phone') {
    openChannels.setAttribute('aria-expanded', 'false');
    applyLayout();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (closeTopPanel()) return;
    if (layout() === 'phone' && openChannels.getAttribute('aria-expanded') === 'true') {
      openChannels.setAttribute('aria-expanded', 'false');
      applyLayout();
      openChannels.focus();
      return;
    }
    if (layout() === 'tablet' && showMembers.getAttribute('aria-expanded') === 'true') {
      showMembers.setAttribute('aria-expanded', 'false');
      applyLayout();
      showMembers.focus();
    }
    return;
  }
  if (!event.altKey) return;
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const channels = state.community
    ? state.community.channels.filter((channel) => channel.type === 'text') : [];
  const index = channels.findIndex((channel) => channel.id === state.channelId);
  if (index < 0) return;
  const next = channels[index + (event.key === 'ArrowDown' ? 1 : -1)];
  if (next) {
    event.preventDefault();
    window.location.href = `/channels/${state.community.id}/${next.id}`;
  }
});



// --- composer events ------------------------------------------------------

composer.addEventListener('input', () => {
  saveDraft();
  updateMentions();
});

composer.addEventListener('keydown', (event) => {
  if (!mentionBox.hidden && mentionOptions.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      mentionActive = Math.min(mentionOptions.length - 1,
        Math.max(0, mentionActive + (event.key === 'ArrowDown' ? 1 : -1)));
      Array.from(mentionBox.children).forEach((node, index) => {
        node.setAttribute('aria-selected', index === mentionActive ? 'true' : 'false');
      });
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applyMention(mentionOptions[mentionActive]);
      return;
    }
    if (event.key === 'Escape') {
      closeMentions();
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendFromComposer();
  }
});

mentionBox.addEventListener('click', (event) => {
  const option = event.target.closest('[role="option"]');
  if (!option) return;
  applyMention(mentionOptions[Array.from(mentionBox.children).indexOf(option)]);
});

attachButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  for (const file of Array.from(fileInput.files)) state.pending.push(file);
  fileInput.value = '';
  drawPending();
});

jumpButton.addEventListener('click', () => {
  stream.scrollTop = stream.scrollHeight;
  jumpButton.hidden = true;
});

stream.addEventListener('scroll', async () => {
  if (atBottom()) jumpButton.hidden = true;
  if (stream.scrollTop > 40 || !state.order.length) return;
  const oldest = state.order[0];
  const answer = await call('/api/channels/' + state.channelId +
    '/messages?limit=50&before=' + oldest);
  if (!answer.ok) return;
  const height = stream.scrollHeight;
  for (const message of answer.data.data) putMessage(message);
  stream.scrollTop = stream.scrollHeight - height;
});

// --- boot -----------------------------------------------------------------

async function loadHistory() {
  const answer = await call('/api/channels/' + state.channelId + '/messages?limit=50');
  if (!answer.ok) {
    window.location.href = '/servers';
    return;
  }
  state.messages = new Map();
  state.order = [];
  for (const message of answer.data.data) {
    state.messages.set(message.id, message);
    state.order.push(message.id);
  }
  drawStream();
  stream.scrollTop = stream.scrollHeight;
  const newest = state.order[state.order.length - 1];
  if (newest) {
    await call('/api/channels/' + state.channelId + '/ack', {
      method: 'POST', body: { message_id: newest },
    });
  }
}

async function loadMemberNames() {
  const answer = await api('/api/servers/' + state.slug + '/members');
  if (answer.ok) state.members = answer.data.data;
}

async function boot() {
  if (!token()) {
    window.location.replace('/login?next=' + encodeNext(window.location.pathname));
    return;
  }
  applyLayout();
  window.addEventListener('resize', applyLayout);
  reactionButtons.replaceChildren();
  await loadSelf();
  await loadRail();
  const ready = await loadCommunity();
  if (!ready) {
    window.location.href = '/servers';
    return;
  }
  rememberChannel(window.location.pathname);
  await Promise.all([loadPermissions(), loadHistory(), loadMembers(), loadMemberNames()]);
  await loadNotifications(null);
  restoreDraft();
  const joinedSlug = window.sessionStorage.getItem('hub_joined_slug');
  if (joinedSlug && joinedSlug === state.slug) {
    window.sessionStorage.removeItem('hub_joined_slug');
    say('You joined ' + state.community.name + '.');
  }
  connectLive();
}

boot();
