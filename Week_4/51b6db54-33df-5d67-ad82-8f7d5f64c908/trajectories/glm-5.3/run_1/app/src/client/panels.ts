// Workspace panels and dialogs: palette, layers, frames, tiles, comments,
// snapshots, activity, preview, command palette, layout, offline and events.
import {
  api, ApiFail, el, qs, clear, byId, showErrors, announceAlert, statusText,
  reducedMotion, myNumberFormat, myZone, debounce, appConfig
} from './base.js';
import {
  composite, makeColorOf, formatNumber, formatDate, tagSequence, rankCommands, relativeTime, rh
} from '../shared/rules.js';
import {
  cel, celKey, cellColor, drawStage, stageAnnounce, listAnnounce, teamAnnounce,
  drawThumb, frameBytes, chooseTool, TOOL_LABELS, type State
} from './stage.js';


// ---- layout ----

export function applyLayout(): void {
  const root = document.body;
  const width = window.innerWidth;
  root.classList.toggle('layout-phone', width < 700);
  root.classList.toggle('layout-tablet', width >= 700 && width < 1100);
  root.classList.toggle('layout-desktop', width >= 1100);
  const panBtn = qs('#more-panels-btn');
  if (panBtn) panBtn.classList.toggle('hidden', width >= 1100);
  for (const btn of document.querySelectorAll('.pan-btn')) {
    (btn as HTMLElement).classList.toggle('hidden', width >= 700);
  }
}

// ---- palette panel ----

export function renderPalettePanel(state: State): void {
  const host = qs('#palette-panel');
  if (!host) return;
  clear(host);
  const nf = myNumberFormat();
  const region = el('section', { id: 'palette-region', role: 'region', 'aria-label': 'Palette', class: 'panel candy-mint' });
  region.append(el('h2', { class: 'panel-title' }, 'Palette'));
  const list = el('div', { id: 'palette', role: 'listbox', 'aria-label': 'Palette', class: 'swatch-list', tabindex: 0 });
  for (const swatch of state.palette.swatches) {
    if (swatch.index === 0) continue;
    const option = el('div', {
      role: 'option',
      'aria-label': `Swatch ${swatch.index}`,
      'data-index': String(swatch.index),
      'data-used-by': String(swatch.used_by),
      class: `swatch${swatch.index === state.primary ? ' primary' : ''}${swatch.index === state.secondary ? ' secondary' : ''}`,
      tabindex: 0
    });
    const chip = el('span', { class: 'swatch-chip' });
    chip.style.background = `#${swatch.color}`;
    option.append(chip, el('span', { class: 'swatch-label' }, `Swatch ${swatch.index}`), el('span', { class: 'swatch-count' }, `Used by ${formatNumber(swatch.used_by, nf)} pixels`));
    option.addEventListener('click', (e) => {
      if (e.shiftKey) {
        state.secondary = swatch.index;
        stageAnnounce(state, `Secondary swatch ${swatch.index}`);
      } else {
        state.primary = swatch.index;
      }
      renderPalettePanel(state);
    });
    option.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          state.secondary = swatch.index;
          stageAnnounce(state, `Secondary swatch ${swatch.index}`);
        } else {
          state.primary = swatch.index;
        }
        renderPalettePanel(state);
      }
    });
    list.append(option);
  }
  region.append(list);
  if (state.role !== 'reviewer') {
    const colour = el('input', { id: 'swatch-colour', class: 'text-input', 'aria-label': 'Swatch colour', value: cellColor(state, state.primary) });
    const save = el('button', { id: 'save-swatch', class: 'pill', 'aria-label': 'Save swatch' }, 'Save swatch');
    save.addEventListener('click', () => void saveSwatch(state, swatchIndex(state), (colour as HTMLInputElement).value));
    const add = el('button', { id: 'add-swatch', class: 'pill', 'aria-label': 'Add swatch' }, 'Add swatch');
    add.addEventListener('click', () => void addSwatch(state, (colour as HTMLInputElement).value));
    const remove = el('button', { id: 'remove-swatch', class: 'pill', 'aria-label': 'Remove swatch' }, 'Remove swatch');
    remove.addEventListener('click', () => void removeSwatch(state, swatchIndex(state)));
    const rampSteps = el('input', { id: 'ramp-steps', type: 'number', min: 3, max: 32, value: 5, class: 'number-input', 'aria-label': 'Ramp steps' });
    const addRamp = el('button', { id: 'add-ramp', class: 'pill', 'aria-label': 'Add ramp' }, 'Add ramp');
    addRamp.addEventListener('click', () => void addRampAction(state, Number((rampSteps as HTMLInputElement).value)));
    if (state.primary === 0 || state.secondary === 0) addRamp.setAttribute('disabled', 'true');
    const importPalette = el('button', { id: 'import-palette', class: 'pill', 'aria-label': 'Import palette' }, 'Import palette');
    const fileInput = el('input', { id: 'palette-file', type: 'file', class: 'visually-hidden', 'aria-label': 'Palette file' });
    importPalette.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => void importPaletteFile(state, fileInput as HTMLInputElement));
    region.append(colour, save, add, remove, rampSteps, addRamp, importPalette, fileInput);
  }
  host.append(region);
}

function swatchIndex(state: State): number {
  return state.primary;
}

async function saveSwatch(state: State, index: number, colour: string): Promise<void> {
  const swatch = state.palette.swatches.find((s) => s.index === index);
  if (!swatch) return;
  statusText('notices', 'Saving swatch…');
  try {
    const res = await api.patch(`/api/palettes/${state.palette.id}/swatches/${index}`, {
      color: colour.replace('#', '').toLowerCase(), version: swatch.version
    }) as { index: number; color: string; version: number; used_by: number; frames: number };
    swatch.color = res.color;
    swatch.version = res.version;
    swatch.used_by = res.used_by;
    swatch.frames = res.frames;
    state.seq++;
    const nf = myNumberFormat();
    stageAnnounce(state, `Swatch ${res.index} now ${res.color}, used by ${formatNumber(res.used_by, nf)} pixels in ${formatNumber(res.frames, nf)} ${res.frames === 1 ? 'frame' : 'frames'}`);
    if (!reducedMotion()) runIndexFlood(state, res.index, res.color);
    else { drawStage(state); renderPalettePanel(state); }
  } catch (e) {
    if (e instanceof ApiFail) showErrors(byId('app'), e);
  }
}

function runIndexFlood(state: State, index: number, newColour: string): void {
  // pixels take the new colour in rings from the cursor over 420ms; stored values are already final
  const w = state.sprite.width, h = state.sprite.height;
  const far = Math.max(
    Math.max(state.cursor.x, w - 1 - state.cursor.x),
    Math.max(state.cursor.y, h - 1 - state.cursor.y)
  );
  state.floodRadius = 0;
  state.floodSwatch = { index, color: '' };
  const started = performance.now();
  const step = (): void => {
    const t = Math.min(1, (performance.now() - started) / 420);
    const eased = 1 - Math.pow(1 - t, 2); // starts quickly, settles softly
    state.floodRadius = Math.round(eased * far);
    drawStage(state);
    if (t < 1) requestAnimationFrame(step);
    else {
      state.floodRadius = null;
      state.floodSwatch = null;
      drawStage(state);
      // thumbnails change left to right, 30ms apart
      const thumbs = Array.from(document.querySelectorAll('[data-thumb-seq]'));
      thumbs.forEach((thumb, i) => {
        window.setTimeout(() => {
          thumb.setAttribute('data-thumb-seq', String(state.seq));
          void updateThumb(state, Number(thumb.getAttribute('data-frame-number') ?? 0), thumb as HTMLElement);
        }, i * 30);
      });
      renderPalettePanel(state);
    }
  };
  requestAnimationFrame(step);
}

async function updateThumb(state: State, frame: number, node: HTMLElement): Promise<void> {
  if (frame < 1) return;
  const buf = composite(state.sprite.width, state.sprite.height, state.sprite.layers.map((l) => ({
    rows: cel(state, frame, l.id),
    colorOf: makeColorOf(state.palette.swatches.map((s) => ({ index: s.index, color: s.color }))),
    opacity: l.opacity,
    blend: (l.blend === 'multiply' ? 'multiply' : 'normal') as 'multiply' | 'normal',
    visible: l.visible
  })));
  const canvas = node as HTMLCanvasElement;
  if (canvas.tagName !== 'CANVAS') return;
  const w = state.sprite.width, h = state.sprite.height;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);
}

