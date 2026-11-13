import '@fontsource/gloock/400.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/600.css';
import './styles.css';

import { storyCopy, type Chapter } from '../shared/copy.js';
import { markTree, reducedMotion, runMotion } from './motion.js';
import { chapterAt, chapterRanges, rangeOf, SHELF_RANGE_START, strikeChapters } from './scene/chapters.js';
import { createScene, webglAvailable, type SceneHandle } from './scene/scene.js';
import { createStill, type StillHandle } from './scene/still.js';
import {
  loadEdition,
  loadShelf,
  notifyShelf,
  onShelfChange,
  openShelfStream,
  shelfModel,
  store,
} from './store.js';
import { mountChrome } from './ui/chrome.js';
import { clear, el, trapFocus } from './ui/dom.js';
import { heldBox, onHoldChange, putBack, reachFor, startPolling } from './ui/hold.js';
import { buildBoxSheet, buildCheckout, buildLookup, buildOrderPage } from './ui/orderflow.js';
import { buildShelf, type ShelfView } from './ui/shelf.js';
import {
  buildDeadLetters,
  buildPacking,
  buildPlates,
  buildRates,
  buildRefunds,
  buildStaffHome,
  buildStatements,
  readIdentity,
  signInAvailable,
} from './ui/staff.js';
import { buildStory } from './ui/story.js';

const canvas = document.getElementById('alley') as HTMLCanvasElement;
const scrim = document.getElementById('scrim') as HTMLElement;
const appRoot = document.getElementById('app') as HTMLElement;

const reduced = reducedMotion();
const hasWebgl = webglAvailable();
const discrete = reduced || !hasWebgl;

let still: StillHandle | null = null;
let handle: SceneHandle;

if (hasWebgl) {
  handle = createScene({
    canvas,
    reducedMotion: reduced,
    onMatchOut: (bundle) => chrome.setStoryStatus(bundle ? storyCopy.bundleOut : storyCopy.matchOut),
  });
} else {
  canvas.hidden = true;
  still = createStill({ onChange: () => undefined });
  document.body.prepend(still.element);
  handle = still;
}

const readOnlyScene = {};
Object.defineProperties(readOnlyScene, {
  progress: { get: () => handle.readout.progress, enumerable: true },
  chapter: { get: () => handle.readout.chapter, enumerable: true },
  cameraPosition: { get: () => ({ ...handle.readout.cameraPosition }), enumerable: true },
  lightIntensity: { get: () => handle.readout.lightIntensity, enumerable: true },
  litMatches: { get: () => handle.readout.litMatches, enumerable: true },
  holdRemainingMs: { get: () => handle.readout.holdRemainingMs, enumerable: true },
  matchLength: { get: () => handle.readout.matchLength, enumerable: true },
});
Object.freeze(readOnlyScene);
Object.defineProperty(window, '__scene', { value: readOnlyScene, writable: false });

const story = buildStory(discrete);
let shelfView: ShelfView | null = null;

const chrome = mountChrome({
  root: appRoot,
  discrete,
  onStrike: () => strike(),
  onStepChapter: (direction) => stepChapter(direction),
  onGoToCheckout: () => navigate('/checkout'),
  onPutBack: () => void releaseHold(),
});

async function releaseHold(): Promise<void> {
  const hold = heldBox();
  if (hold === null) return;
  await putBack();
  holdFocus = false;
  handle.focusBox(null);
  shelfView?.refresh();
  shelfView?.focusCell(hold.number);
  refreshScene();
}

function strike(): void {
  if (!handle.strike()) return;
  chrome.setStoryStatus('');
}

function stepChapter(direction: 1 | -1): void {
  if (still !== null) {
    still.stepChapter(direction);
    currentProgress = rangeOf(still.currentChapter()).from;
    story.showChapter(still.currentChapter());
    chrome.setStoryStatus('');
    afterProgress();
    return;
  }
  const index = chapterRanges.findIndex((range) => range.chapter === chapterAt(currentProgress));
  const next = chapterRanges[Math.min(chapterRanges.length - 1, Math.max(0, index + direction))];
  if (next === undefined) return;
  setProgress(next.from);
  story.showChapter(next.chapter);
  chrome.setStoryStatus('');
  afterProgress();
}

/** Scroll progress maps onto the published chapter ranges by the column's own geometry. */
function progressFromScroll(): number {
  const scrolled = window.scrollY;
  let found = 0;
  for (const range of chapterRanges) {
    const section = story.element.querySelector<HTMLElement>(`[data-chapter="${range.chapter}"]`);
    if (section === null || section.offsetParent === null) continue;
    const top = section.offsetTop;
    const height = Math.max(1, section.offsetHeight);
    if (scrolled < top) break;
    const local = Math.min(1, (scrolled - top) / height);
    found = range.from + local * (range.to - range.from);
  }
  return Math.min(1, Math.max(0, found));
}

