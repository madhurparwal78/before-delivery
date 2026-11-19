/* Workspace boot: navigation, layout, the live connection and the event feed. */
import { S, $, h, icon, status, api, debounce, setSlug } from './workspace-core.js';
import { initStream, loadChannel, catchUp, resetStream, upsertMessage, removeMessage, refreshTools } from './workspace-stream.js';
import { initComposer, refreshComposer, restoreDraft } from './workspace-composer.js';
import {
  initPanels, loadMembers, closePanel, escapeKey, threadMessage, threadDeleted, searchMessage, searchDeleted,
  searchPrune, refreshNotifications,
} from './workspace-panels.js';

const Hub = window.Hub;
let unread = new Map(); // channel id -> read state
let navSignature = '';
let sideOpener = null;
let buffered = [];
let wake = null;
let controller = null;
let lastByte = 0;

/* ---------- rail, channel list, header ---------- */

function renderRail() {
  $('rail-list').replaceChildren(...S.communities.map((c) => h('li', {},
    h('a', { class: 'rail-link', href: `/channels/${c.id}/${c.default_channel_id}`, 'aria-label': c.name,
      'aria-current': c.id === S.communityId ? 'true' : null },
    h('img', { src: c.icon_url, alt: '', width: '48', height: '48' })))));
}

function textChannels() { return S.channels.filter((c) => c.type === 'text'); }

function renderChannels() {
  const signature = JSON.stringify([S.channels, S.channelId, [...unread.entries()]]);
  if (signature === navSignature) return;
  navSignature = signature;
  const nav = $('channels');
  const focused = nav.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
  const groups = [['Text Channels', 'text'], ['Voice Channels', 'voice']];
  nav.replaceChildren(...groups.flatMap(([title, type], i) => {
    const list = S.channels.filter((c) => c.type === type);
    if (!list.length) return [];
    return [h('h2', { id: `group-${i}`, text: title }),
      h('ul', { role: 'list', 'aria-labelledby': `group-${i}` }, list.map((c) => {
        if (type === 'voice') {
          return h('li', {}, h('div', { class: 'voice' }, icon('speaker', 16), h('span', { class: 'name', text: c.name })));
        }
        const state = unread.get(c.id);
        const current = c.id === S.channelId;
        const link = h('a', {
          href: `/channels/${S.communityId}/${c.id}`, class: !current && state && state.unread_count > 0 ? 'unread' : null,
          'aria-current': current ? 'page' : null,
          onclick: (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
            event.preventDefault();
            navigate(S.communityId, c.id);
          },
        }, h('span', { 'aria-hidden': 'true', text: '#' }), h('span', { class: 'name', text: c.name }),
        !current && state && state.mention_count > 0 ? h('span', { class: 'mention-count', 'aria-hidden': 'true', text: String(state.mention_count) }) : null);
        return h('li', {}, link);
      }))];
  }));
  if (focused) nav.querySelector(`[href="${focused}"]`)?.focus();
}

function renderHeader() {
  const channel = S.channels.find((c) => c.id === S.channelId);
  if (channel) S.channelName = channel.name;
  /* The heading appears once the stream is live, so a page that shows it can already animate arrivals. */
  $('title').textContent = S.ready ? S.channelName || '' : '';
  $('title').hidden = !S.ready;
  $('slowmode').textContent = channel && channel.slowmode_seconds > 0
    ? `Slowmode is on: one message every ${channel.slowmode_seconds} seconds.` : '';
  $('community-name').textContent = S.community ? S.community.name : '';
  document.title = `#${S.channelName || ''} - ${S.community ? S.community.name : 'Workspace'} - Community Hub`;
}

function renderUserBar() {
  $('user-bar').replaceChildren(
    h('img', { src: S.me.avatar_url, alt: '', width: '32', height: '32' }),
    h('span', { class: 'who', text: S.me.display_name }),
    h('a', { href: '/settings', class: 'icon-btn', 'aria-label': 'Settings' }, icon('sliders', 18)));
}

/* ---------- data ---------- */

async function loadCommunity() {
  const res = await api('GET', `/api/servers/${S.slug}`);
  if (res.status === 404 || res.status === 403) { location.replace('/servers'); return false; }
  if (!res.ok) return false;
  S.community = res.data;
  S.channels = res.data.channels;
  const until = res.data.me ? res.data.me.communication_disabled_until : null;
  S.timeoutUntil = until ? Date.parse(until) : null;
  renderChannels();
  renderHeader();
  return true;
}

async function refreshPermissions() {
  const channelId = S.channelId;
  const res = await api('GET', `/api/channels/${channelId}/permissions`);
  if (channelId !== S.channelId) return;
  S.perms = new Set(res.ok ? res.data.permissions : []);
  refreshTools();
  refreshComposer();
}

