// Stage helpers shared between the workspace and panel modules, breaking the
// import cycle: workspace.ts and panels.ts both read from here.
import { statusText } from './base.js';
import { composite, makeColorOf } from '../shared/rules.js';
import type { State } from './workspace-types.js';
export type { State };

export const TOOL_LABELS: Record<string, string> = {
  pencil: 'Pencil', eraser: 'Eraser', line: 'Line', rectangle: 'Rectangle', ellipse: 'Ellipse',
  fill: 'Fill', dither: 'Dither', selection: 'Selection', picker: 'Picker'
};

export function chooseTool(state: State, tool: string): void {
  state.tool = tool as State['tool'];
  document.querySelectorAll('.tool-button').forEach((b) => {
    const active = b.getAttribute('data-tool') === tool;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  stageAnnounce(state, `Tool: ${TOOL_LABELS[tool] ?? tool}`);
}

export function celKey(frame: number, layerId: number): string {
  return `${frame}:${layerId}`;
}

export function cel(state: State, frame: number, layerId: number): number[][] {
  const rows = state.cels.get(celKey(frame, layerId));
  if (rows) return rows;
  const fresh = Array.from({ length: state.sprite.height }, () => new Array<number>(state.sprite.width).fill(0));
  state.cels.set(celKey(frame, layerId), fresh);
  return fresh;
}

export function cellColor(state: State, index: number): string {
  const swatch = state.palette.swatches.find((s) => s.index === index);
  return swatch?.color ?? '00000000';
}

export function stageAnnounce(state: State, text: string): void {
  void state;
  statusText('stage-announcements', text);
}

export function listAnnounce(text: string): void {
  statusText('list-announcements', text);
}

export function teamAnnounce(text: string): void {
  const node = document.getElementById('team-announcements');
  if (!node) return;
  const line = document.createElement('div');
  line.textContent = text;
  node.append(line);
  while (node.childElementCount > 20 && node.firstChild) node.removeChild(node.firstChild);
}

/** The composite bytes of one frame, by the published integer rules. */
export function frameBytes(state: State, frame: number): Uint8Array {
  const colorOf = makeColorOf(state.palette.swatches.map((s) => ({ index: s.index, color: s.color })));
  return composite(state.sprite.width, state.sprite.height, state.sprite.layers.map((l) => ({
    rows: cel(state, frame, l.id),
    colorOf,
    opacity: l.opacity,
    blend: (l.blend === 'multiply' ? 'multiply' : 'normal') as 'multiply' | 'normal',
    visible: l.visible
  })));
}

export async function sha256Hex(buf: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Redraw the composite for the current frame onto the stage canvas. */
export function drawStage(state: State): void {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (!canvas) return;
  const { width: w, height: h } = state.sprite;
  const zoom = state.zoom;
  canvas.width = w * zoom;
  canvas.height = h * zoom;
  canvas.style.width = `${w * zoom}px`;
  canvas.style.height = `${h * zoom}px`;
  const colorOf = makeColorOf(state.palette.swatches.map((s) => ({ index: s.index, color: s.color })));
  const layers = state.sprite.layers;
  const buf = composite(w, h, layers.map((l) => ({
    rows: cel(state, state.frame, l.id),
    colorOf,
    opacity: l.opacity,
    blend: (l.blend === 'multiply' ? 'multiply' : 'normal') as 'multiply' | 'normal',
    visible: l.visible
  })));
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  img.data.set(buf);
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  off.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, w, h, 0, 0, canvas.width, canvas.height);

  // onion skin draws separately and never changes the hash
  if (state.onion) {
    for (let i = 1; i <= state.onionFrames; i++) {
      const prev = state.frame - i;
      if (prev < 1) break;
      const prevBuf = composite(w, h, layers.map((l) => ({
        rows: cel(state, prev, l.id),
        colorOf,
        opacity: l.opacity,
        blend: (l.blend === 'multiply' ? 'multiply' : 'normal') as 'multiply' | 'normal',
        visible: l.visible
      })));
      const prevImg = new ImageData(w, h);
      prevImg.data.set(prevBuf);
      const prevOff = document.createElement('canvas');
      prevOff.width = w; prevOff.height = h;
      prevOff.getContext('2d')!.putImageData(prevImg, 0, 0);
      ctx.globalAlpha = 0.3 / i;
      ctx.drawImage(prevOff, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  // floating selection drawn over the stage
  if (state.floating && state.copied) {
    const f = state.floating;
    const rows = state.copied;
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const idx = rows[y][x];
        if (idx === 0) continue;
        const color = cellColor(state, idx);
        ctx.fillStyle = `#${color}`;
        ctx.fillRect((f.x + x) * zoom, (f.y + y) * zoom, zoom, zoom);
      }
    }
  }

  // selection outline
  const rect = state.floating ?? state.selection;
  if (rect) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(rect.x * zoom + 0.5, rect.y * zoom + 0.5, rect.w * zoom - 1, rect.h * zoom - 1);
    ctx.setLineDash([]);
  }

  // cursor crosshair
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  const { x, y } = state.cursor;
  ctx.strokeRect(x * zoom + 0.5, y * zoom + 0.5, zoom - 1, zoom - 1);

  // index flood staging: cells within the radius new, beyond it old
  if (state.floodRadius !== null && state.floodSwatch) {
    const newColor = cellColor(state, state.floodSwatch.index);
    const radius = state.floodRadius;
    const cxp = state.cursor.x, cyp = state.cursor.y;
    ctx.fillStyle = `#${newColor}`;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (Math.max(Math.abs(xx - cxp), Math.abs(yy - cyp)) > radius) continue;
        ctx.fillRect(xx * zoom, yy * zoom, zoom, zoom);
      }
    }
  }

  updateStageAttrs(state);
}

export async function updateStageAttrs(state: State): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (!canvas) return;
  canvas.setAttribute('data-sprite-id', String(state.sprite.id));
  canvas.setAttribute('data-frame', String(state.frame));
  const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
  canvas.setAttribute('data-layer', layer?.name ?? '');
  canvas.setAttribute('data-zoom', String(state.zoom));
  canvas.setAttribute('data-cursor-x', String(state.cursor.x));
  canvas.setAttribute('data-cursor-y', String(state.cursor.y));
  canvas.setAttribute('data-seq', String(state.seq));
  canvas.setAttribute('data-composite-hash', await sha256Hex(frameBytes(state, state.frame)));
  if (state.selection) canvas.setAttribute('data-selection', `${state.selection.x},${state.selection.y},${state.selection.w},${state.selection.h}`);
  else canvas.removeAttribute('data-selection');
  if (state.floating) canvas.setAttribute('data-floating', `${state.floating.x},${state.floating.y},${state.floating.w},${state.floating.h}`);
  else canvas.removeAttribute('data-floating');
  if (state.floodRadius !== null) canvas.setAttribute('data-flood-radius', String(state.floodRadius));
  else canvas.removeAttribute('data-flood-radius');
}

/** Re-emit one frame thumbnail from the current cels. */
export function drawThumb(state: State, frame: number, canvas: HTMLCanvasElement): void {
  const w = state.sprite.width, h = state.sprite.height;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  img.data.set(frameBytes(state, frame));
  ctx.putImageData(img, 0, 0);
}
