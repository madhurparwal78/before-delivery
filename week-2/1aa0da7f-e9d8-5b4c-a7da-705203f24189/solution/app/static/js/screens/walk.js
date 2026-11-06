// /ledger: the Chain Walk. The browser hashes the chain itself as the head reaches each link.

import { ConnectionLost, field, figure, h, icon, reducedMotion, setFigure } from '../core.js';
import { hasWebCrypto } from '../chain.js';
import { NO_WEB_CRYPTO } from '../chain.js';
import { anchorText, ChainCheck, parseAnchor, rememberHighWater } from './verify.js';

const STEP_PX = 72;
const PAGE_STEP = 10;
const REST_MS = 250;
const POLL_MS = 3000;
const MARK_REACH = 120;
const HEAD_OFFSET_PX = 108;
const CELL_COUNT = 64;
const CELL_MS = 100;
const CELL_STAGGER_MS = 6;
const MARK_MS = 300;
const COUNT_MS = 300;
const THUMB_PX = 12;
const SLIDER_END_PX = 20;
const SETTLE_EASE = 'cubic-bezier(.16,1,.3,1)';
const WIDE = matchMedia('(min-width: 768px)');

export async function mount(screen, main) {
  const check = new ChainCheck(screen.signal);
  if (!(await check.open()) || screen.stopped) return;
  const canHash = hasWebCrypto();
  scrollTo(0, 0);
  const previousRestoration = history.scrollRestoration;
  history.scrollRestoration = 'manual';

  let head = 0;
  let railStart = 0;
  let shownFault = null;
  let shownNumeral = 0;
  let countFrame = 0;
  let pumping = false;
  let settling = [];
  let restTimer = 0;
  let awaitingRest = false;
  let drag = null;
  const pendingSteps = new Set();
  const marks = new Map();

  const numeral = figure('Verified through', 0);
  const cells = Array.from({ length: CELL_COUNT }, () => {
    const glyph = h('span', {}, '0');
    return { glyph, element: h('div', { 'data-digest-cell': true, class: 'digest-cell' }, glyph) };
  });
  const panel = h('section', { role: 'region', 'aria-label': 'Digest panel', class: 'digest-panel', 'data-digest-state': 'settled' },
    cells.map((cell) => cell.element));
  const result = h('div', { role: 'status', 'aria-label': 'Walk result', class: 'walk-result' }, canHash ? 'Start of the chain.' : NO_WEB_CRYPTO);
  const pinned = h('div', { class: 'walk-pinned' }, numeral, panel,
    h('div', { class: 'walk-result-row' }, result, h('a', { href: '/audit/chain', class: 'walk-link' }, 'Chain lattice')));

  const currentAnchor = h('input', { type: 'text', readonly: true, class: 'identifier', value: '', placeholder: 'Nothing verified yet' });
  const copyAnchor = h('button', { type: 'button', class: 'btn', disabled: true, onclick: copyCurrentAnchor }, 'Copy anchor');
  const anchorInput = h('input', { type: 'text', class: 'identifier', autocomplete: 'off', spellcheck: 'false' });
  const anchorStatus = h('div', { role: 'status', 'aria-label': 'Anchor status', class: 'status-line' });
  const anchorForm = h('form', { class: 'anchor-row', novalidate: true, onsubmit: checkAnchor },
    field('Anchor to check', anchorInput), h('button', { type: 'submit', class: 'btn' }, 'Check anchor'));
  const anchors = h('div', { class: 'walk-anchors' },
    h('div', { class: 'anchor-row' }, field('Current anchor', currentAnchor), copyAnchor), anchorForm, anchorStatus);

  const fill = h('div', { class: 'slider-fill' });
  const thumb = h('div', { class: 'slider-thumb' });
  const sliderHigh = h('span', { class: 'slider-end slider-end-high', 'aria-hidden': 'true' });
  const slider = h('div', {
    role: 'slider', tabindex: '0', 'aria-label': 'Ledger walk', 'aria-orientation': 'vertical', 'aria-valuemin': '0', class: 'walk-slider',
    onkeydown: onSliderKey, onpointerdown: onDragStart, onpointermove: onDragMove, onpointerup: onDragEnd, onpointercancel: onDragEnd,
  }, h('span', { class: 'slider-end slider-end-low', 'aria-hidden': 'true' }, '0'), h('div', { class: 'slider-line' }), fill, thumb, sliderHigh);
  const breakText = h('p', { class: 'rail-break', hidden: true });
  const stage = h('div', { class: 'rail-stage' }, slider, h('div', { class: 'rail-head', 'aria-hidden': 'true' }), breakText);
  const markLayer = h('div', { class: 'rail-marks' }, h('div', { class: 'rail-zero', 'aria-hidden': 'true', style: `top:${HEAD_OFFSET_PX}px` }, '0'));
  const rail = h('div', { class: 'walk-rail' }, markLayer, stage);
  const region = h('section', { role: 'region', 'aria-label': 'Chain Walk', class: 'walk', 'data-verified-through': '0', 'data-link-state': 'idle' },
    h('div', { class: 'walk-side' }, pinned, anchors), rail);

  main.className = 'page page-walk';
  main.replaceChildren(region);

  const sliderMax = () => Math.max(check.count, check.fault?.link ?? 0);
  const reachable = () => check.fault?.link ?? sliderMax();
  const resolved = () => head <= check.verified || head === check.fault?.link;

  function measure() {
    const railTop = rail.getBoundingClientRect().top + scrollY;
    const barHeight = document.querySelector('.topbar')?.offsetHeight ?? 0;
    const stripHeight = document.querySelector('.action-status')?.offsetHeight ?? 0;
    const stuckTop = WIDE.matches ? railTop : barHeight + stripHeight + pinned.offsetHeight;
    const bottomPad = parseFloat(getComputedStyle(main).paddingBottom);
    const stageHeight = Math.max(innerHeight - stuckTop - bottomPad, THUMB_PX * 4);
    railStart = Math.max(railTop - stuckTop, 0);
    stage.style.top = `${stuckTop}px`;
    stage.style.height = `${stageHeight}px`;
    rail.style.height = `${stageHeight + sliderMax() * STEP_PX}px`;
    scrollForHead();
  }

  function scrollForHead() {
    const wanted = railStart + head * STEP_PX;
    if (head === 0 && scrollY <= railStart) return;
    if (Math.abs(scrollY - wanted) >= 1) scrollTo(0, wanted);
  }

  function syncSlider() {
    const max = sliderMax();
    slider.setAttribute('aria-valuemax', String(max));
    slider.setAttribute('aria-valuenow', String(head));
    slider.setAttribute('aria-valuetext', `Link ${head} of ${check.count}`);
    sliderHigh.textContent = String(max);
    thumb.style.top = `calc(${SLIDER_END_PX}px + (100% - ${2 * SLIDER_END_PX + THUMB_PX}px) * ${max ? head / max : 0})`;
    fill.style.height = `calc((100% - ${2 * SLIDER_END_PX}px) * ${max ? check.verified / max : 0})`;
  }

  function syncMark(link, closing = false) {
    const element = marks.get(link);
    if (!element) return;
    const state = canHash ? check.stateOf(link) : 'unverified';
    element.classList.toggle('at-head', link === head);
    if (element.dataset.markState === state) return;
    element.dataset.markState = state;
    const word = element.querySelector('.mark-word');
    const reached = state === 'verified' || state === 'break';
    word.replaceChildren(...(reached ? [icon(state === 'verified' ? 'check' : 'cross'), state === 'verified' ? 'Verified' : 'Break'] : []));
    element.querySelector('.mark-action').textContent = reached ? check.rows[link - 1]?.action ?? '' : '';
    if (closing && reached && !reducedMotion.matches) closeMark(word);
  }

  function closeMark(word) {
    const options = { duration: MARK_MS, easing: SETTLE_EASE };
    for (const stroke of word.querySelectorAll('path')) {
      stroke.setAttribute('pathLength', '1');
      stroke.style.strokeDasharray = '1';
      stroke.animate({ strokeDashoffset: [1, 0] }, options);
    }
    word.animate({ opacity: [0, 1] }, options);
  }

  function renderMarks() {
    const low = Math.max(1, head - MARK_REACH);
    const high = Math.min(sliderMax(), head + MARK_REACH);
    for (const [link, element] of marks) {
      if (link < low || link > high) {
        element.remove();
        marks.delete(link);
      }
    }
    for (let link = low; link <= high; link += 1) {
      if (!marks.has(link)) {
        const element = h('div', { class: 'link-mark', 'data-link-mark': String(link), style: `top:${HEAD_OFFSET_PX + link * STEP_PX}px` },
          h('span', { class: 'mark-number' }, String(link)), h('span', { class: 'mark-word' }), h('span', { class: 'mark-action' }));
        marks.set(link, element);
        markLayer.append(element);
      }
      syncMark(link);
    }
  }

  function cancelSettle() {
    for (const animation of settling) {
      animation.onfinish = null;
      animation.cancel();
    }
    settling = [];
  }

  function writeCells(text, compared) {
    let firstFound = false;
    cells.forEach((cell, index) => {
      const differs = compared === undefined ? false : compared === null || compared[index] !== text[index];
      cell.glyph.textContent = text[index];
      if (differs) cell.element.setAttribute('data-differs', 'true');
      else cell.element.removeAttribute('data-differs');
      if (differs && !firstFound) {
        firstFound = true;
        cell.element.setAttribute('data-first-break', 'true');
      } else cell.element.removeAttribute('data-first-break');
    });
  }

  // Shows the link under the head. Every cell gets its value now; the glyphs settle in left to right.
  function paintHead() {
    cancelSettle();
    const fault = head === check.fault?.link ? check.fault : null;
    if (fault) writeCells(fault.shown, fault.compared);
    else writeCells(check.digests[head], undefined);
    region.dataset.linkState = fault ? 'broken' : head === 0 ? 'idle' : 'verified';
    if (reducedMotion.matches) {
      panel.dataset.digestState = 'settled';
      return;
    }
    panel.dataset.digestState = 'settling';
    settling = cells.map((cell, index) => cell.glyph.animate(
      { opacity: [0, 1], transform: ['translateY(-4px)', 'translateY(0)'] },
      { duration: CELL_MS, delay: index * CELL_STAGGER_MS, easing: SETTLE_EASE, fill: 'backwards' },
    ));
    settling.at(-1).onfinish = () => {
      settling = [];
      panel.dataset.digestState = 'settled';
    };
  }

  function showNumeral(value) {
    cancelAnimationFrame(countFrame);
    if (reducedMotion.matches || value <= shownNumeral) {
      shownNumeral = value;
      setFigure(numeral, value);
      return;
    }
    const from = shownNumeral;
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min(Math.max(now - started, 0) / COUNT_MS, 1);
      shownNumeral = Math.round(from + (value - from) * (1 - (1 - progress) ** 3));
      setFigure(numeral, shownNumeral);
      if (progress < 1) countFrame = requestAnimationFrame(tick);
    };
    countFrame = requestAnimationFrame(tick);
  }

  function publishVerified() {
    region.dataset.verifiedThrough = String(check.verified);
    const { verified } = check;
    currentAnchor.value = verified ? anchorText(verified, check.digests[verified]) : '';
    copyAnchor.disabled = verified === 0;
    showNumeral(verified);
    syncSlider();
    if (verified) rememberHighWater(verified, check.digests[verified]);
  }

  function linkMessage(link) {
    if (link === check.fault?.link) return `Break at link ${link}.`;
    return link === 0 ? 'Start of the chain.' : `Link ${link} verified.`;
  }

  function announce(message) {
    if (result.textContent !== message) result.textContent = message;
  }

  function clearRest() {
    clearTimeout(restTimer);
    restTimer = 0;
    awaitingRest = false;
  }

  function announceIfRested() {
    if (!awaitingRest || restTimer || drag || !resolved()) return;
    awaitingRest = false;
    announce(linkMessage(head));
  }

  function flushStep(link) {
    if (pendingSteps.delete(link)) announce(linkMessage(link));
  }

  function land() {
    publishVerified();
    syncMark(head, true);
    paintHead();
    flushStep(head);
    announceIfRested();
  }

  function showFault() {
    const { fault } = check;
    shownFault = fault;
    head = fault.link;
    pendingSteps.clear();
    clearRest();
    breakText.textContent = `Break at link ${fault.link}`;
    breakText.hidden = false;
    measure();
    renderMarks();
    for (const link of marks.keys()) syncMark(link);
    syncMark(head, true);
    publishVerified();
    paintHead();
    announce(linkMessage(head));
  }

  // Hashes up to the head, in order, and stops as soon as the head no longer needs more.
  async function pump() {
    if (pumping) return;
    pumping = true;
    check.loadMemory();
    try {
      while (check.verified < head && await check.next()) {
        region.dataset.verifiedThrough = String(check.verified);
        syncMark(check.verified, check.verified === head);
        flushStep(check.verified);
      }
      check.checkEnd();
    } catch (error) {
      if (!(error instanceof ConnectionLost) && error.name !== 'AbortError') throw error;
    } finally {
      pumping = false;
    }
    if (screen.stopped) return;
    if (check.fault && check.fault !== shownFault) showFault();
    else if (resolved()) land();
    else publishVerified();
  }

  function moveHead(target, how) {
    const next = Math.min(Math.max(target, 0), reachable());
    if (next === head) return;
    head = next;
    syncSlider();
    renderMarks();
    if (how !== 'scroll') scrollForHead();
    if (!canHash) return;
    cancelSettle();
    if (!reducedMotion.matches) panel.dataset.digestState = 'settling';
    clearRest();
    if (how === 'step') pendingSteps.add(head);
    else {
      awaitingRest = true;
      if (how !== 'drag') restTimer = setTimeout(() => {
        restTimer = 0;
        announceIfRested();
      }, REST_MS);
    }
    if (resolved()) land();
    else pump();
  }

  function onSliderKey(event) {
    const moves = {
      ArrowUp: [head + 1, 'step'], ArrowRight: [head + 1, 'step'], ArrowDown: [head - 1, 'step'], ArrowLeft: [head - 1, 'step'],
      PageUp: [head + PAGE_STEP, 'far'], PageDown: [head - PAGE_STEP, 'far'], Home: [0, 'far'], End: [reachable(), 'far'],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveHead(...move);
  }

  function onDragStart(event) {
    if (event.button) return;
    event.preventDefault();
    slider.focus({ preventScroll: true });
    slider.setPointerCapture(event.pointerId);
    const box = slider.getBoundingClientRect();
    const travel = Math.max(box.height - 2 * SLIDER_END_PX - THUMB_PX, 1);
    const fromValue = thumb.contains(event.target) ? head : Math.round(((event.clientY - box.top - SLIDER_END_PX) / travel) * sliderMax());
    drag = { startY: event.clientY, fromValue, travel };
    moveHead(fromValue, 'drag');
  }

  function onDragMove(event) {
    if (!drag) return;
    moveHead(drag.fromValue + Math.round(((event.clientY - drag.startY) / drag.travel) * sliderMax()), 'drag');
  }

  function onDragEnd() {
    if (!drag) return;
    drag = null;
    announceIfRested();
  }

  function onScroll() {
    if (drag) return;
    const wanted = Math.round((scrollY - railStart) / STEP_PX);
    if (check.fault && wanted > check.fault.link && head === check.fault.link) scrollForHead();
    else moveHead(wanted, 'scroll');
  }

  async function copyCurrentAnchor() {
    try {
      await navigator.clipboard.writeText(currentAnchor.value);
      anchorStatus.textContent = 'Anchor copied.';
    } catch {
      currentAnchor.focus();
      currentAnchor.select();
      anchorStatus.textContent = 'Anchor selected. Copy it now.';
    }
  }

  function checkAnchor(event) {
    event.preventDefault();
    const anchor = parseAnchor(anchorInput.value);
    if (!anchor) {
      anchorStatus.textContent = 'This is not a Wardline anchor.';
      return;
    }
    check.addAnchor(anchor);
    if (anchor.link > check.verified || !canHash) {
      anchorStatus.textContent = `Anchor for link ${anchor.name} added. It will be tested when the walk reaches it.`;
      if (!canHash) return;
      check.checkEnd();
      if (check.fault && check.fault !== shownFault) showFault();
    } else if (check.testAnchor(anchor)) {
      anchorStatus.textContent = `Anchor for link ${anchor.name} matches.`;
    } else {
      anchorStatus.textContent = `Anchor for link ${anchor.name} does not match.`;
      showFault();
    }
  }

  async function poll() {
    const before = check.count;
    await check.read({ background: true });
    if (check.count !== before) {
      measure();
      syncSlider();
      renderMarks();
    }
    if (canHash && !resolved()) pump();
  }

  syncSlider();
  renderMarks();
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(pinned);
  addEventListener('resize', measure);
  addEventListener('scroll', onScroll, { passive: true });
  screen.every(POLL_MS, poll, { now: false });
  screen.onCleanup(() => {
    observer.disconnect();
    removeEventListener('resize', measure);
    removeEventListener('scroll', onScroll);
    clearTimeout(restTimer);
    cancelAnimationFrame(countFrame);
    cancelSettle();
    history.scrollRestoration = previousRestoration;
  });
}
