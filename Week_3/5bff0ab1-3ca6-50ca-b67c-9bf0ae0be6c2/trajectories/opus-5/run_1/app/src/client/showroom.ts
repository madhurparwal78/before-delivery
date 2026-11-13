import {
  CHAPTERS,
  STAGE_VIEWPORTS,
  SCROLL_DAMP_PER_FRAME,
  STATEMENT_PARALLAX,
  chapter as chapterDef,
  finish as finishDef,
  hub as hubDef,
  model as modelDef,
  partsOf,
  type ChapterId,
  type FinishId,
  type HubId,
  type ModelId,
} from '../shared/catalogue.js';
import { formatPaise } from '../shared/money.js';
import { FIELD_TEXT, STATUS } from '../shared/strings.js';
import { readShowroomState, showroomUrl } from '../shared/urlstate.js';
import type { Lock, LiveReading } from '../shared/types.js';
import {
  announce,
  apiPost,
  ApiError,
  clearStatus,
  currentSelection,
  liveArrived,
  openDialog,
  readFailed,
  setSelection,
  user,
  type DialogHandle,
} from './core.js';
import { clusterTimeFromLabel, withoutIstSuffix } from './labels.js';
import { markLocalLockAction, refreshLocks } from './lockwatch.js';
import { Showroom } from './scene.js';
import { openSignIn } from './signin.js';

interface Bootstrap {
  reading: LiveReading;
  selection: { hub: HubId; model: ModelId; finish: FinishId };
  chapter: ChapterId;
  part: string | null;
  progress: number;
  route: string;
}

let scene: Showroom | null = null;
let reading: LiveReading | null = null;
let drawnReading = false;
let failedRead = false;
let partId: string | null = null;
let chapterId: ChapterId = 'frame';
let progress = 0;
let lastStaleKey = '';
let lastStepFrom = '';
let lockDialog: { handle: DialogHandle; paint: () => void } | null = null;
let urlTimer: number | null = null;
let reduced = false;

function el<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function stageTravel(): number {
  return STAGE_VIEWPORTS * window.innerHeight;
}

function stageTop(): number {
  const stage = el<HTMLElement>('[data-stage]');
  return stage ? stage.offsetTop : 0;
}

export function startShowroom(bootstrap: Bootstrap): void {
  const canvas = el<HTMLCanvasElement>('[data-scene]');
  reading = bootstrap.reading;
  chapterId = bootstrap.chapter;
  partId = bootstrap.part;
  progress = bootstrap.progress;
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.dataset.reduced = reduced ? 'on' : 'off';

  if (canvas) {
    scene = new Showroom(canvas, {
      model: bootstrap.selection.model,
      finish: bootstrap.selection.finish,
      chapter: chapterId,
      part: partId,
      progress,
      reduced,
    });
    const mode = (scene.snapshot().mode as string) ?? 'webgl';
    document.body.dataset.webgl = mode === 'fallback' ? 'off' : 'on';
    document.body.dataset.mode = mode;
    if (mode === 'fallback') announce(STATUS.noWebgl, 'other');
    exposeProbe();
  }

  wireMenu();
  wireChapters();
  wireParts();
  wireSelection();
  wireLockButton();
  wireScroll();
  wireReducedMotion();
  wireContext();

  if (reading) paint(reading, { first: true });
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  let placedAt = -1;
  const placeFromUrl = (): void => {
    if (placedAt >= 0 && Math.abs(window.scrollY - placedAt) > 2) return;
    const value = readShowroomState(
      new URLSearchParams(window.location.search),
      window.location.pathname === '/',
    ).progress;
    if (!reduced && document.body.dataset.webgl !== 'off') {
      window.scrollTo(0, stageTop() + value * stageTravel());
      placedAt = window.scrollY;
    }
    applyProgress(value, true);
  };
  placeFromUrl();
  window.setTimeout(placeFromUrl, 120);
  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) placedAt = -1;
    placeFromUrl();
  });
  if (partId) selectPart(partId);

  liveArrived.on((next) => {
    reading = next;
    failedRead = false;
    paint(next, {});
  });

  readFailed.on(() => markFailedRead());

  window.addEventListener('resize', () => {
    scene?.resize();
    if (!reduced) window.scrollTo(0, stageTop() + progress * stageTravel());
  });
}

