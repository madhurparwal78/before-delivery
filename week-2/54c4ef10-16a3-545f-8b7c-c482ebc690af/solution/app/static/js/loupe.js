// The densitometer loupe: a square 120 px magnifier (4x, hard-edged pixels) with its readout.
import { get } from './api.js';
import { h, prefersReducedMotion } from './dom.js';
import { fixed, signed } from './format.js';
import { SLICE_WIDTH } from './domain.js';
import { tintCanvas } from './tint.js';

const SIDE = 120;
const ZOOM = 4;
const CELL = 8;
const SPAN = SIDE / ZOOM;
const OPEN_MS = 180;
const CLOSE_MS = 100;
const EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
const SHUTTER_START = 'inset(56px)';
const dash = '—';

/** One loupe per strip. `strip` supplies the canvas, scan, slices and cell geometry; `onReading` feeds the curve panel. */
export function createLoupe({ strip, scan, onReading }) {
  const readout = h('div', { class: 'readout', role: 'status', 'aria-label': 'Loupe reading' });
  const phone = window.matchMedia('(max-width: 599px)');
  const panel = h('div', { class: 'loupe-panel' });
  let element = null;
  let canvas = null;
  let cell = null;
  let closing = null;
  let reading = { net: dash, gross: dash, logH: dash };

  const maxCell = (extent) => CELL * Math.floor((extent - 1) / CELL);
  const clampCell = (x, y) => ({ x: Math.min(maxCell(scan.width), Math.max(0, x)), y: Math.min(maxCell(scan.height), Math.max(0, y)) });
  const cellOf = (x, y) => clampCell(CELL * Math.floor(x / CELL), CELL * Math.floor(y / CELL));

  function paintReadout(busy) {
    readout.replaceChildren(h('div', {}, `Net ${reading.net}`), h('div', {}, `Gross ${reading.gross}`), h('div', {}, `log H ${reading.logH}`),
      h('div', {}, cell ? `x ${cell.x} · y ${cell.y}` : `x ${dash} · y ${dash}`));
    readout.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function place() {
    if (phone.matches) panel.append(readout);
    else if (element) element.append(readout);
    else readout.remove();
    panel.hidden = !phone.matches;
  }
  phone.addEventListener('change', place);

  function position() {
    const centreX = (cell.x + CELL / 2) * (strip.cssWidth() / scan.width);
    const centreY = (cell.y + CELL / 2) * (strip.cssHeight() / scan.height);
    const box = strip.box;
    const left = Math.min(Math.max(0, centreX - SIDE / 2), Math.max(0, box.clientWidth - SIDE));
    element.style.left = `${left}px`;
    element.style.top = `${centreY - SIDE / 2}px`;
  }

  function draw() {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#000';
    context.fillRect(0, 0, SIDE, SIDE);
    const left = cell.x + CELL / 2 - SPAN / 2;
    const top = cell.y + CELL / 2 - SPAN / 2;
    strip.slices.forEach((slice, n) => {
      const from = Math.max(left, n * SLICE_WIDTH, 0);
      const to = Math.min(left + SPAN, n * SLICE_WIDTH + slice.width);
      const rows = [Math.max(top, 0), Math.min(top + SPAN, scan.height)];
      if (to <= from || rows[1] <= rows[0]) return;
      context.drawImage(slice, from - n * SLICE_WIDTH, rows[0], to - from, rows[1] - rows[0],
        (from - left) * ZOOM, (rows[0] - top) * ZOOM, (to - from) * ZOOM, (rows[1] - rows[0]) * ZOOM);
    });
    tintCanvas(context, SIDE, SIDE);
    context.strokeStyle = 'rgb(244,217,108)';
    context.lineWidth = 1;
    const width = Math.min(CELL, scan.width - cell.x);
    const height = Math.min(CELL, scan.height - cell.y);
    context.strokeRect((cell.x - left) * ZOOM + 0.5, (cell.y - top) * ZOOM + 0.5, width * ZOOM - 1, height * ZOOM - 1);
  }

  async function request(target) {
    const response = await get(`/api/scans/${scan.id}/reading?x=${target.x}&y=${target.y}`);
    if (!cell || cell.x !== target.x || cell.y !== target.y) return;
    if (response.ok) {
      const { net, gross, log_h: logH, zone } = response.data;
      reading = { net: net === null ? dash : fixed(net), gross: fixed(gross), logH: logH === null ? dash : signed(logH) };
      onReading({ logH, net, zone });
    } else {
      reading = { net: dash, gross: dash, logH: dash };
      onReading(null);
    }
    paintReadout(false);
  }

  function show(target) {
    cell = target;
    position();
    draw();
    paintReadout(true);
    request(target);
  }

  function open(target) {
    if (closing) {
      closing.cancel();
      closing = null;
      element.remove();
      element = null;
    }
    if (element) {
      if (!cell || cell.x !== target.x || cell.y !== target.y) show(target);
      return;
    }
    canvas = h('canvas', { role: 'img', 'aria-label': 'Loupe', width: SIDE, height: SIDE });
    element = h('div', { class: 'loupe' }, canvas);
    strip.box.append(element);
    place();
    show(target);
    if (!prefersReducedMotion()) {
      canvas.animate([{ clipPath: SHUTTER_START }, { clipPath: 'inset(0px)' }], { duration: OPEN_MS, easing: EASE });
    }
  }

  function close() {
    if (!element || closing) return;
    cell = null;
    const leaving = element;
    readout.remove();
    paintReadout(false);
    if (phone.matches) panel.append(readout);
    if (prefersReducedMotion()) {
      leaving.remove();
      element = null;
      return;
    }
    closing = canvas.animate([{ clipPath: 'inset(0px)' }, { clipPath: SHUTTER_START }], { duration: CLOSE_MS, easing: EASE, fill: 'forwards' });
    closing.onfinish = () => {
      leaving.remove();
      if (element === leaving) element = null;
      closing = null;
    };
  }

  paintReadout(false);
  place();
  return {
    panel,
    get isOpen() { return Boolean(element) && !closing; },
    get cell() { return cell; },
    cellOf,
    clampCell,
    open: (x, y) => open(cellOf(x, y)),
    moveBy(dx, dy) {
      const from = cell ?? cellOf(0, 0);
      const target = clampCell(from.x + dx * CELL, from.y + dy * CELL);
      if (!cell || target.x !== cell.x || target.y !== cell.y) {
        if (this.isOpen) show(target);
        else open(target);
      }
    },
    close,
    reposition() { if (cell) { position(); draw(); } },
  };
}