function scrollToProgress(progress: number): void {
  const range = chapterRanges.find((item) => progress >= item.from && progress <= item.to);
  if (range === undefined) return;
  const section = story.element.querySelector<HTMLElement>(`[data-chapter="${range.chapter}"]`);
  if (section === null) return;
  const span = range.to - range.from;
  const local = span === 0 ? 0 : (progress - range.from) / span;
  window.scrollTo({ top: section.offsetTop + local * section.offsetHeight, behavior: 'auto' });
}

let holdFocus = false;
let currentProgress = 0;

function refreshScene(): void {
  if (shelfView === null) return;
  handle.setShelfStates(shelfView.states());
  handle.setShelfCells(shelfView.cells());
}

function afterProgress(): void {
  const chapter = chapterAt(currentProgress);
  chrome.setStrikeEnabled(strikeChapters.includes(chapter) && !handle.burning());
  chrome.playNarration(chapter);
  story.highlight();
  chrome.setCaption(story.litSentence());
  const hold = heldBox();
  const inShelf = currentProgress >= SHELF_RANGE_START;
  if (hold !== null && inShelf && !holdFocus) {
    holdFocus = true;
    handle.focusBox(hold.number);
  } else if (holdFocus && (hold === null || !inShelf)) {
    holdFocus = false;
    handle.focusBox(null);
  }
  refreshScene();
}

function setProgress(progress: number): void {
  currentProgress = progress;
  handle.setProgress(progress);
}

window.addEventListener('scroll', () => {
  if (!discrete && storyVisible) setProgress(progressFromScroll());
  afterProgress();
});

window.addEventListener('resize', () => {
  refreshScene();
  afterProgress();
});

/* The matchbox strikes by drag, tap, Space or Enter. */
let dragFrom: { x: number; y: number } | null = null;
let dragged = 0;
chrome.matchbox.addEventListener('pointerdown', (event) => {
  dragFrom = { x: event.clientX, y: event.clientY };
  dragged = 0;
});
chrome.matchbox.addEventListener('pointermove', (event) => {
  if (dragFrom === null) return;
  dragged = Math.hypot(event.clientX - dragFrom.x, event.clientY - dragFrom.y);
  if (dragged >= 80) {
    dragFrom = null;
    strike();
  }
});
chrome.matchbox.addEventListener('pointerup', (event) => {
  if (dragFrom === null) return;
  dragFrom = null;
  if (dragged < 10 && event.target === chrome.matchbox) strike();
});

function askAboutSound(): void {
  if (store.soundChoice() !== null) return;
  const heading = el('h2', { text: 'Sound' });
  const on = el('button', { type: 'button', class: 'primary', text: 'Sound on' });
  const off = el('button', { type: 'button', text: 'Sound off' });
  const without = el('button', { type: 'button', text: 'Continue without sound' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sound' }, [
    heading,
    el('p', { text: 'The tale is read aloud. Captions always show.' }),
    el('div', { class: 'row' }, [on, off, without]),
  ]);
  const backdrop = el('div', { class: 'backdrop' }, [dialog]);
  document.body.append(backdrop);
  const release = trapFocus(dialog, { onEscape: () => choose('off') });
  on.focus();

  function choose(answer: 'on' | 'off'): void {
    store.chooseSound(answer);
    chrome.syncSound();
    release();
    backdrop.remove();
    afterProgress();
  }
  on.addEventListener('click', () => choose('on'));
  off.addEventListener('click', () => choose('off'));
  without.addEventListener('click', () => choose('off'));
}

let storyVisible = false;

function showStory(scrollTo: 'top' | 'shelf'): void {
  storyVisible = true;
  scrim.classList.remove('dimmed');
  chrome.setStoryVisible(true);
  chrome.setHoldBarVisible(true);
  if (chrome.main.firstChild !== story.element) {
    clear(chrome.main);
    chrome.main.append(story.element);
  }
  if (shelfView === null) {
    shelfView = buildShelf({
      onChoose: (boxNumber) => void choose(boxNumber),
      onPassage: (chapter) => story.scrollToChapter(chapter as Chapter),
      onBox: (boxNumber) => navigate(`/box/${boxNumber}`),
    });
    const section = story.element.querySelector<HTMLElement>('[data-chapter="shelf"]');
    section?.append(shelfView.element);
    markTree(shelfView.element);
  }
  if (scrollTo === 'shelf') {
    if (discrete) {
      story.showChapter('shelf');
      setProgress(rangeOf('shelf').from);
    } else {
      scrollToProgress(1);
      setProgress(progressFromScroll());
    }
  } else if (scrollTo === 'top') {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setProgress(0);
  }
  afterProgress();
}

