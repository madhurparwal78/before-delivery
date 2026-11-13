/** The configurator: room scene, pieces, placement with fling physics, quote. */
import { getApp, setStatus } from '../app.js';
import { api, ApiError } from '../api.js';
import { el, toast } from '../dom.js';
import type { Commission, LayoutItem, Quote } from '../types.js';
import { money } from '../types.js';
import { prefersReducedMotion } from '../cue-line.js';
import type { RouteContext } from './router.js';

const SNAP = 0.25;
const TURN = 15;
const FLING_CUTOFF = 0.3;
const FLING_STOP = 0.05;
const FLING_DAMP = 0.92;

interface PieceView {
  kind: string;
  label: string;
  x: number;
  y: number;
  rotationDeg: number;
  w: number;
  d: number;
  element: HTMLButtonElement;
  lastSaved: { x: number; y: number; rotationDeg: number };
}

export async function configureScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('configurator');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const commission = await api<Commission>(`/commissions/${id}`).catch(() => null);
  if (!commission) {
    app.main.append(el('h1', {}, 'Not found'));
    return;
  }

  const wrap = el('div', { class: 'configurator' });
  const scene = el('div', { class: 'config-scene', role: 'region', 'aria-label': 'Room', tabindex: '0' });
  const inspector = el('aside', { class: 'config-inspector', role: 'region', 'aria-label': 'Inspector' });

  // Bottom-sheet handling below 768 px.
  const sheetToggle = el('button', { class: 'btn ghost sheet-toggle', 'aria-expanded': 'false' }, 'Show inspector');

  const grid = el('div', { class: 'room-grid' });
  scene.append(grid);

  const pieces: PieceView[] = [];
  const requiredByKind = new Map(commission.requiredPieces.map((p) => [p.kind, p]));

  let version = commission.layout.version;

  const syncSceneSize = (): void => {
    const scale = Math.min(52, 640 / Math.max(commission.room.widthM, commission.room.depthM));
    grid.style.setProperty('--room-w', `${commission.room.widthM * scale}px`);
    grid.style.setProperty('--room-h', `${commission.room.depthM * scale}px`);
    grid.style.setProperty('--scale', `${scale}`);
  };
  syncSceneSize();

  const placePiece = (kind: string): void => {
    const info = requiredByKind.get(kind);
    if (!info) return;
    const x = Math.round(commission.room.widthM / 2 / SNAP) * SNAP;
    const y = Math.round(commission.room.depthM / 2 / SNAP) * SNAP;
    const existing = pieces.find((p) => p.kind === kind);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.rotationDeg = existing.rotationDeg;
      positionPiece(existing);
      existing.element.focus();
      return;
    }
    const button = el('button', { class: 'piece' });
    const view: PieceView = {
      kind,
      label: info.label,
      x,
      y,
      rotationDeg: 0,
      w: info.widthM,
      d: info.depthM,
      element: button,
      lastSaved: { x, y, rotationDeg: 0 },
    };
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startDrag(view, e);
      button.focus();
    });
    grid.append(button);
    pieces.push(view);
    positionPiece(view);
    button.focus();
    selectPiece = view;
  };

  let selectPiece: PieceView | null = null;

  function positionPiece(view: PieceView): void {
    const scale = Number(getComputedStyle(grid).getPropertyValue('--scale')) || 52;
    view.element.style.left = `${view.x * scale}px`;
    view.element.style.top = `${view.y * scale}px`;
    view.element.style.width = `${view.w * scale}px`;
    view.element.style.height = `${view.d * scale}px`;
    view.element.style.transform = `rotate(${-view.rotationDeg}deg)`;
    view.element.setAttribute('aria-label', `${view.label} at ${fmt(view.x)} m, ${fmt(view.y)} m, turned ${view.rotationDeg}°`);
  }


  const save = async (view: PieceView | null, source: 'drop' | 'rotate'): Promise<void> => {
    if (!view) return;
    const items: LayoutItem[] = pieces.map((p) => ({ kind: p.kind, x: p.x, y: p.y, rotationDeg: p.rotationDeg }));
    try {
      const result = await api<{ version: number; items: LayoutItem[] }>(`/commissions/${id}/layout`, {
        method: 'PUT',
        body: { version, items },
      });
      version = result.version;
      for (const p of pieces) p.lastSaved = { x: p.x, y: p.y, rotationDeg: p.rotationDeg };
      setStatus(app.statusRegions.placement, `Placed ${view.label} at ${fmt(view.x)} m, ${fmt(view.y)} m, turned ${view.rotationDeg}°.`);
      if (source === 'drop') {
        const fresh = await api<Commission>(`/commissions/${id}`);
        if (fresh.state !== commission.state) {
          toast('Room placed.');
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        const fresh = await api<Commission>(`/commissions/${id}`);
        version = fresh.layout.version;
        setStatus(app.statusRegions.placement, 'This layout changed in another window. Showing the latest version.');
        await configureScreen(ctx);
        return;
      }
      if (e instanceof ApiError) {
        const message = typeof e.extra['message'] === 'string' ? e.extra['message'] : '';
        const itemErrors = e.extra as Record<string, unknown>;
        for (const [key, value] of Object.entries(itemErrors)) {
          if (key.startsWith('items[') && typeof value === 'string') {
            setStatus(app.statusRegions.placement, value);
            break;
          }
        }
        if (message && !Object.keys(itemErrors).some((k) => k.startsWith('items['))) {
          setStatus(app.statusRegions.placement, message);
        }
        // A refused drop springs the piece back to its last saved position.
        restoreSaved(view);
      }
    }
  };

  const restoreSaved = (view: PieceView): void => {
    if (prefersReducedMotion()) {
      view.x = view.lastSaved.x;
      view.y = view.lastSaved.y;
      view.rotationDeg = view.lastSaved.rotationDeg;
      positionPiece(view);
      return;
    }
    view.element.classList.add('spring-back');
    setTimeout(() => {
      view.x = view.lastSaved.x;
      view.y = view.lastSaved.y;
      view.rotationDeg = view.lastSaved.rotationDeg;
      positionPiece(view);
      view.element.classList.remove('spring-back');
    }, 250);
  };

  // Keyboard: arrows, shift+arrows, R, Enter, Escape.
  scene.addEventListener('keydown', (e) => {
    if (!selectPiece) return;
    const view = selectPiece;
    const step = e.shiftKey ? 1 : SNAP;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
        view.x = clampSnap(view.x + step, commission.room.widthM);
        break;
      case 'ArrowLeft':
        view.x = clampSnap(view.x - step, commission.room.widthM);
        break;
      case 'ArrowUp':
        view.y = clampSnap(view.y + step, commission.room.depthM);
        break;
      case 'ArrowDown':
        view.y = clampSnap(view.y - step, commission.room.depthM);
        break;
      case 'r':
      case 'R':
        view.rotationDeg = (view.rotationDeg + (e.shiftKey ? -TURN : TURN) + 360) % 360;
        break;
      case 'Enter':
        e.preventDefault();
        void save(view, 'drop');
        return;
      case 'Escape':
        restoreSaved(view);
        return;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      positionPiece(view);
    }
  });

  let drag: { view: PieceView; pointerId: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number } | null = null;

  function startDrag(view: PieceView, e: PointerEvent): void {
    selectPiece = view;
    drag = { view, pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 };
    view.element.setPointerCapture(e.pointerId);
    view.element.classList.add('lifted');
  }

  const toRoom = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = grid.getBoundingClientRect();
    const scale = Number(getComputedStyle(grid).getPropertyValue('--scale')) || 52;
    return { x: (clientX - rect.left) / scale, y: (rect.bottom - clientY) / scale };
  };

  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const view = drag.view;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT) / 1000;
    const pos = toRoom(e.clientX, e.clientY);
    view.x = pos.x;
    view.y = pos.y;
    drag.vx = (e.clientX - drag.lastX) / dt;
    drag.vy = (e.clientY - drag.lastY) / dt;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.lastT = now;
    positionPiece(view);
  });

  window.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const view = drag.view;
    view.element.classList.remove('lifted');
    // Fling speed in m/s.
    const scale = Number(getComputedStyle(grid).getPropertyValue('--scale')) || 52;
    const vSpeed = Math.hypot(drag.vx, drag.vy) / scale;
    if (vSpeed > FLING_CUTOFF && !prefersReducedMotion()) {
      fling(view, drag.vx / scale, -drag.vy / scale);
    } else {
      settleAndSave(view);
    }
    drag = null;
  });

  const fling = (view: PieceView, vx: number, vy: number): void => {
    let speed = { x: vx, y: vy };
    const step = (): void => {
      speed = { x: speed.x * FLING_DAMP, y: speed.y * FLING_DAMP };
      view.x = clamp(view.x + speed.x / 60, 0, commission.room.widthM);
      view.y = clamp(view.y + speed.y / 60, 0, commission.room.depthM);
      positionPiece(view);
      const mag = Math.hypot(speed.x, speed.y);
      const hitWall = view.x <= 0 || view.x >= commission.room.widthM || view.y <= 0 || view.y >= commission.room.depthM;
      if (mag < FLING_STOP || hitWall) {
        settleAndSave(view);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const settleAndSave = (view: PieceView): void => {
    view.x = clampSnap(view.x, commission.room.widthM);
    view.y = clampSnap(view.y, commission.room.depthM);
    if (prefersReducedMotion()) {
      positionPiece(view);
      void save(view, 'drop');
      return;
    }
    // Spring settle of about half a second with no visible overshoot.
    const startX = view.x;
    const startY = view.y;
    const snappedX = clampSnap(view.x, commission.room.widthM);
    const snappedY = clampSnap(view.y, commission.room.depthM);
    const startAt = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - startAt) / 500);
      const ease = 1 - Math.pow(1 - t, 3);
      view.x = startX + (snappedX - startX) * ease;
      view.y = startY + (snappedY - startY) * ease;
      positionPiece(view);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        view.x = snappedX;
        view.y = snappedY;
        positionPiece(view);
        void save(view, 'drop');
      }
    };
    requestAnimationFrame(step);
  };

  // Restore existing layout items.
  for (const item of commission.layout.items) {
    const info = requiredByKind.get(item.kind);
    if (!info) continue;
    const button = el('button', { class: 'piece' });
    const view: PieceView = {
      kind: item.kind,
      label: info.label,
      x: item.x,
      y: item.y,
      rotationDeg: item.rotationDeg,
      w: info.widthM,
      d: info.depthM,
      element: button,
      lastSaved: { x: item.x, y: item.y, rotationDeg: item.rotationDeg },
    };
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startDrag(view, e);
      button.focus();
    });
    grid.append(button);
    pieces.push(view);
    positionPiece(view);
  }

  // Inspector: pieces to place, size, extras, quote.
  inspector.append(el('h2', {}, 'Pieces to place'));
  const piecesList = el('ul', { class: 'place-list', 'aria-label': 'Pieces to place' });
  for (const p of commission.requiredPieces) {
    const li = el('li', {});
    const btn = el('button', { class: 'btn ghost small' }, `Place ${p.label}`);
    btn.addEventListener('click', () => {
      placePiece(p.kind);
    });
    li.append(btn);
    piecesList.append(li);
  }
  inspector.append(piecesList);

  inspector.append(el('h2', {}, 'Size'));
  const sizeGroup = el('div', { class: 'chip-group', role: 'radiogroup', 'aria-label': 'Size' });
  for (const [value, label] of [
    ['compact', 'Compact'],
    ['standard', 'Standard'],
    ['grand', 'Grand'],
  ] as const) {
    const option = el('label', { class: 'chip-wrap' });
    const input = el('input', { type: 'radio', name: 'size', value });
    input.setAttribute('aria-label', label);
    if (commission.options.size === value) input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) void previewQuote(value, currentAddOns());
    });
    option.append(input, el('span', { class: 'chip-box' }), el('span', { class: 'chip-label' }, label));
    sizeGroup.append(option);
  }
  inspector.append(sizeGroup);

  inspector.append(el('h2', {}, 'Extras'));
  const extrasGroup = el('div', { class: 'chip-group', role: 'group', 'aria-label': 'Extras' });
  const currentAddOns = (): string[] => Array.from(extrasGroup.querySelectorAll<HTMLInputElement>('input:checked')).map((i) => i.value);
  for (const [value, label] of [
    ['ambient-sound', 'Ambient sound'],
    ['night-lighting', 'Night-mode lighting'],
    ['photo-takeaway', 'Photo takeaway'],
  ] as const) {
    const option = el('label', { class: 'chip-wrap' });
    const input = el('input', { type: 'checkbox', value });
    input.setAttribute('aria-label', label);
    if (commission.options.addOns.includes(value)) input.checked = true;
    input.addEventListener('change', () => {
      void previewQuote(currentSize(), currentAddOns());
    });
    option.append(input, el('span', { class: 'chip-box' }), el('span', { class: 'chip-label' }, label));
    extrasGroup.append(option);
  }
  inspector.append(extrasGroup);

  const currentSize = (): string => sizeGroup.querySelector<HTMLInputElement>('input:checked')?.value ?? commission.options.size;

  const quoteSection = el('section', { class: 'quote card', role: 'region', 'aria-label': 'Quote' });
  const quoteLines = el('div', { class: 'quote-lines' });
  const quoteTotal = el('p', { class: 'quote-total' });
  const totalValue = el('span', { class: 'quote-total-value', 'aria-live': 'polite' });
  totalValue.id = 'quote-total-value';
  quoteTotal.append(totalValue);
  const saveQuote = el('button', { class: 'btn primary' }, 'Save quote');
  quoteSection.append(quoteLines, quoteTotal, saveQuote);
  inspector.append(quoteSection);

  let quoteToken = 0;
  async function previewQuote(size: string, addOns: string[]): Promise<void> {
    const token = ++quoteToken;
    try {
      const quote = await api<Quote>(`/commissions/${id}/quote-preview`, { method: 'POST', body: { size, addOns } });
      if (token !== quoteToken) return;
      renderQuote(quote);
      setStatus(app.statusRegions.quote, `Quote updated: ${money(quote.totalCents)} including tax.`);
    } catch {
      // Older or failed previews are dropped.
    }
  }

  function renderQuote(quote: Quote): void {
    quoteLines.textContent = '';
    for (const line of quote.lines) {
      const row = el('div', { class: 'quote-line' });
      row.append(el('span', {}, line.label), el('span', { class: 'numeral' }, money(line.amountCents)));
      quoteLines.append(row);
    }
    rollNumerals(totalValue, money(quote.totalCents));
  }

  const rollNumerals = (node: HTMLElement, value: string): void => {
    // Each digit column rolls to its new digit within 0.6 seconds.
    if (prefersReducedMotion() || node.textContent === value) {
      node.textContent = value;
      return;
    }
    node.textContent = value;
    node.classList.remove('roll');
    void node.offsetWidth;
    node.classList.add('roll');
  };

  if (commission.quote) renderQuote(commission.quote);

  saveQuote.addEventListener('click', async () => {
    try {
      const result = await api<{ options: { size: string; addOns: string[] }; quote: Quote }>(`/commissions/${id}/options`, {
        method: 'PUT',
        body: { size: currentSize(), addOns: currentAddOns() },
      });
      renderQuote(result.quote);
      setStatus(app.statusRegions.quote, `Quote updated: ${money(result.quote.totalCents)} including tax.`);
      toast('Quote saved.');
    } catch (e) {
      if (e instanceof ApiError) {
        toast(e.code === 'options_locked' ? 'Funders are locked once a sponsor accepts or the deposit is paid.' : 'Could not save the quote.');
      }
    }
  });

  sheetToggle.addEventListener('click', () => {
    const open = inspector.classList.toggle('sheet-open');
    sheetToggle.textContent = open ? 'Hide inspector' : 'Show inspector';
    sheetToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inspector.classList.contains('sheet-open')) {
      inspector.classList.remove('sheet-open');
      sheetToggle.textContent = 'Show inspector';
      sheetToggle.setAttribute('aria-expanded', 'false');
      sheetToggle.focus();
    }
  });

  wrap.append(scene, inspector);
  app.main.append(sheetToggle, wrap);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clampSnap(v: number, max: number): number {
  const snapped = Math.round(v / SNAP) * SNAP;
  return clamp(snapped, 0, max);
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}
