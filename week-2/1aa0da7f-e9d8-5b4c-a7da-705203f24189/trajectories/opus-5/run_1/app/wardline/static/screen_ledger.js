/** Chain Walk: the browser proves the chain link by link. */

import { get } from './api.js';
import { hasCrypto, ZERO_DIGEST } from './canon.js';
import { DASH, linkVerdict } from './chain.js';
import { announce, clear, el, reducedMotion } from './dom.js';

const PIXELS_PER_LINK = 72;
const MARK_WINDOW = 150;
const SETTLE_TOTAL = 480;
const STORE_KEY = 'wardline-walk';
const NO_CRYPTO =
  'Cannot verify in this browser. Open Wardline over HTTPS or on this machine.';
const ANCHOR_SHAPE = /^wardline-anchor:v1:([1-9][0-9]*):([0-9a-f]{64})$/;

function loadMemory() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { high: 0, digest: null, anchors: {} };
    const parsed = JSON.parse(raw);
    return {
      high: parsed.high || 0,
      digest: parsed.digest || null,
      anchors: parsed.anchors || {},
    };
  } catch (error) {
    return { high: 0, digest: null, anchors: {} };
  }
}

function saveMemory(memory) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(memory));
  } catch (error) {
    /* a browser that refuses storage still walks */
  }
}

