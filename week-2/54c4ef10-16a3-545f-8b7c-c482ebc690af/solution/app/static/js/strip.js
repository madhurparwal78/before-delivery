// The densitometer strip: the whole scan drawn as a negative, frame-edge handles, pins, the marked area and the loupe.
import { h } from './dom.js';
import { createLoupe } from './loupe.js';
import { paintProcedural } from './prints.js';
import { PreviewUnavailable, drawRegion, loadSlices, sizeCanvas, tintCanvas } from './tint.js';

const GOLD = 'rgb(244,217,108)';
const DRAG_PIXELS = 4;
const TAP_PIXELS = 10;
const SHIFT_STEP = 8;

export function createStrip({ scan, onNudge, onAccept, onPin, onReading, onArea }) {
  const canvas = h('canvas', { class: 'strip', role: 'application', 'aria-label': 'Densitometer strip', tabindex: 0 });
  canvas.style.aspectRatio = `${scan.width} / ${scan.height}`;
  const handles = h('div', { class: 'handles' });
  const unavailable = h('p', { class: 'muted', hidden: true }, 'Preview unavailable');
  const box = h('div', { class: 'strip-box' }, canvas, handles, unavailable);
  const state = { frames: [], pins: [], area: null, current: null, slices: [], base: null, failed: false };
  const view = {
    box,
    get slices() { return state.slices; },
    cssWidth: () => canvas.clientWidth,
    cssHeight: () => canvas.clientHeight,
  };
  const loupe = createLoupe({ strip: view, scan, onReading });
  const toScan = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(scan.width - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * scan.width))),
      y: Math.min(scan.height - 1, Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * scan.height))),
    };
  };
  const toCss = (value) => (value / scan.width) * canvas.clientWidth;

  // --- drawing ---------------------------------------------------------------------------------------------------
  async function layout() {
    const width = canvas.clientWidth;
    if (!width) return;
    const context = sizeCanvas(canvas, width, canvas.clientHeight);
    if (state.failed) {
      paintProcedural(canvas, 'blank');
      unavailable.hidden = false;
      return;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawRegion(context, state.slices, [0, 0, scan.width, scan.height], [0, 0, canvas.width, canvas.height]);
    tintCanvas(context, canvas.width, canvas.height);
    state.base = context.getImageData(0, 0, canvas.width, canvas.height);
    overlays();
    loupe.reposition();
  }

  function overlays() {
    if (state.failed || !state.base) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.putImageData(state.base, 0, 0);
    const ratio = canvas.width / scan.width;
    const ratioY = canvas.height / scan.height;
    context.strokeStyle = GOLD;
    context.fillStyle = GOLD;
    context.lineWidth = 1;
    for (const frame of state.frames) {
      context.fillRect(Math.round(frame.x0 * ratio), 0, 1, canvas.height);
      context.fillRect(Math.round(frame.x1 * ratio) - 1, 0, 1, canvas.height);
    }
    if (state.current) {
      const frame = state.frames.find((candidate) => candidate.number === state.current);
      if (frame) {
        context.lineWidth = 2;
        context.strokeRect(frame.x0 * ratio + 1, 1, (frame.x1 - frame.x0) * ratio - 2, canvas.height - 2);
      }
    }
    if (state.area) {
      context.lineWidth = 1;
      context.setLineDash([4, 3]);
      context.strokeRect(state.area.x * ratio + 0.5, state.area.y * ratioY + 0.5, Math.max(1, state.area.w * ratio - 1), Math.max(1, state.area.h * ratioY - 1));
      context.setLineDash([]);
    }
    for (const pin of state.pins) {
      const size = Math.max(8, 8 * Math.min(ratio, ratioY));
      const x = (pin.x + 4) * ratio;
      const y = (pin.y + 4) * ratioY;
      context.fillStyle = '#133621';
      context.fillRect(x - size / 2 - 1, y - size / 2 - 1, size + 2, size + 2);
      context.fillStyle = GOLD;
      context.fillRect(x - size / 2, y - size / 2, size, size);
      context.fillStyle = '#133621';
      context.fillRect(x - size / 2 + 2, y - size / 2 + 2, size - 4, size - 4);
    }
  }

  // --- handles ---------------------------------------------------------------------------------------------------
  const handleById = new Map();

  function makeHandle(frame, edge) {
    const key = edge === 'left' ? 'x0' : 'x1';
    const element = h('div', { class: 'handle', role: 'slider', tabindex: 0, 'aria-label': `Frame ${frame.number} ${edge} edge`,
      'aria-valuemin': 0, 'aria-valuemax': scan.width, 'aria-orientation': 'horizontal' });
    const record = { element, frameId: frame.id, key, pending: null };
    element.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? SHIFT_STEP : 1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const current = record.pending ?? currentFrame(record)[key];
        move(record, current + (event.key === 'ArrowLeft' ? -step : step));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        commit(record);
      }
    });
    element.addEventListener('blur', () => commit(record));
    element.addEventListener('pointerdown', (event) => {
      element.setPointerCapture(event.pointerId);
      element.focus();
      record.dragging = true;
    });
    element.addEventListener('pointermove', (event) => {
      if (record.dragging) move(record, toScan(event.clientX, event.clientY).x);
    });
    element.addEventListener('pointerup', () => {
      record.dragging = false;
      commit(record);
    });
    return record;
  }

  const currentFrame = (record) => state.frames.find((frame) => frame.id === record.frameId);

  function paintHandle(record) {
    const value = record.pending ?? currentFrame(record)[record.key];
    record.element.setAttribute('aria-valuenow', String(value));
    record.element.style.left = `${(value / scan.width) * 100}%`;
  }

  function move(record, value) {
    record.pending = Math.min(scan.width, Math.max(0, value));
    paintHandle(record);
  }

  async function commit(record) {
    const frame = currentFrame(record);
    if (record.pending === null || !frame || record.saving) return;
    const value = record.pending;
    if (value === frame[record.key]) {
      record.pending = null;
      return;
    }
    record.saving = true;
    const saved = await onNudge(frame, record.key, value);
    record.saving = false;
    record.pending = null;
    if (!saved) paintHandle(record);
  }

  function buildHandles() {
    handles.replaceChildren();
    handleById.clear();
    for (const frame of state.frames) {
      const left = makeHandle(frame, 'left');
      const right = makeHandle(frame, 'right');
      handleById.set(frame.id, { left, right });
      handles.append(left.element, right.element);
    }
  }

  function updateHandles() {
    const same = state.frames.length === handleById.size && state.frames.every((frame) => handleById.has(frame.id));
    if (!same) buildHandles();
    let anyFlagged = false;
    for (const frame of state.frames) {
      const { left, right } = handleById.get(frame.id);
      const flagged = frame.flag === 'flagged';
      anyFlagged ||= flagged;
      paintHandle(left);
      paintHandle(right);
      left.element.classList.toggle('flagged', flagged);
      right.element.classList.toggle('flagged', flagged);
      if (flagged && !right.accept) {
        right.accept = h('button', { type: 'button', class: 'accept', onclick: async () => {
          await onAccept(currentFrame(right));
          right.element.focus();
        } }, `Accept frame ${frame.number} width`);
        right.element.after(right.accept);
      } else if (!flagged && right.accept) {
        right.accept.remove();
        right.accept = null;
      }
    }
    handles.classList.toggle('has-flagged', anyFlagged);
  }

  // --- pointer, keyboard and touch -------------------------------------------------------------------------------
  const defaultCell = () => {
    const first = state.frames[0];
    return first ? loupe.cellOf(Math.floor((first.x0 + first.x1) / 2), Math.floor(scan.height / 2))
      : loupe.cellOf(Math.floor(scan.width / 2), Math.floor(scan.height / 2));
  };
  const openDefault = () => loupe.open(defaultCell().x, defaultCell().y);
  let press = null;

  function tap(event, started) {
    if (Math.hypot(event.clientX - started.x, event.clientY - started.y) > TAP_PIXELS) return;
    const { x, y } = toScan(event.clientX, event.clientY);
    const target = loupe.cellOf(x, y);
    if (loupe.isOpen && loupe.cell.x === target.x && loupe.cell.y === target.y) onPin(loupe.cell);
    else loupe.open(x, y);
  }

  canvas.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    const { x, y } = toScan(event.clientX, event.clientY);
    loupe.open(x, y);
  });
  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch' && !press) loupe.close();
  });
  canvas.addEventListener('pointerdown', (event) => {
    press = { x: event.clientX, y: event.clientY, dragged: false, started: toScan(event.clientX, event.clientY) };
    if (event.pointerType !== 'touch') canvas.setPointerCapture(event.pointerId);
  });
  // A vertical swipe from the strip scrolls the page. Where the browser pans natively (touch-action: pan-y) it
  // cancels the pointer and no further moves arrive here; otherwise the strip scrolls the page by the swipe itself.
  function swipe(event) {
    if (!press || Math.abs(event.clientY - press.y) <= TAP_PIXELS) return;
    if (Math.abs(event.clientY - press.y) < Math.abs(event.clientX - press.x)) return;
    window.scrollBy(0, (press.lastY ?? press.y) - event.clientY);
    press.lastY = event.clientY;
  }

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') {
      swipe(event);
      return;
    }
    const { x, y } = toScan(event.clientX, event.clientY);
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_PIXELS) {
      press.dragged = true;
      const from = press.started;
      onArea({ x: Math.min(from.x, x), y: Math.min(from.y, y), w: Math.abs(x - from.x) + 1, h: Math.abs(y - from.y) + 1 });
    }
    loupe.open(x, y);
  });
  canvas.addEventListener('pointerup', (event) => {
    const finished = press;
    press = null;
    if (!finished) return;
    if (event.pointerType === 'touch') {
      tap(event, finished);
      return;
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!finished.dragged && loupe.cell) onPin(loupe.cell);
  });
  canvas.addEventListener('pointercancel', () => { press = null; });
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && !box.contains(event.target)) loupe.close();
  });

  canvas.addEventListener('focus', () => { if (!loupe.isOpen) openDefault(); });
  canvas.addEventListener('blur', () => loupe.close());
  canvas.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? SHIFT_STEP : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      if (!loupe.isOpen) openDefault();
      loupe.moveBy(...moves[event.key]);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!loupe.isOpen) openDefault();
      onPin(loupe.cell);
    } else if (event.key === 'Escape') {
      loupe.close();
    }
  });

  new ResizeObserver(() => layout()).observe(canvas);

  return {
    box,
    canvas,
    loupePanel: loupe.panel,
    async load() {
      try {
        state.slices = await loadSlices(scan);
      } catch (error) {
        if (!(error instanceof PreviewUnavailable)) throw error;
        state.failed = true;
      }
      await layout();
    },
    setFrames(frames) {
      state.frames = frames;
      updateHandles();
      overlays();
    },
    setPins(pins) { state.pins = pins; overlays(); },
    setArea(area) { state.area = area; overlays(); },
    setCurrent(number) { state.current = number; overlays(); },
    focus() { canvas.focus(); },
  };
}