function exposeProbe(): void {
  const api = {
    snapshot: () => scene?.snapshot() ?? null,
  };
  (window as unknown as { __showroom: typeof api }).__showroom = api;
}

/* ---------- progress and scrolling ---------- */

function applyProgress(next: number, immediate = false): void {
  progress = Math.max(0, Math.min(1, next));
  const chapter = CHAPTERS.reduce(
    (found, candidate) => (progress >= candidate.from ? candidate : found),
    CHAPTERS[0] as (typeof CHAPTERS)[number],
  );
  if (chapter.id !== chapterId) {
    if (partId && !partsOf(chapter.id).some((part) => part.id === partId)) {
      selectPart(null);
    }
    chapterId = chapter.id;
    paintChapter();
  }
  scene?.applyProgress(progress, { immediate });
  paintParallax();
  queueUrl();
}

function paintParallax(): void {
  const chapter = chapterDef(chapterId);
  const travelled = (progress - chapter.from) * stageTravel();
  for (const statement of document.querySelectorAll<HTMLElement>('[data-chapter-statement]')) {
    statement.style.transform = `translateY(${(-STATEMENT_PARALLAX * travelled).toFixed(1)}px)`;
  }
}

function wireScroll(): void {
  let target = window.scrollY;
  let last = performance.now();
  let damping = false;

  window.addEventListener(
    'wheel',
    (event) => {
      if (reduced || document.body.dataset.webgl === 'off') return;
      event.preventDefault();
      const max = document.documentElement.scrollHeight - window.innerHeight;
      target = Math.max(0, Math.min(max, target + event.deltaY));
      damping = true;
    },
    { passive: false },
  );

  const step = (): void => {
    requestAnimationFrame(step);
    const now = performance.now();
    const delta = now - last;
    last = now;
    if (damping) {
      const factor = 1 - Math.pow(1 - SCROLL_DAMP_PER_FRAME, delta / (1000 / 60));
      const current = window.scrollY;
      const next = current + (target - current) * factor;
      if (Math.abs(target - current) < 0.5) {
        damping = false;
      } else {
        window.scrollTo(0, next);
      }
    } else {
      target = window.scrollY;
    }
    if (!reduced && document.body.dataset.webgl !== 'off') {
      const value = (window.scrollY - stageTop()) / stageTravel();
      if (Math.abs(value - progress) > 0.0005) applyProgress(value);
    }
  };
  requestAnimationFrame(step);
}

function queueUrl(): void {
  if (urlTimer !== null) return;
  urlTimer = window.setTimeout(() => {
    urlTimer = null;
    writeUrl();
  }, 200);
}

function writeUrl(): void {
  if (window.location.pathname === '/' && progress === 0) return;
  const selection = currentSelection();
  const url = showroomUrl({
    hub: selection.hub,
    model: selection.model,
    finish: selection.finish,
    chapter: chapterId,
    part: partId,
    progress,
    corrected: false,
  });
  window.history.replaceState(window.history.state, '', url);
}

/* ---------- chapters and parts ---------- */

function chapterButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-chapter-button]')];
}