function showSheet(node: HTMLElement, options: { dim: boolean; holdBar: boolean }): void {
  storyVisible = false;
  clear(chrome.main);
  chrome.main.append(node);
  markTree(node);
  runMotion(chrome.main, 'route');
  scrim.classList.toggle('dimmed', options.dim);
  chrome.setStoryVisible(false);
  chrome.setHoldBarVisible(options.holdBar);
}

async function choose(boxNumber: number): Promise<void> {
  const state = shelfModel.states.get(boxNumber);
  if (state === 'taken') {
    notifyShelf();
    return;
  }
  const hold = await reachFor(boxNumber);
  shelfView?.refresh();
  if (hold === null) {
    refreshScene();
    return;
  }
  holdFocus = true;
  handle.focusBox(boxNumber);
  refreshScene();
  chrome.focusCheckout();
}

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  void render();
}

window.addEventListener('popstate', () => void render());

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest('a');
  if (target === null || target === undefined) return;
  const href = target.getAttribute('href');
  if (href === null || !href.startsWith('/') || href.startsWith('/auth/') || href.startsWith('/api/')) {
    return;
  }
  event.preventDefault();
  navigate(href);
});

async function render(): Promise<void> {
  const path = window.location.pathname;
  const previous = chrome.main.firstElementChild;
  if (previous !== null && previous !== story.element) {
    previous.dispatchEvent(new CustomEvent('press-unmount'));
  }

  if (path === '/' || path === '/shelf') {
    showStory(path === '/shelf' ? 'shelf' : 'top');
    return;
  }

  if (path.startsWith('/box/')) {
    const boxNumber = Number.parseInt(path.slice(5), 10);
    showSheet(
      await buildBoxSheet({
        boxNumber,
        onHold: (number) => {
          void choose(number).then(() => navigate('/shelf'));
        },
      }),
      { dim: true, holdBar: false },
    );
    return;
  }

  if (path === '/checkout') {
    showSheet(
      await buildCheckout({
        onOrder: (reference, token) => navigate(`/order/${reference}?token=${token}`),
        onHoldEnded: (message) => {
          chrome.setStoryStatus(message);
          navigate('/shelf');
        },
      }),
      { dim: true, holdBar: true },
    );
    return;
  }

  if (path.startsWith('/order/')) {
    const reference = path.slice(7);
    const token =
      new URLSearchParams(window.location.search).get('token') ??
      (store.order()?.reference === reference ? (store.order()?.orderToken ?? '') : '');
    showSheet(await buildOrderPage({ reference, token }), { dim: true, holdBar: false });
    return;
  }

  if (path === '/lookup') {
    showSheet(
      buildLookup({ onFound: (reference, token) => navigate(`/order/${reference}?token=${token}`) }),
      { dim: true, holdBar: false },
    );
    return;
  }

  if (path.startsWith('/staff')) {
    const identity = await readIdentity();
    chrome.setSignedIn(identity !== null);
    if (identity === null) {
      showSheet(buildStaffHome(null, !(await signInAvailable())), { dim: true, holdBar: false });
      return;
    }
    if (path === '/staff/packing') showSheet(buildPacking(), { dim: true, holdBar: false });
    else if (path === '/staff/dead-letters') showSheet(buildDeadLetters(), { dim: true, holdBar: false });
    else if (path === '/staff/refunds') showSheet(buildRefunds(), { dim: true, holdBar: false });
    else if (path === '/staff/rates') showSheet(buildRates(), { dim: true, holdBar: false });
    else if (path === '/staff/statements') showSheet(buildStatements(), { dim: true, holdBar: false });
    else if (path === '/staff/plates') showSheet(buildPlates(), { dim: true, holdBar: false });
    else showSheet(buildStaffHome(identity, false), { dim: true, holdBar: false });
    return;
  }

  showStory('top');
}

onShelfChange(() => {
  chrome.refreshBanner();
  shelfView?.refresh();
  refreshScene();
});

onHoldChange(() => {
  chrome.refreshHoldBar();
  shelfView?.refresh();
  const hold = heldBox();
  handle.setHold(hold?.remainingMs ?? null, hold?.holdMs ?? 1);
  if (hold === null && holdFocus) {
    holdFocus = false;
    handle.focusBox(null);
  }
  refreshScene();
});

async function boot(): Promise<void> {
  askAboutSound();
  await loadEdition().catch(() => undefined);
  await loadShelf().catch(() => undefined);
  openShelfStream();
  const hold = heldBox();
  if (hold !== null) {
    handle.setHold(hold.remainingMs, hold.holdMs);
    startPolling();
  }
  await render();
  chrome.refreshBanner();
  chrome.refreshHoldBar();
}

void boot();
