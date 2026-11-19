// The workspace: stage, tools, panels, live view, offline queue.
import {
  api, ApiFail, el, qs, clear, byId, showErrors, announceAlert, statusText, appConfig, loadConfig,
  reducedMotion, myNumberFormat, debounce, type Me
} from './base.js';
import {
  composite, makeColorOf, formatNumber, tagSequence, rankCommands, lineJoin,
  pixelPerfectKeep, strokeCells, fillDitherCells, dedupe, type Cel, type Tool
} from '../shared/rules.js';
import type {
  Swatch, Palette, Layer, Frame, Tag, SpriteInfo, Comment, SnapshotRow,
  Tileset, Tilemap, State, StrokeRequest
} from './workspace-types.js';
import {
  renderPalettePanel, renderLayersPanel, renderFramesPanel, renderTilesPanel,
  renderCommentsPanel, renderSnapshotsPanel, renderActivityPanel, renderPreviewPanel,
  buildMorePanelsSheet, buildCommandPalette, bindPanels, applyLayout,
  openExportDialog, openCommentDialog, undoRedo, runSelectionOp,
  liftSelection, commitFloating, pollEvents, reconnect, goOffline, openDialog
} from './panels.js';
import {
  cel, celKey, cellColor, drawStage, stageAnnounce, listAnnounce, teamAnnounce,
  updateStageAttrs, drawThumb, frameBytes, sha256Hex, chooseTool, TOOL_LABELS
} from './stage.js';

export type { State, StrokeRequest };


export async function initWorkspace(spriteId: number, projectId: number): Promise<void> {
  await loadConfig();
  let me: Me | null = null;
  try { me = await api.get('/api/me') as Me; } catch { me = null; }
  (window as unknown as { __me?: Me }).__me = me ?? undefined;

  const sprite = await api.get(`/api/sprites/${spriteId}`) as SpriteInfo;
  const project = await api.get(`/api/projects/${projectId}`) as { id: number; name: string; role: string; members: { id: number; name: string; email: string; role: string }[] };
  sprite.project_id = projectId;
  const palette = await api.get(`/api/palettes/${sprite.palette}`) as Palette;
  const comments = await api.get(`/api/sprites/${spriteId}/comments`) as { comments: Comment[] };
  const snapshots = await api.get(`/api/sprites/${spriteId}/snapshots`) as { snapshots: SnapshotRow[] };

  const state: State = {
    sprite, palette,
    cels: new Map(),
    frame: 1,
    activeLayerId: sprite.layers[0]?.id ?? 0,
    tool: 'pencil',
    mirror: 'none',
    size: 1,
    primary: palette.swatches.find((s) => s.index === 1)?.index ?? 0,
    secondary: palette.swatches.find((s) => s.index === 2)?.index ?? 0,
    filled: false,
    contiguous: true,
    ditherLevel: 8,
    pixelPerfect: false,
    onion: false,
    onionFrames: 1,
    zoom: 8,
    cursor: { x: 0, y: 0 },
    drawing: false,
    selection: null,
    floating: null,
    copied: null,
    corner: null,
    seq: sprite.seq,
    strokeQueue: [],
    offline: !navigator.onLine,
    tilesets: [],
    tilemaps: [],
    selectedTileset: null,
    selectedTilemap: null,
    selectedTile: 1,
    edgeMatching: true,
    stamp: null,
    comments: comments.comments,
    snapshots: snapshots.snapshots,
    presence: [],
    me,
    role: project.role,
    floodRadius: null,
    floodSwatch: null,
    cursors: new Map(),
    thumbSeq: new Map(),
    lastStrokeAt: 0,
    strokeCountByPerson: new Map()
  };

  // load tilesets
  for (const tsId of sprite.tilesets) {
    const ts = await api.get(`/api/tilesets/${tsId}`) as Tileset;
    state.tilesets.push(ts);
  }
  for (const tmId of sprite.tilemaps) {
    const tm = await api.get(`/api/tilemaps/${tmId}`) as Tilemap;
    state.tilemaps.push(tm);
  }
  state.selectedTileset = state.tilesets[0]?.id ?? null;
  state.selectedTilemap = state.tilemaps[0]?.id ?? null;

  await loadCels(state);
  renderShell(state, project.name, project.members);
  bindStage(state);
  bindPanels(state);
  applyLayout();
  window.addEventListener('resize', applyLayout);
  void pollEvents(state);
  setInterval(() => void pollEvents(state), 900);
  setInterval(() => { void sendCursor(state); }, 4000);
  setInterval(() => { void refreshPresence(state); }, 2000);
  window.addEventListener('online', () => void reconnect(state));
  window.addEventListener('offline', () => goOffline(state));
  document.addEventListener('visibilitychange', () => { void sendCursor(state); });
}