async function addSwatch(state: State, colour: string): Promise<void> {
  try {
    const res = await api.post(`/api/palettes/${state.palette.id}/swatches`, { color: colour.replace('#', '').toLowerCase() }) as { index: number; color: string };
    state.palette.swatches.push({ index: res.index, color: res.color, version: 1, used_by: 0, frames: 0, edited_by: null });
    renderPalettePanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function removeSwatch(state: State, index: number): Promise<void> {
  try {
    await api.del(`/api/palettes/${state.palette.id}/swatches/${index}`);
    state.palette.swatches = state.palette.swatches.filter((s) => s.index !== index);
    if (state.primary === index) state.primary = state.palette.swatches.find((s) => s.index !== 0)?.index ?? 0;
    if (state.secondary === index) state.secondary = 0;
    statusText('notices', `Swatch ${index} removed`);
    renderPalettePanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function addRampAction(state: State, steps: number): Promise<void> {
  try {
    const res = await api.post(`/api/palettes/${state.palette.id}/ramp`, {
      from: state.primary, to: state.secondary, steps
    }) as { swatches: { index: number; color: string; version: number }[] };
    for (const s of res.swatches) state.palette.swatches.push({ index: s.index, color: s.color, version: s.version, used_by: 0, frames: 0, edited_by: null });
    renderPalettePanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function importPaletteFile(state: State, input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  statusText('notices', 'Importing palette…');
  const text = await file.text();
  try {
    const res = await api.post(`/api/palettes/${state.palette.id}/import`, { file_name: file.name, text }) as { added: number };
    const nf = myNumberFormat();
    statusText('notices', `Added ${formatNumber(res.added, nf)} ${res.added === 1 ? 'swatch' : 'swatches'}`);
    const fresh = await api.get(`/api/palettes/${state.palette.id}`) as { swatches: { index: number; color: string; version: number; used_by: number; frames: number; edited_by: string | null }[] };
    state.palette.swatches = fresh.swatches;
    renderPalettePanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

// ---- layers panel ----

export function renderLayersPanel(state: State): void {
  const host = qs('#layers-panel');
  if (!host) return;
  clear(host);
  const region = el('section', { id: 'layers-region', role: 'region', 'aria-label': 'Layers', class: 'panel candy-cyan' });
  region.append(el('h2', { class: 'panel-title' }, 'Layers'));
  const list = el('div', { id: 'layers', role: 'listbox', 'aria-label': 'Layers', class: 'layer-list', tabindex: 0 });
  for (const layer of state.sprite.layers) {
    const option = el('div', {
      role: 'option', 'aria-label': layer.name, 'data-id': String(layer.id),
      class: `layer${layer.id === state.activeLayerId ? ' active' : ''}`, tabindex: 0
    });
    option.append(el('span', { class: 'layer-name' }, layer.name));
    if (layer.locked_by) option.append(el('span', { class: 'lock-note' }, 'Locked'));
    option.addEventListener('click', () => {
      state.activeLayerId = layer.id;
      renderLayersPanel(state);
      drawStage(state);
    });
    option.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.activeLayerId = layer.id;
        renderLayersPanel(state);
        drawStage(state);
      }
      if (e.key === ' ') {
        e.preventDefault();
        listAnnounce(`Lifted ${layer.name}, position ${layer.position} of ${state.sprite.layers.length}`);
      }
    });
    list.append(option);
  }
  region.append(list);
  if (state.role !== 'reviewer') {
    const add = el('button', { class: 'pill', 'aria-label': 'Add layer' }, 'Add layer');
    add.addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/sprites/${state.sprite.id}/layers`, {}) as { id: number; name: string; seq: number };
        state.sprite.layers.unshift({ id: res.id, name: res.name, opacity: 100, blend: 'normal', visible: true, locked_by: null, position: 1 });
        state.sprite.layers.forEach((l, i) => { l.position = i + 1; });
        state.seq = res.seq;
        renderLayersPanel(state);
      } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
    });
    const opacity = el('input', { id: 'layer-opacity', type: 'range', min: 0, max: 100, value: 100, class: 'slider', 'aria-label': 'Layer opacity' });
    opacity.addEventListener('input', () => void patchLayer(state, { opacity: Number((opacity as HTMLInputElement).value) }));
    const blend = el('select', { id: 'layer-blend', class: 'select-input', 'aria-label': 'Blend' });
    blend.append(el('option', { value: 'normal' }, 'Normal'), el('option', { value: 'multiply' }, 'Multiply'));
    blend.addEventListener('change', () => void patchLayer(state, { blend: (blend as HTMLSelectElement).value }));
    const visible = el('input', { id: 'layer-visible', type: 'checkbox' });
    visible.checked = state.sprite.layers.find((l) => l.id === state.activeLayerId)?.visible ?? true;
    visible.addEventListener('change', () => void patchLayer(state, { visible: (visible as HTMLInputElement).checked }));
    const visibleLabel = el('label', { class: 'check-label' });
    visibleLabel.append(visible, el('span', {}, 'Layer visible'));
    const lock = el('button', { id: 'lock-layer', class: 'pill', 'aria-label': 'Lock layer' }, 'Lock layer');
    lock.addEventListener('click', () => void toggleLock(state));
    const merge = el('button', { id: 'merge-down', class: 'pill', 'aria-label': 'Merge down' }, 'Merge down');
    merge.addEventListener('click', () => void mergeDown(state));
    region.append(add, opacity, blend, visibleLabel, lock, merge);
  }
  host.append(region);
}

async function patchLayer(state: State, patch: Record<string, unknown>): Promise<void> {
  try {
    const res = await api.patch(`/api/sprites/${state.sprite.id}/layers/${state.activeLayerId}`, patch) as { seq: number };
    state.seq = res.seq;
    const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
    if (layer) {
      if (patch['opacity'] !== undefined) layer.opacity = Number(patch['opacity']);
      if (patch['blend'] !== undefined) layer.blend = String(patch['blend']);
      if (patch['visible'] !== undefined) layer.visible = patch['visible'] === true;
    }
    drawStage(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function toggleLock(state: State): Promise<void> {
  const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  try {
    if (layer.locked_by === null) {
      const res = await api.post(`/api/sprites/${state.sprite.id}/layers/${layer.id}/lock`, {}) as { locked_by: string; seq: number };
      layer.locked_by = state.me?.id ?? 0;
      state.seq = res.seq;
    } else {
      const res = await api.del(`/api/sprites/${state.sprite.id}/layers/${layer.id}/lock`) as { seq: number };
      layer.locked_by = null;
      state.seq = res.seq;
    }
    renderLayersPanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function mergeDown(state: State): Promise<void> {
  const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  try {
    const res = await api.post(`/api/sprites/${state.sprite.id}/layers/${layer.id}/merge-down`, {}) as { seq: number; new_swatches: number };
    state.seq = res.seq;
    const nf = myNumberFormat();
    const below = state.sprite.layers.find((l) => l.position === layer.position + 1);
    if (below) statusText('notices', `Merged into ${below.name}, ${formatNumber(res.new_swatches, nf)} ${res.new_swatches === 1 ? 'new swatch' : 'new swatches'}`);
    const fresh = await api.get(`/api/sprites/${state.sprite.id}`) as { layers: typeof state.sprite.layers };
    state.sprite.layers = fresh.layers;
    state.activeLayerId = state.sprite.layers[0]?.id ?? 0;
    await reloadCels(state);
    renderLayersPanel(state);
    drawStage(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function reloadCels(state: State): Promise<void> {
  for (const frame of state.sprite.frames) {
    for (const layer of state.sprite.layers) {
      const data = await api.get(`/api/sprites/${state.sprite.id}/frames/${frame.number}/indices?layer=${encodeURIComponent(layer.name)}`) as { rows: number[][] };
      state.cels.set(celKey(frame.number, layer.id), data.rows);
    }
  }
}

// ---- preview panel ----

interface PreviewState {
  timer: number | undefined;
  position: number;
  pass: number;
  mode: 'autoplay' | 'step';
}

const preview: PreviewState = { timer: undefined, position: 0, pass: 1, mode: 'step' };
let previewTag: string | null = null;
let previewSpeed: 'half' | 'normal' | 'double' = 'normal';

export function renderPreviewPanel(state: State): void {
  const host = qs('#preview-panel');
  if (!host) return;
  clear(host);
  const region = el('section', { id: 'preview-region', role: 'region', 'aria-label': 'Preview', class: 'panel candy-cyan' });
  region.append(el('h2', { class: 'panel-title' }, 'Preview'));
  const canvas = el('canvas', { id: 'preview-canvas', class: 'preview-canvas' });
  canvas.setAttribute('data-preview-frame', '1');
  canvas.setAttribute('data-preview-mode', reducedMotion() ? 'step' : 'autoplay');
  canvas.width = state.sprite.width * 2;
  canvas.height = state.sprite.height * 2;
  const tagSelect = el('select', { id: 'preview-tag', class: 'select-input', 'aria-label': 'Preview tag' });
  tagSelect.append(el('option', { value: '' }, 'All frames'));
  for (const tag of state.sprite.tags) tagSelect.append(el('option', { value: String(tag.id) }, tag.name));
  tagSelect.addEventListener('change', () => {
    previewTag = (tagSelect as HTMLSelectElement).value || null;
    preview.position = 0;
    preview.pass = 1;
    startPreview(state);
  });
  const speedSelect = el('select', { id: 'preview-speed', class: 'select-input', 'aria-label': 'Preview speed' });
  speedSelect.append(el('option', { value: 'half' }, 'Half'), el('option', { value: 'normal' }, 'Normal'), el('option', { value: 'double' }, 'Double'));
  speedSelect.addEventListener('change', () => {
    previewSpeed = (speedSelect as HTMLSelectElement).value as 'half' | 'normal' | 'double';
    startPreview(state);
  });
  const prev = el('button', { class: 'pill small', 'aria-label': 'Previous frame' }, 'Previous frame');
  const next = el('button', { class: 'pill small', 'aria-label': 'Next frame' }, 'Next frame');
  prev.addEventListener('click', () => stepPreview(state, -1));
  next.addEventListener('click', () => stepPreview(state, 1));
  const playPause = el('button', { id: 'play-pause', class: 'pill small', 'aria-label': 'Pause preview' }, 'Pause preview');
  if (reducedMotion()) playPause.classList.add('hidden');
  playPause.addEventListener('click', () => {
    if (preview.mode === 'autoplay') {
      stopPreview();
      playPause.textContent = 'Play preview';
      playPause.setAttribute('aria-label', 'Play preview');
    } else {
      startPreview(state);
      playPause.textContent = 'Pause preview';
      playPause.setAttribute('aria-label', 'Pause preview');
    }
  });
  region.append(canvas, tagSelect, speedSelect, prev, next, playPause);
  host.append(region);
  drawPreviewFrame(state);
  if (!reducedMotion()) startPreview(state);
}

function previewSequence(state: State): number[] {
  const all = state.sprite.frames.map((f) => f.number);
  if (!previewTag) return all;
  const tag = state.sprite.tags.find((t) => String(t.id) === previewTag);
  if (!tag) return all;
  return tagSequence(tag.from, tag.to, tag.direction);
}

function frameDuration(state: State, frameNo: number): number {
  const frame = state.sprite.frames.find((f) => f.number === frameNo);
  const ms = frame?.duration_ms ?? 100;
  if (reducedMotion()) return ms;
  if (previewSpeed === 'half') return ms * 2;
  if (previewSpeed === 'double') return rh(ms, 2);
  return ms;
}

function drawPreviewFrame(state: State): void {
  const canvas = qs('#preview-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const seq = previewSequence(state);
  if (!seq.length) return;
  const frameNo = seq[preview.position % seq.length];
  canvas.setAttribute('data-preview-frame', String(frameNo));
  const buf = composite(state.sprite.width, state.sprite.height, state.sprite.layers.map((l) => ({
    rows: cel(state, frameNo, l.id),
    colorOf: makeColorOf(state.palette.swatches.map((s) => ({ index: s.index, color: s.color }))),
    opacity: l.opacity,
    blend: (l.blend === 'multiply' ? 'multiply' : 'normal') as 'multiply' | 'normal',
    visible: l.visible
  })));
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(state.sprite.width, state.sprite.height);
  img.data.set(buf);
  const off = document.createElement('canvas');
  off.width = state.sprite.width; off.height = state.sprite.height;
  off.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

function startPreview(state: State): void {
  stopPreview();
  if (reducedMotion()) return;
  preview.mode = 'autoplay';
  const canvas = qs('#preview-canvas');
  if (canvas) canvas.setAttribute('data-preview-mode', 'autoplay');
  const tick = (): void => {
    const seq = previewSequence(state);
    const tag = previewTag ? state.sprite.tags.find((t) => String(t.id) === previewTag) : null;
    const repeat = tag?.repeat ?? 0;
    const frameNo = seq[preview.position % seq.length];
    const duration = frameDuration(state, frameNo);
    preview.timer = window.setTimeout(() => {
      const at = (preview.position + 1) % seq.length;
      if (at === 0) {
        const passes = preview.pass + 1;
        if (repeat !== 0 && passes > repeat) {
          finishPreview(state, repeat);
          return;
        }
        preview.pass = passes;
      }
      preview.position = at;
      drawPreviewFrame(state);
      tick();
    }, duration);
  };
  tick();
}

function finishPreview(state: State, passes: number): void {
  stopPreview();
  const canvas = qs('#preview-canvas');
  if (canvas) canvas.setAttribute('data-preview-mode', 'step');
  statusText('notices', `Finished after ${formatNumber(passes, myNumberFormat())} ${passes === 1 ? 'pass' : 'passes'}`);
  void state;
}

function stopPreview(): void {
  if (preview.timer !== undefined) window.clearTimeout(preview.timer);
  preview.timer = undefined;
  preview.mode = 'step';
  const canvas = qs('#preview-canvas');
  if (canvas) canvas.setAttribute('data-preview-mode', 'step');
}

function stepPreview(state: State, dir: number): void {
  const seq = previewSequence(state);
  if (!seq.length) return;
  if (reducedMotion()) {
    // step buttons walk one pass, wrapping
    preview.position = (preview.position + dir + seq.length) % seq.length;
  } else {
    preview.position = (preview.position + dir + seq.length) % seq.length;
  }
  drawPreviewFrame(state);
}

// ---- export dialog ----

export function openExportDialog(state: State): void {
  const dialog = el('div', { role: 'dialog', 'aria-label': 'Export', class: 'dialog' });
  const format = el('select', { id: 'export-format', class: 'select-input', 'aria-label': 'Format' });
  format.append(el('option', { value: 'png' }, 'PNG'), el('option', { value: 'gif' }, 'GIF'), el('option', { value: 'sheet' }, 'Sheet'));
  const scale = el('input', { id: 'export-scale', type: 'number', min: 1, max: 16, value: 1, class: 'number-input', 'aria-label': 'Scale' });
  const frame = el('input', { id: 'export-frame', type: 'number', min: 1, value: 1, class: 'number-input', 'aria-label': 'Export frame' });
  const padding = el('input', { id: 'export-padding', type: 'number', min: 0, max: 64, value: 0, class: 'number-input', 'aria-label': 'Padding' });
  const extrude = el('input', { id: 'export-extrude', type: 'number', min: 0, max: 16, value: 0, class: 'number-input', 'aria-label': 'Extrude' });
  const label = el('input', { id: 'export-label', class: 'text-input', 'aria-label': 'Export label' });
  const start = el('button', { class: 'pill', 'aria-label': 'Start export' }, 'Start export');
  const cancelBtn = el('button', { id: 'cancel-job', class: 'pill', 'aria-label': 'Cancel job' }, 'Cancel job');
  cancelBtn.classList.add('hidden');
  const alertBox = el('div', { class: 'alert-box' });
  const progressText = () => statusText('job-progress', '');

  start.addEventListener('click', async () => {
    try {
      const body = {
        format: (format as HTMLSelectElement).value,
        scale: Number((scale as HTMLInputElement).value),
        frame: (format as HTMLSelectElement).value === 'png' ? Number((frame as HTMLInputElement).value) : undefined,
        padding: (format as HTMLSelectElement).value === 'sheet' ? Number((padding as HTMLInputElement).value) : 0,
        extrude: (format as HTMLSelectElement).value === 'sheet' ? Number((extrude as HTMLInputElement).value) : 0,
        label: (label as HTMLInputElement).value || undefined
      };
      const res = await api.post(`/api/sprites/${state.sprite.id}/exports`, body) as { job: number };
      cancelBtn.classList.remove('hidden');
      trackJob(res.job, cancelBtn);
    } catch (e) {
      if (e instanceof ApiFail) {
        if (e.status === 503) announceAlert(dialog, 'Storage is unavailable. Your artwork is safe.');
        else showErrors(dialog, e);
      }
    }
  });
  dialog.append(alertBox, format, scale, frame, padding, extrude, label, start, cancelBtn);
  document.body.append(dialog);
  openDialog(dialog);
  progressText();
}

function trackJob(jobId: number, cancelBtn: HTMLElement): void {
  statusText('job-progress', 'Processing 0 of 0');
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (ev) => {
    const data = JSON.parse(ev.data) as { state: string; done: number; total: number; files: { name: string }[] };
    if (data.state === 'stored') {
      statusText('job-progress', `Stored: ${data.files.map((f) => f.name).join(', ')}`);
      source.close();
      cancelBtn.classList.add('hidden');
      return;
    }
    if (data.state === 'cancelled') {
      statusText('job-progress', `Cancelled at ${data.done} of ${data.total}: nothing stored`);
      source.close();
      cancelBtn.classList.add('hidden');
      return;
    }
    if (data.state === 'failed') {
      statusText('job-progress', 'Export failed: nothing stored');
      source.close();
      cancelBtn.classList.add('hidden');
      return;
    }
    statusText('job-progress', `Processing ${data.done} of ${data.total}`);
  };
  source.onerror = () => source.close();
  cancelBtn.addEventListener('click', async () => {
    source.close();
    try {
      await api.post(`/api/jobs/${jobId}/cancel`);
    } catch { /* the poll will show the final state */ }
  });
}

// ---- command palette ----

export function buildCommandPalette(state: State): HTMLElement {
  const dialog = el('div', { role: 'dialog', 'aria-label': 'Command palette', class: 'dialog cmd' });
  const input = el('input', { id: 'command-input', class: 'text-input', role: 'combobox', 'aria-label': 'Command', 'aria-expanded': 'true', 'aria-controls': 'commands-list' });
  const list = el('ul', { id: 'commands-list', role: 'listbox', 'aria-label': 'Commands', class: 'commands-list' });
  const allItems = (): string[] => {
    const items = Object.values(TOOL_LABELS).map((t) => `Tool: ${t}`);
    for (const layer of state.sprite.layers) items.push(`Layer: ${layer.name}`);
    for (const frame of state.sprite.frames) items.push(`Frame ${frame.number}`);
    for (const swatch of state.palette.swatches) if (swatch.index !== 0) items.push(`Swatch ${swatch.index}`);
    return items;
  };
  let activeIndex = 0;
  let ranked: string[] = allItems();
  const render = (): void => {
    clear(list);
    if (!ranked.length) {
      list.append(el('li', { class: 'empty' }, 'No matching commands'));
      return;
    }
    ranked.forEach((item, i) => {
      const li = el('li', { role: 'option', 'aria-selected': i === activeIndex ? 'true' : 'false', class: i === activeIndex ? 'active' : '' }, item);
      list.append(li);
    });
    input.setAttribute('aria-activedescendant', `cmd-${activeIndex}`);
    const active = list.children[activeIndex] as HTMLElement | undefined;
    if (active) active.id = `cmd-${activeIndex}`;
  };
  const run = (item: string): void => {
    if (item.startsWith('Tool: ')) chooseTool(state, (Object.entries(TOOL_LABELS).find(([, v]) => v === item.slice(6))?.[0] ?? 'pencil') as Parameters<typeof chooseTool>[1]);
    else if (item.startsWith('Layer: ')) {
      const layer = state.sprite.layers.find((l) => l.name === item.slice(7));
      if (layer) {
        state.activeLayerId = layer.id;
        const { renderLayersPanel } = moduleBinding;
        renderLayersPanel?.(state);
        drawStage(state);
      }
    } else if (item.startsWith('Frame ')) {
      state.frame = Number(item.slice(6));
      stageAnnounce(state, `Frame ${state.frame} of ${state.sprite.frames.length}`);
      moduleBinding.renderFramesPanel?.(state);
      drawStage(state);
    } else if (item.startsWith('Swatch ')) {
      state.primary = Number(item.slice(7));
      moduleBinding.renderPalettePanel?.(state);
    }
  };
  input.addEventListener('input', () => {
    ranked = rankCommands((input as HTMLInputElement).value, allItems());
    activeIndex = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(ranked.length - 1, activeIndex + 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); render(); }
    if (e.key === 'Enter') { e.preventDefault(); if (ranked[activeIndex]) { run(ranked[activeIndex]); closeDialog(dialog); } }
  });
  dialog.append(input, list);
  render();
  return dialog;
}

// panels referenced by the command palette without a circular import at load time
interface PanelBinding {
  renderLayersPanel?: (s: State) => void;
  renderFramesPanel?: (s: State) => void;
  renderPalettePanel?: (s: State) => void;
}
export const moduleBinding: PanelBinding = {};

// ---- more panels sheet (phone) ----

export function buildMorePanelsSheet(state: State): void {
  const body = document.body;
  const existing = qs('#more-panels-sheet');
  if (existing) existing.remove();
  const sheet = el('div', { id: 'more-panels-sheet', role: 'dialog', 'aria-label': 'More panels', class: 'dialog sheet' });
  const tabs = el('div', { role: 'tablist', 'aria-label': 'Workspace', class: 'tablist' });
  const panelsHost = el('div', { class: 'tab-panels' });
  const defs: [string, string, () => void][] = [
    ['tiles', 'Tiles', () => renderTilesPanel(state)],
    ['comments', 'Comments', () => renderCommentsPanel(state)],
    ['snapshots', 'Snapshots', () => renderSnapshotsPanel(state)],
    ['activity', 'Activity', () => renderActivityPanel(state)]
  ];
  for (const [key, label, render] of defs) {
    const tab = el('button', { role: 'tab', 'aria-label': label, class: 'tab' }, label);
    const hostId = `sheet-${key}`;
    tab.addEventListener('click', () => {
      const host = byId(hostId);
      for (const other of Array.from(panelsHost.children)) other.classList.remove('open');
      host.classList.add('open');
      render();
    });
    tabs.append(tab);
  }
  for (const [key] of defs) {
    panelsHost.append(el('div', { id: `sheet-${key}`, class: 'sheet-panel' }));
  }
  sheet.append(tabs, panelsHost);
  body.append(sheet);
  const openBtn = el('button', { id: 'more-panels-btn', class: 'pill', 'aria-label': 'More panels' }, 'More panels');
  openBtn.addEventListener('click', () => {
    openDialog(sheet, openBtn);
    const firstHost = byId('sheet-tiles');
    firstHost.classList.add('open');
    renderTilesPanel(state);
  });
  const topbar = qs('.topbar');
  if (topbar) topbar.append(openBtn);
}

export function bindPanels(state: State): void {
  moduleBinding.renderLayersPanel = renderLayersPanel;
  moduleBinding.renderFramesPanel = renderFramesPanel;
  moduleBinding.renderPalettePanel = renderPalettePanel;
  // phone tablist for Canvas/Layers/Frames/Palette
  const body = document.body;
  const existing = qs('#phone-tabs');
  if (existing) existing.remove();
  const dock = el('div', { id: 'phone-tabs', role: 'tablist', 'aria-label': 'Workspace', class: 'tablist phone-dock' });
  const panelOrder: [string, string, () => void][] = [
    ['canvas', 'Canvas', () => { /* canvas is the stage, always present */ }],
    ['layers', 'Layers', () => renderLayersPanel(state)],
    ['frames', 'Frames', () => renderFramesPanel(state)],
    ['palette', 'Palette', () => renderPalettePanel(state)]
  ];
  for (const [key, label, render] of panelOrder) {
    const tab = el('button', { role: 'tab', 'aria-label': label, class: 'tab' }, label);
    tab.addEventListener('click', () => {
      for (const other of Array.from(document.querySelectorAll('.workspace-tab-panel'))) other.classList.remove('open');
      const host = document.getElementById(`tab-panel-${key}`);
      if (host) {
        host.classList.add('open');
        render();
      }
    });
    dock.append(tab);
  }
  body.append(dock);
  // panels that move into tabs on the phone
  const stage = qs('#stage-panel');
  if (stage) {
    const wrapper = el('div', { id: 'tab-panel-canvas', class: 'workspace-tab-panel open' });
    stage.after(wrapper);
    wrapper.append(stage);
  }
  for (const key of ['layers', 'frames', 'palette']) {
    const host = document.getElementById(`${key}-panel`);
    if (host) {
      const wrapper = el('div', { id: `tab-panel-${key}`, class: 'workspace-tab-panel' });
      host.after(wrapper);
      wrapper.append(host);
    }
  }
}

// ---- undo, redo, selection ops, floating selection ----

export async function undoRedo(state: State, kind: 'undo' | 'redo'): Promise<void> {
  if (state.role === 'reviewer') { announceAlert(document, "Reviewers can't draw"); return; }
  try {
    const res = await api.post(`/api/sprites/${state.sprite.id}/${kind}`) as { seq: number; pixels_changed: number };
    state.seq = res.seq;
    stageAnnounce(state, kind === 'undo' ? 'Undone' : 'Redone');
    const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
    if (layer) {
      const data = await api.get(`/api/sprites/${state.sprite.id}/frames/${state.frame}/indices?layer=${encodeURIComponent(layer.name)}`) as { rows: number[][] };
      state.cels.set(celKey(state.frame, layer.id), data.rows);
    }
    drawStage(state);
  } catch (e) {
    if (e instanceof ApiFail) announceAlert(document, e.notice());
  }
}

export function runSelectionOp(state: State, op: string): void {
  if (state.role === 'reviewer') { announceAlert(document, "Reviewers can't draw"); return; }
  const rect = state.selection;
  if (!rect && op !== 'paste') return;
  if (op === 'copy') {
    const rows = cel(state, state.frame, state.activeLayerId);
    const copy: number[][] = [];
    for (let y = 0; y < rect!.h; y++) {
      const row: number[] = [];
      for (let x = 0; x < rect!.w; x++) row.push(rows[rect!.y + y]?.[rect!.x + x] ?? 0);
      copy.push(row);
    }
    state.copied = copy;
    return;
  }
  void sendSelectionOp(state, op);
}

async function sendSelectionOp(state: State, op: string): Promise<void> {
  const rect = state.selection;
  const body: Record<string, unknown> = {
    client_stroke_id: `sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    frame: state.frame,
    layer: state.activeLayerId,
    op,
    rect: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : undefined,
    to: { x: state.cursor.x, y: state.cursor.y }
  };
  if (op === 'paste') {
    body['rect'] = { x: 0, y: 0, w: state.copied?.[0]?.length ?? 0, h: state.copied?.length ?? 0 };
    body['rows'] = state.copied ?? [];
  }
  try {
    const res = await api.post(`/api/sprites/${state.sprite.id}/selection`, body) as { seq: number; pixels_changed: number };
    state.seq = res.seq;
    if (op === 'move' || op === 'paste') {
      state.selection = { x: state.cursor.x, y: state.cursor.y, w: body['rect'] ? (body['rect'] as { w: number }).w : 0, h: body['rect'] ? (body['rect'] as { h: number }).h : 0 };
    }
    const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
    if (layer) {
      const data = await api.get(`/api/sprites/${state.sprite.id}/frames/${state.frame}/indices?layer=${encodeURIComponent(layer.name)}`) as { rows: number[][] };
      state.cels.set(celKey(state.frame, layer.id), data.rows);
    }
    drawStage(state);
  } catch (e) { if (e instanceof ApiFail) announceAlert(document, e.notice()); }
}

export function liftSelection(state: State): void {
  if (!state.selection) return;
  const rows = cel(state, state.frame, state.activeLayerId);
  const copy: number[][] = [];
  for (let y = 0; y < state.selection.h; y++) {
    const row: number[] = [];
    for (let x = 0; x < state.selection.w; x++) row.push(rows[state.selection.y + y]?.[state.selection.x + x] ?? 0);
    copy.push(row);
  }
  state.copied = copy;
  state.floating = { ...state.selection };
  stageAnnounce(state, `Selection ${state.selection.w} by ${state.selection.h} at ${state.selection.x}, ${state.selection.y}`);
  drawStage(state);
}

export async function commitFloating(state: State): Promise<void> {
  if (!state.floating) return;
  const f = state.floating;
  const body = {
    client_stroke_id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    frame: state.frame,
    layer: state.activeLayerId,
    op: 'move',
    rect: state.selection ? { x: state.selection.x, y: state.selection.y, w: state.selection.w, h: state.selection.h } : { x: f.x, y: f.y, w: f.w, h: f.h },
    to: { x: f.x, y: f.y }
  };
  try {
    const res = await api.post(`/api/sprites/${state.sprite.id}/selection`, body) as { seq: number; pixels_changed: number };
    state.seq = res.seq;
    state.selection = { x: f.x, y: f.y, w: f.w, h: f.h };
    state.floating = null;
    stageAnnounce(state, `Selection placed at ${f.x}, ${f.y}`);
    const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
    if (layer) {
      const data = await api.get(`/api/sprites/${state.sprite.id}/frames/${state.frame}/indices?layer=${encodeURIComponent(layer.name)}`) as { rows: number[][] };
      state.cels.set(celKey(state.frame, layer.id), data.rows);
    }
    drawStage(state);
  } catch (e) { if (e instanceof ApiFail) announceAlert(document, e.notice()); }
}

// ---- offline queue, reconnect, events ----

export function goOffline(state: State): void {
  state.offline = true;
  statusText('sync-status', `Offline · ${state.strokeQueue.length} strokes queued`);
}

export async function reconnect(state: State): Promise<void> {
  const queued = state.strokeQueue.slice();
  state.offline = false;
  let applied = 0;
  let refused = 0;
  let refusedMessage = '';
  // fetch missed events first, then replay queued strokes in order
  const events = await api.get(`/api/sprites/${state.sprite.id}/events?since=${state.seq}`) as { events: { seq: number }[] };
  applied += events.events.length;
  const fresh = await api.get(`/api/sprites/${state.sprite.id}`) as typeof state.sprite;
  state.sprite = fresh;
  await reloadCels(state);
  for (const request of queued) {
    try {
      const body = {
        client_stroke_id: request.client_stroke_id,
        frame: request.frame, layer: request.layer, tool: request.tool,
        points: request.points, swatch: request.swatch, size: request.size,
        mirror: request.mirror, options: request.options
      };
      const res = await api.post(`/api/sprites/${state.sprite.id}/strokes`, body) as { seq: number; pixels_changed: number };
      state.seq = res.seq;
      applied++;
    } catch (e) {
      refused++;
      if (e instanceof ApiFail) refusedMessage = e.notice();
    }
  }
  state.strokeQueue = [];
  await reloadCels(state);
  drawStage(state);
  const total = applied;
  statusText('sync-status', `Reconnected · ${formatNumber(total, myNumberFormat())} updates applied`);
  if (refused > 0) {
    const line = el('div', {}, `1 stroke refused: ${refusedMessage}`);
    byId('sync-status').after(line);
  }
}

export async function pollEvents(state: State): Promise<void> {
  if (state.offline) return;
  try {
    const data = await api.get(`/api/sprites/${state.sprite.id}/events?since=${state.seq}`) as {
      events: { seq: number; type: string; by: string | null; at: string; data: Record<string, unknown> }[];
    };
    if (!data.events.length) return;
    let needsCels = false;
    let needsPalette = false;
    let needsTiles = false;
    let needsComments = false;
    for (const event of data.events) {
      state.seq = Math.max(state.seq, event.seq);
      if (['stroke', 'selection', 'undo', 'redo'].includes(event.type)) {
        needsCels = true;
        if (event.by && event.by !== state.me?.name) {
          const count = Number(event.data['changed'] ?? 0);
          if (count > 0) {
            const nf = myNumberFormat();
            teamAnnounce(`${event.by} painted ${formatNumber(count, nf)} pixels`);
          }
        }
      }
      if (event.type === 'swatch' || event.type === 'palette') { needsPalette = true; needsCels = true; }
      if (event.type === 'layer' || event.type === 'frame' || event.type === 'cel' || event.type === 'tag' || event.type === 'restore') { needsCels = true; }
      if (event.type === 'tile' || event.type === 'tilemap') needsTiles = true;
      if (event.type === 'comment') needsComments = true;
    }
    if (needsCels) {
      const fresh = await api.get(`/api/sprites/${state.sprite.id}`) as typeof state.sprite;
      fresh.project_id = state.sprite.project_id;
      state.sprite = fresh;
      await reloadCels(state);
    }
    if (needsPalette) {
      const fresh = await api.get(`/api/palettes/${state.palette.id}`) as typeof state.palette;
      state.palette = fresh;
    }
    if (needsComments) {
      const fresh = await api.get(`/api/sprites/${state.sprite.id}/comments`) as { comments: typeof state.comments };
      state.comments = fresh.comments;
    }
    if (needsTiles) await refreshTilesSilent(state);
    drawStage(state);
    if (needsPalette) renderPalettePanel(state);
    if (needsComments) renderCommentsPanel(state);
    if (needsTiles) renderTilesPanel(state);
    renderFramesPanel(state);
  } catch { /* offline; the queue handles it */ }
}

async function refreshTilesSilent(state: State): Promise<void> {
  state.tilesets = [];
  state.tilemaps = [];
  const sprite = await api.get(`/api/sprites/${state.sprite.id}`) as typeof state.sprite;
  sprite.project_id = state.sprite.project_id;
  state.sprite = sprite;
  for (const tsId of sprite.tilesets) state.tilesets.push(await api.get(`/api/tilesets/${tsId}`) as typeof state.tilesets[number]);
  for (const tmId of sprite.tilemaps) state.tilemaps.push(await api.get(`/api/tilemaps/${tmId}`) as typeof state.tilemaps[number]);
}

// ---- frames panel ----

export function renderFramesPanel(state: State): void {
  const host = qs('#frames-panel');
  if (!host) return;
  clear(host);
  const nf = myNumberFormat();
  const region = el('section', { id: 'frames-region', role: 'region', 'aria-label': 'Frames', class: 'panel candy-lemon' });
  region.append(el('h2', { class: 'panel-title' }, 'Frames'));
  const totalMs = state.sprite.frames.reduce((s, f) => s + f.duration_ms, 0);
  const mean = state.sprite.frames.length ? totalMs / state.sprite.frames.length : 0;
  const meanText = (() => {
    const rounded = Math.round(mean * 10) / 10;
    const fixed = rounded.toFixed(1);
    return fixed.endsWith('.0') ? fixed.slice(0, -2) : formatNumber(rounded, nf).includes('.') ? formatNumber(rounded, nf) : formatNumber(rounded, nf);
  })();
  const totals = el('p', { class: 'frames-totals', 'data-total-ms': String(totalMs) },
    `Total ${formatNumber(totalMs, nf)} ms · Average ${meanText} ms`);
  region.append(totals);
  const grid = el('div', { id: 'frames-grid', role: 'grid', 'aria-label': 'Frames', class: 'frames-grid' });
  grid.setAttribute('aria-rowcount', String(state.sprite.frames.length));
  const visibleCount = Math.min(40, state.sprite.frames.length);
  state.sprite.frames.slice(0, visibleCount).forEach((frame) => {
    const row = el('div', { role: 'row', 'aria-label': `Frame ${frame.number}`, 'aria-rowindex': String(frame.number), class: `frame-row${frame.number === state.frame ? ' active' : ''}`, 'data-frame-number': String(frame.number), tabindex: 0 });
    const thumb = el('canvas', { class: 'frame-thumb', 'data-thumb-seq': String(state.thumbSeq.get(frame.number) ?? 0), 'data-frame-number': String(frame.number) });
    thumb.width = state.sprite.width; thumb.height = state.sprite.height;
    row.append(thumb, el('span', { class: 'frame-label' }, `Frame ${frame.number}`));
    if (frame.linked_layers.length) row.append(el('span', { class: 'linked-note' }, 'Linked'));
    row.addEventListener('click', () => {
      state.frame = frame.number;
      stageAnnounce(state, `Frame ${frame.number} of ${state.sprite.frames.length}`);
      drawStage(state);
      renderFramesPanel(state);
    });
    grid.append(row);
  });
  region.append(grid);
  if (state.role !== 'reviewer') {
    const addFrame = el('button', { class: 'pill', 'aria-label': 'Add frame' }, 'Add frame');
    addFrame.addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/sprites/${state.sprite.id}/frames`, {}) as { number: number; seq: number };
        state.sprite.frames.push({ number: res.number, duration_ms: 100, linked_layers: [] });
        state.seq = res.seq;
        renderFramesPanel(state);
      } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
    });
    const duration = el('input', { id: 'frame-duration', type: 'number', class: 'number-input', 'aria-label': 'Frame duration', value: String(state.sprite.frames.find((f) => f.number === state.frame)?.duration_ms ?? 100) });
    duration.addEventListener('change', async () => {
      try {
        const res = await api.patch(`/api/sprites/${state.sprite.id}/frames/${state.frame}`, { duration_ms: Number((duration as HTMLInputElement).value) }) as { seq: number };
        state.seq = res.seq;
        const frame = state.sprite.frames.find((f) => f.number === state.frame);
        if (frame) frame.duration_ms = Number((duration as HTMLInputElement).value);
        renderFramesPanel(state);
      } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
    });
    const link = el('button', { class: 'pill', 'aria-label': 'Link cel' }, 'Link cel');
    link.addEventListener('click', async () => {
      const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
      if (!layer || state.frame < 2) return;
      try {
        const res = await api.post(`/api/sprites/${state.sprite.id}/frames/${state.frame}/cels/link`, { layer: layer.name, to_frame: state.frame - 1 }) as { seq: number };
        state.seq = res.seq;
        const frame = state.sprite.frames.find((f) => f.number === state.frame);
        if (frame) frame.linked_layers = [state.frame - 1];
        await reloadCels(state);
        renderFramesPanel(state);
        drawStage(state);
      } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
    });
    const unlink = el('button', { class: 'pill', 'aria-label': 'Unlink cel' }, 'Unlink cel');
    unlink.addEventListener('click', async () => {
      const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
      if (!layer) return;
      try {
        const res = await api.post(`/api/sprites/${state.sprite.id}/frames/${state.frame}/cels/unlink`, { layer: layer.name }) as { seq: number };
        state.seq = res.seq;
        const frame = state.sprite.frames.find((f) => f.number === state.frame);
        if (frame) frame.linked_layers = [];
        await reloadCels(state);
        renderFramesPanel(state);
        drawStage(state);
      } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
    });
    const tagName = el('input', { id: 'tag-name', class: 'text-input', 'aria-label': 'Tag name' });
    const tagFrom = el('input', { id: 'tag-from', type: 'number', min: 1, class: 'number-input', 'aria-label': 'Tag from', value: '1' });
    const tagTo = el('input', { id: 'tag-to', type: 'number', min: 1, class: 'number-input', 'aria-label': 'Tag to', value: '1' });
    const tagDirection = el('select', { id: 'tag-direction', class: 'select-input', 'aria-label': 'Tag direction' });
    tagDirection.append(el('option', { value: 'forward' }, 'Forward'), el('option', { value: 'reverse' }, 'Reverse'), el('option', { value: 'pingpong' }, 'Pingpong'));
    const tagRepeat = el('input', { id: 'tag-repeat', type: 'number', min: 0, max: 99, class: 'number-input', 'aria-label': 'Tag repeat', value: '0' });
    const addTag = el('button', { class: 'pill', 'aria-label': 'Add tag' }, 'Add tag');
    addTag.addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/sprites/${state.sprite.id}/tags`, {
          name: (tagName as HTMLInputElement).value,
          from: Number((tagFrom as HTMLInputElement).value),
          to: Number((tagTo as HTMLInputElement).value),
          direction: (tagDirection as HTMLSelectElement).value,
          repeat: Number((tagRepeat as HTMLInputElement).value)
        }) as { id: number; seq: number };
        state.sprite.tags.push({
          id: res.id, name: (tagName as HTMLInputElement).value,
          from: Number((tagFrom as HTMLInputElement).value), to: Number((tagTo as HTMLInputElement).value),
          direction: (tagDirection as HTMLSelectElement).value as 'forward' | 'reverse' | 'pingpong',
          repeat: Number((tagRepeat as HTMLInputElement).value)
        });
        state.seq = res.seq;
        renderFramesPanel(state);
        renderPreviewPanel(state);
      } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
    });
    region.append(addFrame, duration, link, unlink, tagName, tagFrom, tagTo, tagDirection, tagRepeat, addTag);
  }
  // frame thumbnails
  host.append(region);
  for (const row of Array.from(grid.querySelectorAll('.frame-row'))) {
    void updateThumb(state, Number(row.getAttribute('data-frame-number')), row.querySelector('canvas') as HTMLCanvasElement);
  }
}

// ---- tiles panel ----

export function renderTilesPanel(state: State): void {
  const host = qs('#tiles-panel');
  if (!host) return;
  clear(host);
  const region = el('section', { id: 'tiles-region', role: 'region', 'aria-label': 'Tiles', class: 'panel candy-orange' });
  region.append(el('h2', { class: 'panel-title' }, 'Tiles'));
  if (!state.tilesets.length) {
    region.append(el('p', { class: 'empty' }, 'No tiles yet'));
  } else {
    const tileset = state.tilesets.find((t) => t.id === state.selectedTileset) ?? state.tilesets[0];
    const nf = myNumberFormat();
    const list = el('div', { id: 'tiles', role: 'listbox', 'aria-label': 'Tiles', class: 'tile-list', tabindex: 0 });
    for (const tile of tileset.tiles) {
      const option = el('div', { role: 'option', 'aria-label': `Tile ${tile.id}`, 'data-tile': String(tile.id), class: `tile-option${tile.id === state.selectedTile ? ' active' : ''}`, tabindex: 0 });
      const mini = el('canvas', { class: 'tile-thumb' });
      mini.width = tileset.tile_size; mini.height = tileset.tile_size;
      drawTileThumb(mini, tile.rows, state);
      option.append(mini, el('span', { class: 'tile-label' }, `Tile ${tile.id}`), el('span', { class: 'tile-uses' }, `Used ${formatNumber(tile.uses, nf)} ${tile.uses === 1 ? 'time' : 'times'}`));
      option.addEventListener('click', () => { state.selectedTile = tile.id; renderTilesPanel(state); });
      list.append(option);
    }
    region.append(list);
    const map = state.tilemaps.find((m) => m.id === state.selectedTilemap) ?? state.tilemaps[0];
    if (map) {
      const edgeCheck = el('input', { id: 'edge-matching', type: 'checkbox' });
      edgeCheck.checked = state.edgeMatching;
      edgeCheck.addEventListener('change', () => { state.edgeMatching = (edgeCheck as HTMLInputElement).checked; });
      const edgeLabel = el('label', { class: 'check-label' });
      edgeLabel.append(edgeCheck, el('span', {}, 'Edge matching'));
      region.append(edgeLabel);
      const grid = el('div', { id: 'tilemap-grid', role: 'grid', 'aria-label': 'Tilemap', class: 'tilemap-grid' });
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const cellData = map.cells.find((c) => c.x === x && c.y === y);
          const cell = el('div', {
            role: 'gridcell',
            'data-x': String(x), 'data-y': String(y),
            'data-tile': String(cellData?.tile ?? 0),
            'data-flip-h': String(cellData?.flip_h ?? false),
            'data-flip-v': String(cellData?.flip_v ?? false),
            class: 'tilemap-cell', tabindex: 0
          });
          if (cellData && cellData.tile !== 0) {
            const tile = tileset.tiles.find((t) => t.id === cellData.tile);
            if (tile) {
              const mini = el('canvas', { class: 'tilemap-thumb' });
              mini.width = tileset.tile_size; mini.height = tileset.tile_size;
              drawTileThumb(mini, tile.rows, state, cellData.flip_h, cellData.flip_v);
              cell.append(mini);
            }
          }
          cell.addEventListener('click', () => void placeCell(state, x, y, cell));
          grid.append(cell);
        }
      }
      if (state.stamp) grid.setAttribute('data-stamp', `${state.stamp.w},${state.stamp.h}`);
      else grid.removeAttribute('data-stamp');
      bindTilemapKeys(state, grid, map, tileset);
      region.append(grid);
      if (state.role !== 'reviewer') {
        const importFrame = el('button', { class: 'pill', 'aria-label': 'Import frame as tiles' }, 'Import frame as tiles');
        importFrame.addEventListener('click', () => void importFrameAsTiles(state, tileset.id, map.id));
        const editTile = el('button', { class: 'pill', 'aria-label': 'Edit tile' }, 'Edit tile');
        editTile.addEventListener('click', () => openTileEditor(state, tileset, state.selectedTile));
        const newTileset = el('button', { class: 'pill', 'aria-label': 'New tileset' }, 'New tileset');
        newTileset.addEventListener('click', async () => {
          try {
            await api.post(`/api/sprites/${state.sprite.id}/tilesets`, { name: 'Tileset', tile_size: 8 });
            const fresh = await api.get(`/api/tilesets/${tileset.id}`) as typeof tileset;
            void fresh;
            await refreshTiles(state);
          } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
        });
        const edgeTable = el('input', { id: 'edge-table', class: 'text-input', 'aria-label': 'Edge table', value: tileset.edge_table.join(',') });
        const saveEdge = el('button', { class: 'pill', 'aria-label': 'Save edge table' }, 'Save edge table');
        saveEdge.addEventListener('click', async () => {
          const table = (edgeTable as HTMLInputElement).value.split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
          try {
            const res = await api.patch(`/api/tilesets/${tileset.id}/edges`, { table }) as { seq: number };
            state.seq = res.seq;
            tileset.edge_table = table;
          } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
        });
        region.append(importFrame, editTile, newTileset, edgeTable, saveEdge);
      }
    }
  }
  host.append(region);
}

