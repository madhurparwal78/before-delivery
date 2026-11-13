import { createRenderer, SceneState } from './scene.js';
import { chapterFor, STRIKE_CHAPTERS } from './chapters.js';
import { api, ApiError } from './api.js';
import { copy, errorCopy } from './copy.js';
import { formatOre } from '../shared/money.js';
import { shelfColumnsFor } from './cameraPath.js';

/** The published scene object. Writing to it changes nothing. */
const sceneState: SceneState = {
  progress: 0,
  chapter: 'alley',
  cameraPosition: { x: 0, y: 1.6, z: 6 },
  lightIntensity: 0,
  litMatches: 0,
  holdRemainingMs: null,
  matchLength: null,
};
Object.defineProperty(window, '__scene', { value: sceneState, writable: false, configurable: false });

const app = document.getElementById('app')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const narration = document.getElementById('narration') as HTMLAudioElement;

let renderer = createRenderer(canvas);
let boxes: { number: number; plate: string; state: string }[] = [];
let hold: { number: number; token: string; holdMs: number; remainingMs: number } | null = null;
let soundOn = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function navigate(path: string): void {
  history.pushState(null, '', path);
  route();
  playMotion(app, 'route');
}

window.addEventListener('popstate', () => route());

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string | boolean>, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === 'boolean') (node as unknown as Record<string, boolean>)[k] = v;
      else node.setAttribute(k, v);
    }
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(id: string, text: string): HTMLElement | null {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
  return node;
}

// ---------- Motion ----------

const MOTION_MS: Record<string, number> = {
  press: 120, focus: 160, shake: 240, count: 320, step: 420,
  'payment-state': 320, receipt: 480, row: 180, route: 480,
};

function playMotion(target: Element | null, name: string): void {
  if (!target) return;
  (target as HTMLElement).dataset.motion = name;
  if (reducedMotion) {
    target.getAnimations().forEach((a) => a.cancel());
    return;
  }
  const ms = MOTION_MS[name] ?? 200;
  (target as HTMLElement).animate(motionFrames(name), { duration: ms, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
}

function motionFrames(name: string): Keyframe[] {
  switch (name) {
    case 'press': return [{ transform: 'scale(1)' }, { transform: 'scale(0.97)' }, { transform: 'scale(1)' }];
    case 'focus': return [{ boxShadow: '0 0 0 0 rgba(228,180,84,0)' }, { boxShadow: '0 0 0 3px rgba(228,180,84,0.5)' }];
    case 'shake': return [
      { transform: 'translateX(0)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' },
    ];
    case 'count': return [{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }];
    case 'step': return [{ transform: 'translateX(16px)', opacity: '0.2' }, { transform: 'translateX(0)', opacity: '1' }];
    case 'payment-state': return [{ opacity: '0.2' }, { opacity: '1' }];
    case 'receipt': return [{ transform: 'scaleY(0.1)', opacity: '0' }, { transform: 'scaleY(1)', opacity: '1' }];
    case 'row': return [{ opacity: '0', transform: 'translateY(6px)' }, { opacity: '1', transform: 'translateY(0)' }];
    case 'route': return [{ opacity: '0' }, { opacity: '1' }];
    default: return [];
  }
}

document.addEventListener('pointerdown', (e) => {
  const button = (e.target as HTMLElement).closest('button');
  if (button) playMotion(button, 'press');
});
document.addEventListener('focusin', (e) => {
  const target = e.target as HTMLElement;
  if (target.matches('input, select, textarea, button, a, [tabindex]')) playMotion(target, 'focus');
});

// ---------- Sound ----------

const SOUND_KEY = 'press-sound';

function soundAsked(): boolean {
  return localStorage.getItem(SOUND_KEY) !== null;
}

function askSound(): void {
  const dialog = el('dialog');
  dialog.setAttribute('aria-label', 'Sound');
  const p = el('p', {}, 'Would you like to hear the story read aloud?');
  const on = el('button', {}, 'Sound on');
  const off = el('button', {}, 'Sound off');
  const skip = el('button', {}, 'Continue without sound');
  dialog.append(p, on, off, skip);
  document.body.appendChild(dialog);
  (dialog as HTMLDialogElement).showModal();
  on.focus();
  const choose = (kind: 'on' | 'off' | 'skip'): void => {
    localStorage.setItem(SOUND_KEY, kind === 'on' ? 'on' : 'off');
    soundOn = kind === 'on';
    (dialog as HTMLDialogElement).close();
    dialog.remove();
    route();
  };
  on.addEventListener('click', () => choose('on'));
  off.addEventListener('click', () => choose('off'));
  skip.addEventListener('click', () => choose('skip'));
}

function playNarration(chapter: string): void {
  if (!soundOn) return;
  narration.src = `/narration/${chapter}.ogg`;
  narration.play().catch(() => { /* autoplay refusals leave captions on */ });
}

// ---------- Story ----------

interface Passage { passageId: string; chapter: string; text: string }
let tale: Passage[] = [];

async function loadTale(): Promise<void> {
  if (tale.length > 0) return;
  const res = await fetch('/tale.json');
  tale = await res.json();
}

function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    const c = text[i];
    if (c === '.' || c === '!' || c === '?') {
      const next = text[i + 1];
      if (next === ' ' || next === '"' || next === undefined) {
        parts.push(buf.trim());
        buf = '';
      }
    }
  }
  if (buf.trim().length > 0) parts.push(buf.trim());
  return parts;
}

let litChapter: string | null = null;
let litWasBundle = false;

function renderStory(): void {
  document.title = 'The Last Bundle — Svovlstik Press';
  app.innerHTML = '';

  const main = el('main');
  const title = el('h1', {}, 'The Little Match-Seller');
  const credit = el('p', { class: 'credit' }, 'Hans Christian Andersen, translated by H. P. Paull');

  const captions = el('div', { role: 'region', 'aria-label': 'Captions', id: 'captions' });
  const status = el('div', { role: 'status', id: 'story-status' });

  const strike = el('button', { id: 'strike' }, 'Strike a match');
  strike.addEventListener('click', () => strikeMatch());

  const nextBtn = el('button', { id: 'next-chapter', class: 'chapter-step' }, 'Next chapter');
  const prevBtn = el('button', { id: 'prev-chapter', class: 'chapter-step' }, 'Previous chapter');
  nextBtn.addEventListener('click', () => stepChapter(1));
  prevBtn.addEventListener('click', () => stepChapter(-1));
  if (!(reducedMotion || !renderer)) {
    nextBtn.hidden = true;
    prevBtn.hidden = true;
  }

  const soundToggle = el('button', { id: 'sound-toggle', 'aria-pressed': String(soundOn) }, 'Sound');
  soundToggle.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
    soundToggle.setAttribute('aria-pressed', String(soundOn));
    if (soundOn) playNarration(sceneState.chapter);
    else narration.pause();
  });

  const shelfLink = el('a', { href: '/shelf', class: 'shelf-link' }, 'See the shelf of 240 boxes');

  const column = el('div', { class: 'story-column' });
  column.append(title, credit);
  for (const p of tale) {
    const section = el('section', { 'data-chapter': p.chapter, id: p.passageId });
    const h2 = el('h2', {}, chapterTitle(p.chapter));
    section.appendChild(h2);
    for (const sentence of splitSentences(p.text)) {
      section.appendChild(el('p', { class: 'sentence' }, sentence));
    }
    column.appendChild(section);
  }
  column.appendChild(shelfLink);

  main.append(column, captions);
  const toolbar = el('div', { class: 'story-toolbar' });
  toolbar.append(prevBtn, strike, nextBtn, soundToggle);
  main.appendChild(toolbar);
  main.appendChild(status);
  app.appendChild(main);

  // Captions always show: the sentence in focus.
  main.addEventListener('scroll', () => {
    const sentences = Array.from(main.querySelectorAll('.sentence')) as HTMLElement[];
    const mid = main.scrollTop + main.clientHeight / 2;
    let focused = sentences[0];
    for (const s of sentences) {
      if (s.offsetTop <= mid) focused = s;
    }
    if (focused) captions.textContent = focused.textContent ?? '';
  }, { passive: true });

  // The matchbox strikes by drag or tap.
  let dragging = false;
  let startX = 0;
  strike.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
  });
  window.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(e.clientX - startX) >= 80) strikeMatch();
  });
  strike.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      strikeMatch();
    }
  });
}