/** Presence list and live cursors of other members, updated from the server. */
async function refreshPresence(state: State): Promise<void> {
  if (state.offline) return;
  try {
    const data = await api.get(`/api/sprites/${state.sprite.id}/presence`) as {
      presence: { name: string; idle: boolean }[];
      cursors: { person: string; x: number; y: number; frame: number }[];
    };
    state.presence = data.presence;
    state.cursors = new Map(data.cursors.map((c) => [c.person, c]));
    renderPresence(state);
    renderLiveCursors(state);
  } catch { /* offline */ }
}

function renderPresence(state: State): void {
  const list = document.getElementById('presence-list');
  if (!list) return;
  clear(list);
  const visible = appConfig.presence_visible;
  state.presence.slice(0, visible).forEach((person) => {
    list.append(el('li', { 'data-idle': String(person.idle) }, person.name.slice(0, 2)));
  });
  if (state.presence.length > visible) {
    list.append(el('li', { class: 'more' }, `+${state.presence.length - visible}`));
  }
  if (!state.presence.length) list.append(el('li', { class: 'more', 'data-idle': 'false' }, '·'));
}

function renderLiveCursors(state: State): void {
  const region = document.getElementById('live-cursors');
  if (!region) return;
  clear(region);
  for (const [name, cursor] of state.cursors) {
    if (name === state.me?.name) continue;
    const node = el('div', {
      class: 'cursor-marker',
      'data-person': name,
      'data-x': String(cursor.x),
      'data-y': String(cursor.y),
      'data-frame': String(cursor.frame)
    }, name.slice(0, 2));
    region.append(node);
  }
}
async function loadCels(state: State): Promise<void> {
  for (const frame of state.sprite.frames) {
    for (const layer of state.sprite.layers) {
      const data = await api.get(`/api/sprites/${state.sprite.id}/frames/${frame.number}/indices?layer=${encodeURIComponent(layer.name)}`) as { rows: number[][] };
      state.cels.set(celKey(frame.number, layer.id), data.rows);
    }
  }
}

// ---- shell rendering ----

