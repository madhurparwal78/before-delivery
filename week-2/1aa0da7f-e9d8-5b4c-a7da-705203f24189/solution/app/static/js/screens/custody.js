// Custody: reading and checking the entries in the browser, the history table and the scrub timeline.

import { hasWebCrypto, linkDigest, NO_WEB_CRYPTO } from '../chain.js';
import { api, canonicalTime, h, icon, reducedMotion, ruledTable, syncRows } from '../core.js';
import { openDialog } from '../dialogs.js';

const LIVE_MS = 4000;
const STOP_PX = 64;
const REST_MS = 250;
const PAGE_KEYS = 10;

async function checked(entry) {
  if (!hasWebCrypto()) return { entry, verdict: null };
  return { entry, verdict: (await linkDigest(entry.prev_digest, entry)) === entry.digest };
}

// Reads every page, checks each new row, and extends in place. One poll serves the table and the timeline.
export function custodyFeed(screen, exhibitId) {
  const listeners = new Set();
  const feed = {
    rows: [],
    state: 'checking',
    subscribe(listener) {
      listeners.add(listener);
      listener();
    },
    stop() {
      stopped = true;
      stopPolling();
    },
  };
  let stopped = false;
  let first = true;

  async function read() {
    let after = feed.rows.at(-1)?.entry.seq ?? 0;
    const fresh = [];
    do {
      const answer = await api('GET', `/api/exhibits/${exhibitId}/custody?after=${after}`, { background: !first, signal: screen.signal });
      if (stopped) return;
      if (!answer.ok) {
        if (first && answer.status === 404) {
          feed.state = 'missing';
          stopPolling();
          for (const listener of listeners) listener();
        }
        return;
      }
      fresh.push(...await Promise.all(answer.data.entries.map(checked)));
      if (stopped) return;
      after = answer.data.next_after;
    } while (after !== null);
    first = false;
    if (!fresh.length && feed.state === 'ready') return;
    feed.rows.push(...fresh);
    feed.state = 'ready';
    for (const listener of listeners) listener();
  }

  const stopPolling = screen.every(LIVE_MS, read);
  return feed;
}

function stamp(entry) {
  return `${entry.at.slice(0, 10)} ${canonicalTime(entry.at)}`;
}

function verdictMark(verdict) {
  if (verdict === null) return null;
  return verdict
    ? h('span', { class: 'custody-verified' }, icon('check'), 'Verified')
    : h('span', { class: 'custody-altered' }, icon('cross'), 'Altered');
}

function custodyCopy(feed) {
  if (feed.state === 'checking') return 'Checking custody.';
  if (feed.state === 'missing') return 'No exhibit with this id.';
  if (!hasWebCrypto()) return NO_WEB_CRYPTO;
  const failed = feed.rows.find((row) => !row.verdict);
  if (failed) return `Entry ${failed.entry.seq} does not match its digest.`;
  return `${feed.rows.length} entries checked. All match their digests. Run Chain Walk to prove the whole chain.`;
}

const COLUMNS = ['Seq', 'Check', 'Time', 'Actor', 'Action', 'Record'];

// The table and its status, for the exhibit and the auditor review. A caller with both surfaces passes the shared feed.
export function custodyTable(screen, exhibitId, feed = custodyFeed(screen, exhibitId)) {
  const status = h('div', { role: 'status', 'aria-label': 'Custody status', class: 'status-line custody-status' });
  const { table, body, row } = ruledTable('Custody history', COLUMNS);
  const render = ({ entry, verdict }) => row(
    h('span', { class: 'mono' }, String(entry.seq)),
    verdictMark(verdict),
    h('time', {}, stamp(entry)),
    h('span', { class: 'mono' }, entry.actor_id),
    { wide: h('span', { class: 'mono' }, entry.action) },
    { wide: h('span', { class: 'mono' }, entry.target) });
  feed.subscribe(() => {
    const copy = custodyCopy(feed);
    if (status.textContent !== copy) status.textContent = copy;
    syncRows(body, feed.rows, { key: (item) => String(item.entry.seq), signature: (item) => String(item.verdict), render });
  });
  return {
    element: h('div', { class: 'custody-history' }, h('h3', {}, 'Custody history'), status, table),
    stop: () => feed.stop(),
  };
}

function entryDetails(entry, opener) {
  const closer = h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Close entry');
  const fields = ['seq', 'at', 'actor_id', 'session_id', 'action', 'target', 'detail', 'prev_digest', 'digest'];
  const list = h('dl', { class: 'entry-fields' }, fields.flatMap((name) => {
    const value = entry[name];
    return [h('dt', {}, name), h('dd', { class: 'mono' }, value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value))];
  }));
  const dialog = openDialog({ name: 'Custody entry', content: h('div', { class: 'stack' }, list, closer), opener, wide: true });
  closer.focus();
  return dialog;
}

function stopElement({ entry, verdict }) {
  return h('li', { class: 'timeline-stop', 'data-custody-stop': String(entry.seq), 'data-stop-state': 'future' },
    h('span', { class: 'stop-marker', 'aria-hidden': 'true' }),
    h('span', { class: 'stop-words' },
      h('span', { class: 'mono' }, `${entry.seq} ${entry.action}`),
      h('time', {}, stamp(entry))),
    verdictMark(verdict));
}