function drawTileThumb(canvas: HTMLCanvasElement, rows: number[][], state: State, flipH = false, flipV = false): void {
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width / rows[0].length;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const idx = rows[y][x];
      if (idx === 0) continue;
      const sx = flipH ? rows[y].length - 1 - x : x;
      const sy = flipV ? rows.length - 1 - y : y;
      ctx.fillStyle = `#${cellColor(state, idx)}`;
      ctx.fillRect(sx * size, sy * size, Math.ceil(size), Math.ceil(size));
    }
  }
}

async function placeCell(state: State, x: number, y: number, cell: HTMLElement): Promise<void> {
  if (state.role === 'reviewer') { announceAlert(document, "Reviewers can't change artwork"); return; }
  const map = state.tilemaps.find((m) => m.id === state.selectedTilemap);
  if (!map) return;
  const current = map.cells.find((c) => c.x === x && c.y === y);
  const tile = current?.tile === state.selectedTile ? 0 : state.selectedTile;
  try {
    const res = await api.post(`/api/tilemaps/${map.id}/cells`, { x, y, tile, flip_h: false, flip_v: false, edge_matching: state.edgeMatching }) as { seq: number; changed: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[] };
    state.seq = res.seq;
    for (const change of res.changed) {
      map.cells = map.cells.filter((c) => !(c.x === change.x && c.y === change.y));
      if (change.tile !== 0) map.cells.push(change);
      const node = document.querySelector(`#tilemap-grid [data-x="${change.x}"][data-y="${change.y}"]`);
      if (node) {
        node.setAttribute('data-tile', String(change.tile));
        node.setAttribute('data-flip-h', String(change.flip_h));
        node.setAttribute('data-flip-v', String(change.flip_v));
      }
    }
    renderTilesPanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
  void cell;
}

function bindTilemapKeys(state: State, grid: HTMLElement, map: { width: number; height: number; id: number }, tileset: { edge_table: number[] }): void {
  let focusX = 0, focusY = 0;
  let markStart: { x: number; y: number } | null = null;
  const focusCell = (): HTMLElement | null => grid.querySelector(`[data-x="${focusX}"][data-y="${focusY}"]`);
  const setFocus = (): void => { const cell = focusCell(); if (cell) (cell as HTMLElement).focus(); };

  grid.addEventListener('keydown', (e) => {
    const move = (dx: number, dy: number): void => {
      focusX = Math.max(0, Math.min(map.width - 1, focusX + dx));
      focusY = Math.max(0, Math.min(map.height - 1, focusY + dy));
      setFocus();
      const cell = focusCell();
      const tile = cell?.getAttribute('data-tile') ?? '0';
      let text = `Cell ${focusX}, ${focusY}, tile ${tile}`;
      if (cell?.getAttribute('data-flip-h') === 'true') text += ', flip H';
      if (cell?.getAttribute('data-flip-v') === 'true') text += ', flip V';
      stageAnnounce(state, text);
    };
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); move(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); move(1, 0); break;
      case 'ArrowUp': e.preventDefault(); move(0, -1); break;
      case 'ArrowDown': e.preventDefault(); move(0, 1); break;
      case 'Enter':
        e.preventDefault();
        if (state.stamp) void placeStamp(state, focusX, focusY);
        else void placeCell(state, focusX, focusY, focusCell()!);
        break;
      case 'Delete':
        e.preventDefault();
        void eraseCell(state, focusX, focusY);
        break;
      case 'h': case 'H': {
        if (state.stamp) { flipStampH(state); renderTilesPanel(state); }
        else void flipCell(state, focusX, focusY);
        break;
      }
      case 'v': case 'V': {
        if (state.stamp) { flipStampV(state); renderTilesPanel(state); }
        else void flipCell(state, focusX, focusY, 'v');
        break;
      }
      case 'c': case 'C': {
        if (state.stamp) { state.stamp = null; renderTilesPanel(state); return; }
        const startX = markStart?.x ?? focusX, startY = markStart?.y ?? focusY;
        const x0 = Math.min(startX, focusX), x1 = Math.max(startX, focusX);
        const y0 = Math.min(startY, focusY), y1 = Math.max(startY, focusY);
        const cells: { tile: number; flip_h: boolean; flip_v: boolean }[][] = [];
        for (let y = y0; y <= y1; y++) {
          const row: { tile: number; flip_h: boolean; flip_v: boolean }[] = [];
          for (let x = x0; x <= x1; x++) {
            const cell = grid.querySelector(`[data-x="${x}"][data-y="${y}"]`);
            row.push({
              tile: Number(cell?.getAttribute('data-tile') ?? 0),
              flip_h: cell?.getAttribute('data-flip-h') === 'true',
              flip_v: cell?.getAttribute('data-flip-v') === 'true'
            });
          }
          cells.push(row);
        }
        state.stamp = { w: x1 - x0 + 1, h: y1 - y0 + 1, cells };
        stageAnnounce(state, `Stamp ${state.stamp.w} by ${state.stamp.h}`);
        renderTilesPanel(state);
        break;
      }
      case 'Escape':
        state.stamp = null;
        markStart = null;
        renderTilesPanel(state);
        break;
      default:
        if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          if (!markStart) markStart = { x: focusX, y: focusY };
          if (e.key === 'ArrowLeft') focusX = Math.max(0, focusX - 1);
          if (e.key === 'ArrowRight') focusX = Math.min(map.width - 1, focusX + 1);
          if (e.key === 'ArrowUp') focusY = Math.max(0, focusY - 1);
          if (e.key === 'ArrowDown') focusY = Math.min(map.height - 1, focusY + 1);
          setFocus();
          e.preventDefault();
        }
        break;
    }
  });
  grid.addEventListener('focusin', () => {
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.classList.contains('tilemap-cell')) {
      focusX = Number(focused.getAttribute('data-x'));
      focusY = Number(focused.getAttribute('data-y'));
    }
  });
}