function renderShell(state: State, projectName: string, members: { id: number; name: string }[]): void {
  const app = byId('app');
  clear(app);
  const nf = myNumberFormat();
  const isReviewer = state.role === 'reviewer';

  const top = el('header', { class: 'topbar' });
  const title = el('div', { class: 'title' });
  title.append(el('span', { class: 'project-name' }, projectName), el('span', { class: 'sprite-name' }, state.sprite.name));
  top.append(title);
  const presenceList = el('ul', { id: 'presence-list', class: 'presence', 'aria-label': 'On this sprite' });
  top.append(presenceList);
  top.append(
    el('span', { id: 'sync-status', role: 'status', class: 'status sync-status', 'aria-label': 'Sync status' }, 'Synced'),
    el('button', { id: 'export-open', class: 'pill', 'aria-label': 'Export', onclick: () => openExportDialog(state) }, 'Export')
  );
  if (isReviewer) {
    top.append(el('span', { class: 'reviewer-note', id: 'reviewer-note' }, "Reviewers can't draw"));
  }

  const toolbar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Tools' });
  for (const tool of Object.keys(TOOL_LABELS)) {
    toolbar.append(el('button', {
      class: `pill tool-button${tool === state.tool ? ' active' : ''}`,
      'data-tool': tool,
      'aria-pressed': tool === state.tool ? 'true' : 'false',
      'aria-label': TOOL_LABELS[tool],
      onclick: () => chooseTool(state, tool as Tool)
    }, TOOL_LABELS[tool]));
  }
  toolbar.append(
    el('label', { class: 'check' }, ''),
  );
  const pixelPerfect = el('input', { id: 'pixel-perfect', type: 'checkbox', class: 'visually-hidden' });
  const ppLabel = el('label', { class: 'check-label' });
  pixelPerfect.addEventListener('change', () => {
    state.pixelPerfect = pixelPerfect.checked;
    stageAnnounce(state, state.pixelPerfect ? 'Pixel perfect on' : 'Pixel perfect off');
  });
  ppLabel.append(pixelPerfect, el('span', {}, 'Pixel perfect'));
  const filled = el('input', { id: 'filled', type: 'checkbox' });
  filled.addEventListener('change', () => { state.filled = filled.checked; });
  const filledLabel = el('label', { class: 'check-label' });
  filledLabel.append(filled, el('span', {}, 'Filled'));
  const contiguous = el('input', { id: 'contiguous', type: 'checkbox' });
  contiguous.checked = true;
  contiguous.addEventListener('change', () => { state.contiguous = contiguous.checked; });
  const contLabel = el('label', { class: 'check-label' });
  contLabel.append(contiguous, el('span', {}, 'Contiguous'));

  const ditherLevel = el('input', { id: 'dither-level', type: 'number', min: 1, max: 16, value: 8, 'aria-label': 'Dither level', class: 'number-input' });
  ditherLevel.addEventListener('input', () => { state.ditherLevel = Number(ditherLevel.value) || 8; });
  const brushSize = el('input', { id: 'brush-size', type: 'number', min: 1, max: 8, value: 1, 'aria-label': 'Brush size', class: 'number-input' });
  brushSize.addEventListener('input', () => {
    state.size = Math.min(8, Math.max(1, Number(brushSize.value) || 1));
    brushSize.value = String(state.size);
    stageAnnounce(state, `Brush size ${state.size}`);
  });
  const mirror = el('select', { id: 'mirror', 'aria-label': 'Mirror', class: 'select-input' });
  for (const [value, label] of [['none', 'None'], ['x', 'X'], ['y', 'Y'], ['both', 'Both']] as [string, string][]) {
    mirror.append(el('option', { value }, label));
  }
  mirror.addEventListener('change', () => {
    state.mirror = mirror.value as State['mirror'];
    stageAnnounce(state, `Mirror: ${state.mirror === 'none' ? 'none' : state.mirror}`);
  });

  const selOps = el('div', { class: 'sel-ops' });
  for (const [op, label] of [['move', 'Move selection'], ['copy', 'Copy selection'], ['paste', 'Paste selection'], ['flip_h', 'Flip horizontal'], ['flip_v', 'Flip vertical'], ['rotate', 'Rotate 90']] as [string, string][]) {
    selOps.append(el('button', { class: 'pill small', 'aria-label': label, onclick: () => runSelectionOp(state, op) }, label));
  }
  const onionCheck = el('input', { id: 'onion', type: 'checkbox' });
  onionCheck.addEventListener('change', () => {
    state.onion = onionCheck.checked;
    drawStage(state);
  });
  const onionLabel = el('label', { class: 'check-label' });
  onionLabel.append(onionCheck, el('span', {}, 'Onion skin'));
  const onionFrames = el('input', { id: 'onion-frames', type: 'number', min: 1, max: 4, value: 1, 'aria-label': 'Onion frames', class: 'number-input' });
  onionFrames.addEventListener('input', () => {
    state.onionFrames = Math.min(4, Math.max(1, Number(onionFrames.value) || 1));
    onionFrames.value = String(state.onionFrames);
    drawStage(state);
  });

  const undoBtn = el('button', { id: 'undo', class: 'pill', 'aria-label': 'Undo', onclick: () => void undoRedo(state, 'undo') }, 'Undo');
  const redoBtn = el('button', { id: 'redo', class: 'pill', 'aria-label': 'Redo', onclick: () => void undoRedo(state, 'redo') }, 'Redo');

  const toolPanel = el('div', { id: 'tools-panel', class: 'panel tools-panel' });
  const toolRow1 = el('div', { class: 'tool-row' });
  toolRow1.append(
    el('span', { class: 'tool-label' }, 'Dither'), ditherLevel,
    el('span', { class: 'tool-label' }, 'Brush'), brushSize,
    el('span', { class: 'tool-label' }, 'Mirror'), mirror
  );
  const onionRow = el('div', { class: 'tool-row' });
  onionRow.append(onionLabel, onionFrames);
  const undoRow = el('div', { class: 'tool-row' });
  undoRow.append(undoBtn, redoBtn);
  toolPanel.append(toolbar, ppLabel, filledLabel, contLabel, toolRow1, selOps, onionRow, undoRow);

  const stageWrap = el('div', { id: 'stage-viewport', class: 'stage-viewport' });
  const canvas = el('canvas', {
    id: 'stage', role: 'application', 'aria-label': 'Sprite stage',
    'data-sprite-id': String(state.sprite.id),
    tabindex: 0
  });
  stageWrap.append(canvas);
  const zoomRow = el('div', { class: 'zoom-row' });
  for (const [dir, label] of [['in', 'Zoom in'], ['out', 'Zoom out'], ['left', 'Pan left'], ['right', 'Pan right'], ['up', 'Pan up'], ['down', 'Pan down']] as [string, string][]) {
    zoomRow.append(el('button', {
      class: `pill small zoom-btn pan-${dir}`,
      'aria-label': label,
      'data-pan': dir,
      onclick: () => {
        if (dir === 'in') setZoom(state, state.zoom * 2 >= state.zoom * 2 ? [1, 2, 4, 8, 16, 32].find((z) => z > state.zoom) ?? 32 : 8);
        else if (dir === 'out') setZoom(state, [...[1, 2, 4, 8, 16, 32]].reverse().find((z) => z < state.zoom) ?? 1);
        else panBy(state, dir);
      }
    }, label));
  }
  const cursorsRegion = el('div', { id: 'live-cursors', class: 'live-cursors', role: 'region', 'aria-label': 'Live cursors' });
  stageWrap.append(cursorsRegion);

  const stagePanel = el('section', { id: 'stage-panel', class: 'stage-panel' });
  stagePanel.append(toolPanel, stageWrap, zoomRow);

  app.append(top, stagePanel, el('div', { id: 'panels', class: 'panels' }));

  renderPalettePanel(state);
  renderLayersPanel(state);
  renderFramesPanel(state);
  renderTilesPanel(state);
  renderCommentsPanel(state);
  renderSnapshotsPanel(state);
  renderActivityPanel(state);
  renderPreviewPanel(state);
  buildMorePanelsSheet(state);

  const liveWrap = el('div', { class: 'live-regions' });
  liveWrap.append(
    el('div', { id: 'stage-announcements', role: 'status', class: 'sr-only', 'aria-label': 'Stage announcements' }),
    el('div', { id: 'list-announcements', role: 'status', class: 'sr-only', 'aria-label': 'List announcements' }),
    el('div', { id: 'team-announcements', role: 'status', class: 'sr-only team-box', 'aria-label': 'Team announcements' }),
    el('div', { id: 'notices', role: 'status', class: 'sr-only', 'aria-label': 'Notices' }),
    el('div', { id: 'draft-status', role: 'status', class: 'sr-only', 'aria-label': 'Draft status' }),
    el('div', { id: 'job-progress', role: 'status', class: 'sr-only', 'aria-label': 'Job progress' }),
    el('div', { class: 'alert-box', role: 'alert' })
  );
  app.append(liveWrap);

  const cmdDialog = buildCommandPalette(state);
  document.body.append(cmdDialog);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openDialog(cmdDialog);
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const inText = (document.activeElement as HTMLElement)?.matches('input, textarea, select, [contenteditable]') ?? false;
      if (!inText && state.me && state.role !== 'reviewer') { e.preventDefault(); void undoRedo(state, 'undo'); }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
      const inText = (document.activeElement as HTMLElement)?.matches('input, textarea, select, [contenteditable]') ?? false;
      if (!inText && state.me && state.role !== 'reviewer') { e.preventDefault(); void undoRedo(state, 'redo'); }
    }
  });

  setZoom(state, 8);
  drawStage(state);
}

