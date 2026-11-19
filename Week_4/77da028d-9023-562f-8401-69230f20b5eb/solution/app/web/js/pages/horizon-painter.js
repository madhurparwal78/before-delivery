// The horizon painter: 72 horizon-mask bins drawn as a treeline on a strip, painted by pointer or keyboard.
import { h } from '../core/dom.js';

const BINS = 72;
const BIN_DEGREES = 5;
const MAX_ALTITUDE = 90;
const SAVE_DELAY_MS = 500;
const AXIS_BAND = 22;
const MAX_PIXEL_RATIO = 2;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// createHorizonPainter({altitudes, onSave}) -> {element}
// onSave(altitudes) saves the whole mask and reports its own result; the painter never overlaps two saves.
export function createHorizonPainter({ altitudes, onSave }) {
  const canvas = h('canvas', { class: 'horizon-painter', role: 'img', tabindex: '0' });
  const mask = [...altitudes];
  let selected = 0;
  let lastBin = null;
  let painting = false;
  let saveTimer = 0;
  let saving = false;
  let queued = false;

  function name() {
    canvas.setAttribute('aria-label', `Horizon painter: azimuth ${selected * BIN_DEGREES} degrees, mask altitude ${mask[selected]} degrees`);
  }

  function plot() {
    return { width: canvas.clientWidth, height: canvas.clientHeight - AXIS_BAND };
  }

  function draw() {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const { width, height } = plot();
    if (width === 0) return;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round((height + AXIS_BAND) * ratio);
    const context = canvas.getContext('2d');
    const colors = getComputedStyle(document.documentElement);
    const color = (token) => colors.getPropertyValue(token).trim();
    context.scale(ratio, ratio);
    context.fillStyle = color('--raised');
    context.fillRect(0, 0, width, height + AXIS_BAND);
    const binWidth = width / BINS;
    const y = (altitude) => (1 - altitude / MAX_ALTITUDE) * height;

    context.font = '12px Sora, system-ui, sans-serif';
    context.fillStyle = color('--muted');
    context.strokeStyle = color('--edge-strong');
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    for (const altitude of [30, 60]) {
      context.beginPath();
      context.moveTo(0, y(altitude));
      context.lineTo(width, y(altitude));
      context.stroke();
      context.fillText(`${altitude}°`, 6, y(altitude) - 4);
    }
    context.setLineDash([]);
    for (const azimuth of [0, 90, 180, 270]) {
      const x = (azimuth / 360) * width;
      context.textAlign = azimuth === 0 ? 'left' : 'center';
      context.fillText(`${azimuth}°`, azimuth === 0 ? 6 : x, height + 16);
    }
    context.textAlign = 'left';

    context.fillStyle = color('--ground');
    context.beginPath();
    context.moveTo(0, height);
    mask.forEach((altitude, bin) => {
      context.lineTo(bin * binWidth, y(altitude));
      context.lineTo((bin + 1) * binWidth, y(altitude));
    });
    context.lineTo(width, height);
    context.closePath();
    context.fill();
    context.strokeStyle = color('--edge-strong');
    context.stroke();

    context.strokeStyle = color('--cyan');
    context.lineWidth = 2;
    context.strokeRect(selected * binWidth, y(mask[selected]), binWidth, height - y(mask[selected]) || 1);
  }

  async function flush() {
    if (saving) { queued = true; return; }
    saving = true;
    await onSave([...mask]);
    saving = false;
    if (queued) { queued = false; flush(); }
  }

  function paintAt(event) {
    const rect = canvas.getBoundingClientRect();
    const { width, height } = plot();
    const bin = clamp(Math.floor(((event.clientX - rect.left) / width) * BINS), 0, BINS - 1);
    const altitude = clamp(Math.round((1 - (event.clientY - rect.top) / height) * MAX_ALTITUDE), 0, MAX_ALTITUDE);
    const [from, to] = [Math.min(lastBin ?? bin, bin), Math.max(lastBin ?? bin, bin)];
    for (let index = from; index <= to; index += 1) mask[index] = altitude;
    lastBin = bin;
    selected = bin;
    name();
    draw();
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    painting = true;
    lastBin = null;
    paintAt(event);
  });
  canvas.addEventListener('pointermove', (event) => { if (painting) paintAt(event); });
  const release = () => {
    if (!painting) return;
    painting = false;
    flush();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 5 : 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      selected = (selected + (event.key === 'ArrowRight' ? 1 : -1) + BINS) % BINS;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      mask[selected] = clamp(mask[selected] + (event.key === 'ArrowUp' ? step : -step), 0, MAX_ALTITUDE);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, SAVE_DELAY_MS);
    } else return;
    event.preventDefault();
    name();
    draw();
  });

  new ResizeObserver(draw).observe(canvas);
  name();
  return { element: canvas };
}