async function loadReadStates() {
  const res = await api('GET', `/api/servers/${S.slug}/read-states`);
  if (!res.ok) return;
  unread = new Map(res.data.data.map((r) => [r.channel_id, r]));
  renderChannels();
}
const reloadReadStates = debounce(loadReadStates, 300);
S.hooks.readStatesChanged = reloadReadStates;
// The composer is redrawn once both reads have landed: either may finish first, and the time-out lives in one, send_messages in the other.
S.hooks.refreshAccess = () => Promise.all([loadCommunity(), refreshPermissions()]).then(refreshComposer);

function setLost(lost) {
  S.lost = lost;
  $('start').textContent = lost ? 'You can no longer view this channel.' : 'This is the start of the channel.';
  if (lost) {
    resetStream();
    $('start').hidden = false;
    S.perms = new Set();
    closePanel('thread', false);
    refreshComposer();
  }
}

async function loadChannelData() {
  setLost(false);
  await Promise.all([refreshPermissions(), loadChannel()]);
  restoreDraft();
  refreshComposer();
  Hub.rememberChannel(`/channels/${S.communityId}/${S.channelId}`);
}

function applyChannelPresence() {
  const present = S.channels.some((c) => c.id === S.channelId);
  if (!present && !S.lost) setLost(true);
  else if (present && S.lost) loadChannelData();
}

/* ---------- navigation ---------- */

function switchChannel(channelId) {
  S.channelId = channelId;
  closePanel('thread', false);
  closeSide(false);
  navSignature = '';
  renderChannels();
  renderHeader();
  loadChannelData();
  loadReadStates();
}

function navigate(communityId, channelId) {
  const path = `/channels/${communityId}/${channelId}`;
  if (communityId !== S.communityId) { location.assign(path); return; }
  if (channelId === S.channelId) { closeSide(false); return; }
  history.pushState({}, '', path);
  switchChannel(channelId);
}
S.hooks.navigate = navigate;

window.addEventListener('popstate', () => {
  const match = /^\/channels\/(\d+)\/(\d+)$/.exec(location.pathname);
  if (!match) return;
  if (Number(match[1]) !== S.communityId) { location.reload(); return; }
  switchChannel(Number(match[2]));
});

/* ---------- layout: phone channel panel, tablet member list ---------- */

function openSide(opener) {
  sideOpener = opener;
  const side = $('side');
  side.classList.remove('is-closing');
  side.classList.add('is-open');
  $('scrim').classList.add('is-open');
  $('open-channels').setAttribute('aria-expanded', 'true');
  side.querySelector('a[aria-current="page"], a')?.focus({ preventScroll: true });
}

function closeSide(restoreFocus) {
  const side = $('side');
  if (!side.classList.contains('is-open')) return;
  side.classList.remove('is-open');
  $('scrim').classList.remove('is-open');
  $('open-channels').setAttribute('aria-expanded', 'false');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    side.classList.add('is-closing');
    const done = () => side.classList.remove('is-closing');
    side.addEventListener('animationend', done, { once: true });
    setTimeout(done, 320);
  }
  if (restoreFocus) (sideOpener || $('open-channels')).focus();
}

function initLayout() {
  $('open-channels').append(icon('menu'));
  $('open-channels').addEventListener('click', (event) => {
    if ($('side').classList.contains('is-open')) closeSide(true); else openSide(event.currentTarget);
  });
  $('scrim').addEventListener('click', () => closeSide(true));
  matchMedia('(min-width: 768px)').addEventListener('change', () => {
    $('side').classList.remove('is-open', 'is-closing');
    $('scrim').classList.remove('is-open');
    $('open-channels').setAttribute('aria-expanded', 'false');
  });
  matchMedia('(min-width: 1280px), (max-width: 767px)').addEventListener('change', () => {
    $('members').classList.remove('is-open', 'is-closing');
    $('show-members').setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (escapeKey(event)) { event.preventDefault(); return; }
      const side = $('side');
      if (side.classList.contains('is-open') && (side.contains(document.activeElement) || document.activeElement === document.body)) {
        event.preventDefault();
        closeSide(true);
      }
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const list = textChannels();
      const index = list.findIndex((c) => c.id === S.channelId);
      const target = list[index + (event.key === 'ArrowDown' ? 1 : -1)];
      event.preventDefault();
      if (target) navigate(S.communityId, target.id);
    }
  });
}

/* ---------- live events ---------- */

const refreshInbox = debounce(refreshNotifications, 120);
const refreshMembers = debounce(loadMembers, 150);

const handleAccess = debounce(async () => {
  if (!S.communities.some((c) => c.id === S.communityId)) { location.replace('/servers'); return; }
  if (!(await loadCommunity())) return;
  applyChannelPresence();
  if (!S.lost) await refreshPermissions();
  searchPrune();
  loadMembers();
  refreshNotifications();
  loadReadStates();
}, 80);