// ---- zoom, pan, drawing ----

const ZOOM_STEPS = [1, 2, 4, 8, 16, 32];

function setZoom(state: State, wanted: number): void {
  const fit = ZOOM_STEPS.filter((z) => z * state.sprite.width <= 640 && z * state.sprite.height <= 480);
  const fitting = fit.length ? fit[fit.length - 1] : 1;
  let zoom = ZOOM_STEPS.includes(wanted) ? wanted : 8;
  if (zoom > 8 && zoom > fitting) zoom = Math.max(1, fitting);
  state.zoom = zoom;
  drawStage(state);
  const canvas = byId('stage') as HTMLCanvasElement;
  canvas.setAttribute('data-zoom', String(zoom));
}

function panBy(state: State, dir: string): void {
  const viewport = byId('stage-viewport');
  const step = state.zoom * 8;
  if (dir === 'left') viewport.scrollLeft -= step;
  if (dir === 'right') viewport.scrollLeft += step;
  if (dir === 'up') viewport.scrollTop -= step;
  if (dir === 'down') viewport.scrollTop += step;
}

// ---- stage input ----

function spritePoint(state: State, clientX: number, clientY: number): { x: number; y: number } {
  const canvas = byId('stage') as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(state.sprite.width - 1, Math.floor((clientX - rect.left) / state.zoom))),
    y: Math.max(0, Math.min(state.sprite.height - 1, Math.floor((clientY - rect.top) / state.zoom)))
  };
}

interface PointerSession {
  tool: Tool;
  points: [number, number][];
  shiftRun: boolean;
  moved: boolean;
  longPressTimer: number | undefined;
  longPressFired: boolean;
  multiTouch: boolean;
}