function chapterTitle(chapter: string): string {
  switch (chapter) {
    case 'alley': return 'I. The last evening of the old year';
    case 'stove': return 'II. The warm stove';
    case 'goose': return 'III. The roast goose';
    case 'tree': return 'IV. The Christmas-tree';
    case 'star': return 'V. The falling star';
    case 'grandmother': return 'VI. The grandmother';
    case 'shelf': return 'VII. The bundle of matches';
    default: return '';
  }
}

function stepChapter(delta: number): void {
  const chapters: readonly string[] = ['alley', 'stove', 'goose', 'tree', 'star', 'grandmother', 'shelf'];
  const idx = chapters.indexOf(sceneState.chapter);
  const next = chapters[Math.min(chapters.length - 1, Math.max(0, idx + delta))] as typeof sceneState.chapter;
  litChapter = null;
  sceneState.lightIntensity = 0;
  sceneState.litMatches = 0;
  const ranges: Record<string, [number, number]> = {
    alley: [0, 0.12], stove: [0.12, 0.3], goose: [0.3, 0.46], tree: [0.46, 0.62],
    star: [0.62, 0.72], grandmother: [0.72, 0.86], shelf: [0.86, 1],
  };
  const target = (ranges[next][0] + ranges[next][1]) / 2;
  const main = document.querySelector('main');
  if (main) {
    main.scrollTop = target * (main.scrollHeight - main.clientHeight);
  }
  sceneState.chapter = next;
  if (soundOn) playNarration(next);
}

function strikeMatch(): void {
  const chapter = sceneState.chapter;
  if (!STRIKE_CHAPTERS.includes(chapter as never)) return;
  if (litChapter === chapter && sceneState.lightIntensity > 0) return;
  litChapter = chapter;
  litWasBundle = chapter === 'grandmother';
  sceneState.litMatches = litWasBundle ? 12 : 1;
  sceneState.lightIntensity = litWasBundle ? 2 : 1;
  setStatus('story-status', '');
  if (reducedMotion || !renderer) {
    // Under reduced motion the vision stays lit until the reader moves on.
    if (soundOn) playNarration(chapter);
    return;
  }
  if (soundOn) playNarration(chapter);
  setTimeout(() => {
    if (litChapter !== chapter) return;
    sceneState.lightIntensity = 0;
    sceneState.litMatches = 0;
    litChapter = null;
    setStatus('story-status', litWasBundle ? copy.story.bundleOut : copy.story.matchOut);
  }, 12_000);
}

// ---------- Shelf ----------

function renderShelf(): void {
  document.title = 'The shelf — Svovlstik Press';
  app.innerHTML = '';
  const wrap = el('div', { class: 'shelf-screen' });
  const banner = el('div', { role: 'alert', id: 'sales-banner', 'aria-label': 'Sales banner' });
  const search = el('input', { role: 'searchbox', type: 'search', id: 'shelf-search', 'aria-label': 'Search the tale and the shelf' });
  const results = el('ul', { role: 'list', id: 'search-results', 'aria-label': 'Search results' });
  const searchStatus = el('div', { role: 'status', id: 'search-status' });
  const grid = el('div', { role: 'grid', id: 'box-grid', 'aria-label': 'Box shelf' });
  const holdBar = renderHoldBar();

  wrap.append(banner, search, searchStatus, results, grid, holdBar);
  app.appendChild(wrap);

  void refreshShelf();
  restoreHold();
  wireSearch(search, results, searchStatus);
  focusRovingGrid(grid);
}

function renderHoldBar(): HTMLElement {
  const bar = el('div', { role: 'region', id: 'hold-bar', 'aria-label': 'Hold bar' });
  const timer = el('span', { role: 'timer', id: 'hold-timer', 'aria-label': 'Time left' }, '');
  const status = el('span', { role: 'status', id: 'hold-status' });
  const heldCount = el('span', { role: 'status', id: 'boxes-held', 'aria-label': 'Boxes held' }, '0');
  const checkoutBtn = el('button', { id: 'go-checkout' }, 'Go to checkout');
  const putBack = el('button', { id: 'put-back' }, 'Put it back');
  checkoutBtn.addEventListener('click', () => navigate('/checkout'));
  putBack.addEventListener('click', async () => {
    if (!hold) return;
    const releasedNumber = hold.number;
    try {
      await api.releaseHold(hold.number, hold.token);
      setStatus('hold-status', copy.hold.released(releasedNumber));
      setHold(null);
      await refreshShelf();
      const grid = document.getElementById('box-grid');
      if (grid) {
        const cell = grid.querySelector(`[data-number="${releasedNumber}"]`) as HTMLElement | null;
        if (cell) {
          cell.tabIndex = 0;
          cell.focus();
        }
      }
    } catch (err) {
      if (err instanceof ApiError) setStatus('hold-status', errorCopy(err.code));
    }
  });
  bar.append(timer, status, heldCount, checkoutBtn, putBack);
  updateHoldBar(bar);
  return bar;
}

function updateHoldBar(bar: HTMLElement): void {
  const timer = bar.querySelector('#hold-timer') as HTMLElement;
  const checkoutBtn = bar.querySelector('#go-checkout') as HTMLElement;
  const putBack = bar.querySelector('#put-back') as HTMLElement;
  if (!hold) {
    timer.textContent = '';
    checkoutBtn.hidden = true;
    putBack.hidden = true;
    sceneState.holdRemainingMs = null;
    sceneState.matchLength = null;
    return;
  }
  const ms = Math.max(0, hold.remainingMs);
  const total = hold.holdMs;
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  timer.textContent = `${mm}:${ss}`;
  sceneState.holdRemainingMs = ms;
  sceneState.matchLength = Math.max(0, ms / total);
  checkoutBtn.hidden = false;
  putBack.hidden = false;
}

function setHold(h: typeof hold): void {
  hold = h;
  // The hold token stays with the browser session so a reload keeps counting
  // down from the server's answer, with no gain.
  if (h) sessionStorage.setItem('press-hold', JSON.stringify(h));
  else sessionStorage.removeItem('press-hold');
  const bar = document.getElementById('hold-bar');
  if (bar) updateHoldBar(bar);
  const held = document.getElementById('boxes-held');
  if (held) {
    held.textContent = h ? '1' : '0';
    playMotion(held, 'count');
  }
}

