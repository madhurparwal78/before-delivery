/** Custody history: the table, the browser's own check and the scrubbed timeline. */

import { get } from './api.js';
import { entryCanonical, entryDigest, hasCrypto } from './canon.js';
import { announce, clear, el, reducedMotion, takeFocus, verdictCell } from './dom.js';
import { openDialog } from './dialog.js';
import { syncRows, table } from './ui.js';

const NO_CRYPTO =
  'Cannot verify in this browser. Open Wardline over HTTPS or on this machine.';
const STOP_HEIGHT = 64;
const SCROLLER_HEIGHT = 320;

export function mountCustody(host, exhibitId, options = {}) {
  const withTimeline = options.withTimeline !== false;
  const status = el('p', {
    role: 'status',
    'aria-label': 'Custody status',
    'aria-live': 'polite',
  });
  const history = table('Custody history', [
    'Seq',
    'At',
    'Actor',
    'Session',
    'Action',
    'Target',
    'Check',
  ]);
  let timeline = null;
  if (withTimeline) {
    timeline = buildTimeline();
    host.append(timeline.region);
  }
  host.append(history.node, status);

  let entries = [];
  let verdicts = new Map();
  let dead = false;

  async function load(background = true) {
    if (dead) return;
    announce(status, 'Checking custody.');
    const collected = [];
    let after = 0;
    for (let page = 0; page < 50; page += 1) {
      const reply = await get(
        `/api/exhibits/${encodeURIComponent(exhibitId)}/custody?after=${after}&limit=200`,
        { background }
      );
      if (reply.status === 404) {
        announce(status, 'No exhibit with this id.');
        status.classList.add('refusal');
        dead = true;
        return;
      }
      if (reply.status !== 200) return;
      collected.push(...reply.body.entries);
      if (reply.body.next_after === null || reply.body.next_after === undefined) break;
      after = reply.body.next_after;
    }
    entries = collected;
    verdicts = new Map();
    if (!hasCrypto()) {
      announce(status, NO_CRYPTO);
    } else {
      let firstBad = null;
      for (const entry of entries) {
        const digest = await entryDigest(entry.prev_digest, entry);
        const ok = digest === entry.digest;
        verdicts.set(entry.seq, ok);
        if (!ok && firstBad === null) firstBad = entry.seq;
      }
      if (firstBad === null) {
        status.classList.remove('refusal');
        announce(
          status,
          `${entries.length} entries checked. All match their digests. Run Chain Walk to prove the whole chain.`
        );
      } else {
        status.classList.add('refusal');
        announce(status, `Entry ${firstBad} does not match its digest.`);
      }
    }
    renderTable();
    if (timeline) timeline.update(entries, verdicts);
  }

  function renderTable() {
    syncRows(history.body, entries, {
      key: (entry) => entry.seq,
      signature: (entry) => `${entry.digest}|${verdicts.get(entry.seq)}`,
      build: (entry) =>
        el('tr', {}, [
          el('td', { class: 'mono', text: String(entry.seq) }),
          el('td', { class: 'mono', text: entry.at }),
          el('td', { class: 'mono', text: entry.actor_id }),
          el('td', { class: 'mono', text: entry.session_id || '-' }),
          el('td', { text: entry.action }),
          el('td', { class: 'mono', text: entry.target }),
          el('td', {}, [verdictCell(verdicts.get(entry.seq) !== false)]),
        ]),
    });
  }

  return { load, node: history.node, status };
}