function bindStage(state: State): void {
  const canvas = byId('stage') as HTMLCanvasElement;
  let session: PointerSession | null = null;

  const announcePixel = (): void => {
    const layer = state.sprite.layers.find((l) => l.id === state.activeLayerId);
    const rows = cel(state, state.frame, state.activeLayerId);
    const idx = rows[state.cursor.y]?.[state.cursor.x] ?? 0;
    const color = idx === 0 ? '00000000' : cellColor(state, idx);
    stageAnnounce(state, `Pixel ${state.cursor.x}, ${state.cursor.y}, ${color}, layer ${layer?.name ?? ''}`);
  };

  canvas.addEventListener('pointermove', (e) => {
    const p = spritePoint(state, e.clientX, e.clientY);
    state.cursor = p;
    canvas.setAttribute('data-cursor-x', String(p.x));
    canvas.setAttribute('data-cursor-y', String(p.y));
    if (session) {
      const last = session.points[session.points.length - 1];
      if (!last || last[0] !== p.x || last[1] !== p.y) {
        session.points.push([p.x, p.y]);
        session.moved = session.moved || !last || Math.abs(last[0] - p.x) + Math.abs(last[1] - p.y) > 0;
        if (session.tool === 'pencil' || session.tool === 'eraser') previewStroke(state, session);
        if (['line', 'rectangle', 'ellipse', 'selection'].includes(session.tool)) {
          session.points = [session.points[0], [p.x, p.y]];
          previewShape(state, session);
        }
      }
    } else {
      drawStage(state);
    }
    void sendCursor(state);
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (session?.multiTouch) return;
    const p = spritePoint(state, e.clientX, e.clientY);
    state.cursor = p;
    if (state.role === 'reviewer') {
      announceAlert(document, "Reviewers can't draw");
      return;
    }
    if (state.floating) return;
    canvas.focus();
    const tool = state.tool;
    session = {
      tool,
      points: [[p.x, p.y]],
      shiftRun: false,
      moved: false,
      longPressTimer: undefined,
      longPressFired: false,
      multiTouch: false
    };
    if (['fill', 'dither', 'picker'].includes(tool)) {
      if (tool === 'picker') pickColour(state, p.x, p.y);
      else commitStroke(state, [session.points[0]] as [number, number][], tool);
      session = null;
      return;
    }
    if (e.pointerType === 'touch') {
      session.longPressTimer = window.setTimeout(() => {
        if (session && !session.moved) {
          session.longPressFired = true;
          pickColour(state, p.x, p.y);
        }
      }, appConfig.long_press_ms);
    }
  });

  const finish = (e: PointerEvent): void => {
    if (!session) return;
    if (session.longPressTimer !== undefined) window.clearTimeout(session.longPressTimer);
    const s = session;
    session = null;
    if (s.multiTouch) return; // second finger cancels with no pixels
    if (s.longPressFired) return; // long press picks, paints nothing
    if (['line', 'rectangle', 'ellipse', 'selection'].includes(s.tool)) {
      const points = s.points.length === 2 ? s.points : [s.points[0], s.points[0]];
      if (s.tool === 'selection') {
        state.selection = normalise(points[0], points[1]);
        stageAnnounce(state, `Selection ${state.selection.w} by ${state.selection.h} at ${state.selection.x}, ${state.selection.y}`);
        drawStage(state);
      } else {
        commitStroke(state, points, s.tool);
      }
      return;
    }
    if (s.tool === 'pencil' || s.tool === 'eraser') {
      commitStroke(state, s.points, s.tool);
    }
    void e;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => {
    if (session?.longPressTimer !== undefined) window.clearTimeout(session.longPressTimer);
    session = null;
  });
  canvas.addEventListener('pointerenter', () => { canvas.setAttribute('data-hover', 'true'); });
  canvas.addEventListener('pointerleave', () => { canvas.removeAttribute('data-hover'); drawStage(state); });

  // a second finger cancels the touch with no pixels
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && session) {
      if (session.longPressTimer !== undefined) window.clearTimeout(session.longPressTimer);
      session.multiTouch = true;
      session.points = [];
      drawStage(state);
    }
  });

  // ---- keyboard drawing mode ----
  let shiftHeld = false;
  let shiftPoints: [number, number][] = [];

  canvas.addEventListener('focus', () => { state.drawing = true; });

  canvas.addEventListener('keydown', (e) => {
    const inText = (document.activeElement as HTMLElement)?.matches('input, textarea, select') ?? false;
    if (inText) return;
    const { width: w, height: h } = state.sprite;
    const move = (dx: number, dy: number): void => {
      if (state.floating) {
        const f = state.floating;
        const nx = Math.min(w - f.w, Math.max(-f.w + 1, f.x + dx));
        const ny = Math.min(h - f.h, Math.max(-f.h + 1, f.y + dy));
        state.floating = { ...f, x: nx, y: ny };
        stageAnnounce(state, `Selection ${f.w} by ${f.h} at ${nx}, ${ny}`);
        drawStage(state);
        return;
      }
      const nx = Math.max(0, Math.min(w - 1, state.cursor.x + dx));
      const ny = Math.max(0, Math.min(h - 1, state.cursor.y + dy));
      if (nx === state.cursor.x && ny === state.cursor.y) return;
      state.cursor = { x: nx, y: ny };
      if (shiftHeld && (state.tool === 'pencil' || state.tool === 'eraser')) {
        shiftPoints.push([nx, ny]);
        // paint the run cell as it extends, committed as one stroke on release
        const rows = cel(state, state.frame, state.activeLayerId);
        const cells = dedupe(shiftPoints.map((pt) => [pt[0], pt[1]] as [number, number]));
        for (const [cxp, cyp] of cells) rows[cyp][cxp] = state.tool === 'eraser' ? 0 : state.primary;
        drawStage(state);
      } else {
        drawStage(state);
        announcePixel();
      }
    };

    if (state.floating) {
      if (e.key === 'Enter') { commitFloating(state); return; }
      if (e.key === 'Escape') {
        state.floating = null;
        stageAnnounce(state, 'Selection cancelled');
        drawStage(state);
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1, 0); }
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1, 0); }
      if (e.key === 'ArrowUp') { e.preventDefault(); move(0, -1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); move(0, 1); }
      if (e.key === ' ' || e.key === 'Tab') e.preventDefault();
      return;
    }

    if (e.key === 'Shift') { shiftHeld = true; shiftPoints = [[state.cursor.x, state.cursor.y]]; return; }
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); move(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); move(1, 0); break;
      case 'ArrowUp': e.preventDefault(); move(0, -1); break;
      case 'ArrowDown': e.preventDefault(); move(0, 1); break;
      case ' ':
        e.preventDefault();
        applySpaceTool(state);
        break;
      case 'Escape':
        state.drawing = false;
        stageAnnounce(state, 'Left drawing mode');
        break;
      case 'Tab':
        e.preventDefault();
        break;
      case 'Enter':
        canvas.focus();
        break;
      case 'b': case 'B': chooseTool(state, 'pencil'); break;
      case 'e': case 'E': chooseTool(state, 'eraser'); break;
      case 'l': case 'L': chooseTool(state, 'line'); break;
      case 'r': case 'R': chooseTool(state, 'rectangle'); break;
      case 'o': case 'O': chooseTool(state, 'ellipse'); break;
      case 'g': case 'G': chooseTool(state, 'fill'); break;
      case 'd': case 'D': chooseTool(state, 'dither'); break;
      case 's': case 'S': chooseTool(state, 'selection'); break;
      case 'i': case 'I': chooseTool(state, 'picker'); break;
      case 'm': case 'M': {
        const order: State['mirror'][] = ['none', 'x', 'y', 'both'];
        state.mirror = order[(order.indexOf(state.mirror) + 1) % order.length];
        (byId('mirror') as HTMLSelectElement).value = state.mirror;
        stageAnnounce(state, `Mirror: ${state.mirror}`);
        break;
      }
      case 'x': case 'X': {
        const p = state.primary;
        state.primary = state.secondary;
        state.secondary = p;
        stageAnnounce(state, 'Swatches swapped');
        renderPalettePanel(state);
        break;
      }
      case '[': {
        state.size = Math.max(1, state.size - 1);
        (byId('brush-size') as HTMLInputElement).value = String(state.size);
        stageAnnounce(state, `Brush size ${state.size}`);
        break;
      }
      case ']': {
        state.size = Math.min(8, state.size + 1);
        (byId('brush-size') as HTMLInputElement).value = String(state.size);
        stageAnnounce(state, `Brush size ${state.size}`);
        break;
      }
      case ',': {
        if (state.frame > 1) { state.frame--; stageAnnounce(state, `Frame ${state.frame} of ${state.sprite.frames.length}`); drawStage(state); renderFramesPanel(state); }
        break;
      }
      case '.': {
        if (state.frame < state.sprite.frames.length) { state.frame++; stageAnnounce(state, `Frame ${state.frame} of ${state.sprite.frames.length}`); drawStage(state); renderFramesPanel(state); }
        break;
      }
      case 'c': case 'C': openCommentDialog(state, state.cursor.x, state.cursor.y); break;
      case 'p': case 'P': {
        state.pixelPerfect = !state.pixelPerfect;
        (byId('pixel-perfect') as HTMLInputElement).checked = state.pixelPerfect;
        stageAnnounce(state, state.pixelPerfect ? 'Pixel perfect on' : 'Pixel perfect off');
        break;
      }
      case 'f': case 'F': liftSelection(state); break;
      default: break;
    }
  });

  canvas.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      shiftHeld = false;
      if (shiftPoints.length > 0 && (state.tool === 'pencil' || state.tool === 'eraser')) {
        // the preview cells revert, then the stroke commits as one operation
        const rows = cel(state, state.frame, state.activeLayerId);
        const before = rows.map((r) => [...r]);
        const points = [...shiftPoints];
        shiftPoints = [];
        // rollback preview then send
        const request = buildStrokeRequest(state, points, state.tool);
        const preview = localCellsFor(state, points, state.tool);
        void applyRequest(state, request, preview, before);
      }
    }
  });

  // global hotkeys outside the stage
  document.addEventListener('keydown', (e) => {
    const target = document.activeElement as HTMLElement | null;
    const inText = target?.matches('input, textarea, select, [contenteditable]') ?? false;
    const inDialog = target?.closest('[role="dialog"]') !== null;
    if (inText || inDialog) return;
    const inTilemap = target?.closest('#tilemap-grid') !== null;
    const key = e.key.toLowerCase();
    const toolKeys: Record<string, Tool> = { b: 'pencil', e: 'eraser', l: 'line', r: 'rectangle', o: 'ellipse', g: 'fill', d: 'dither', s: 'selection', i: 'picker' };
    if (toolKeys[key] && !inTilemap) { chooseTool(state, toolKeys[key]); return; }
    if (inTilemap && ['h', 'v', 'c'].includes(key)) return; // map meaning
    if (key === 'm' && !inTilemap) {
      const order: State['mirror'][] = ['none', 'x', 'y', 'both'];
      state.mirror = order[(order.indexOf(state.mirror) + 1) % order.length];
      (byId('mirror') as HTMLSelectElement).value = state.mirror;
      stageAnnounce(state, `Mirror: ${state.mirror}`);
    }
    if (key === 'x' && !inTilemap) {
      const p = state.primary;
      state.primary = state.secondary;
      state.secondary = p;
      stageAnnounce(state, 'Swatches swapped');
      renderPalettePanel(state);
    }
    if (e.key === '[' && !inTilemap) {
      state.size = Math.max(1, state.size - 1);
      (byId('brush-size') as HTMLInputElement).value = String(state.size);
      stageAnnounce(state, `Brush size ${state.size}`);
    }
    if (e.key === ']' && !inTilemap) {
      state.size = Math.min(8, state.size + 1);
      (byId('brush-size') as HTMLInputElement).value = String(state.size);
      stageAnnounce(state, `Brush size ${state.size}`);
    }
    if (e.key === ',') {
      if (state.frame > 1) { state.frame--; stageAnnounce(state, `Frame ${state.frame} of ${state.sprite.frames.length}`); drawStage(state); renderFramesPanel(state); }
    }
    if (e.key === '.') {
      if (state.frame < state.sprite.frames.length) { state.frame++; stageAnnounce(state, `Frame ${state.frame} of ${state.sprite.frames.length}`); drawStage(state); renderFramesPanel(state); }
    }
  });
}