function flipStampH(state: State): void {
  if (!state.stamp) return;
  // mirror the stamp's columns and toggle each cell's horizontal flip
  const w = state.stamp.cells[0].length;
  const flipped = state.stamp.cells.map((row) => {
    const out = [...row];
    for (let x = 0; x < w; x++) {
      const src = row[w - 1 - x];
      out[x] = { tile: src.tile, flip_h: !src.flip_h, flip_v: src.flip_v };
    }
    return out;
  });
  state.stamp = { ...state.stamp, cells: flipped };
}

function flipStampV(state: State): void {
  if (!state.stamp) return;
  const h = state.stamp.cells.length;
  const flipped: { tile: number; flip_h: boolean; flip_v: boolean }[][] = [];
  for (let y = 0; y < h; y++) {
    const src = state.stamp.cells[h - 1 - y];
    flipped.push(src.map((c) => ({ tile: c.tile, flip_h: c.flip_h, flip_v: !c.flip_v })));
  }
  state.stamp = { ...state.stamp, cells: flipped };
}

async function placeStamp(state: State, x: number, y: number): Promise<void> {
  const map = state.tilemaps.find((m) => m.id === state.selectedTilemap);
  if (!map || !state.stamp) return;
  try {
    const res = await api.post(`/api/tilemaps/${map.id}/stamp`, { x, y, cells: state.stamp.cells }) as { seq: number; changed: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[] };
    state.seq = res.seq;
    for (const change of res.changed) {
      map.cells = map.cells.filter((c) => !(c.x === change.x && c.y === change.y));
      if (change.tile !== 0) map.cells.push(change);
    }
    stageAnnounce(state, `Stamped ${state.stamp.w} by ${state.stamp.h} at ${x}, ${y}`);
    state.stamp = null;
    renderTilesPanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function eraseCell(state: State, x: number, y: number): Promise<void> {
  const map = state.tilemaps.find((m) => m.id === state.selectedTilemap);
  if (!map) return;
  try {
    const res = await api.post(`/api/tilemaps/${map.id}/cells`, { x, y, tile: 0, flip_h: false, flip_v: false, edge_matching: state.edgeMatching }) as { seq: number; changed: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[] };
    state.seq = res.seq;
    for (const change of res.changed) {
      map.cells = map.cells.filter((c) => !(c.x === change.x && c.y === change.y));
      if (change.tile !== 0) map.cells.push(change);
    }
    renderTilesPanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function flipCell(state: State, x: number, y: number, axis: 'h' | 'v' = 'h'): Promise<void> {
  const map = state.tilemaps.find((m) => m.id === state.selectedTilemap);
  if (!map) return;
  const current = map.cells.find((c) => c.x === x && c.y === y);
  if (!current) return;
  try {
    const res = await api.patch(`/api/tilemaps/${map.id}/cells/${x}/${y}`, {
      flip_h: axis === 'h' ? !current.flip_h : current.flip_h,
      flip_v: axis === 'v' ? !current.flip_v : current.flip_v
    }) as { seq: number };
    state.seq = res.seq;
    current.flip_h = axis === 'h' ? !current.flip_h : current.flip_h;
    current.flip_v = axis === 'v' ? !current.flip_v : current.flip_v;
    renderTilesPanel(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function importFrameAsTiles(state: State, tilesetId: number, tilemapId: number): Promise<void> {
  const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  try {
    await api.post(`/api/tilesets/${tilesetId}/import`, { frame: state.frame, layer: layer.name, tilemap: tilemapId, x: 0, y: 0 });
    await refreshTiles(state);
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

async function refreshTiles(state: State): Promise<void> {
  state.tilesets = [];
  state.tilemaps = [];
  for (const tsId of state.sprite.tilesets) {
    state.tilesets.push(await api.get(`/api/tilesets/${tsId}`) as typeof state.tilesets[number]);
  }
  for (const tmId of state.sprite.tilemaps) {
    state.tilemaps.push(await api.get(`/api/tilemaps/${tmId}`) as typeof state.tilemaps[number]);
  }
  state.selectedTileset = state.tilesets[0]?.id ?? null;
  state.selectedTilemap = state.tilemaps[0]?.id ?? null;
  renderTilesPanel(state);
}

function openTileEditor(state: State, tileset: { id: number; tile_size: number; tiles: { id: number; rows: number[][]; uses: number }[] }, tileNum: number): void {
  const tile = tileset.tiles.find((t) => t.id === tileNum);
  if (!tile) return;
  const dialog = el('div', { role: 'dialog', 'aria-label': 'Edit tile', class: 'dialog' });
  const rows = tile.rows.map((r) => [...r]);
  let cx = 0, cy = 0;
  const editor = el('canvas', { role: 'application', 'aria-label': 'Tile editor', class: 'tile-editor' });
  editor.width = tileset.tile_size * 12; editor.height = tileset.tile_size * 12;
  const redraw = (): void => {
    const ctx = editor.getContext('2d')!;
    ctx.clearRect(0, 0, editor.width, editor.height);
    const size = editor.width / tileset.tile_size;
    for (let y = 0; y < tileset.tile_size; y++) {
      for (let x = 0; x < tileset.tile_size; x++) {
        const idx = rows[y][x];
        if (idx !== 0) {
          ctx.fillStyle = `#${cellColor(state, idx)}`;
          ctx.fillRect(x * size, y * size, size, size);
        }
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.strokeRect(cx * size + 0.5, cy * size + 0.5, size - 1, size - 1);
  };
  editor.addEventListener('click', (e) => {
    const rect = editor.getBoundingClientRect();
    const size = editor.width / tileset.tile_size;
    cx = Math.floor((e.clientX - rect.left) / size);
    cy = Math.floor((e.clientY - rect.top) / size);
    if (cy < tileset.tile_size && cx < tileset.tile_size) rows[cy][cx] = state.primary;
    redraw();
  });
  editor.addEventListener('keydown', (e) => {
    const size = editor.width / tileset.tile_size;
    if (e.key === 'ArrowLeft') cx = Math.max(0, cx - 1);
    if (e.key === 'ArrowRight') cx = Math.min(tileset.tile_size - 1, cx + 1);
    if (e.key === 'ArrowUp') cy = Math.max(0, cy - 1);
    if (e.key === 'ArrowDown') cy = Math.min(tileset.tile_size - 1, cy + 1);
    if (e.key === ' ') { e.preventDefault(); if (rows[cy]) rows[cy][cx] = state.primary; }
    redraw();
  });
  editor.tabIndex = 0;
  const save = el('button', { class: 'pill', 'aria-label': 'Save tile' }, 'Save tile');
  save.addEventListener('click', async () => {
    try {
      await api.patch(`/api/tilesets/${tileset.id}/tiles/${tileNum}`, { rows });
      closeDialog(dialog);
      await refreshTiles(state);
    } catch (e) { if (e instanceof ApiFail) showErrors(dialog, e); }
  });
  dialog.append(editor, save);
  document.body.append(dialog);
  openDialog(dialog);
  redraw();
}

// ---- dialogs ----

export function openDialog(dialog: HTMLElement, opener?: HTMLElement): void {
  dialog.classList.add('open');
  const source = opener ?? (document.activeElement as HTMLElement | null) ?? undefined;
  dialog.setAttribute('data-opener-id', source?.id ?? '');
  const focusable = dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length) focusable[0].focus();
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeDialog(dialog); }
  });
}

export function closeDialog(dialog: HTMLElement): void {
  dialog.classList.remove('open');
  dialog.remove();
  const openerId = dialog.getAttribute('data-opener-id');
  const opener = openerId ? document.getElementById(openerId) : null;
  if (opener) opener.focus();
}

// ---- comments panel ----

export function renderCommentsPanel(state: State): void {
  const host = qs('#comments-panel');
  if (!host) return;
  clear(host);
  const region = el('section', { id: 'comments-region', role: 'region', 'aria-label': 'Comments', class: 'panel candy-cornflower' });
  region.append(el('h2', { class: 'panel-title' }, 'Comments'));
  const list = el('ul', { id: 'comments', 'aria-label': 'Comments', class: 'comments-list' });
  const pins = state.comments.filter((c) => c.frame === state.frame);
  if (!pins.length) list.append(el('li', { class: 'empty' }, 'No comments yet'));
  for (const comment of pins) {
    const li = el('li', { class: `comment ${comment.state}`, 'data-id': String(comment.id) });
    li.append(el('span', { class: 'comment-author' }, `${comment.author}, frame ${comment.frame}`));
    li.append(el('p', { class: 'comment-text' }, comment.text));
    for (const mention of comment.mentions) {
      li.append(el('p', { class: 'mention-line' }, mention.state === 'delivered' ? `Delivered to ${mention.name}` : `Sending to ${mention.name}`));
    }
    const actions = el('div', { class: 'comment-actions' });
    if (comment.state === 'open') {
      const resolve = el('button', { class: 'pill small', 'aria-label': 'Resolve' }, 'Resolve');
      resolve.addEventListener('click', async () => {
        try {
          await api.post(`/api/comments/${comment.id}/resolve`);
          comment.state = 'resolved';
          renderCommentsPanel(state);
          updatePinState(state, comment.id, comment.state);
        } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
      });
      actions.append(resolve);
    } else {
      const reopen = el('button', { class: 'pill small', 'aria-label': 'Reopen' }, 'Reopen');
      reopen.addEventListener('click', async () => {
        try {
          await api.post(`/api/comments/${comment.id}/reopen`);
          comment.state = 'open';
          renderCommentsPanel(state);
          updatePinState(state, comment.id, comment.state);
        } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
      });
      actions.append(reopen);
    }
    li.append(actions);
    list.append(li);
  }
  region.append(list);
  const pin = el('button', { id: 'pin-comment', class: 'pill', 'aria-label': 'Pin comment' }, 'Pin comment');
  pin.addEventListener('click', () => {
    openCommentDialog(state, state.cursor.x, state.cursor.y);
  });
  region.append(pin);
  host.append(region);
  renderPins(state);
}

function updatePinState(state: State, id: number, commentState: string): void {
  const pin = document.querySelector(`.stage-pin[data-id="${id}"]`);
  if (pin) pin.setAttribute('data-state', commentState);
}

function renderPins(state: State): void {
  const region = byId('pin-layer');
  if (!region) return;
  clear(region);
  for (const comment of state.comments.filter((c) => c.frame === state.frame)) {
    const btn = el('button', {
      class: 'stage-pin',
      'aria-label': `Comment at ${comment.x}, ${comment.y}`,
      'data-state': comment.state,
      'data-id': String(comment.id)
    });
    btn.style.left = `${comment.x * state.zoom}px`;
    btn.style.top = `${comment.y * state.zoom}px`;
    btn.addEventListener('click', () => {
      state.cursor = { x: comment.x, y: comment.y };
      drawStage(state);
    });
    region.append(btn);
  }
}

export function openCommentDialog(state: State, x: number, y: number): void {
  const dialog = el('div', { role: 'dialog', 'aria-label': 'New comment', class: 'dialog' });
  const text = el('textarea', { id: 'comment-text', class: 'text-input tall', 'aria-label': 'Comment' });
  const post = el('button', { class: 'pill', 'aria-label': 'Post comment' }, 'Post comment');
  const alertBox = el('div', { class: 'alert-box' });
  const draftKey = `comment:${state.sprite.id}`;

  // draft autosave with the configured pause
  let draftVersion = 0;
  void api.get(`/api/drafts/${encodeURIComponent(draftKey)}`).then((d) => {
    const draft = d as { text: string; version: number };
    draftVersion = draft.version;
    if (draft.text && !(text as HTMLTextAreaElement).value) (text as HTMLTextAreaElement).value = draft.text;
  }).catch(() => {});
  const saveDraft = debounce(() => {
    const body = { text: (text as HTMLTextAreaElement).value, version: draftVersion };
    statusText('draft-status', 'Saving…');
    void api.put(`/api/drafts/${encodeURIComponent(draftKey)}`, body)
      .then((r) => {
        const res = r as { text: string; version: number };
        draftVersion = res.version;
        statusText('draft-status', 'Saved');
      })
      .catch((e) => {
        if (e instanceof ApiFail) {
          const current = (e.body['current'] as { text: string; version: number } | undefined);
          if (current) {
            statusText('draft-status', 'A newer version exists');
            const load = el('button', { class: 'pill small', id: 'load-newer', 'aria-label': 'Load newer' }, 'Load newer');
            statusText('draft-status', 'A newer version exists');
            byId('draft-status').append(load);
            load.addEventListener('click', () => {
              (text as HTMLTextAreaElement).value = current.text;
              draftVersion = current.version;
            });
          }
        }
      });
  }, appConfig.autosave_ms);
  text.addEventListener('input', saveDraft);

  post.addEventListener('click', async () => {
    statusText('notices', 'Posting…');
    const key = `c-${state.sprite.id}-${x}-${y}-${Date.now()}`;
    try {
      const res = await api.post(`/api/sprites/${state.sprite.id}/comments`, {
        frame: state.frame, x, y, text: (text as HTMLTextAreaElement).value
      }, { idempotencyKey: key }) as { id: number };
      state.comments.push({
        id: res.id, frame: state.frame, x, y,
        text: (text as HTMLTextAreaElement).value, state: 'open',
        author: state.me?.name ?? '', mentions: []
      });
      statusText('notices', 'Comment posted');
      await api.put(`/api/drafts/${encodeURIComponent(draftKey)}`, { text: '', version: draftVersion }).catch(() => {});
      closeDialog(dialog);
      renderCommentsPanel(state);
    } catch (e) {
      if (e instanceof ApiFail) showErrors(dialog, e);
    }
  });
  dialog.append(alertBox, text, post);
  document.body.append(dialog);
  openDialog(dialog);
}

// ---- snapshots panel ----

export function renderSnapshotsPanel(state: State): void {
  const host = qs('#snapshots-panel');
  if (!host) return;
  clear(host);
  const region = el('section', { id: 'snapshots-region', role: 'region', 'aria-label': 'Snapshots', class: 'panel white-card' });
  region.append(el('h2', { class: 'panel-title' }, 'Snapshots'));
  const name = el('input', { id: 'snapshot-name', class: 'text-input', 'aria-label': 'Snapshot name' });
  const save = el('button', { id: 'save-snapshot', class: 'pill', 'aria-label': 'Save snapshot' }, 'Save snapshot');
  save.addEventListener('click', async () => {
    statusText('notices', 'Saving snapshot…');
    try {
      const res = await api.post(`/api/sprites/${state.sprite.id}/snapshots`, { name: (name as HTMLInputElement).value }) as { id: number; name: string; seq: number; at: string };
      state.snapshots.unshift(res);
      statusText('notices', `Snapshot ${res.name} saved`);
      renderSnapshotsPanel(state);
    } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
  });
  const list = el('ul', { id: 'snapshots', 'aria-label': 'Snapshots', class: 'snapshot-list' });
  if (!state.snapshots.length) list.append(el('li', { class: 'empty' }, 'No snapshots yet'));
  for (const snap of state.snapshots) {
    const li = el('li', { class: 'snapshot-row', 'data-id': String(snap.id) });
    li.append(el('span', { class: 'snapshot-name' }, snap.name));
    const restore = el('button', { class: 'pill small', 'aria-label': 'Restore' }, 'Restore');
    restore.addEventListener('click', async () => {
      statusText('notices', 'Restoring…');
      try {
        await api.post(`/api/snapshots/${snap.id}/restore`);
        statusText('notices', `Restored ${snap.name}`);
        const fresh = await api.get(`/api/sprites/${state.sprite.id}`) as typeof state.sprite;
        state.sprite = fresh;
        await reloadCels(state);
        drawStage(state);
        renderLayersPanel(state);
        renderFramesPanel(state);
        renderTilesPanel(state);
      } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
    });
    li.append(restore);
    list.append(li);
  }
  const compareFrom = el('select', { id: 'compare-from', class: 'select-input', 'aria-label': 'From' });
  const compareTo = el('select', { id: 'compare-to', class: 'select-input', 'aria-label': 'To' });
  for (const snap of [...state.snapshots].reverse()) {
    compareFrom.append(el('option', { value: String(snap.id) }, snap.name));
    compareTo.append(el('option', { value: String(snap.id) }, snap.name));
  }
  const changes = el('ul', { id: 'snapshot-changes', 'aria-label': 'Snapshot changes', class: 'changes-list' });
  compareFrom.addEventListener('change', () => void runCompare(state, compareFrom as HTMLSelectElement, compareTo as HTMLSelectElement, changes));
  compareTo.addEventListener('change', () => void runCompare(state, compareFrom as HTMLSelectElement, compareTo as HTMLSelectElement, changes));
  region.append(name, save, list, compareFrom, compareTo, changes);
  host.append(region);
}

async function runCompare(state: State, from: HTMLSelectElement, to: HTMLSelectElement, changes: HTMLElement): Promise<void> {
  const fromId = from.value, toId = to.value;
  if (!fromId || !toId) return;
  clear(changes);
  try {
    const res = await api.get(`/api/sprites/${state.sprite.id}/snapshots/compare?from=${fromId}&to=${toId}`) as { frames: { frame: number; changed: number }[] };
    const nf = myNumberFormat();
    for (const frame of res.frames) {
      changes.append(el('li', {}, `${formatNumber(frame.changed, nf)} ${frame.changed === 1 ? 'pixel' : 'pixels'} changed in frame ${formatNumber(frame.frame, nf)}`));
    }
    if (!res.frames.length) changes.append(el('li', { class: 'empty' }, 'No changes'));
  } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
}

// ---- activity panel ----

export function renderActivityPanel(state: State): void {
  const host = qs('#activity-panel');
  if (!host) return;
  clear(host);
  const region = el('section', { id: 'activity-region', role: 'region', 'aria-label': 'Activity', class: 'panel white-card' });
  region.append(el('h2', { class: 'panel-title' }, 'Activity'));
  const list = el('ul', { id: 'activity', 'aria-label': 'Activity', class: 'activity-list' });
  region.append(list);
  let cursor: number | null = null;
  const load = async (): Promise<void> => {
    const url = `/api/projects/${state.sprite.project_id}/activity${cursor ? `?cursor=${cursor}` : ''}`;
    try {
      const res = await api.get(url) as { items: { id: number; sentence: string; at: string }[]; next_cursor: number | null };
      if (!res.items.length && !cursor) list.append(el('li', { class: 'empty' }, 'No activity yet'));
      const nowMs = Date.parse(appConfig.now);
      for (const item of res.items) {
        list.append(el('li', { class: 'activity-row' }, `${item.sentence} · ${relativeTime(nowMs, Date.parse(item.at))}`));
      }
      cursor = res.next_cursor;
      moreBtn.classList.toggle('hidden', cursor === null);
    } catch (e) { if (e instanceof ApiFail) showErrors(byId('app'), e); }
  };
  const moreBtn = el('button', { id: 'load-more', class: 'pill', 'aria-label': 'Load more' }, 'Load more');
  moreBtn.addEventListener('click', () => void load());
  region.append(moreBtn);
  host.append(region);
  void load();
}