function restoreHold(): void {
  const raw = sessionStorage.getItem('press-hold');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { number: number; token: string; holdMs: number; remainingMs: number };
    void api.holdRemaining(parsed.number, parsed.token).then((r) => {
      hold = { ...parsed, remainingMs: r.remainingMs };
      const bar = document.getElementById('hold-bar');
      if (bar) updateHoldBar(bar);
      const held = document.getElementById('boxes-held');
      if (held) held.textContent = '1';
      setStatus('hold-status', copy.hold.granted(parsed.number));
    }).catch(() => {
      sessionStorage.removeItem('press-hold');
    });
  } catch { /* no hold */ }
}

async function refreshShelf(): Promise<void> {
  try {
    const data = await api.shelf();
    boxes = data.boxes;
    const banner = document.getElementById('sales-banner');
    if (banner) banner.textContent = data.salesPaused ? copy.banner.salesPaused : '';
    const grid = document.getElementById('box-grid');
    if (grid) {
      grid.innerHTML = '';
      const columns = shelfColumnsFor(window.innerWidth);
      // A DOM grid in step with the 3D boxes: rows of cells.
      for (let r = 0; r * columns < boxes.length; r++) {
        const row = el('div', { role: 'row', class: 'shelf-row' });
        row.style.setProperty('grid-template-columns', `repeat(${columns}, minmax(44px, 1fr))`);
        for (let c = 0; c < columns; c++) {
          const b = boxes[r * columns + c];
          if (!b) break;
          const cell = el('div', {
            role: 'gridcell',
            class: `box-cell ${b.state}`,
            'data-number': String(b.number),
          }, '');
          cell.setAttribute('aria-label', `Box ${b.number}, ${b.plate}, ${b.state}`);
          cell.tabIndex = -1;
          const shape = b.state === 'taken' ? '▮' : b.state === 'held' ? '❖' : '▪';
          cell.append(
            el('span', { class: 'box-shape', 'aria-hidden': 'true' }, shape),
            el('span', { class: 'box-number' }, String(b.number)),
            el('span', { class: 'box-plate' }, b.plate),
            el('span', { class: 'box-state' }, b.state),
          );
          cell.addEventListener('click', () => void chooseBox(b.number, grid));
          cell.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void chooseBox(b.number, grid);
            }
          });
          row.appendChild(cell);
        }
        grid.appendChild(row);
      }
      const first = grid.querySelector('[role=gridcell]') as HTMLElement | null;
      if (first) first.tabIndex = 0;
    }
  } catch { /* the shelf keeps the last known state */ }
}

function focusRovingGrid(grid: HTMLElement): void {
  grid.tabIndex = 0;
  grid.addEventListener('keydown', (e) => {
    const cells = Array.from(grid.querySelectorAll('[role=gridcell]')) as HTMLElement[];
    const current = document.activeElement as HTMLElement;
    const idx = current ? cells.indexOf(current) : -1;
    const columns = shelfColumnsFor(window.innerWidth);
    let target = -1;
    if (/^[0-9]$/.test(e.key)) {
      typeBuffer += e.key;
      clearTimeout(typeTimer);
      const buffer = typeBuffer;
      typeTimer = window.setTimeout(() => {
        const n = Number(buffer);
        if (n >= 1 && n <= 240) {
          const cell = cells[n - 1];
          if (cell) {
            cell.focus();
            void chooseBox(n, grid);
          }
        }
        typeBuffer = '';
      }, 500);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'ArrowRight': target = Math.min(cells.length - 1, idx + 1); break;
      case 'ArrowLeft': target = Math.max(0, idx - 1); break;
      case 'ArrowDown': target = Math.min(cells.length - 1, idx + columns); break;
      case 'ArrowUp': target = Math.max(0, idx - columns); break;
      case 'Home': target = 0; break;
      case 'End': target = cells.length - 1; break;
      default: return;
    }
    e.preventDefault();
    if (target >= 0 && cells[target]) {
      cells.forEach((c) => (c.tabIndex = -1));
      cells[target].tabIndex = 0;
      cells[target].focus();
      grid.setAttribute('aria-activedescendant', cells[target].dataset.number ?? '');
    }
  });
}

let typeBuffer = '';
let typeTimer = 0;

async function chooseBox(number: number, grid: HTMLElement): Promise<void> {
  if (hold && hold.number === number) {
    navigate('/checkout');
    return;
  }
  setStatus('hold-status', copy.hold.pending(number));
  try {
    const h = await api.takeHold(number, hold?.token);
    setHold({ number, token: h.holdToken, holdMs: h.holdMs, remainingMs: h.remainingMs });
    setStatus('hold-status', copy.hold.granted(number));
    void refreshShelf();
    const checkoutBtn = document.getElementById('go-checkout');
    if (checkoutBtn) checkoutBtn.focus();
    void grid;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'box_held') setStatus('hold-status', copy.hold.boxHeld(number));
      else if (err.code === 'box_taken') setStatus('hold-status', copy.hold.boxTaken(number));
      else setStatus('hold-status', errorCopy(err.code));
    }
  }
}