function normalise(a: [number, number], b: [number, number]): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
    w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1
  };
}

function applySpaceTool(state: State): void {
  const { x, y } = state.cursor;
  switch (state.tool) {
    case 'pencil': case 'eraser': case 'fill': case 'dither':
      commitStroke(state, [[x, y]], state.tool);
      break;
    case 'picker':
      pickColour(state, x, y);
      break;
    case 'line': case 'rectangle': case 'ellipse': case 'selection': {
      if (!state.corner) {
        state.corner = { x, y };
      } else {
        const points: [number, number][] = [[state.corner.x, state.corner.y], [x, y]];
        if (state.tool === 'selection') {
          state.selection = normalise(points[0], points[1]);
          stageAnnounce(state, `Selection ${state.selection.w} by ${state.selection.h} at ${state.selection.x}, ${state.selection.y}`);
          drawStage(state);
        } else {
          commitStroke(state, points, state.tool);
        }
        state.corner = null;
      }
      break;
    }
  }
}

function pickColour(state: State, x: number, y: number): void {
  const rows = cel(state, state.frame, state.activeLayerId);
  const idx = rows[y]?.[x] ?? 0;
  if (idx === 0) return;
  state.primary = idx;
  stageAnnounce(state, `Picked swatch ${idx}`);
  renderPalettePanel(state);
}