function wireChapters(): void {
  const toolbar = el<HTMLElement>('[data-chapters]');
  if (!toolbar) return;
  for (const button of chapterButtons()) {
    button.addEventListener('click', () => {
      if (toolbar.getAttribute('aria-disabled') === 'true') return;
      jumpTo(button.dataset.chapterButton as ChapterId);
    });
  }
  toolbar.addEventListener('keydown', (event) => {
    if (toolbar.getAttribute('aria-disabled') === 'true') return;
    const buttons = chapterButtons();
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      jumpTo(buttons[index]?.dataset.chapterButton as ChapterId);
      return;
    } else return;
    event.preventDefault();
    const button = buttons[next] as HTMLButtonElement;
    for (const other of buttons) other.tabIndex = -1;
    button.tabIndex = 0;
    button.focus();
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function jumpTo(chapter: ChapterId): void {
  const jump = chapterDef(chapter).jump;
  chapterId = chapter;
  if (reduced || document.body.dataset.webgl === 'off') {
    applyProgress(jump, true);
    scene?.jumpToChapter(chapter);
  } else {
    window.scrollTo(0, stageTop() + jump * stageTravel());
    applyProgress(jump);
    scene?.jumpToChapter(chapter);
  }
  paintChapter();
  const button = chapterButtons().find((entry) => entry.dataset.chapterButton === chapter);
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function paintChapter(): void {
  for (const button of chapterButtons()) {
    const active = button.dataset.chapterButton === chapterId;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  }
  for (const statement of document.querySelectorAll<HTMLElement>('[data-chapter-statement]')) {
    statement.hidden = statement.dataset.chapterStatement !== chapterId;
  }
  for (const elevation of document.querySelectorAll<SVGElement>('.elevation')) {
    const active = elevation.getAttribute('data-chapter') === chapterId;
    if (active) elevation.removeAttribute('hidden');
    else elevation.setAttribute('hidden', '');
  }
  paintPartsList();
}

function paintPartsList(): void {
  const list = el<HTMLElement>('[data-parts]');
  if (!list) return;
  const parts = partsOf(chapterId);
  const existing = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  parts.forEach((part, index) => {
    let option = existing[index];
    if (!option) {
      option = document.createElement('div');
      option.setAttribute('role', 'option');
      list.append(option);
      wireOption(option);
    }
    option.dataset.part = part.id;
    option.textContent = part.name;
    option.setAttribute('aria-selected', part.id === partId ? 'true' : 'false');
  });
  for (let index = parts.length; index < existing.length; index += 1) existing[index]?.remove();
}

function wireOption(option: HTMLElement): void {
  option.addEventListener('click', () => {
    const list = el<HTMLElement>('[data-parts]');
    if (list?.getAttribute('aria-disabled') === 'true') return;
    const id = option.dataset.part as string;
    selectPart(id === partId ? null : id);
  });
}

function wireParts(): void {
  const list = el<HTMLElement>('[data-parts]');
  if (!list) return;
  for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) wireOption(option);
  list.addEventListener('keydown', (event) => {
    if (list.getAttribute('aria-disabled') === 'true') return;
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    const current = options.findIndex((option) => option.dataset.part === partId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.max(0, Math.min(options.length - 1, (current < 0 ? -1 : current) + step));
      const option = options[next];
      if (option) selectPart(option.dataset.part as string);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[Math.max(0, current)];
      if (option) {
        const id = option.dataset.part as string;
        selectPart(id === partId ? null : id);
      }
    }
  });
  const open = el<HTMLButtonElement>('[data-parts-open]');
  open?.addEventListener('click', () => {
    const isOpen = list.dataset.open === 'true';
    list.dataset.open = isOpen ? 'false' : 'true';
    applyInert();
    if (!isOpen) list.focus();
    else open.focus();
  });
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && list.dataset.open === 'true') {
      list.dataset.open = 'false';
      applyInert();
      open?.focus();
    }
  });
  applyInert();
  window.addEventListener('resize', applyInert);
}

function applyInert(): void {
  const list = el<HTMLElement>('[data-parts]');
  const links = el<HTMLElement>('[data-links]');
  const phone = window.innerWidth <= 767;
  if (list) {
    const closed = phone && list.dataset.open !== 'true';
    if (closed) list.setAttribute('inert', '');
    else list.removeAttribute('inert');
    list.tabIndex = closed ? -1 : 0;
    for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      option.tabIndex = -1;
    }
  }
  if (links) {
    const closed = phone && links.dataset.open !== 'true';
    if (closed) links.setAttribute('inert', '');
    else links.removeAttribute('inert');
    for (const link of links.querySelectorAll<HTMLAnchorElement>('a')) {
      link.tabIndex = closed ? -1 : 0;
    }
  }
}