export default {
  async mount(context) {
    const host = context.page;
    const memory = loadMemory();
    const figure = el('span', { dataset: { figure: 'true' }, text: '0' });
    const walkResult = el('p', {
      role: 'status',
      'aria-label': 'Walk result',
      'aria-live': 'polite',
    });
    const anchorStatus = el('p', {
      role: 'status',
      'aria-label': 'Anchor status',
      'aria-live': 'polite',
    });
    const cells = el('div', { class: 'cells' });
    const cellNodes = [];
    for (let index = 0; index < 64; index += 1) {
      const cell = el('span', { dataset: { digestCell: String(index) }, text: '0' });
      cellNodes.push(cell);
      cells.append(cell);
    }
    const panel = el(
      'section',
      {
        id: 'digest-panel',
        role: 'region',
        'aria-label': 'Digest panel',
        dataset: { digestState: 'settled' },
      },
      [el('h2', { text: 'Digest' }), cells]
    );
    const slider = el('input', {
      type: 'range',
      'aria-label': 'Ledger walk',
      min: '0',
      max: '0',
      value: '0',
      step: '1',
    });
    const marks = el('div', { style: 'position:relative' });
    const breakText = el('p', { class: 'break-text', hidden: true });
    const rail = el('div', { id: 'rail' }, [slider, breakText, marks]);
    const currentAnchor = el('input', {
      type: 'text',
      readOnly: true,
      'aria-label': 'Current anchor',
      value: '',
    });
    const copyAnchor = el('button', {
      type: 'button',
      text: 'Copy anchor',
      disabled: true,
      on: { click: copyNow },
    });
    const anchorToCheck = el('input', { type: 'text', 'aria-label': 'Anchor to check' });
    const checkAnchor = el('button', {
      type: 'button',
      text: 'Check anchor',
      on: { click: checkNow },
    });
    const anchors = el('div', {}, [
      el('h2', { text: 'Anchors' }),
      el('label', { text: 'Current anchor' }),
      currentAnchor,
      copyAnchor,
      el('label', { text: 'Anchor to check' }),
      anchorToCheck,
      checkAnchor,
      anchorStatus,
    ]);
    const region = el(
      'section',
      {
        role: 'region',
        'aria-label': 'Chain Walk',
        dataset: { verifiedThrough: '0', linkState: 'idle' },
      },
      [
        figure,
        el('span', { dataset: { figureLabel: 'true' }, text: 'Verified through' }),
        el('h1', { text: 'Chain Walk' }),
        el('a', { href: '/audit/chain', 'data-route': 'true', text: 'Chain lattice' }),
        walkResult,
        el('div', { class: 'walk' }, [rail, el('div', {}, [panel, anchors])]),
      ]
    );
    host.append(region);

    const walk = {
      count: 0,
      rows: [],
      computed: [],
      verified: 0,
      head: 0,
      breakAt: null,
      maxReach: 0,
      fetchedAll: false,
    };
    let settleTimers = [];
    let restTimer = null;
    let hashing = Promise.resolve();
    let disposed = false;

    function setLinkState(value) {
      region.dataset.linkState = value;
    }

    function cancelSettle() {
      for (const timer of settleTimers) clearTimeout(timer);
      settleTimers = [];
    }

    function paintCells(value, compare) {
      cancelSettle();
      const characters = value.split('');
      const against = compare ? compare.split('') : null;
      const immediate = reducedMotion();
      panel.dataset.digestState = immediate ? 'settled' : 'settling';
      const show = (index) => {
        const cell = cellNodes[index];
        cell.textContent = characters[index];
        if (against && characters[index] !== against[index]) {
          cell.dataset.differs = 'true';
        } else {
          delete cell.dataset.differs;
        }
        delete cell.dataset.firstBreak;
      };
      if (immediate) {
        for (let index = 0; index < 64; index += 1) show(index);
        markFirstBreak(against, characters);
        return;
      }
      for (let index = 0; index < 64; index += 1) {
        settleTimers.push(
          setTimeout(() => {
            show(index);
            if (index === 63) {
              panel.dataset.digestState = 'settled';
              markFirstBreak(against, characters);
            }
          }, Math.round((SETTLE_TOTAL / 64) * index))
        );
      }
    }

    function markFirstBreak(against, characters) {
      if (!against) return;
      for (let index = 0; index < 64; index += 1) {
        if (characters[index] !== against[index]) {
          cellNodes[index].dataset.firstBreak = 'true';
          return;
        }
      }
    }

    async function fetchMore() {
      if (walk.fetchedAll) return false;
      const lastSeq = walk.rows.length ? walk.rows[walk.rows.length - 1].seq : 0;
      const reply = await get(`/api/ledger?after=${lastSeq}&limit=200`, {
        background: true,
      });
      if (reply.status !== 200) return false;
      walk.count = reply.body.count;
      if (!reply.body.entries.length) {
        walk.fetchedAll = true;
        return false;
      }
      walk.rows.push(...reply.body.entries);
      updateReach();
      return true;
    }

    function updateReach() {
      const beyond = memory.high > walk.count || anchorBeyond();
      walk.maxReach = walk.count + (beyond ? 1 : 0);
      slider.max = String(walk.maxReach);
      drawMarks();
      rail.style.minHeight = walk.maxReach * PIXELS_PER_LINK + 'px';
      marks.style.height = walk.maxReach * PIXELS_PER_LINK + 'px';
    }

    function anchorBeyond() {
      return Object.keys(memory.anchors).some((key) => Number(key) > walk.count);
    }

    function rememberedFor(link) {
      if (memory.anchors[String(link)]) return memory.anchors[String(link)];
      if (memory.high === link && memory.digest) return memory.digest;
      return null;
    }

    /** Hashes every link up to n, stopping at the first break. */
    async function reach(target) {
      if (!hasCrypto()) return;
      while (walk.computed.length < target && walk.breakAt === null) {
        const link = walk.computed.length + 1;
        if (walk.rows.length < link) {
          const more = await fetchMore();
          if (!more) {
            const beyond = memory.high > walk.count || anchorBeyond();
            if (beyond && link > walk.count) {
              walk.breakAt = link;
              walk.breakCells = { value: DASH, compare: '#'.repeat(64) };
            }
            return;
          }
          continue;
        }
        const entry = walk.rows[link - 1];
        const previousSeq = link === 1 ? 0 : walk.rows[link - 2].seq;
        const previous = link === 1 ? ZERO_DIGEST : walk.computed[link - 2];
        const verdict = await linkVerdict(
          link,
          entry,
          previousSeq,
          previous,
          rememberedFor(link)
        );
        if (verdict.broken) {
          walk.breakAt = verdict.named;
          walk.breakCells = { value: verdict.value, compare: verdict.compare };
          return;
        }
        walk.computed.push(verdict.digest);
        const digest = verdict.digest;
        if (link > walk.verified) {
          walk.verified = link;
          if (link > memory.high) {
            memory.high = link;
            memory.digest = digest;
            saveMemory(memory);
          }
        }
      }
    }

    function drawMarks() {
      const from = Math.max(1, walk.head - MARK_WINDOW);
      const to = Math.min(walk.maxReach, Math.max(walk.head + MARK_WINDOW, from + 299));
      clear(marks);
      for (let link = from; link <= to && link - from < 300; link += 1) {
        const verdict =
          walk.breakAt === link
            ? 'broken'
            : link <= walk.verified
            ? 'verified'
            : 'idle';
        const mark = el(
          'div',
          {
            class: 'link-mark',
            dataset: { linkMark: String(link), verdict },
            style: `position:absolute;top:${(link - from) * PIXELS_PER_LINK}px;left:0;right:0`,
          },
          [
            el('span', { text: `Link ${link}` }),
            el('span', {
              text:
                verdict === 'verified'
                  ? '\u2713 Verified'
                  : verdict === 'broken'
                  ? '\u2717 Break'
                  : '',
            }),
          ]
        );
        marks.append(mark);
      }
      marks.style.paddingTop = (from - 1) * PIXELS_PER_LINK + 'px';
    }

    function anchorValue() {
      if (!walk.verified) return '';
      return `wardline-anchor:v1:${walk.verified}:${walk.computed[walk.verified - 1]}`;
    }

    function paintHead(announceNow) {
      const link = walk.head;
      figure.textContent = String(walk.verified);
      region.dataset.verifiedThrough = String(
        walk.breakAt !== null && walk.head === walk.breakAt
          ? Math.max(0, walk.breakAt - 1)
          : walk.verified
      );
      slider.value = String(link);
      slider.setAttribute('aria-valuetext', `Link ${link} of ${walk.count}`);
      currentAnchor.value = anchorValue();
      copyAnchor.disabled = currentAnchor.value === '';
      if (walk.breakAt !== null) {
        breakText.hidden = false;
        breakText.textContent = `Break at link ${walk.breakAt}`;
      }
      drawMarks();
      if (link === 0) {
        setLinkState('idle');
        paintCells('0'.repeat(64), null);
        if (announceNow) announce(walkResult, 'Start of the chain.');
        return;
      }
      if (!hasCrypto()) {
        setLinkState('idle');
        if (announceNow) announce(walkResult, NO_CRYPTO);
        return;
      }
      if (walk.breakAt !== null && link === walk.breakAt) {
        setLinkState('broken');
        paintCells(walk.breakCells.value, walk.breakCells.compare);
        if (announceNow) announce(walkResult, `Break at link ${walk.breakAt}.`);
        return;
      }
      setLinkState('verified');
      paintCells(walk.computed[link - 1] || '0'.repeat(64), null);
      if (announceNow) announce(walkResult, `Link ${link} verified.`);
    }

    async function moveHead(target, single) {
      const wanted = Math.max(0, Math.min(walk.maxReach, Math.round(target)));
      cancelSettle();
      walk.head = wanted;
      hashing = hashing.then(() => reach(wanted));
      await hashing;
      if (disposed) return;
      if (walk.breakAt !== null && walk.head > walk.breakAt) {
        walk.head = walk.breakAt;
      }
      syncScroll();
      if (single) {
        paintHead(true);
        return;
      }
      paintHead(false);
      clearTimeout(restTimer);
      const resting = walk.head;
      restTimer = setTimeout(() => {
        if (walk.head === resting) paintHead(true);
      }, 250);
    }

    let syncing = false;
    function syncScroll() {
      const top = rail.getBoundingClientRect().top + window.scrollY;
      syncing = true;
      window.scrollTo({ top: top + walk.head * PIXELS_PER_LINK, behavior: 'auto' });
      setTimeout(() => {
        syncing = false;
      }, 0);
    }

    function onScroll() {
      if (syncing) return;
      const top = rail.getBoundingClientRect().top + window.scrollY;
      const offset = window.scrollY - top;
      const link = Math.max(0, Math.min(walk.maxReach, Math.floor(offset / PIXELS_PER_LINK)));
      if (link === walk.head) return;
      moveHead(link, false);
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    slider.addEventListener('keydown', (event) => {
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
        const size = steps[event.key];
        moveHead(walk.head + size, Math.abs(size) === 1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        moveHead(0, false);
      } else if (event.key === 'End') {
        event.preventDefault();
        moveHead(walk.maxReach, false);
      }
    });
    slider.addEventListener('input', () => moveHead(Number(slider.value), false));
    slider.addEventListener('change', () => moveHead(Number(slider.value), false));

    async function copyNow() {
      const value = currentAnchor.value;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        announce(anchorStatus, 'Anchor copied.');
      } catch (error) {
        currentAnchor.focus();
        currentAnchor.select();
        announce(anchorStatus, 'Anchor selected. Copy it now.');
      }
    }

    async function checkNow() {
      const found = ANCHOR_SHAPE.exec(anchorToCheck.value.trim());
      if (!found) {
        announce(anchorStatus, 'This is not a Wardline anchor.');
        return;
      }
      const link = Number(found[1]);
      const digest = found[2];
      memory.anchors[String(link)] = digest;
      saveMemory(memory);
      updateReach();
      if (link <= walk.verified) {
        if (walk.computed[link - 1] === digest) {
          announce(anchorStatus, `Anchor for link ${link} matches.`);
          return;
        }
        announce(anchorStatus, `Anchor for link ${link} does not match.`);
        walk.breakAt = link;
        walk.breakCells = { value: walk.computed[link - 1], compare: digest };
        walk.verified = Math.max(0, link - 1);
        walk.computed = walk.computed.slice(0, link - 1);
        await moveHead(link, true);
        return;
      }
      announce(
        anchorStatus,
        `Anchor for link ${link} added. It will be tested when the walk reaches it.`
      );
      if (link > walk.count && walk.verified === walk.count && walk.count > 0) {
        await moveHead(walk.count + 1, true);
      }
    }

    await fetchMore();
    updateReach();
    paintHead(false);
    if (!hasCrypto()) announce(walkResult, NO_CRYPTO);

    return {
      refresh: async () => {
        const reply = await get('/api/ledger?after=0&limit=1', { background: true });
        if (reply.status === 200 && reply.body.count !== walk.count) {
          walk.count = reply.body.count;
          walk.fetchedAll = false;
          updateReach();
          paintHead(false);
        }
      },
      dispose: () => {
        disposed = true;
        cancelSettle();
        window.removeEventListener('scroll', onScroll);
      },
    };
  },
};
