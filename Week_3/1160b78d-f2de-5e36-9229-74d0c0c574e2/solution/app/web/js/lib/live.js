// The page's one WebSocket, the Live updates region and the Notices for you count.
//
//   import { live } from '../lib/live.js';
//   const off = live.on('incident', (data, message) => {...});   // returns an unsubscribe function
//   live.watch('incident', id);                                  // ask for a per-second countdown (re-sent on reconnect)
//   live.announce('Note added.');                                // append one line to status "Live updates" (last 20 kept)
//
// Opens exactly one socket per page, sends {"type":"hello"} only once it is open, reconnects by itself from the last
// sequence number seen (?after=<seq>) and never handles a replayed message twice. Close code 4401 sends the person to
// sign-in, 4403 reloads the page under their new role (the server routes them).
import { boot } from './boot.js';
import { api } from './api.js';
import { flash } from './flash.js';

const EPHEMERAL = new Set(['clock', 'countdown']);
const KEEP_LINES = 20;
const handlers = new Map();
const watches = new Map();
let socket = null;
let lastSeq = boot.seq ?? 0;
let started = false;
let announceFilter = () => false;
let noticeTimer = null;

function emit(type, data, message) {
  for (const fn of handlers.get(type) ?? []) fn(data, message);
}

function announce(text) {
  const region = document.getElementById('live');
  if (!region || !text) return;
  const line = document.createElement('p');
  line.textContent = text;
  region.append(line);
  while (region.children.length > KEEP_LINES) region.firstElementChild.remove();
}

function refreshNotices() {
  const el = document.getElementById('notices');
  if (!el) return;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(async () => {
    const res = await api.get('/api/me', { keepOn401: true });
    if (res.ok) {
      const text = `${res.data.incidents_needing_you} incidents need you`;
      if (el.textContent !== text) el.textContent = text;
    }
  }, 150);
}

function onMessage(event) {
  const message = JSON.parse(event.data);
  const ephemeral = EPHEMERAL.has(message.type);
  if (!ephemeral) {
    if (message.seq <= lastSeq) return;
    lastSeq = message.seq;
  }
  if (message.type === 'incident') {
    if (message.data.announce && announceFilter(message.data)) announce(message.data.announce);
    refreshNotices();
  }
  emit(message.type, message.data, message);
}

async function onClose(event) {
  socket = null;
  if (event.code === 4401) {
    flash('You have been signed out.');
    location.assign('/sign-in');
    return;
  }
  if (event.code === 4403) {
    const res = await api.get('/api/me', { keepOn401: true });
    if (res.ok) flash(`Your role changed to ${roleLabel(res.data.role)}.`);
    location.assign(location.pathname + location.search);
    return;
  }
  setTimeout(open, 1000);
}

const ROLE_LABELS = { responder: 'Responder', lead: 'Lead', admin: 'Admin', stakeholder: 'Stakeholder' };
function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

function open() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}/api/live?after=${lastSeq}`);
  socket = ws;
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello' }));
    for (const [, frame] of watches) ws.send(JSON.stringify(frame));
  });
  ws.addEventListener('message', onMessage);
  ws.addEventListener('close', onClose);
}

export const live = {
  // start opens the socket; main.js calls it for every signed-in page that has one.
  start(filter) {
    if (started) return;
    started = true;
    if (filter) announceFilter = filter;
    open();
  },
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type).delete(fn);
  },
  watch(scope, id) {
    const frame = { type: 'watch', scope, id };
    watches.set(`${scope}:${id}`, frame);
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  },
  announce,
};