function selectPart(id: string | null): void {
  partId = id;
  paintPartsList();
  scene?.setPart(id);
  let label = el<HTMLElement>('[data-part-label]');
  if (!label) {
    label = document.createElement('p');
    label.className = 'part-label';
    label.setAttribute('data-part-label', '');
    el<HTMLElement>('[data-stage-pin]')?.append(label);
  }
  if (id) {
    const part = partsOf(chapterId).find((entry) => entry.id === id);
    label.textContent = part ? `${part.name}. ${part.note}` : '';
    label.style.opacity = '0';
    scene?.animate('label-mask', (eased) => {
      if (label) label.style.opacity = String(eased);
    });
  } else {
    label.textContent = '';
  }
  queueUrl();
}

/* ---------- selection controls ---------- */

function wireSelection(): void {
  const hub = el<HTMLSelectElement>('[data-hub]');
  hub?.addEventListener('change', () => {
    changeSelection({ hub: hub.value as HubId });
  });
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-model] input')) {
    input.addEventListener('change', () => {
      if (input.checked) changeSelection({ model: input.value as ModelId });
    });
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-finish] input')) {
    input.addEventListener('change', () => {
      if (input.checked) changeSelection({ finish: input.value as FinishId });
    });
  }
}

function changeSelection(change: Partial<{ hub: HubId; model: ModelId; finish: FinishId }>): void {
  const before = currentSelection();
  const next = { ...before, ...change };
  drawnReading = false;
  failedRead = false;
  setSelection(next);
  if (change.model) scene?.setModel(change.model);
  if (change.finish) scene?.setFinish(change.finish);
  const canvas = el<HTMLCanvasElement>('[data-scene]');
  if (canvas && change.model) {
    canvas.setAttribute('aria-label', `Malhar ${modelDef(change.model).name} showroom`);
  }
  clearAmounts();
  paintLockButton();
  queueUrl();
  if (lockDialog) lockDialog.paint();
}

function clearAmounts(): void {
  const price = el<HTMLElement>('[data-price]');
  if (!price) return;
  const exShowroom = el<HTMLElement>('[data-ex-showroom]');
  const onRoad = el<HTMLElement>('[data-on-road]');
  if (exShowroom) exShowroom.textContent = FIELD_TEXT.priceLoading;
  if (onRoad) onRoad.textContent = FIELD_TEXT.priceLoading;
  const asOf = el<HTMLElement>('[data-as-of]');
  if (asOf) asOf.hidden = true;
}

/* ---------- painting a reading ---------- */

function sceneReading(next: LiveReading): Parameters<Showroom['draw']>[0] {
  const units = String(Math.max(0, Math.min(99, next.unitsLeft))).padStart(2, '0');
  const ride = next.nextSlot ? clusterTimeFromLabel(next.nextSlot.label) : '--:--';
  const holdsThisFinish = next.lock !== null && next.lock.finish === next.finish;
  return {
    seq: next.seq,
    unitsLeft: next.unitsLeft,
    onRoadPaise: next.quote.onRoadPaise,
    lockExpiresAt: next.lock && next.lock.state === 'locked' ? next.lock.expiresAt : null,
    nextSlot: next.nextSlot?.startsAt ?? null,
    finish: next.finish,
    display: `UNITS ${units} RIDE ${ride}`,
    hoursLeft: next.hoursLeft,
    lamp: next.stale,
    soldOutPrimer: next.unitsLeft === 0 && !holdsThisFinish,
  };
}