function wireSearch(input: HTMLInputElement, results: HTMLElement, status: HTMLElement): void {
  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    timer = window.setTimeout(async () => {
      if (q.length === 0) {
        results.innerHTML = '';
        status.textContent = '';
        return;
      }
      try {
        const data = await api.search(q);
        results.innerHTML = '';
        for (const hit of data.hits) {
          const li = el('li');
          const a = hit.kind === 'passage'
            ? el('a', { href: `/${String(hit.chapter)}`, class: 'result-passage' }, `${String(hit.excerpt).slice(0, 80)}…`)
            : el('a', { href: `/box/${String(hit.number)}`, class: 'result-box' }, `Box ${String(hit.number)} — ${String(hit.plate)} (${String(hit.state)})`);
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (hit.kind === 'passage') {
              localStorage.setItem('jump-passage', String(hit.passageId));
              navigate('/');
              setTimeout(() => {
                const section = document.getElementById(String(hit.passageId));
                if (section) section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
              }, 150);
            } else {
              navigate(`/box/${String(hit.number)}`);
            }
          });
          li.appendChild(a);
          results.appendChild(li);
        }
        status.textContent = '';
      } catch {
        status.textContent = 'Search is resting. The tale and the shelf still work.';
      }
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      const first = results.querySelector('a') as HTMLElement | null;
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

// ---------- Box page ----------

async function renderBoxPage(number: number): Promise<void> {
  document.title = `Box ${number} — Svovlstik Press`;
  app.innerHTML = '';
  try {
    const b = await api.box(number);
    const edition = await api.edition();
    const sheet = el('div', { class: 'sheet box-sheet' });
    const back = el('a', { href: '/shelf', class: 'back-link' }, 'Back to the shelf');
    const h = el('h1', {}, `Box ${b.number}`);
    const plate = el('p', { class: 'plate' }, `Plate: ${b.plate}`);
    const state = el('p', { class: 'state' }, `State: ${b.state}`);
    const price = el('p', { class: 'price' }, `DKK ${formatOre(edition.priceOre)} including courier`);
    const charity = el('p', { class: 'charity' }, `Charity share of this box: DKK ${formatOre(edition.charityOre)} to ${edition.charityName}`);
    const art = el('img', { alt: `Plate art for ${b.plate}`, class: 'plate-art' });
    if (b.artUrl) art.setAttribute('src', b.artUrl);
    else art.classList.add('procedural');
    const choose = el('button', { class: 'primary' }, 'Choose this number');
    choose.addEventListener('click', () => {
      navigate('/shelf');
      setTimeout(() => void chooseBox(b.number, document.getElementById('box-grid')!), 400);
    });
    sheet.append(back, h, plate, state, price, charity, art, choose);
    app.appendChild(sheet);
  } catch {
    const sheet = el('div', { class: 'sheet' });
    sheet.appendChild(el('p', {}, 'We could not find that.'));
    app.appendChild(sheet);
  }
}

// ---------- Checkout ----------

function field(label: string, name: string, type: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('div', { class: 'field' });
  const input = el('input', { type, 'aria-label': label });
  input.id = `f-${name.replace(/\./g, '-')}`;
  const lab = el('label', { for: input.id }, label);
  wrap.append(lab, input);
  return { wrap, input };
}

function renderCheckout(): void {
  document.title = 'Checkout — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet checkout-sheet' });
  const form = el('form', { id: 'checkout-form' });
  form.setAttribute('aria-label', 'Checkout');
  const h = el('h1', {}, 'Checkout');
  const errors = el('div', { role: 'alert', id: 'checkout-errors', 'aria-label': 'Checkout errors' });

  const name = field('Your name', 'buyer.name', 'text');
  const email = field('Your email', 'buyer.email', 'email');
  const street = field('Street', 'address.street', 'text');
  const postcode = field('Postcode', 'address.postcode', 'text');
  const city = field('City', 'address.city', 'text');

  const giftCheck = el('input', { type: 'checkbox', id: 'gift-check' });
  giftCheck.setAttribute('aria-label', 'This is a gift');
  const giftLabel = el('label', { for: 'gift-check' }, 'This is a gift');
  const giftFields = el('div', { id: 'gift-fields', hidden: 'true' });
  const recipientName = field('Recipient name', 'gift.recipientName', 'text');
  const recipientEmail = field('Recipient email', 'gift.recipientEmail', 'email');
  const message = field('Gift message', 'gift.message', 'text');
  giftFields.append(recipientName.wrap, recipientEmail.wrap, message.wrap);
  giftCheck.addEventListener('change', () => {
    giftFields.hidden = !giftCheck.checked;
    playMotion(giftFields, 'step');
  });

  const methodCard = el('input', { type: 'radio', name: 'method', id: 'method-card', value: 'card' });
  methodCard.setAttribute('aria-label', 'Card');
  methodCard.checked = true;
  const cardLabel = el('label', { for: 'method-card' }, 'Card');
  const methodBank = el('input', { type: 'radio', name: 'method', id: 'method-bank', value: 'bank' });
  methodBank.setAttribute('aria-label', 'Bank transfer');
  const bankLabel = el('label', { for: 'method-bank' }, 'Bank transfer');

  const cardFields = el('div', { id: 'card-fields' });
  const cardNumber = field('Card number', 'card.number', 'text');
  const cardExpiry = field('Expiry', 'card.expiry', 'text');
  const cardCvc = field('Security code', 'card.cvc', 'text');
  cardFields.append(cardNumber.wrap, cardExpiry.wrap, cardCvc.wrap);
  methodBank.addEventListener('change', () => { cardFields.hidden = true; });
  methodCard.addEventListener('change', () => { cardFields.hidden = false; });

  const submit = el('button', { type: 'submit', class: 'primary', id: 'authorise' }, 'Authorise DKK 1,584.00');
  const transferBtn = el('button', { type: 'button', id: 'reserve-transfer' }, 'Reserve for bank transfer');
  const status = el('div', { role: 'status', id: 'payment-status' });

  form.append(h, errors,
    name.wrap, email.wrap, street.wrap, postcode.wrap, city.wrap,
    giftCheck, giftLabel, giftFields,
    methodCard, cardLabel, methodBank, bankLabel,
    cardFields, submit, transferBtn);
  sheet.append(form, status, renderHoldBar());
  restoreHold();
  app.appendChild(sheet);

  transferBtn.hidden = true;
  methodBank.addEventListener('change', () => {
    transferBtn.hidden = false;
    submit.hidden = true;
  });
  methodCard.addEventListener('change', () => {
    transferBtn.hidden = true;
    submit.hidden = false;
  });

  const submitCheckout = async (method: 'card' | 'bank'): Promise<void> => {
    errors.textContent = '';
    document.querySelectorAll('.field-error').forEach((n) => n.remove());
    status.textContent = copy.payment.started;
    playMotion(status, 'payment-state');
    const body: Record<string, unknown> = {
      number: hold?.number,
      method,
      buyer: { name: name.input.value, email: email.input.value },
      address: { street: street.input.value, postcode: postcode.input.value, city: city.input.value },
    };
    if (giftCheck.checked) {
      body.gift = {
        recipientName: recipientName.input.value,
        recipientEmail: recipientEmail.input.value,
        message: message.input.value,
      };
    }
    if (method === 'card') {
      body.card = { number: cardNumber.input.value, expiry: cardExpiry.input.value, cvc: cardCvc.input.value };
    }
    const key = `attempt-${crypto.randomUUID()}`;
    try {
      const reply = await api.checkout(body, hold?.token ?? '', key);
      if (reply.challenge) {
        status.textContent = copy.payment.challenge;
        showBankCheck(reply.reference, reply.orderToken, status);
        return;
      }
      if (reply.transfer) {
        status.textContent = copy.payment.pending;
        setHold(null);
        navigate(`/order/${reply.reference}?token=${reply.orderToken}`);
        return;
      }
      status.textContent = copy.payment.authorised;
      setHold(null);
      navigate(`/order/${reply.reference}?token=${reply.orderToken}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = err.fields ?? {};
        for (const [k, v] of Object.entries(fieldErrors)) {
          const input = document.getElementById(`f-${k.replace(/\./g, '-')}`) as HTMLElement | null;
          if (input) {
            input.setAttribute('aria-invalid', 'true');
            input.parentElement?.appendChild(el('p', { class: 'field-error' }, v));
          }
        }
        if (Object.keys(fieldErrors).length > 0) {
          errors.textContent = 'Please check the highlighted fields.';
          playMotion(form, 'shake');
        } else {
          errors.textContent = errorCopy(err.code);
          if (copy.declines[err.code as keyof typeof copy.declines]) {
            status.textContent = copy.payment.challenge;
          }
        }
      }
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitCheckout('card');
  });
  transferBtn.addEventListener('click', () => void submitCheckout('bank'));
}

function showBankCheck(reference: string, orderToken: string, status: HTMLElement): void {
  const dialog = el('dialog');
  dialog.setAttribute('aria-label', 'Bank check');
  const p = el('p', {}, "Your bank wants to check it is you. Enter the one-time code (this bank's test code is 1234).");
  const code = el('input', { type: 'text', 'aria-label': 'One-time code' });
  const approve = el('button', { class: 'primary' }, 'Approve');
  const cancel = el('button', {}, 'Cancel');
  dialog.append(p, code, approve, cancel);
  document.body.appendChild(dialog);
  (dialog as HTMLDialogElement).showModal();
  code.focus();

  const opener = document.activeElement as HTMLElement;
  dialog.addEventListener('close', () => {
    dialog.remove();
    opener?.focus();
  });

  approve.addEventListener('click', async () => {
    try {
      await api.answerChallenge(reference, { code: code.value }, hold?.token ?? '');
      (dialog as HTMLDialogElement).close();
      status.textContent = copy.payment.authorised;
      navigate(`/order/${reference}?token=${orderToken}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const box = document.getElementById('checkout-errors');
        if (box) box.textContent = errorCopy(err.code);
        playMotion(dialog, 'shake');
      }
    }
  });
  cancel.addEventListener('click', async () => {
    try {
      await api.answerChallenge(reference, { cancel: true }, hold?.token ?? '');
    } catch { /* the hold keeps burning */ }
    (dialog as HTMLDialogElement).close();
  });
}

