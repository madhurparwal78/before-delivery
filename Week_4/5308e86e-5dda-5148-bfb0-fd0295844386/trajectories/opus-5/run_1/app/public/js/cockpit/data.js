// The cockpit's shared data: one snapshot of the company's money, one live
// stream, and the refresh rules every cockpit page follows.

import * as api from '../api.js';
import * as session from '../session.js';
import * as router from '../router.js';
import { announce } from '../status.js';

const REFRESH_MS = 10000;
const RAIL_MS = 5000;
const RECONNECT_MS = 2000;

// One browser holds one stream, however many cockpit tabs are open: a browser
// allows only a handful of connections per host. The tab holding the lease
// streams and passes each event to its sister tabs at once.
const LEASE_KEY = 'tallwind.stream_lease';
const LEASE_MS = 4000;
const RENEW_MS = 1500;
const TAB_ID = Math.random().toString(36).slice(2);

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('tallwind-stream') : null;
let leading = false;

function readLease() {
  try {
    return JSON.parse(window.localStorage.getItem(LEASE_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function claimLease() {
  const lease = readLease();
  const now = Date.now();
  if (lease && lease.id !== TAB_ID && lease.until > now) return false;
  try {
    window.localStorage.setItem(LEASE_KEY, JSON.stringify({ id: TAB_ID, until: now + LEASE_MS }));
  } catch (error) {
    return true;
  }
  const confirmed = readLease();
  return Boolean(confirmed && confirmed.id === TAB_ID);
}

function releaseLease() {
  const lease = readLease();
  if (lease && lease.id === TAB_ID) {
    try {
      window.localStorage.removeItem(LEASE_KEY);
    } catch (error) {
      /* storage is unavailable */
    }
  }
  leading = false;
}

export const state = {
  me: null,
  accounts: [],
  snapshot: null,
  approvalsWaiting: 0,
  approvals: [],
  companyName: '',
  outage: false,
};

const listeners = new Set();
let timers = [];
let streamAbort = null;
let lastEventId = null;
let running = false;
let announcedOutage = false;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event) {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      /* a page that has gone */
    }
  }
}

function noteOutage() {
  state.outage = true;
  if (!announcedOutage) {
    announcedOutage = true;
    announce(api.OUTAGE_MESSAGE);
  }
  emit({ type: 'outage' });
}

function noteRecovery() {
  if (!state.outage) return;
  state.outage = false;
  announcedOutage = false;
  announce(api.RECOVERY_MESSAGE);
  emit({ type: 'recovered' });
}

// A refresh that fails never replaces a figure that is already shown.
export async function refreshMoney() {
  if (!session.signedIn()) return;
  const [accounts, snapshot] = await Promise.all([
    api.get('/api/accounts'),
    api.get('/api/snapshot'),
  ]);
  if (accounts.aborted || snapshot.aborted || accounts.revoked || snapshot.revoked) return;
  if (api.isOutage(accounts) || api.isOutage(snapshot)) {
    noteOutage();
    return;
  }
  if (accounts.status !== 200 || snapshot.status !== 200) return;
  state.accounts = accounts.json.accounts;
  state.snapshot = snapshot.json;
  noteRecovery();
  emit({ type: 'money' });
}

export async function refreshApprovals() {
  if (!session.signedIn()) return;
  const answer = await api.get('/api/approvals');
  if (answer.aborted || answer.revoked || answer.status !== 200) return;
  const waiting = answer.json.approvals.length;
  const changed = waiting !== state.approvalsWaiting;
  state.approvalsWaiting = waiting;
  state.approvals = answer.json.approvals;
  emit({ type: 'approvals', changed });
}

export async function refreshMe() {
  const answer = await api.get('/api/me');
  if (answer.status === 200) {
    state.me = answer.json;
    state.companyName = answer.json.user.company_name || '';
    session.setUser(answer.json.user);
    noteRecovery();
  } else if (api.isOutage(answer)) noteOutage();
  return answer;
}

function broadcast(message) {
  if (channel) channel.postMessage(message);
}

// The tab that holds the lease reads the stream; the others wait for its events.
async function leadOrFollow() {
  while (running && session.signedIn()) {
    if (claimLease()) {
      leading = true;
      await readStream();
      if (!running) return;
    } else {
      leading = false;
      await wait(RENEW_MS);
    }
  }
}

async function readStream() {
  while (running && leading && session.signedIn()) {
    const token = session.token();
    if (!token) return;
    streamAbort = new AbortController();
    let response;
    try {
      const address = `/api/stream?token=${encodeURIComponent(token)}${
        lastEventId ? `&last_event_id=${encodeURIComponent(lastEventId)}` : ''
      }`;
      response = await fetch(address, { signal: streamAbort.signal });
    } catch (error) {
      if (!running) return;
      await wait(RECONNECT_MS);
      continue;
    }
    if (response.status === 401) {
      broadcast({ type: 'revoked' });
      router.handleRevoked();
      return;
    }
    if (response.status !== 200 || !response.body) {
      await wait(RECONNECT_MS);
      continue;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop();
        for (const block of blocks) {
          const id = /^id: (.+)$/m.exec(block);
          const data = /^data: (.+)$/m.exec(block);
          if (!id || !data) continue;
          lastEventId = id[1];
          let transaction = null;
          try {
            transaction = JSON.parse(data[1]);
          } catch (error) {
            continue;
          }
          broadcast({ type: 'transaction', transaction, eventId: lastEventId });
          emit({ type: 'transaction', transaction });
          refreshMoney();
          refreshApprovals();
        }
      }
    } catch (error) {
      /* the connection dropped; reconnect below */
    }
    if (!running) return;
    await wait(RECONNECT_MS);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timers.push(timer);
  });
}

function onChannelMessage(event) {
  if (!running) return;
  const message = event.data || {};
  if (message.type === 'revoked') {
    router.handleRevoked();
    return;
  }
  if (message.type !== 'transaction') return;
  if (message.eventId) lastEventId = message.eventId;
  emit({ type: 'transaction', transaction: message.transaction });
  refreshMoney();
  refreshApprovals();
}

export function start() {
  if (running) return;
  running = true;
  announcedOutage = false;
  refreshMe();
  refreshMoney();
  refreshApprovals();
  timers.push(setInterval(() => refreshMoney(), REFRESH_MS));
  timers.push(setInterval(() => refreshApprovals(), RAIL_MS));
  timers.push(
    setInterval(() => {
      if (leading) claimLease();
    }, RENEW_MS)
  );
  if (channel) channel.onmessage = onChannelMessage;
  window.addEventListener('pagehide', releaseLease);
  leadOrFollow();
}

// Signing out, and a revoked session, stop every timer, the stream and every
// company-scoped value the page holds.
export function stop() {
  running = false;
  for (const timer of timers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  timers = [];
  if (streamAbort) streamAbort.abort();
  streamAbort = null;
  lastEventId = null;
  if (channel) channel.onmessage = null;
  window.removeEventListener('pagehide', releaseLease);
  releaseLease();
  listeners.clear();
  state.me = null;
  state.accounts = [];
  state.snapshot = null;
  state.approvals = [];
  state.approvalsWaiting = 0;
  state.companyName = '';
  state.outage = false;
  announcedOutage = false;
}

export function accountById(id) {
  return state.accounts.find((account) => account.id === id) || null;
}

export function perAccount(id) {
  if (!state.snapshot) return null;
  return state.snapshot.per_account.find((entry) => entry.account_id === id) || null;
}