function paint(next: LiveReading, options: { first?: boolean }): void {
  drawnReading = true;
  scene?.draw(sceneReading(next));
  paintAmounts(next);
  paintElevations(next);
  paintLockButton();
  if (lockDialog) lockDialog.paint();
  if (!options.first) {
    paintStaleStatus(next);
    paintPriceStatus(next);
  } else {
    lastStaleKey = staleKey(next);
    lastStepFrom = next.quote.stepEffectiveFrom;
  }
}

function staleKey(next: LiveReading): string {
  return next.stale ? `${next.hub}|${next.staleReason}|${next.stockAsOfLabel}` : `${next.hub}|live`;
}

function paintStaleStatus(next: LiveReading): void {
  const key = staleKey(next);
  if (key === lastStaleKey) return;
  const wasStale = lastStaleKey.includes('|system|') || lastStaleKey.includes('|count|');
  const sameHub = lastStaleKey.startsWith(`${next.hub}|`);
  lastStaleKey = key;
  if (next.stale) {
    const label = withoutIstSuffix(next.stockAsOfLabel);
    if (next.staleReason === 'count') {
      announce(
        label.includes(',') ? STATUS.hubCountingEarlier(label) : STATUS.hubCountingToday(label),
        'stale',
      );
    } else {
      announce(
        label.includes(',') ? STATUS.hubStaleEarlier(label) : STATUS.hubStaleToday(label),
        'stale',
      );
    }
    return;
  }
  if (wasStale && sameHub) {
    announce(
      lastStaleKey.includes('count') ? STATUS.countDoneForRider : STATUS.hubBack,
      'stale',
    );
    return;
  }
  if (wasStale && !sameHub) clearStatus();
}

function paintPriceStatus(next: LiveReading): void {
  if (lastStepFrom && next.quote.stepEffectiveFrom !== lastStepFrom) {
    announce(STATUS.priceMoved(formatPaise(next.quote.onRoadPaise)), 'price');
  }
  lastStepFrom = next.quote.stepEffectiveFrom;
}

function paintAmounts(next: LiveReading): void {
  const exShowroom = el<HTMLElement>('[data-ex-showroom]');
  const onRoad = el<HTMLElement>('[data-on-road]');
  if (exShowroom) exShowroom.textContent = formatPaise(next.quote.exShowroomPaise);
  if (onRoad) onRoad.textContent = formatPaise(next.quote.onRoadPaise);
  const asOf = el<HTMLElement>('[data-as-of]');
  if (asOf) asOf.hidden = true;
  const stock = el<HTMLElement>('[data-stock-line]');
  if (stock) {
    const finishName = finishDef(next.finish).name;
    const hubName = hubDef(next.hub).name;
    stock.textContent =
      next.unitsLeft === 1
        ? `1 unit left in ${finishName} at ${hubName}.`
        : `${next.unitsLeft} units left in ${finishName} at ${hubName}.`;
  }
  const asOfStock = el<HTMLElement>('[data-stock-as-of]');
  if (asOfStock) {
    asOfStock.hidden = !next.stale;
    asOfStock.textContent = `Stock as of ${next.stockAsOfLabel}`;
  }
  const outage = el<HTMLElement>('[data-hub-outage]');
  if (outage) {
    if (next.stale) {
      const label = withoutIstSuffix(next.stockAsOfLabel);
      outage.hidden = false;
      outage.textContent =
        next.staleReason === 'count'
          ? label.includes(',')
            ? STATUS.hubCountingEarlier(label)
            : STATUS.hubCountingToday(label)
          : label.includes(',')
            ? STATUS.hubStaleEarlier(label)
            : STATUS.hubStaleToday(label);
    } else {
      outage.hidden = true;
      outage.textContent = '';
    }
  }
}

function markFailedRead(): void {
  failedRead = true;
  const asOf = el<HTMLElement>('[data-as-of]');
  if (asOf && reading) {
    asOf.hidden = false;
    const time = reading.serverNow.slice(11, 16);
    const hour = Number(time.slice(0, 2));
    const minute = time.slice(3, 5);
    const suffix = hour < 12 ? 'am' : 'pm';
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    asOf.textContent = FIELD_TEXT.asOf(`${twelve}:${minute} ${suffix}`);
  }
  paintLockButton();
}