// ---------- Order page ----------

async function renderOrderPage(reference: string, token: string): Promise<void> {
  document.title = `Order ${reference} — Svovlstik Press`;
  app.innerHTML = '';
  try {
    const o = await api.order(reference, token);
    const sheet = el('div', { class: 'sheet order-sheet' });
    const h = el('h1', {}, `Order ${o.reference}`);
    const status = el('div', { role: 'status', id: 'payment-status' });
    status.textContent = paymentCopy(o.paymentState, o.number);
    playMotion(status, 'payment-state');
    const box = el('p', {}, `Box ${o.number} — plate: ${o.plate}`);
    const total = el('p', {}, `Total: DKK ${formatOre(o.totalOre)}`);
    const charity = el('p', {}, `Charity share: DKK ${formatOre(o.charityOre)}`);
    sheet.append(h, status, box, total, charity);
    if (o.transfer) {
      const t = el('div', { class: 'transfer-details' });
      t.append(
        el('p', {}, `IBAN: ${o.transfer.iban}`),
        el('p', {}, `Payment reference: ${o.transfer.paymentReference}`),
        el('p', {}, `Amount: DKK ${formatOre(o.transfer.amountOre)}`),
        el('p', {}, `Deadline: ${o.transfer.deadlineAt}`),
      );
      sheet.appendChild(t);
    }
    if (o.certificate.state === 'issued') {
      sheet.appendChild(el('a', { href: `/api/orders/${o.reference}/certificate?token=${encodeURIComponent(token)}`, class: 'primary' }, 'Download certificate'));
    } else if (o.certificate.state === 'pending') {
      sheet.appendChild(el('p', {}, copy.lookup.certificatePending));
    } else if (o.certificate.state === 'cancelled') {
      sheet.appendChild(el('p', {}, copy.lookup.certificateCancelled));
    }
    sheet.appendChild(el('a', { href: '/', class: 'back-link' }, 'Back to the tale'));
    app.appendChild(sheet);
    playMotion(sheet, 'receipt');
  } catch {
    const sheet = el('div', { class: 'sheet' });
    sheet.appendChild(el('p', {}, copy.lookup.refused));
    app.appendChild(sheet);
  }
}

function paymentCopy(state: string, number: number): string {
  switch (state) {
    case 'started': return copy.payment.started;
    case 'challenge': return copy.payment.challenge;
    case 'authorised': return copy.payment.authorised;
    case 'captured': return copy.payment.captured;
    case 'partially_refunded': return copy.payment.partiallyRefunded;
    case 'refunded': return copy.payment.refunded;
    case 'voided': return copy.payment.voided;
    case 'capture_failed': return copy.payment.captureFailed;
    case 'authorisation_expired': return copy.payment.authorisationExpired;
    case 'pending': return copy.payment.pending;
    case 'settled': return copy.payment.settled;
    case 'lapsed': return copy.payment.lapsed(number);
    default: return copy.payment.authorised;
  }
}

// ---------- Lookup ----------

function renderLookup(): void {
  document.title = 'Find your order — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet lookup-sheet' });
  const form = el('form', { id: 'lookup-form' });
  form.setAttribute('aria-label', 'Find your order');
  const h = el('h1', {}, 'Find your order');
  const ref = field('Order reference', 'reference', 'text');
  const email = field('Email', 'email', 'email');
  const submit = el('button', { type: 'submit', class: 'primary' }, 'Find my order');
  const alert = el('div', { role: 'alert', id: 'lookup-message', 'aria-label': 'Lookup message' });
  form.append(h, ref.wrap, email.wrap, submit);
  sheet.append(form, alert);
  app.appendChild(sheet);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.textContent = '';
    try {
      const r = await api.lookup(ref.input.value.trim(), email.input.value.trim());
      navigate(`/order/${r.reference}?token=${r.orderToken}`);
    } catch (err) {
      if (err instanceof ApiError) {
        alert.textContent = errorCopy(err.code);
        playMotion(form, 'shake');
      }
    }
  });
}

// ---------- Staff ----------

async function renderStaff(): Promise<void> {
  document.title = 'Staff — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet staff-sheet' });
  const h = el('h1', {}, 'Staff');
  let me: { username: string; roles: string[] } | null = null;
  try {
    me = await api.staff.me();
  } catch { me = null; }
  if (!me) {
    sheet.append(h, el('a', { href: '/auth/login', class: 'primary' }, 'Staff sign-in'));
    app.appendChild(sheet);
    return;
  }
  const roles = me.roles.filter((r) => ['maker', 'packer', 'treasurer'].includes(r));
  const who = el('p', { class: 'who' }, `Signed in as ${me.username} (${roles.join(', ')})`);
  const signOut = el('button', {}, 'Sign out');
  signOut.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.href = '/staff';
  });
  const nav = el('nav', { class: 'staff-nav' });
  if (me.roles.includes('packer')) {
    nav.append(el('a', { href: '/staff/packing' }, 'Packing'), el('a', { href: '/staff/dead-letters' }, 'Dead letters'));
  }
  if (me.roles.includes('treasurer')) {
    nav.append(el('a', { href: '/staff/refunds' }, 'Refunds'), el('a', { href: '/staff/rates' }, 'Rates'), el('a', { href: '/staff/statements' }, 'Statements'));
  }
  if (me.roles.includes('maker')) {
    nav.append(el('a', { href: '/staff/plates' }, 'Plates'));
  }
  sheet.append(h, who, signOut, nav);
  app.appendChild(sheet);
}

async function renderPacking(): Promise<void> {
  document.title = 'Packing — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet staff-sheet' });
  const h = el('h1', {}, 'Packing');
  const search = el('input', { type: 'search', 'aria-label': 'Search boxes' });
  const status = el('div', { role: 'status', id: 'staff-status' });
  const list = el('div', { class: 'staff-list', id: 'orders-list' });
  sheet.append(h, search, status, list);
  app.appendChild(sheet);

  const data = await api.staff.orders();
  renderPackingRows(list, data.orders as Record<string, unknown>[]);
  search.addEventListener('input', async () => {
    const q = search.value.trim();
    if (!q) {
      renderPackingRows(list, data.orders as Record<string, unknown>[]);
      return;
    }
    try {
      const r = await api.staff.search(q);
      const numbers = new Set(r.hits.map((x) => Number(x.number)));
      renderPackingRows(list, (data.orders as Record<string, unknown>[]).filter((o) => numbers.has(Number(o.number))));
      if (r.degraded) status.textContent = copy.staff.searchFallback;
    } catch {
      status.textContent = copy.staff.searchFallback;
    }
  });
}