function previewStroke(state: State, session: PointerSession): void {
  const cells = localCellsFor(state, session.points, session.tool);
  const rows = cel(state, state.frame, state.activeLayerId);
  for (const [x, y, idx] of cells) {
    if (y < rows.length && x < rows[y].length) rows[y][x] = idx;
  }
  drawStage(state);
}

function previewShape(state: State, session: PointerSession): void {
  // shapes preview by recomputing the whole cel from a scratch copy each move
  const rows = cel(state, state.frame, state.activeLayerId);
  // restore is handled by the server response; locally show the shape outline
  drawStage(state);
  void rows;
}

/** The cells a stroke paints locally, by the same shared rules as the server. */
function localCellsFor(state: State, points: [number, number][], tool: Tool): [number, number, number][] {
  const rows = cel(state, state.frame, state.activeLayerId);
  const input = {
    tool,
    points,
    swatch: state.primary,
    size: state.size,
    mirror: state.mirror,
    options: {
      filled: state.filled,
      contiguous: state.contiguous,
      secondary: state.secondary,
      level: state.ditherLevel,
      pixelPerfect: state.pixelPerfect
    }
  };
  if (tool === 'fill' || tool === 'dither') {
    return fillDitherCells({ ...input, tool }, { rows: rows.map((r) => [...r]) });
  }
  const base = strokeCells(input, state.sprite.width, state.sprite.height);
  return base.map(([x, y]) => [x, y, tool === 'eraser' ? 0 : state.primary] as [number, number, number]);
}