function paintElevations(next: LiveReading): void {
  const scenePayload = sceneReading(next);
  const needleDeg = next.hoursLeft > 0 ? -135 + (270 * Math.min(next.hoursLeft, 96)) / 96 : -135;
  for (const elevation of document.querySelectorAll<SVGElement>('.elevation')) {
    elevation.setAttribute('data-needle-deg', String(needleDeg));
    elevation.setAttribute('data-lamp', String(next.stale));
    elevation.setAttribute('data-units', scenePayload.display.slice(6, 8));
    elevation.setAttribute(
      'data-ride',
      next.nextSlot ? clusterTimeFromLabel(next.nextSlot.label) : '--:--',
    );
    const tank = scenePayload.soldOutPrimer
      ? '#9c9ea3'
      : `#${finishDef(next.finish)
          .paint.map((channel) => channel.toString(16).padStart(2, '0'))
          .join('')}`;
    elevation.setAttribute('data-tank', tank);
    const body = elevation.querySelector('path[fill]');
    body?.setAttribute('fill', tank);
    const lamp = elevation.querySelector('g circle[cx="10"]');
    lamp?.setAttribute('fill', next.stale ? '#ff4a1f' : '#2b2d31');
    const needle = elevation.querySelector('g line');
    if (needle) {
      needle.setAttribute('x2', (12 * Math.sin((needleDeg * Math.PI) / 180)).toFixed(2));
      needle.setAttribute('y2', (-12 * Math.cos((needleDeg * Math.PI) / 180)).toFixed(2));
    }
    const text = elevation.querySelector('text');
    if (text) text.textContent = scenePayload.display;
  }
}

/* ---------- lock ---------- */

function holdsThisTrio(next: LiveReading | null): boolean {
  if (!next || !next.lock) return false;
  return (
    next.lock.finish === next.finish &&
    ['requested', 'locked', 'delivery_set'].includes(next.lock.state)
  );
}

function paintLockButton(): void {
  const button = el<HTMLButtonElement>('[data-lock-button]');
  if (!button) return;
  const blocked =
    !drawnReading ||
    failedRead ||
    reading === null ||
    reading.stale ||
    reading.unitsLeft === 0 ||
    holdsThisTrio(reading);
  button.setAttribute('aria-disabled', blocked ? 'true' : 'false');
}

function wireLockButton(): void {
  const button = el<HTMLButtonElement>('[data-lock-button]');
  button?.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    if (!user()) {
      openSignIn();
      const stop = window.setInterval(() => {
        if (user()) {
          window.clearInterval(stop);
          openLockDialog();
        }
      }, 200);
      window.setTimeout(() => window.clearInterval(stop), 60_000);
      return;
    }
    openLockDialog();
  });
}

function openLockDialog(): void {
  if (lockDialog) return;
  let confirmButton: HTMLButtonElement | null = null;
  let amount: HTMLElement | null = null;
  let expiry: HTMLElement | null = null;
  let details: HTMLElement | null = null;
  const handle = openDialog({
    label: 'Confirm your lock',
    onClose: () => {
      lockDialog = null;
    },
    build: (panel, dialog) => {
      const heading = document.createElement('h2');
      heading.textContent = 'Confirm your lock';
      details = document.createElement('p');
      amount = document.createElement('p');
      amount.className = 'numeral';
      expiry = document.createElement('p');
      const actions = document.createElement('div');
      actions.className = 'dialog-actions';
      confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'primary';
      confirmButton.textContent = 'Confirm lock';
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.textContent = 'Keep looking';
      keep.addEventListener('click', () => dialog.close());
      confirmButton.addEventListener('click', () => {
        if (confirmButton?.getAttribute('aria-disabled') === 'true') return;
        void submitLock(dialog, confirmButton as HTMLButtonElement);
      });
      actions.append(confirmButton, keep);
      panel.append(heading, details, amount, expiry, actions);
    },
  });
  const paint = (): void => {
    if (!reading) return;
    if (details) {
      details.textContent = `${modelDef(reading.model).name}, ${
        finishDef(reading.finish).name
      }, ${hubDef(reading.hub).name}`;
    }
    if (amount) amount.textContent = formatPaise(reading.quote.onRoadPaise);
    if (expiry) expiry.textContent = `Held until ${reading.lockPreview.expiresLabel}`;
    if (confirmButton) {
      const blocked = reading.stale || reading.unitsLeft === 0;
      confirmButton.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    }
  };
  lockDialog = { handle, paint };
  paint();
}