function renderPackingRows(list: HTMLElement, orders: Record<string, unknown>[]): void {
  list.innerHTML = '';
  const status = document.getElementById('staff-status')!;
  const narrow = window.innerWidth < 768;
  if (narrow) {
    orders.forEach((o, i) => {
      const card = el('article', { class: 'order-card' });
      card.appendChild(el('h2', {}, `Box ${o.number}`));
      card.appendChild(el('p', {}, String(o.reference)));
      card.appendChild(el('p', {}, String((o.recipientName as string) ?? '')));
      card.appendChild(el('p', {}, `${o.boxState} · ${o.paymentState}`));
      card.appendChild(el('p', {}, o.trackingCode ? String(o.trackingCode) : ''));
      const pack = el('button', {}, 'Pack');
      pack.addEventListener('click', () => void doPack(String(o.reference), Number(o.number), status));
      card.appendChild(pack);
      if (o.boxState === 'returned') {
        const back = el('button', {}, 'Back on the shelf');
        back.addEventListener('click', async () => {
          try {
            await api.staff.backOnShelf(Number(o.number));
            status.textContent = copy.staff.backOnShelf(Number(o.number));
            setTimeout(() => location.reload(), 700);
          } catch (err) {
            status.textContent = err instanceof ApiError ? errorCopy(err.code) : '';
          }
        });
        card.appendChild(back);
      }
      list.appendChild(card);
      if (i < 10) setTimeout(() => playMotion(card, 'row'), i * 30);
    });
    return;
  }
  const table = el('table');
  table.setAttribute('aria-label', 'Orders');
  const head = el('tr', {});
  for (const label of ['Box', 'Reference', 'Recipient', 'State', 'Payment', 'Tracking', '']) {
    head.appendChild(el('th', {}, label));
  }
  table.appendChild(head);
  orders.forEach((o, i) => {
    const row = el('tr');
    row.appendChild(el('td', {}, String(o.number)));
    row.appendChild(el('td', {}, String(o.reference)));
    row.appendChild(el('td', {}, String((o.recipientName as string) ?? '')));
    row.appendChild(el('td', {}, String(o.boxState)));
    row.appendChild(el('td', {}, String(o.paymentState)));
    row.appendChild(el('td', {}, o.trackingCode ? String(o.trackingCode) : '—'));
    const actions = el('td');
    const pack = el('button', {}, 'Pack');
    pack.addEventListener('click', () => void doPack(String(o.reference), Number(o.number), status));
    actions.appendChild(pack);
    if (o.boxState === 'returned') {
      const back = el('button', {}, 'Back on the shelf');
      back.addEventListener('click', async () => {
        try {
          await api.staff.backOnShelf(Number(o.number));
          status.textContent = copy.staff.backOnShelf(Number(o.number));
          setTimeout(() => location.reload(), 700);
        } catch (err) {
          status.textContent = err instanceof ApiError ? errorCopy(err.code) : '';
        }
      });
      actions.appendChild(back);
    }
    row.appendChild(actions);
    table.appendChild(row);
    if (i < 10) setTimeout(() => playMotion(row, 'row'), i * 30);
  });
  list.appendChild(table);
}

async function doPack(reference: string, number: number, status: HTMLElement): Promise<void> {
  status.textContent = copy.staff.packingStarted(number);
  try {
    const r = await api.staff.pack(reference) as { packing: string };
    status.textContent = r.packing === 'done' ? copy.staff.packed(number) : copy.staff.packingStarted(number);
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    if (err instanceof ApiError) {
      status.textContent = err.code === 'capture_refused'
        ? copy.staff.captureRefused(number)
        : err.code === 'gateway_unreachable' ? copy.outage.gatewayPack
        : err.code === 'ledger_unreachable' ? copy.outage.ledgerPack
        : errorCopy(err.code);
    }
  }
}

async function renderDeadLetters(): Promise<void> {
  document.title = 'Dead letters — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet staff-sheet' });
  const h = el('h1', {}, 'Dead letters');
  const status = el('div', { role: 'status', id: 'staff-status' });
  const list = el('div', { class: 'staff-list', id: 'dead-list' });
  sheet.append(h, status, list);
  app.appendChild(sheet);
  try {
    const data = await api.staff.deadLetters();
    if (data.events.length === 0) {
      status.textContent = copy.staff.noDeadLetters;
      return;
    }
    const table = el('table');
    table.setAttribute('aria-label', 'Dead letters');
    for (const label of ['Event', 'Type', 'Box', 'Last error', 'Actions']) {
      table.appendChild(el('th', {}, label));
    }
    for (const ev of data.events) {
      const row = el('tr');
      row.appendChild(el('td', {}, String(ev.eventId)));
      row.appendChild(el('td', {}, String(ev.type)));
      row.appendChild(el('td', {}, String(ev.boxNumber)));
      row.appendChild(el('td', {}, String(ev.lastError)));
      const actions = el('td');
      const retry = el('button', {}, 'Retry');
      retry.addEventListener('click', async () => {
        try {
          await api.staff.retryDead(String(ev.eventId));
          status.textContent = copy.staff.deadLetterRetried;
          setTimeout(() => location.reload(), 700);
        } catch (err) {
          status.textContent = err instanceof ApiError ? errorCopy(err.code) : '';
        }
      });
      const dismiss = el('button', {}, 'Dismiss');
      const note = el('input', { type: 'text', 'aria-label': 'Dismissal note' });
      dismiss.addEventListener('click', async () => {
        try {
          await api.staff.dismissDead(String(ev.eventId), note.value);
          status.textContent = copy.staff.deadLetterDismissed;
          setTimeout(() => location.reload(), 700);
        } catch (err) {
          status.textContent = err instanceof ApiError ? errorCopy(err.code) : 'Add a note of up to 280 characters.';
        }
      });
      actions.append(retry, dismiss, note);
      row.appendChild(actions);
      table.appendChild(row);
    }
    list.appendChild(table);
  } catch (err) {
    status.textContent = err instanceof ApiError && err.code === 'queue_unreachable'
      ? 'The dead-letter list cannot be read right now. Nothing is lost.'
      : '';
  }
}