function buildStrokeRequest(state: State, points: [number, number][], tool: Tool): StrokeRequest {
  return {
    client_stroke_id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    frame: state.frame,
    layer: state.activeLayerId,
    tool,
    points,
    swatch: state.primary,
    size: state.size,
    mirror: state.mirror,
    options: {
      filled: state.filled,
      contiguous: state.contiguous,
      secondary: state.secondary,
      level: state.ditherLevel,
      pixel_perfect: state.pixelPerfect
    },
    localCells: []
  };
}

function commitStroke(state: State, points: [number, number][], tool: Tool): void {
  if (state.role === 'reviewer') { announceAlert(document, "Reviewers can't draw"); return; }
  const rows = cel(state, state.frame, state.activeLayerId);
  const before = rows.map((r) => [...r]);
  const request = buildStrokeRequest(state, points, tool);
  const preview = localCellsFor(state, points, tool);
  for (const [x, y, idx] of preview) {
    if (y < rows.length && x < rows[y].length) rows[y][x] = idx;
  }
  drawStage(state);
  void applyRequest(state, request, preview, before);
}

async function applyRequest(state: State, request: StrokeRequest, preview: [number, number, number][], before: number[][]): Promise<void> {
  try {
    const body = {
      client_stroke_id: request.client_stroke_id,
      frame: request.frame,
      layer: request.layer,
      tool: request.tool,
      points: request.points,
      swatch: request.swatch,
      size: request.size,
      mirror: request.mirror,
      options: request.options
    };
    const res = await api.post(`/api/sprites/${state.sprite.id}/strokes`, body) as { seq: number; pixels_changed: number };
    state.seq = res.seq;
    announcePainted(state, res.pixels_changed);
  } catch (e) {
    if (state.offline && !(e instanceof ApiFail)) {
      state.strokeQueue.push({ ...request, localCells: preview });
      statusText('sync-status', `Offline · ${state.strokeQueue.length} strokes queued`);
      return;
    }
    rollback(state, before);
    if (e instanceof ApiFail) announceAlert(document, e.notice());
  }
}

function rollback(state: State, before: number[][]): void {
  state.cels.set(celKey(state.frame, state.activeLayerId), before);
  drawStage(state);
}

function announcePainted(state: State, count: number): void {
  if (count === 0) return;
  const name = state.me?.name ?? 'You';
  const existing = state.strokeCountByPerson.get(name);
  if (existing) {
    existing.count += count;
    const nf = myNumberFormat();
    updateTeamLine(name, `${name} painted ${formatNumber(existing.count, nf)} pixels`);
    if (existing.timer !== undefined) window.clearTimeout(existing.timer);
    existing.timer = window.setTimeout(() => {
      state.strokeCountByPerson.delete(name);
    }, 2000);
  } else {
    const entry = { count, timer: undefined as number | undefined };
    state.strokeCountByPerson.set(name, entry);
    const nf = myNumberFormat();
    teamAnnounce(`${name} painted ${formatNumber(count, nf)} pixels`);
    entry.timer = window.setTimeout(() => {
      state.strokeCountByPerson.delete(name);
    }, 2000);
  }
}

function updateTeamLine(name: string, text: string): void {
  const node = byId('team-announcements');
  const lines = Array.from(node.children);
  for (const line of lines) {
    if (line.textContent?.startsWith(`${name} painted`)) {
      line.textContent = text;
      return;
    }
  }
  teamAnnounce(text);
}

// ---- cursor presence (server-held via events) ----

let cursorSendPending = false;

async function sendCursor(state: State): Promise<void> {
  if (cursorSendPending) return;
  cursorSendPending = true;
  try {
    if (!state.offline) {
      await api.post(`/api/sprites/${state.sprite.id}/cursors`, {
        x: state.cursor.x, y: state.cursor.y, frame: state.frame
      }).catch(() => {});
    }
  } finally {
    cursorSendPending = false;
  }
}