async function submitLock(dialog: DialogHandle, confirmButton: HTMLButtonElement): Promise<void> {
  if (!reading) return;
  const selection = currentSelection();
  confirmButton.setAttribute('aria-disabled', 'true');
  announce(STATUS.lockChecking, 'lock');
  markLocalLockAction();
  try {
    const reply = await apiPost<{ lock: Lock }>('/api/locks', {
      hub: selection.hub,
      model: selection.model,
      finish: selection.finish,
      stepEffectiveFrom: reading.quote.stepEffectiveFrom,
    });
    markLocalLockAction(reply.data.lock.id);
    if (reply.status === 202) {
      dialog.close();
      announce(STATUS.lockChecking, 'lock');
    } else {
      dialog.close();
      announce(STATUS.lockConfirmed(reply.data.lock.expiresLabel ?? ''), 'lock');
    }
    await refreshLocks();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const code = error.failure.code;
    if (code === 'price_moved') {
      announce(
        STATUS.priceMoved(formatPaise(reading?.quote.onRoadPaise ?? 0)),
        'price',
      );
      lockDialog?.paint();
      confirmButton.setAttribute('aria-disabled', 'false');
      return;
    }
    if (code === 'hub_unreachable') {
      lockDialog?.paint();
      return;
    }
    if (code === 'none_left') {
      dialog.close();
      announce(STATUS.finishGone, 'lock');
      return;
    }
    if (code === 'lock_exists_other_finish') {
      dialog.close();
      announce(STATUS.lockExistsOtherFinish, 'lock');
      return;
    }
    if (error.failure.status === 401) {
      openSignIn();
      return;
    }
    confirmButton.setAttribute('aria-disabled', 'false');
  }
}

/* ---------- menu, reduced motion, context ---------- */

function wireMenu(): void {
  const button = el<HTMLButtonElement>('[data-menu]');
  const links = el<HTMLElement>('[data-links]');
  button?.addEventListener('click', () => {
    const open = links?.dataset.open === 'true';
    if (links) links.dataset.open = open ? 'false' : 'true';
    button.setAttribute('aria-expanded', open ? 'false' : 'true');
    applyInert();
  });
}

function wireReducedMotion(): void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', () => {
    reduced = query.matches;
    document.body.dataset.reduced = reduced ? 'on' : 'off';
    scene?.setReduced(reduced);
    document.body.dataset.mode = (scene?.snapshot().mode as string) ?? 'webgl';
    if (!reduced) window.scrollTo(0, stageTop() + progress * stageTravel());
  });
}

function wireContext(): void {
  const canvas = el<HTMLCanvasElement>('[data-scene]');
  if (!canvas) return;
  canvas.addEventListener('webglcontextlost', () => {
    announce(STATUS.paused3d, 'other');
    el<HTMLElement>('[data-chapters]')?.setAttribute('aria-disabled', 'true');
    el<HTMLElement>('[data-parts]')?.setAttribute('aria-disabled', 'true');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    announce(STATUS.back3d, 'other');
    el<HTMLElement>('[data-chapters]')?.removeAttribute('aria-disabled');
    el<HTMLElement>('[data-parts]')?.removeAttribute('aria-disabled');
    window.scrollTo(0, stageTop() + progress * stageTravel());
  });
}