function buildTimeline() {
  const scroller = el('div', { dataset: { custodyScroller: 'true' } });
  const stops = el('div');
  const spacer = el('div');
  scroller.append(stops, spacer);
  const fill = el('span', { dataset: { scrubFill: 'true' } });
  const track = el('span', { dataset: { scrubTrack: 'true' } }, [fill]);
  const slider = el('input', {
    type: 'range',
    'aria-label': 'Custody scrub',
    min: '1',
    max: '1',
    value: '1',
    step: '1',
  });
  const timelineStatus = el('p', {
    role: 'status',
    'aria-label': 'Custody timeline status',
    'aria-live': 'polite',
  });
  const details = el('button', {
    type: 'button',
    text: 'Entry details',
    on: { click: openDetails },
  });
  const region = el(
    'section',
    {
      role: 'region',
      'aria-label': 'Custody timeline',
      dataset: {
        scrubProgress: '0',
        scrubPosition: '1',
        scrubTotal: '0',
        scrubState: 'settled',
      },
    },
    [el('h3', { text: 'Custody timeline' }), track, scroller, slider, details, timelineStatus]
  );

  let entries = [];
  let verdicts = new Map();
  let settleTimer = null;
  let restTimer = null;

  function total() {
    return entries.length;
  }

  function range() {
    return Math.max(0, (total() - 1) * STOP_HEIGHT);
  }

  function fitSpacer() {
    const visible = scroller.clientHeight || SCROLLER_HEIGHT;
    spacer.style.height = Math.max(0, visible - STOP_HEIGHT) + 'px';
  }

  function update(nextEntries, nextVerdicts) {
    const keepOffset = scroller.scrollTop;
    fitSpacer();
    entries = nextEntries;
    verdicts = nextVerdicts;
    syncRows(stops, entries, {
      key: (entry) => entry.seq,
      signature: (entry) => `${entry.digest}|${verdicts.get(entry.seq)}`,
      build: (entry) =>
        el(
          'div',
          {
            dataset: { custodyStop: String(entry.seq), stopState: 'future' },
          },
          [
            el('span', { class: 'mono', text: String(entry.seq) }),
            el('span', { text: entry.action }),
            verdictCell(verdicts.get(entry.seq) !== false),
          ]
        ),
    });
    slider.max = String(Math.max(1, total()));
    region.dataset.scrubTotal = String(total());
    fitSpacer();
    scroller.scrollTop = Math.min(keepOffset, range());
    paint(true);
  }

  function position() {
    if (total() <= 1) return 1;
    return Math.min(total(), Math.round(scroller.scrollTop / STOP_HEIGHT) + 1);
  }

  function progress() {
    if (total() <= 1 || range() === 0) return 1000;
    return Math.round((1000 * scroller.scrollTop) / range());
  }

  function paint(immediate) {
    const spot = position();
    const share = progress();
    region.dataset.scrubPosition = String(spot);
    region.dataset.scrubProgress = String(share);
    slider.value = String(spot);
    slider.setAttribute('aria-valuetext', `Entry ${spot} of ${total()}`);
    fill.style.width = share / 10 + '%';
    for (const stop of Array.from(stops.children)) {
      const seq = Number(stop.dataset.custodyStop);
      const index = entries.findIndex((entry) => entry.seq === seq) + 1;
      stop.dataset.stopState =
        index < spot ? 'past' : index === spot ? 'current' : 'future';
    }
    clearTimeout(settleTimer);
    if (immediate || reducedMotion()) {
      region.dataset.scrubState = 'settled';
    } else {
      region.dataset.scrubState = 'moving';
      settleTimer = setTimeout(() => {
        region.dataset.scrubState = 'settled';
      }, 260);
    }
  }

  function copyFor(spot) {
    if (total() === 0) return '';
    if (spot >= total()) return `Latest custody entry. Entry ${total()} of ${total()}.`;
    if (spot === 1) return `Start of custody. Entry 1 of ${total()}.`;
    return `Entry ${spot} of ${total()}.`;
  }

  function rest(immediately) {
    clearTimeout(restTimer);
    if (immediately) {
      announce(timelineStatus, copyFor(position()));
      return;
    }
    restTimer = setTimeout(() => announce(timelineStatus, copyFor(position())), 250);
  }

  window.addEventListener('resize', fitSpacer);
  scroller.addEventListener('scroll', () => {
    paint(false);
    rest(false);
  });

  function moveTo(spot, immediate) {
    const target = Math.max(1, Math.min(total() || 1, spot));
    scroller.scrollTop = (target - 1) * STOP_HEIGHT;
    paint(false);
    rest(immediate);
  }

  slider.addEventListener('keydown', (event) => {
    const spot = position();
    const steps = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: 10,
      PageDown: -10,
    };
    if (event.key in steps) {
      event.preventDefault();
      moveTo(spot + steps[event.key], Math.abs(steps[event.key]) === 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      moveTo(1, false);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(total(), false);
    }
  });
  slider.addEventListener('input', () => moveTo(Number(slider.value), true));

  region.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const tag = event.target.tagName;
    if (tag === 'INPUT' && event.target.type !== 'range') return;
    if (tag === 'TEXTAREA') return;
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      moveTo(position() + 1, true);
    } else if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      moveTo(position() - 1, true);
    }
  });

  function openDetails() {
    const entry = entries[position() - 1];
    if (!entry) return;
    openDialog({
      label: 'Custody entry',
      opener: details,
      build: (node, handle) => {
        node.append(
          el('h3', { text: `Entry ${entry.seq}` }),
          el('pre', { class: 'mono digest', text: entryCanonical(entry) }),
          el('p', { class: 'mono digest', text: `digest ${entry.digest}` }),
          el('p', { class: 'mono digest', text: `prev ${entry.prev_digest}` }),
          el('button', {
            type: 'button',
            text: 'Close entry',
            on: { click: () => handle.close() },
          })
        );
      },
    });
  }

  return { region, update };
}