async function renderRefunds(): Promise<void> {
  document.title = 'Refunds — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet staff-sheet' });
  const h = el('h1', {}, 'Refunds');
  const status = el('div', { role: 'status', id: 'staff-status' });
  const list = el('div', { class: 'staff-list' });
  const ledger = el('div', { role: 'region', id: 'ledger', 'aria-label': 'Ledger' });
  sheet.append(h, status, list, ledger);
  app.appendChild(sheet);
  const data = await api.staff.ledgerOrders();
  const narrow = window.innerWidth < 768;
  if (narrow) {
    for (const o of data.orders) {
      const card = el('article', { class: 'order-card' });
      card.appendChild(el('h2', {}, `Box ${o.number}`));
      card.appendChild(el('p', {}, String(o.reference)));
      card.appendChild(el('p', {}, `${o.paymentState} · ${o.boxState}`));
      const amount = el('input', { type: 'number', 'aria-label': 'Refund amount in DKK' });
      const btn = el('button', {}, 'Refund');
      const rest = el('button', {}, 'Refund the rest');
      const wireRefund = async (amountOre: number | null): Promise<void> => {
        if (amountOre === null) {
          status.textContent = 'Enter an amount above zero.';
          return;
        }
        try {
          const r = await api.staff.refund(String(o.reference), amountOre, `refund-${crypto.randomUUID()}`);
          status.textContent = (r as { state: string }).state === 'settled' ? copy.staff.refundSettled : copy.staff.refundPending;
          void showLedger(String(o.reference), ledger);
        } catch (err) {
          status.textContent = err instanceof ApiError
            ? err.code === 'gateway_unreachable' ? copy.outage.gatewayRefund
            : err.code === 'ledger_unreachable' ? copy.outage.ledgerRefund
            : errorCopy(err.code) : '';
        }
      };
      btn.addEventListener('click', () => {
        const kroner = Number((amount as HTMLInputElement).value);
        void wireRefund(Number.isFinite(kroner) && kroner > 0 ? Math.round(kroner * 100) : null);
      });
      rest.addEventListener('click', async () => {
        const rem = await api.staff.refundRemainder(String(o.reference));
        void wireRefund(rem.amountOre);
      });
      card.append(amount, btn, rest);
      list.appendChild(card);
    }
    return;
  }
  const table = el('table');
  table.setAttribute('aria-label', 'Ledger orders');
  for (const label of ['Box', 'Reference', 'Payment', 'Box state', 'Gross', 'Actions']) {
    table.appendChild(el('th', {}, label));
  }
  for (const o of data.orders) {
    const row = el('tr');
    row.appendChild(el('td', {}, String(o.number)));
    row.appendChild(el('td', {}, String(o.reference)));
    row.appendChild(el('td', {}, String(o.paymentState)));
    row.appendChild(el('td', {}, String(o.boxState)));
    row.appendChild(el('td', {}, `DKK ${formatOre(Number(o.grossOre))}`));
    const actions = el('td');
    const amount = el('input', { type: 'number', 'aria-label': 'Refund amount in DKK' });
    const btn = el('button', {}, 'Refund');
    const rest = el('button', {}, 'Refund the rest');
    btn.addEventListener('click', async () => {
      const kroner = Number((amount as HTMLInputElement).value);
      if (!Number.isFinite(kroner) || kroner <= 0) {
        status.textContent = 'Enter an amount above zero.';
        return;
      }
      try {
        const r = await api.staff.refund(String(o.reference), Math.round(kroner * 100), `refund-${crypto.randomUUID()}`);
        status.textContent = (r as { state: string }).state === 'settled' ? copy.staff.refundSettled : copy.staff.refundPending;
        void showLedger(String(o.reference), ledger);
      } catch (err) {
        status.textContent = err instanceof ApiError
          ? err.code === 'gateway_unreachable' ? copy.outage.gatewayRefund
          : err.code === 'ledger_unreachable' ? copy.outage.ledgerRefund
          : errorCopy(err.code) : '';
      }
    });
    rest.addEventListener('click', async () => {
      try {
        const rem = await api.staff.refundRemainder(String(o.reference));
        const r = await api.staff.refund(String(o.reference), rem.amountOre, `refund-${crypto.randomUUID()}`);
        status.textContent = (r as { state: string }).state === 'settled' ? copy.staff.refundSettled : copy.staff.refundPending;
        void showLedger(String(o.reference), ledger);
      } catch (err) {
        status.textContent = err instanceof ApiError ? errorCopy(err.code) : '';
      }
    });
    actions.append(amount, btn, rest);
    row.appendChild(actions);
    table.appendChild(row);
  }
  list.appendChild(table);
}

async function showLedger(reference: string, region: HTMLElement): Promise<void> {
  try {
    const l = await api.staff.ledger(reference);
    region.innerHTML = '';
    region.appendChild(el('h2', {}, `Ledger for ${reference}`));
    const totals = l.totals as Record<string, number>;
    region.appendChild(el('p', {}, `Charity: DKK ${formatOre(totals.charityOre)} · Maker: DKK ${formatOre(totals.makerOre)} · VAT: DKK ${formatOre(totals.vatOre)}`));
    region.appendChild(el('p', {}, `Gateway fee: DKK ${formatOre(Number(l.gatewayFeeOre ?? 0))} · Maker after fees: DKK ${formatOre(Number(l.makerAfterFeesOre ?? 0))}`));
    for (const line of l.lines as Record<string, number>[]) {
      region.appendChild(el('p', {}, `${line.kind}: charity DKK ${formatOre(line.charityOre)} maker DKK ${formatOre(line.makerOre)} VAT DKK ${formatOre(line.vatOre)}`));
    }
  } catch { /* the region keeps its last content */ }
}

async function renderRates(): Promise<void> {
  document.title = 'Charity rate — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet staff-sheet' });
  const h = el('h1', {}, 'Charity rate');
  const status = el('div', { role: 'status', id: 'staff-status' });
  const list = el('div', { class: 'staff-list' });
  const rate = el('input', { type: 'number', 'aria-label': 'New rate in percent' });
  const from = el('input', { type: 'datetime-local', 'aria-label': 'Effective from' });
  const btn = el('button', {}, 'Schedule rate');
  btn.addEventListener('click', async () => {
    const percent = Number((rate as HTMLInputElement).value);
    const local = (from as HTMLInputElement).value;
    const instant = local ? new Date(local).toISOString() : '';
    try {
      await api.staff.scheduleRate(Math.round(percent * 100), instant);
      status.textContent = copy.staff.rateScheduled;
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      status.textContent = err instanceof ApiError ? errorCopy(err.code) : '';
    }
  });
  sheet.append(h, status, rate, from, btn, list);
  app.appendChild(sheet);
  const rates = await api.staff.rates();
  for (const r of rates.rates) {
    list.appendChild(el('p', {}, `${Number(r.rateBasisPoints) / 100}% from ${String(r.effectiveFrom)}`));
  }
}