// `region "Custody timeline"`: 64 pixels of scroll to one stop, with the current stop at the top of the scroller.
export function custodyTimeline(screen, feed) {
  const fill = h('div', { class: 'scrub-fill', 'data-scrub-fill': true });
  const track = h('div', { class: 'scrub-track', 'data-scrub-track': true }, fill);
  const stops = h('ol', { class: 'timeline-stops' });
  const scroller = h('div', { class: 'timeline-scroller', 'data-custody-scroller': true, role: 'group', 'aria-label': 'Custody entries', tabindex: '0' },
    h('div', { class: 'scrub-stage' }, track), stops);
  const slider = h('input', { type: 'range', class: 'scrub-slider', 'aria-label': 'Custody scrub', min: '1', max: '1', step: '1', value: '1' });
  const details = h('button', { type: 'button', class: 'btn' }, 'Entry details');
  const status = h('div', { role: 'status', 'aria-label': 'Custody timeline status', class: 'status-line' });
  const region = h('section', {
    role: 'region',
    'aria-label': 'Custody timeline',
    class: 'custody-timeline',
    'data-scrub-progress': '0',
    'data-scrub-position': '1',
    'data-scrub-total': '0',
    'data-scrub-state': 'settled',
  }, h('h3', {}, 'Custody timeline'), scroller, h('div', { class: 'timeline-controls' }, slider, details), status);

  let position = 1;
  let restTimer = null;
  let glideRun = 0;
  let openEntry = null;
  const total = () => feed.rows.length;

  function glide() {
    glideRun += 1;
    const run = glideRun;
    const gliding = reducedMotion.matches ? [] : region.getAnimations({ subtree: true }).filter((motion) => ['width', 'color'].includes(motion.transitionProperty));
    region.setAttribute('data-scrub-state', gliding.length ? 'moving' : 'settled');
    if (gliding.length) {
      Promise.allSettled(gliding.map((motion) => motion.finished)).then(() => {
        if (run === glideRun) glide();
      });
    }
  }

  function markStops() {
    [...stops.children].forEach((stop, index) => {
      const state = index + 1 < position ? 'past' : index + 1 === position ? 'current' : 'future';
      if (stop.getAttribute('data-stop-state') !== state) stop.setAttribute('data-stop-state', state);
    });
  }

  function sync() {
    const count = total();
    const range = Math.max(count - 1, 0) * STOP_PX;
    const offset = scroller.scrollTop;
    const next = Math.min(Math.round(offset / STOP_PX) + 1, Math.max(count, 1));
    const progress = range ? Math.min(Math.round(1000 * offset / range), 1000) : count ? 1000 : 0;
    const moved = next !== position;
    position = next;
    region.setAttribute('data-scrub-total', String(count));
    region.setAttribute('data-scrub-position', String(position));
    region.setAttribute('data-scrub-progress', String(progress));
    slider.max = String(Math.max(count, 1));
    slider.value = String(position);
    slider.setAttribute('aria-valuetext', `Entry ${position} of ${count}`);
    fill.style.width = `${progress / 10}%`;
    markStops();
    glide();
    return moved;
  }

  function announce() {
    clearTimeout(restTimer);
    const count = total();
    if (position === count) status.textContent = `Latest custody entry. Entry ${count} of ${count}.`;
    else if (position === 1) status.textContent = `Start of custody. Entry 1 of ${count}.`;
    else status.textContent = `Entry ${position} of ${count}.`;
  }

  function moveTo(target, { singleStep = false } = {}) {
    const clamped = Math.min(Math.max(target, 1), Math.max(total(), 1));
    scroller.scrollTop = (clamped - 1) * STOP_PX;
    if (!sync()) return;
    if (singleStep) announce();
    else {
      clearTimeout(restTimer);
      restTimer = setTimeout(announce, REST_MS);
    }
  }

  scroller.addEventListener('scroll', () => {
    if (sync()) {
      clearTimeout(restTimer);
      restTimer = setTimeout(announce, REST_MS);
    }
  }, { passive: true });

  slider.addEventListener('input', () => moveTo(Number(slider.value)));
  slider.addEventListener('keydown', (event) => {
    const moves = {
      ArrowUp: [position + 1, true],
      ArrowRight: [position + 1, true],
      ArrowDown: [position - 1, true],
      ArrowLeft: [position - 1, true],
      PageUp: [position + PAGE_KEYS, false],
      PageDown: [position - PAGE_KEYS, false],
      Home: [1, false],
      End: [total(), false],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveTo(move[0], { singleStep: move[1] });
  });

  region.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const step = { n: 1, p: -1 }[event.key.toLowerCase()];
    if (!step) return;
    event.preventDefault();
    moveTo(position + step, { singleStep: true });
  });

  details.addEventListener('click', () => {
    const row = feed.rows[position - 1];
    if (row) openEntry = entryDetails(row.entry, details);
  });

  feed.subscribe(() => {
    for (const row of feed.rows.slice(stops.children.length)) stops.append(stopElement(row));
    sync();
  });

  const stop = () => {
    clearTimeout(restTimer);
    glideRun += 1;
    openEntry?.close({ returnFocus: false });
  };
  screen.onCleanup(stop);
  return { element: region, stop };
}