function apply(event) {
  const { type, data } = event;
  if (type === 'message.created' || type === 'message.updated') {
    const msg = data.message;
    if (msg.channel_id === S.channelId) upsertMessage(msg, { animate: type === 'message.created' });
    else reloadReadStates();
    threadMessage(msg);
    if (type === 'message.updated') searchMessage(msg);
  } else if (type === 'message.deleted') {
    if (data.channel_id === S.channelId) removeMessage(data.id);
    threadDeleted(data.id);
    searchDeleted(data.id);
  } else if (type === 'access.changed') {
    S.communities = data.communities;
    renderRail();
    handleAccess();
  } else if (type === 'members.changed') {
    if (data.community_id === S.communityId) refreshMembers();
  } else if (type === 'notifications.changed') {
    refreshInbox();
  } else if (type === 'timeout.changed') {
    if (data.community_id === S.communityId) S.hooks.refreshAccess();
  }
}

async function start() {
  const community = S.communities.find((c) => c.id === S.communityId);
  if (!community) { location.replace('/servers'); return; }
  setSlug(community.slug);
  renderRail();
  if (!(await loadCommunity())) return;
  if (!S.channels.some((c) => c.id === S.channelId)) {
    const fallback = textChannels()[0];
    if (fallback) {
      history.replaceState({}, '', `/channels/${S.communityId}/${fallback.id}`);
      S.channelId = fallback.id;
      renderChannels();
      renderHeader();
    }
  }
  const present = S.channels.some((c) => c.id === S.channelId);
  await Promise.all([loadMembers(), present ? loadChannelData() : setLost(true), refreshNotifications(), loadReadStates()]);
  const joined = sessionStorage.getItem('hub.joined');
  if (joined) { sessionStorage.removeItem('hub.joined'); status(`You joined ${joined}.`); }
  S.ready = true;
  renderHeader();
  const queue = buffered;
  buffered = [];
  queue.forEach(apply);
}

async function reconnected(ready) {
  S.communities = ready.communities;
  if (!S.communities.some((c) => c.id === S.communityId)) { location.replace('/servers'); return; }
  renderRail();
  if (!(await loadCommunity())) return;
  if (S.channels.some((c) => c.id === S.channelId)) {
    if (S.lost) await loadChannelData(); else { await Promise.all([refreshPermissions(), catchUp()]); }
  } else if (!S.lost) setLost(true);
  searchPrune();
  await Promise.all([loadMembers(), refreshNotifications(), loadReadStates()]);
}

function dispatch(event) {
  if (event.type === 'ready') {
    S.communities = event.data.communities;
    if (!S.started) { S.started = true; start(); return; }
    if (S.dropped) reconnected(event.data).then(() => { S.dropped = false; status('Connected.'); });
    return;
  }
  if (!S.ready) buffered.push(event); else apply(event);
}

function markDropped() {
  if (!S.dropped) { S.dropped = true; status('Reconnecting…'); }
}

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    lastByte = performance.now();
    text += decoder.decode(value, { stream: true });
    let end;
    while ((end = text.indexOf('\n\n')) !== -1) {
      const frame = text.slice(0, end);
      text = text.slice(end + 2);
      const payload = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (payload) {
        try { dispatch(JSON.parse(payload)); } catch (error) { console.warn('live event skipped', error); }
      }
    }
  }
}

async function liveLoop() {
  for (;;) {
    const began = performance.now();
    try {
      controller = new AbortController();
      lastByte = performance.now();
      const response = await fetch('/api/live', {
        headers: { Authorization: `Bearer ${Hub.token()}`, Accept: 'text/event-stream' }, signal: controller.signal, cache: 'no-store',
      });
      if (response.status === 401) { Hub.endSession(); return; }
      if (response.ok) await readStream(response);
    } catch { /* the connection dropped: reconnect below */ }
    if (S.started) markDropped();
    if (performance.now() - began < 1000) await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 1000); });
  }
}

function initLive() {
  window.addEventListener('offline', () => { markDropped(); controller?.abort(); });
  window.addEventListener('online', () => wake?.());
  setInterval(() => { if (controller && performance.now() - lastByte > 6000) controller.abort(); }, 2000);
  liveLoop();
}

/* ---------- boot ---------- */

async function boot() {
  if (!Hub.requireSession()) return;
  const [communityId, channelId] = [Number(document.body.dataset.community), Number(document.body.dataset.channel)];
  S.communityId = communityId;
  S.channelId = channelId;
  S.me = Hub.user();
  const me = await api('GET', '/api/users/@me');
  if (me.ok) S.me = me.data;
  if (!S.me) return;
  renderUserBar();
  initLayout();
  initStream();
  initComposer();
  initPanels();
  initLive();
}

boot();