async function renderStatements(): Promise<void> {
  document.title = 'Statements — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet staff-sheet' });
  const h = el('h1', {}, 'Statements');
  const status = el('div', { role: 'status', id: 'staff-status' });
  const month = el('input', { type: 'month', 'aria-label': 'Month' });
  const issue = el('button', {}, 'Issue statement');
  const endpoint = el('input', { type: 'url', 'aria-label': 'Charity endpoint URL' });
  const saveEndpoint = el('button', {}, 'Save endpoint');
  const downloads = el('div', { class: 'staff-list' });
  const deliveriesTable = el('table');
  deliveriesTable.setAttribute('aria-label', 'Deliveries');
  sheet.append(h, status, month, issue, endpoint, saveEndpoint, downloads, deliveriesTable);
  app.appendChild(sheet);

  issue.addEventListener('click', async () => {
    try {
      await api.staff.issueStatement((month as HTMLInputElement).value);
      status.textContent = copy.staff.statementIssued;
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      status.textContent = err instanceof ApiError ? errorCopy(err.code) : '';
    }
  });
  saveEndpoint.addEventListener('click', async () => {
    try {
      await api.staff.saveEndpoint((endpoint as HTMLInputElement).value.trim());
      status.textContent = 'Endpoint saved.';
    } catch (err) {
      status.textContent = err instanceof ApiError ? errorCopy(err.code) : '';
    }
  });

  const statements = await api.staff.statements();
  for (const s of statements.statements) {
    downloads.appendChild(el('p', {}, '')).appendChild(
      el('a', { href: String(s.pdfUrl) }, `Download statement ${String(s.month)} revision ${String(s.revision)}`),
    ).parentElement;
  }
  try {
    const d = await api.staff.deliveries();
    for (const label of ['Event', 'Type', 'Status', 'Attempts', 'Last code']) {
      deliveriesTable.appendChild(el('th', {}, label));
    }
    for (const row of d.deliveries) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, String(row.eventId)));
      tr.appendChild(el('td', {}, String(row.eventType)));
      tr.appendChild(el('td', {}, String(row.status)));
      tr.appendChild(el('td', {}, String(row.attempts)));
      tr.appendChild(el('td', {}, String(row.lastStatusCode ?? '')));
      deliveriesTable.appendChild(tr);
    }
  } catch {
    status.textContent = 'Delivery state cannot be read right now. Events are kept and will be sent.';
  }
}

async function renderPlates(): Promise<void> {
  document.title = 'Plate art — Svovlstik Press';
  app.innerHTML = '';
  const sheet = el('div', { class: 'sheet staff-sheet' });
  const h = el('h1', {}, 'Plates');
  const status = el('div', { role: 'status', id: 'staff-status' });
  const stock = el('p', { id: 'stock' }, '');
  sheet.append(h, status, stock);
  for (const plate of ['stove', 'goose', 'tree', 'star', 'grandmother']) {
    const wrap = el('div', { class: 'plate-upload' });
    wrap.appendChild(el('h2', {}, plate));
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg' });
    file.setAttribute('aria-label', `Art file for ${plate}`);
    const btn = el('button', {}, `Upload art for ${plate}`);
    btn.addEventListener('click', async () => {
      const f = (file as HTMLInputElement).files?.[0];
      if (!f) return;
      const form = new FormData();
      form.append('file', f);
      try {
        const res = await fetch(`/api/staff/plates/${plate}/art`, { method: 'POST', body: form });
        if (res.ok) {
          status.textContent = copy.staff.artSaved;
          const img = wrap.querySelector('img');
          if (img) (img as HTMLImageElement).src = `/api/plates/${plate}/art?${Date.now()}`;
        } else {
          const body = await res.json() as { error?: { code?: string } };
          status.textContent = errorCopy(body.error?.code ?? 'not_found');
        }
      } catch {
        status.textContent = copy.outage.storageUpload;
      }
    });
    const img = el('img', { alt: `Current art for ${plate}`, src: `/api/plates/${plate}/art` });
    img.addEventListener('error', () => img.remove());
    wrap.append(file, btn, img);
    sheet.appendChild(wrap);
  }
  app.appendChild(sheet);
  try {
    const s = await api.staff.stock();
    stock.textContent = `${s.remaining} boxes remain. Low-stock alerts at ${s.thresholds.join(', ')}.`;
  } catch { /* stock is advisory */ }
}

// ---------- Routing ----------

function route(): void {
  const path = location.pathname;
  if (path === '/') renderStory();
  else if (path === '/shelf') renderShelf();
  else if (path.startsWith('/box/')) void renderBoxPage(Number(path.split('/')[2]));
  else if (path === '/checkout') renderCheckout();
  else if (path.startsWith('/order/')) {
    const token = new URLSearchParams(location.search).get('token') ?? '';
    void renderOrderPage(decodeURIComponent(path.split('/')[2]), token);
  }
  else if (path === '/lookup') renderLookup();
  else if (path === '/staff') void renderStaff();
  else if (path === '/staff/packing') void renderPacking();
  else if (path === '/staff/dead-letters') void renderDeadLetters();
  else if (path === '/staff/refunds') void renderRefunds();
  else if (path === '/staff/rates') void renderRates();
  else if (path === '/staff/statements') void renderStatements();
  else if (path === '/staff/plates') void renderPlates();
  else renderStory();
}

// ---------- The frame loop ----------

let lastTickAt = Date.now();

async function tick(): Promise<void> {
  const now = Date.now();
  const main = document.querySelector('main');
  if (main) {
    const max = main.scrollHeight - main.clientHeight;
    sceneState.progress = max > 0 ? main.scrollTop / max : sceneState.progress;
  }
  sceneState.chapter = chapterFor(sceneState.progress);

  // The countdown comes only from the server, polled once per second.
  if (hold) {
    if (now - lastTickAt >= 1000) {
      lastTickAt = now;
      try {
        const r = await api.holdRemaining(hold.number, hold.token);
        hold.remainingMs = r.remainingMs;
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'hold_ended' || err.code === 'sales_paused')) {
          setStatus('hold-status', copy.hold.holdEnded(hold.number));
          setHold(null);
          void refreshShelf();
        }
      }
    } else {
      hold.remainingMs = Math.max(0, hold.remainingMs - (now - lastFrameAt));
    }
    if (hold.remainingMs <= 0) {
      setStatus('hold-status', copy.hold.holdEnded(hold.number));
      setHold(null);
      void refreshShelf();
    }
    const bar = document.getElementById('hold-bar');
    if (bar) updateHoldBar(bar);
  }

  if (renderer) {
    renderer.render(sceneState, boxes, hold?.number ?? null);
    sceneState.cameraPosition = renderer.lastCamera;
  }
  lastFrameAt = now;
  requestAnimationFrame(() => void tick());
}

let lastFrameAt = Date.now();

// ---------- Boot ----------

async function boot(): Promise<void> {
  await loadTale();
  const saved = localStorage.getItem(SOUND_KEY);
  soundOn = saved === 'on';
  route();
  // The sound question comes before the story on a first visit, and once
  // answered it never returns.
  if (!soundAsked() && location.pathname === '/') askSound();

  const sse = new EventSource('/api/shelf/events');
  sse.addEventListener('box', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as { number: number; state: string };
    const box = boxes.find((b) => b.number === data.number);
    if (box) box.state = data.state;
    const cell = document.querySelector(`[data-number="${data.number}"]`);
    if (cell) {
      cell.className = `box-cell ${data.state}`;
      const stateSpan = cell.querySelector('.box-state');
      if (stateSpan) stateSpan.textContent = data.state;
      const shape = cell.querySelector('.box-shape');
      if (shape) shape.textContent = data.state === 'taken' ? '▮' : data.state === 'held' ? '❖' : '▪';
      cell.setAttribute('aria-label', `Box ${data.number}, ${box?.plate ?? ''}, ${data.state}`);
    }
  });
  sse.addEventListener('sales', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as { salesPaused: boolean };
    const banner = document.getElementById('sales-banner');
    if (banner) banner.textContent = data.salesPaused ? copy.banner.salesPaused : '';
  });

  requestAnimationFrame(() => void tick());
}

void boot();
