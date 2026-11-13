import type {
  Assembly,
  ConstraintKind,
  Direction,
  Operation,
  Part,
  Sketch,
  TreeRow,
} from '../shared/api.js';
import { buildProfile } from '../shared/profile.js';
import { parseLength, toleranceToText, type DisplayUnit } from '../shared/units.js';
import { api, type Outcome, type ServerError } from './api.js';
import { drawBodies, type BodyItem, type BodyMesh } from './bodies.js';
import {
  COPY,
  constraintAdded,
  constraintRedundant,
  featureAdded,
  instanceAdded,
  slackReadout,
} from './copy.js';
import type { Actions, Ctx, DialogKind, State, Tool } from './context.js';
import {
  captureFocus,
  clear,
  el,
  focusFirst,
  restoreFocus,
  svg,
  textField,
  trapFocus,
} from './dom.js';
import { renderDialog } from './dialogs.js';
import { displayOf, show } from './format.js';
import {
  countTo,
  flashTurns,
  reducedMotion,
  resizeRings,
  settleHandle,
  type RingChange,
} from './motion.js';
import {
  featureTreeItems,
  partOf,
  renderBomTable,
  renderCommandStrip,
  renderFeatureTree,
  renderPropertiesContent,
} from './panels.js';
import { canvasItems, renderSketchCanvas, type Viewport } from './sketchCanvas.js';
import { dimensionKindFor } from './selection.js';

const state: State = {
  member: null,
  signingIn: false,
  signInError: null,
  signInFields: {},
  workspace: null,
  materials: [],
  parts: [],
  assemblies: [],
  purchased: [],
  mode: null,
  tab: 'model',
  treeExpanded: new Set(),
  partsExpanded: new Set(),
  treeActive: null,
  sketch: null,
  selection: [],
  highlight: 0,
  tool: 'select',
  toolDraft: {},
  toolPoints: [],
  toolErrors: {},
  dimension: null,
  dimensionErrors: {},
  zoom: 1,
  pan: { x: 0, y: 0 },
  extrude: null,
  featureDraft: null,
  preview: null,
  rows: [],
  bom: null,
  bodies: new Map(),
  saveStatus: 'idle',
  savingPartId: null,
  modelMessage: '',
  storageDown: false,
  conflict: null,
  slackShown: null,
  ringsFrom: null,
  ghost: null,
  sheet: null,
  dialog: null,
  dialogFields: {},
  dialogErrors: {},
  dialogPending: false,
  dialogOpener: null,
  dialogKey: null,
  sheetOpener: null,
  width: window.innerWidth,
};

const ctx: Ctx = { state, actions: {} as Actions };
const root = document.getElementById('app') as HTMLElement;

function unit(): DisplayUnit {
  return state.member?.units ?? 'mm';
}

function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ------------------------------------------------------------------- failures

type Bucket = 'none' | 'tool' | 'dimension' | 'dialog' | 'signin';

function applyFailure(failure: Exclude<Outcome<unknown>, { kind: 'ok' }>, bucket: Bucket): void {
  if (failure.kind === 'offline') {
    state.modelMessage = COPY.noAnswer;
    return;
  }
  const error: ServerError = failure.error;
  if (failure.status === 412) {
    state.conflict = error.message;
    return;
  }
  if (failure.status === 422 && error.fields) {
    const fields = error.fields;
    if (bucket === 'tool') state.toolErrors = toolFieldErrors(fields);
    else if (bucket === 'dimension') state.dimensionErrors = fields;
    else if (bucket === 'dialog') state.dialogErrors = fields;
    else if (bucket === 'signin') state.signInFields = fields;
    else state.modelMessage = error.message;
    if (bucket !== 'none' && bucket !== 'signin') state.modelMessage = '';
    return;
  }
  if (bucket === 'signin') state.signInError = error.message;
  else if (bucket === 'dialog' && failure.status === 409) state.dialogErrors = { component: error.message };
  else state.modelMessage = error.message;
}

const TOOL_FIELD_PATHS: Record<string, string> = {
  'entity.start.x': 'startX',
  'entity.start.y': 'startY',
  'entity.end.x': 'endX',
  'entity.end.y': 'endY',
  'entity.center.x': 'centreX',
  'entity.center.y': 'centreY',
  'entity.radius': 'radius',
  'entity.start_angle_deg': 'startAngle',
  'entity.end_angle_deg': 'endAngle',
  'entity.x': 'x',
  'entity.y': 'y',
};

function toolFieldErrors(fields: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [path, message] of Object.entries(fields)) {
    const key = TOOL_FIELD_PATHS[path];
    if (key) mapped[key] = message;
    else mapped.radius = message;
  }
  if (state.tool === 'circle' && mapped.radius) mapped.diameter = mapped.radius;
  return mapped;
}

// --------------------------------------------------------------- data loading

async function loadCatalogue(): Promise<void> {
  const [parts, assemblies, purchased] = await Promise.all([
    api.parts(),
    api.assemblies(),
    api.purchased(),
  ]);
  if (parts.kind === 'ok') state.parts = parts.data.parts;
  if (assemblies.kind === 'ok') state.assemblies = assemblies.data.assemblies;
  if (purchased.kind === 'ok') state.purchased = purchased.data.purchased;
}

async function loadAssemblyView(assemblyId: string): Promise<void> {
  const [tree, bom, assembly] = await Promise.all([
    api.assemblyTree(assemblyId),
    api.bom(assemblyId),
    api.assembly(assemblyId),
  ]);
  if (tree.kind === 'ok') state.rows = tree.data.rows;
  if (bom.kind === 'ok') state.bom = bom.data;
  if (assembly.kind === 'ok') {
    state.assemblies = state.assemblies.map((candidate) =>
      candidate.id === assemblyId ? assembly.data.assembly : candidate,
    );
  }
}

async function loadBody(part: Part): Promise<void> {
  if (!part.confirmed) return;
  const key = `${part.id}:${part.confirmed.build}`;
  if (state.bodies.has(key)) return;
  const outcome = await api.partBody(part.id);
  state.bodies.set(key, outcome.kind === 'ok' ? outcome.data : 'unavailable');
}

function bodyOf(part: Part): BodyMesh | 'unavailable' | null {
  if (!part.confirmed) return null;
  return state.bodies.get(`${part.id}:${part.confirmed.build}`) ?? null;
}

async function loadBodiesForMode(): Promise<void> {
  if (!state.mode) return;
  if (state.mode.kind === 'assembly') {
    for (const part of partsInRows(state.rows)) await loadBody(part);
    return;
  }
  const part = partOf(ctx, state.mode);
  if (part) await loadBody(part);
}

function partsInRows(rows: TreeRow[]): Part[] {
  const found: Part[] = [];
  const walk = (list: TreeRow[]): void => {
    for (const row of list) {
      if (row.component.type === 'part') {
        const part = state.parts.find((candidate) => candidate.id === row.component.id);
        if (part) found.push(part);
      }
      if (row.children) walk(row.children);
    }
  };
  walk(rows);
  return found;
}

async function checkStorage(): Promise<void> {
  const outcome = await api.storageStatus();
  if (outcome.kind === 'ok') state.storageDown = outcome.data.storage === 'unreachable';
}

// ------------------------------------------------------------ part save cycle

function statusFromPart(part: Part): State['saveStatus'] {
  if (part.body.status === 'stored') return 'stored';
  if (part.body.status === 'none') return 'no_body';
  return 'not_stored';
}

async function withPartSave<T>(
  partId: string,
  run: () => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  state.savingPartId = partId;
  state.saveStatus = 'saving';
  state.modelMessage = '';
  render();
  const outcome = await run();
  state.savingPartId = null;
  if (outcome.kind === 'ok') {
    const part = (outcome.data as { part?: Part }).part;
    if (part) {
      state.parts = state.parts.map((candidate) => (candidate.id === part.id ? part : candidate));
      state.saveStatus = statusFromPart(part);
      state.bodies.delete(`${part.id}:${part.confirmed?.build ?? 0}`);
      await loadBody(part);
    }
  } else {
    state.saveStatus = 'idle';
  }
  const wasDown = state.storageDown;
  void checkStorage().then(() => {
    if (state.storageDown !== wasDown) render();
  });
  return outcome;
}

async function afterModelChange(): Promise<void> {
  await loadCatalogue();
  if (state.mode?.kind === 'assembly') await loadAssemblyView(state.mode.assemblyId);
  await loadBodiesForMode();
}

// ------------------------------------------------------------- slack sequence

function updateSlackText(): void {
  const node = root.querySelector('.slack-readout');
  if (!node) return;
  clear(node);
  node.appendChild(document.createTextNode(slackReadout(state.slackShown ?? 0)));
  node.classList.toggle('held', state.slackShown === 0);
}

async function animateSlack(from: number, to: number): Promise<void> {
  const sketch = state.sketch;
  if (!sketch) return;
  const changes: RingChange[] = [];
  for (const point of sketch.points) {
    const node = root.querySelector(`[data-ring="${point.ref}"]`) as SVGCircleElement | null;
    if (!node) continue;
    const previous = (state.ringsFrom?.get(point.ref) ?? point.freedom) * 6;
    const next = point.freedom * 6;
    if (previous !== next) changes.push({ node, from: previous, to: next });
  }
  await resizeRings(changes);
  state.ringsFrom = null;
  await countTo(from, to, (value) => {
    state.slackShown = value;
    updateSlackText();
  });
  state.slackShown = to;
  render();
}

function clearGhost(): void {
  if (state.ghost === null) return;
  state.ghost = null;
  render();
}

/** The refused glyph and the one the server named turn conflict red together. */
async function showConflict(error: ServerError): Promise<void> {
  const ghost = {
    label: error.refused_label as string,
    conflictId: (error.conflicts_with as { id: string }).id,
    flash: false,
  };
  state.ghost = ghost;
  state.modelMessage = error.message;
  render();
  if (reducedMotion()) return;
  await flashTurns((on) => {
    ghost.flash = on;
    render();
  });
  if (state.ghost === ghost) {
    state.ghost = null;
    render();
  }
}

// ----------------------------------------------------------------- navigation

async function openAssembly(id: string): Promise<void> {
  state.mode = { kind: 'assembly', assemblyId: id };
  state.tab = 'model';
  state.treeExpanded = new Set();
  state.sketch = null;
  state.extrude = null;
  state.featureDraft = null;
  state.preview = null;
  state.slackShown = null;
  render();
  await loadAssemblyView(id);
  await loadBodiesForMode();
  render();
}

async function openPart(id: string): Promise<void> {
  state.mode = { kind: 'part', partId: id };
  state.sketch = null;
  state.extrude = null;
  state.featureDraft = null;
  state.preview = null;
  state.slackShown = null;
  const part = state.parts.find((candidate) => candidate.id === id);
  if (part) state.saveStatus = statusFromPart(part);
  render();
  await loadBodiesForMode();
  render();
}

async function openSketch(id: string): Promise<void> {
  const outcome = await api.sketch(id);
  if (outcome.kind !== 'ok') return;
  state.sketch = outcome.data.sketch;
  state.mode = { kind: 'sketch', sketchId: id };
  state.selection = [];
  state.highlight = 0;
  state.tool = 'select';
  state.dimension = null;
  state.extrude = null;
  state.featureDraft = null;
  state.preview = null;
  state.zoom = 1;
  state.pan = { x: 0, y: 0 };
  state.slackShown = outcome.data.sketch.slack;
  state.ringsFrom = null;
  const part = state.parts.find((candidate) => candidate.id === outcome.data.sketch.part_id);
  if (part) state.saveStatus = statusFromPart(part);
  render();
}

function openFeature(partId: string, featureId: string): void {
  const part = state.parts.find((candidate) => candidate.id === partId);
  const feature = part?.features.find((candidate) => candidate.id === featureId);
  if (!part || !feature) return;
  state.mode = { kind: 'feature', partId, featureId };
  state.sketch = null;
  state.extrude = null;
  state.preview = null;
  state.slackShown = null;
  state.featureDraft = {
    partId,
    featureId,
    depth: show.plain(feature.depth_mm, displayOf(state.member)),
    direction: feature.direction,
  };
  state.saveStatus = statusFromPart(part);
  render();
  void loadBodiesForMode().then(render);
}

// --------------------------------------------------------------- sketch edits

function toolDefaults(tool: Tool): Record<string, string> {
  const display = displayOf(state.member);
  const sketch = state.sketch;
  const last = sketch?.entities[sketch.entities.length - 1];
  let x = 0;
  let y = 0;
  if (last) {
    if (last.type === 'line') {
      x = Math.max(last.start.x, last.end.x) + 10;
      y = last.end.y;
    } else if (last.type === 'point') {
      x = last.x + 10;
      y = last.y;
    } else {
      x = last.center.x + last.radius + 10;
      y = last.center.y;
    }
  }
  const text = (value: number): string => show.plain(value, display);
  if (tool === 'line') {
    return { startX: text(x), startY: text(y), endX: text(x + 20), endY: text(y) };
  }
  if (tool === 'circle') return { centreX: text(x), centreY: text(y), diameter: text(20) };
  if (tool === 'arc') {
    return {
      centreX: text(x),
      centreY: text(y),
      radius: text(10),
      startAngle: '0',
      endAngle: '90',
    };
  }
  return { x: text(x), y: text(y) };
}

function entityPayload(): Record<string, unknown> | null {
  const draft = state.toolDraft;
  if (state.tool === 'line') {
    return {
      type: 'line',
      start: { x: draft.startX ?? '', y: draft.startY ?? '' },
      end: { x: draft.endX ?? '', y: draft.endY ?? '' },
    };
  }
  if (state.tool === 'circle') {
    const diameter = parseLength(draft.diameter ?? '', unit(), 'length');
    return {
      type: 'circle',
      center: { x: draft.centreX ?? '', y: draft.centreY ?? '' },
      radius: diameter.ok ? diameter.mm / 2 : draft.diameter ?? '',
    };
  }
  if (state.tool === 'arc') {
    return {
      type: 'arc',
      center: { x: draft.centreX ?? '', y: draft.centreY ?? '' },
      radius: draft.radius ?? '',
      start_angle_deg: draft.startAngle ?? '',
      end_angle_deg: draft.endAngle ?? '',
    };
  }
  if (state.tool === 'point') return { type: 'point', x: draft.x ?? '', y: draft.y ?? '' };
  return null;
}

/** With a pointer, each tool collects its clicks on the canvas, then places the entity. */
const TOOL_CLICKS: Record<Tool, number> = { select: 0, line: 2, circle: 2, arc: 3, point: 1 };

function canvasPoint(x: number, y: number): void {
  const tool = state.tool;
  if (tool === 'select') return;
  const display = displayOf(state.member);
  const text = (value: number): string => show.plain(value, display);
  state.toolPoints = [...state.toolPoints, { x, y }];
  if (state.toolPoints.length < TOOL_CLICKS[tool]) {
    render();
    return;
  }
  type Spot = { x: number; y: number };
  const clicks = state.toolPoints as Spot[];
  const first = clicks[0] as Spot;
  if (tool === 'line') {
    const end = clicks[1] as Spot;
    state.toolDraft = {
      startX: text(first.x),
      startY: text(first.y),
      endX: text(end.x),
      endY: text(end.y),
    };
  } else if (tool === 'circle') {
    const rim = clicks[1] as Spot;
    state.toolDraft = {
      centreX: text(first.x),
      centreY: text(first.y),
      diameter: text(2 * Math.hypot(rim.x - first.x, rim.y - first.y)),
    };
  } else if (tool === 'arc') {
    const start = clicks[1] as Spot;
    const end = clicks[2] as Spot;
    const degrees = (point: Spot): number =>
      (Math.atan2(point.y - first.y, point.x - first.x) * 180) / Math.PI;
    state.toolDraft = {
      centreX: text(first.x),
      centreY: text(first.y),
      radius: text(Math.hypot(start.x - first.x, start.y - first.y)),
      startAngle: degrees(start).toFixed(3),
      endAngle: degrees(end).toFixed(3),
    };
  } else {
    state.toolDraft = { x: text(first.x), y: text(first.y) };
  }
  state.toolPoints = [];
  void placeEntity();
}

async function placeEntity(): Promise<void> {
  const sketch = state.sketch;
  const entity = entityPayload();
  if (!sketch || !entity) return;
  clearGhost();
  state.toolErrors = {};
  const previous = new Map(sketch.points.map((point) => [point.ref, point.freedom]));
  const oldSlack = sketch.slack;
  const outcome = await withPartSave(sketch.part_id, () =>
    api.addEntity(sketch.id, { base_revision: sketch.revision, entity }),
  );
  if (outcome.kind !== 'ok') {
    applyFailure(outcome, 'tool');
    render();
    return;
  }
  state.sketch = outcome.data.sketch;
  state.selection = [outcome.data.entity.id];
  state.highlight = canvasItems(outcome.data.sketch).findIndex(
    (item) => item.ref === outcome.data.entity.id,
  );
  state.tool = 'select';
  state.toolPoints = [];
  state.ringsFrom = previous;
  state.slackShown = oldSlack;
  render();
  focusCanvas();
  await animateSlack(oldSlack, outcome.data.sketch.slack);
  await afterModelChange();
  render();
}

async function sendConstraint(body: Record<string, unknown>, bucket: Bucket): Promise<void> {
  const sketch = state.sketch;
  if (!sketch) return;
  clearGhost();
  const previous = new Map(sketch.points.map((point) => [point.ref, point.freedom]));
  const oldSlack = sketch.slack;
  const outcome = await withPartSave(sketch.part_id, () =>
    api.addConstraint(sketch.id, { base_revision: sketch.revision, ...body }),
  );
  if (outcome.kind !== 'ok') {
    if (outcome.kind === 'error' && outcome.error.code === 'over_constrained') {
      await showConflict(outcome.error);
      return;
    }
    applyFailure(outcome, bucket);
    render();
    return;
  }
  state.sketch = outcome.data.sketch;
  state.dimension = null;
  state.dimensionErrors = {};
  state.ringsFrom = previous;
  state.slackShown = oldSlack;
  render();
  focusCanvas();
  await animateSlack(oldSlack, outcome.data.sketch.slack);
  state.modelMessage = outcome.data.constraint.redundant
    ? constraintRedundant(outcome.data.constraint.label)
    : constraintAdded(outcome.data.constraint.label, outcome.data.sketch.slack);
  render();
  await afterModelChange();
  render();
}

async function applyConstraint(kind: ConstraintKind): Promise<void> {
  await sendConstraint({ kind, refs: state.selection }, 'none');
}

function startDimension(requested?: ConstraintKind): void {
  const sketch = state.sketch;
  if (!sketch) return;
  const kind = requested ?? dimensionKindFor(sketch, state.selection);
  if (!kind) return;
  clearGhost();
  state.dimension = {
    constraintId: null,
    kind,
    refs: [...state.selection],
    value: measuredValueText(sketch, kind, state.selection),
    tolerance: '',
  };
  state.dimensionErrors = {};
  render();
  focusField('dimension-value');
}

function measuredValueText(sketch: Sketch, kind: ConstraintKind, refs: string[]): string {
  const display = displayOf(state.member);
  const point = (ref: string): { x: number; y: number } => {
    if (ref === 'origin') return { x: 0, y: 0 };
    const found = sketch.points.find((candidate) => candidate.ref === ref);
    return found ? { x: found.x, y: found.y } : { x: 0, y: 0 };
  };
  if (kind === 'diameter' || kind === 'radius') {
    const entity = sketch.entities.find((candidate) => candidate.id === refs[0]);
    if (entity && (entity.type === 'circle' || entity.type === 'arc')) {
      return show.plain(kind === 'diameter' ? entity.radius * 2 : entity.radius, display);
    }
    return '';
  }
  if (refs.length === 1) {
    const entity = sketch.entities.find((candidate) => candidate.id === refs[0]);
    if (entity && entity.type === 'line') {
      return show.plain(
        Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y),
        display,
      );
    }
    return '';
  }
  const first = point(refs[0] as string);
  const second = point(refs[1] as string);
  if (kind === 'horizontal_distance') return show.plain(Math.abs(second.x - first.x), display);
  if (kind === 'vertical_distance') return show.plain(Math.abs(second.y - first.y), display);
  return show.plain(Math.hypot(second.x - first.x, second.y - first.y), display);
}

function editDimension(constraintId: string): void {
  const sketch = state.sketch;
  const constraint = sketch?.constraints.find((candidate) => candidate.id === constraintId);
  if (!sketch || !constraint || constraint.value_mm === undefined) return;
  const display = displayOf(state.member);
  state.dimension = {
    constraintId,
    kind: constraint.kind,
    refs: constraint.refs,
    value: show.plain(constraint.value_mm, display),
    tolerance: toleranceToText(constraint.tolerance ?? null, display.units, display.precision),
  };
  state.dimensionErrors = {};
  render();
  focusField('dimension-value');
}

async function applyDimension(): Promise<void> {
  const sketch = state.sketch;
  const draft = state.dimension;
  if (!sketch || !draft) return;
  const payload = { value: draft.value, tolerance: draft.tolerance };
  if (draft.constraintId === null) {
    await sendConstraint({ kind: draft.kind, refs: draft.refs, ...payload }, 'dimension');
    return;
  }
  clearGhost();
  const previous = new Map(sketch.points.map((point) => [point.ref, point.freedom]));
  const oldSlack = sketch.slack;
  const outcome = await withPartSave(sketch.part_id, () =>
    api.patchConstraint(sketch.id, draft.constraintId as string, {
      base_revision: sketch.revision,
      ...payload,
    }),
  );
  if (outcome.kind !== 'ok') {
    applyFailure(outcome, 'dimension');
    render();
    return;
  }
  state.sketch = outcome.data.sketch;
  state.dimension = null;
  state.ringsFrom = previous;
  state.slackShown = oldSlack;
  render();
  focusCanvas();
  await animateSlack(oldSlack, outcome.data.sketch.slack);
  await afterModelChange();
  render();
}

async function deleteConstraint(constraintId: string): Promise<void> {
  const sketch = state.sketch;
  if (!sketch) return;
  clearGhost();
  const previous = new Map(sketch.points.map((point) => [point.ref, point.freedom]));
  const oldSlack = sketch.slack;
  const outcome = await withPartSave(sketch.part_id, () =>
    api.deleteConstraint(sketch.id, constraintId, sketch.revision),
  );
  if (outcome.kind !== 'ok') {
    applyFailure(outcome, 'none');
    render();
    return;
  }
  state.sketch = outcome.data.sketch;
  state.ringsFrom = previous;
  state.slackShown = oldSlack;
  render();
  await animateSlack(oldSlack, outcome.data.sketch.slack);
  await afterModelChange();
  render();
}

async function deleteSelection(): Promise<void> {
  const sketch = state.sketch;
  if (!sketch) return;
  clearGhost();
  const entityIds = state.selection.filter((ref) =>
    sketch.entities.some((entity) => entity.id === ref),
  );
  if (entityIds.length === 0) return;
  const previous = new Map(sketch.points.map((point) => [point.ref, point.freedom]));
  const oldSlack = sketch.slack;
  let latest = sketch;
  for (const entityId of entityIds) {
    const outcome = await withPartSave(latest.part_id, () =>
      api.deleteEntity(latest.id, entityId, latest.revision),
    );
    if (outcome.kind !== 'ok') {
      applyFailure(outcome, 'none');
      render();
      return;
    }
    latest = outcome.data.sketch;
  }
  state.sketch = latest;
  state.selection = [];
  state.highlight = 0;
  state.ringsFrom = previous;
  state.slackShown = oldSlack;
  render();
  await animateSlack(oldSlack, latest.slack);
  await afterModelChange();
  render();
}

// -------------------------------------------------------------------- extrude

function depthStep(): number {
  return unit() === 'in' ? 0.05 : 1;
}

function profileArea(sketch: Sketch): number | null {
  const profile = buildProfile(sketch.entities.map((entity) => ({ ...entity })));
  return profile ? profile.area_mm2 : null;
}

function computePreview(
  part: Part,
  sketch: Sketch,
  depthText: string,
  operation: Operation,
  previousDepthMm: number,
): void {
  if (operation === 'intersect') {
    state.preview = { volume_mm3: null, mass_g: null };
    return;
  }
  const parsed = parseLength(depthText, unit(), 'length');
  const area = profileArea(sketch);
  if (!parsed.ok || area === null) {
    state.preview = { volume_mm3: null, mass_g: null };
    return;
  }
  const base = part.confirmed?.volume_mm3 ?? 0;
  const change = area * (parsed.mm - previousDepthMm);
  const volume = operation === 'cut' ? base - change : base + change;
  state.preview = {
    volume_mm3: volume,
    mass_g: (volume * part.material.density_g_cm3) / 1000,
  };
}

function startExtrude(): void {
  const sketch = state.sketch;
  if (!sketch || state.member?.role !== 'founder') return;
  const part = state.parts.find((candidate) => candidate.id === sketch.part_id);
  if (!part) return;
  clearGhost();
  state.extrude = {
    sketchId: sketch.id,
    depth: show.plain(unit() === 'in' ? 25.4 : 10, displayOf(state.member)),
    operation: part.features.length === 0 ? 'new' : 'join',
    direction: 'normal',
    pending: false,
    idempotencyKey: newKey(),
  };
  computePreview(part, sketch, state.extrude.depth, state.extrude.operation, 0);
  render();
  focusField('extrude-depth');
}

async function confirmExtrude(): Promise<void> {
  const draft = state.extrude;
  const sketch = state.sketch;
  if (!draft || !sketch || draft.pending) return;
  draft.pending = true;
  state.dimensionErrors = {};
  render();
  const outcome = await withPartSave(sketch.part_id, () =>
    api.createFeature(
      sketch.part_id,
      {
        base_revision: (state.parts.find((part) => part.id === sketch.part_id) as Part).revision,
        sketch_id: sketch.id,
        operation: draft.operation,
        depth: draft.depth,
        direction: draft.direction,
      },
      draft.idempotencyKey,
    ),
  );
  draft.pending = false;
  if (outcome.kind !== 'ok') {
    applyFailure(outcome, 'dimension');
    render();
    return;
  }
  state.extrude = null;
  state.preview = null;
  state.modelMessage = featureAdded(outcome.data.feature.name);
  const refreshed = await api.sketch(sketch.id);
  if (refreshed.kind === 'ok') state.sketch = refreshed.data.sketch;
  await afterModelChange();
  render();
  focusCanvas();
}

async function applyFeatureDepth(): Promise<void> {
  const draft = state.featureDraft;
  if (!draft) return;
  const part = state.parts.find((candidate) => candidate.id === draft.partId);
  if (!part) return;
  state.dimensionErrors = {};
  const outcome = await withPartSave(part.id, () =>
    api.patchFeature(part.id, draft.featureId, {
      base_revision: part.revision,
      depth: draft.depth,
      direction: draft.direction,
    }),
  );
  if (outcome.kind !== 'ok') {
    applyFailure(outcome, 'dimension');
    render();
    return;
  }
  state.preview = null;
  await afterModelChange();
  render();
}

// ----------------------------------------------------------------- part edits

async function setMaterial(materialId: string): Promise<void> {
  const part = partOf(ctx, state.mode);
  if (!part) return;
  const outcome = await withPartSave(part.id, () =>
    api.patchPart(part.id, { base_revision: part.revision, material_id: materialId }),
  );
  if (outcome.kind !== 'ok') applyFailure(outcome, 'none');
  await afterModelChange();
  render();
}

async function savePart(): Promise<void> {
  const part = partOf(ctx, state.mode);
  if (!part) return;
  const outcome = await withPartSave(part.id, () => api.savePart(part.id));
  if (outcome.kind !== 'ok') applyFailure(outcome, 'none');
  await afterModelChange();
  render();
}

// ------------------------------------------------------------------ assembly

async function setQuantity(instanceId: string, quantity: number): Promise<void> {
  const mode = state.mode;
  if (mode?.kind !== 'assembly') return;
  const assembly = state.assemblies.find((candidate) => candidate.id === mode.assemblyId) as Assembly;
  const outcome = await api.patchInstance(assembly.id, instanceId, {
    base_revision: assembly.revision,
    quantity,
  });
  if (outcome.kind !== 'ok') applyFailure(outcome, 'none');
  await afterModelChange();
  render();
}

async function removeInstance(instanceId: string): Promise<void> {
  const mode = state.mode;
  if (mode?.kind !== 'assembly') return;
  const assembly = state.assemblies.find((candidate) => candidate.id === mode.assemblyId) as Assembly;
  const outcome = await api.deleteInstance(assembly.id, instanceId, assembly.revision);
  if (outcome.kind !== 'ok') applyFailure(outcome, 'none');
  await afterModelChange();
  render();
}

// -------------------------------------------------------------------- dialogs

function openDialog(kind: DialogKind, opener: HTMLElement | null): void {
  state.dialog = kind;
  state.dialogOpener = opener?.dataset.focusKey ?? null;
  state.dialogErrors = {};
  state.dialogPending = false;
  state.dialogKey = kind === 'add-to-assembly' ? newKey() : null;
  state.dialogFields =
    kind === 'new-part'
      ? { name: '', material_id: state.materials[0]?.id ?? '' }
      : kind === 'new-sketch'
        ? { plane: 'top', offset: '0' }
        : kind === 'add-to-assembly'
          ? { component: firstComponentValue(), quantity: '1' }
          : { name: '', declared_mass_g: '' };
  render();
  const panel = root.querySelector('[role="dialog"].dialog') as HTMLElement | null;
  if (panel) focusFirst(panel);
}

function firstComponentValue(): string {
  const part = state.parts[0];
  if (part) return `part:${part.id}`;
  const purchased = state.purchased[0];
  if (purchased) return `purchased:${purchased.id}`;
  const assembly = state.assemblies[0];
  return assembly ? `assembly:${assembly.id}` : '';
}

function closeDialog(): void {
  const opener = state.dialogOpener;
  state.dialog = null;
  state.dialogOpener = null;
  state.dialogErrors = {};
  render();
  focusByKey(opener);
}

async function submitDialog(): Promise<void> {
  const kind = state.dialog;
  if (!kind || state.dialogPending) return;
  state.dialogPending = true;
  state.dialogErrors = {};
  render();
  const fields = state.dialogFields;
  if (kind === 'new-part') {
    const outcome = await api.createPart({
      name: fields.name ?? '',
      material_id: fields.material_id ?? '',
    });
    await finishDialog(outcome, () => openPart(outcome.kind === 'ok' ? outcome.data.part.id : ''));
    return;
  }
  if (kind === 'new-assembly') {
    const outcome = await api.createAssembly({ name: fields.name ?? '' });
    await finishDialog(outcome, () =>
      openAssembly(outcome.kind === 'ok' ? outcome.data.assembly.id : ''),
    );
    return;
  }
  if (kind === 'new-purchased') {
    const outcome = await api.createPurchased({
      name: fields.name ?? '',
      declared_mass_g: Number(fields.declared_mass_g ?? ''),
    });
    await finishDialog(outcome, async () => undefined);
    return;
  }
  if (kind === 'new-sketch') {
    const part = partOf(ctx, state.mode);
    if (!part) return;
    const outcome = await withPartSave(part.id, () =>
      api.createSketch(part.id, {
        base_revision: part.revision,
        plane: fields.plane ?? 'top',
        offset: fields.offset ?? '0',
      }),
    );
    await finishDialog(outcome, () =>
      openSketch(outcome.kind === 'ok' ? outcome.data.sketch.id : ''),
    );
    return;
  }
  const mode = state.mode;
  if (mode?.kind !== 'assembly') return;
  const assembly = state.assemblies.find((candidate) => candidate.id === mode.assemblyId) as Assembly;
  const [type, id] = (fields.component ?? '').split(':');
  const outcome = await api.addInstance(
    assembly.id,
    {
      base_revision: assembly.revision,
      component: { type, id },
      quantity: Number(fields.quantity ?? '1'),
    },
    state.dialogKey as string,
  );
  if (outcome.kind === 'ok') {
    const name = componentNameOf(type as string, id as string);
    state.modelMessage = instanceAdded(name, Number(fields.quantity ?? '1'), assembly.name);
  }
  await finishDialog(outcome, async () => undefined);
}

function componentNameOf(type: string, id: string): string {
  if (type === 'part') return state.parts.find((part) => part.id === id)?.name ?? '';
  if (type === 'purchased') return state.purchased.find((item) => item.id === id)?.name ?? '';
  return state.assemblies.find((item) => item.id === id)?.name ?? '';
}

async function finishDialog(
  outcome: Outcome<unknown>,
  then: () => Promise<void> | void,
): Promise<void> {
  state.dialogPending = false;
  if (outcome.kind !== 'ok') {
    applyFailure(outcome, 'dialog');
    render();
    return;
  }
  state.dialog = null;
  const opener = state.dialogOpener;
  state.dialogOpener = null;
  await loadCatalogue();
  await then();
  if (state.mode?.kind === 'assembly') await loadAssemblyView(state.mode.assemblyId);
  await loadBodiesForMode();
  render();
  focusByKey(opener);
}

// -------------------------------------------------------------------- sheets

function focusByKey(key: string | null): void {
  if (key === null) return;
  (root.querySelector(`[data-focus-key="${key}"]`) as HTMLElement | null)?.focus();
}

function openSheet(sheet: 'tree' | 'properties', opener: HTMLElement | null): void {
  state.sheet = sheet;
  state.sheetOpener = opener?.dataset.focusKey ?? null;
  render();
  const panel = root.querySelector('[role="dialog"].sheet') as HTMLElement | null;
  if (panel) focusFirst(panel);
}

function closeSheet(): void {
  const opener = state.sheetOpener;
  state.sheet = null;
  state.sheetOpener = null;
  render();
  focusByKey(opener);
}

// -------------------------------------------------------------- focus helpers

function focusCanvas(): void {
  (root.querySelector('.sketch-canvas') as SVGElement | null)?.focus();
}

function focusField(id: string): void {
  const node = root.querySelector(`#${id}`) as HTMLElement | null;
  node?.focus();
  if (node instanceof HTMLInputElement) node.select();
}

// ------------------------------------------------------------------- the view

function signInScreen(): HTMLElement {
  const form = el('form', { 'aria-label': 'Sign in', class: 'signin-form' });
  const email = textField('Email', 'signin-email', state.signInFields.emailValue ?? '', state.signInFields.email, 'email');
  const password = textField('Password', 'signin-password', '', state.signInFields.password, 'password');
  form.appendChild(email);
  form.appendChild(password);
  if (state.signInError) {
    form.appendChild(el('div', { role: 'alert', class: 'signin-error' }, [state.signInError]));
  }
  form.appendChild(
    el('button', { type: 'submit', class: 'primary', disabled: state.signingIn }, [
      state.signingIn ? COPY.signingIn : COPY.signIn,
    ]),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const emailInput = form.querySelector('#signin-email') as HTMLInputElement;
    const passwordInput = form.querySelector('#signin-password') as HTMLInputElement;
    ctx.actions.signIn(emailInput.value, passwordInput.value);
  });
  return el('main', { class: 'signin' }, [
    el('div', { class: 'wordmark' }, [
      el('span', { class: 'wordmark-name' }, ['Kerfline Bench']),
      el('span', { class: 'wordmark-house' }, ['Halyard Instrument Works']),
    ]),
    form,
  ]);
}

function brandCorner(): HTMLElement {
  const signOut = el('button', { type: 'button' }, ['Sign out']);
  signOut.addEventListener('click', () => ctx.actions.signOut());
  return el('header', { class: 'brand' }, [
    el('span', { class: 'wordmark-name' }, ['Kerfline Bench']),
    el('span', { class: 'member-name' }, [state.member?.name ?? '']),
    signOut,
  ]);
}

function gridLayer(scale: number): SVGSVGElement {
  const spacing = Math.max(6, 10 * scale);
  const sheet = svg('svg', { class: 'grid', 'aria-hidden': 'true' });
  const defs = svg('defs');
  const fine = svg('pattern', {
    id: 'grid-fine',
    width: spacing,
    height: spacing,
    patternUnits: 'userSpaceOnUse',
  });
  fine.appendChild(svg('path', { d: `M ${spacing} 0 L 0 0 0 ${spacing}`, class: 'grid-fine' }));
  const coarse = svg('pattern', {
    id: 'grid-coarse',
    width: spacing * 10,
    height: spacing * 10,
    patternUnits: 'userSpaceOnUse',
  });
  coarse.appendChild(svg('rect', { width: spacing * 10, height: spacing * 10, fill: 'url(#grid-fine)' }));
  coarse.appendChild(
    svg('path', { d: `M ${spacing * 10} 0 L 0 0 0 ${spacing * 10}`, class: 'grid-coarse' }),
  );
  defs.appendChild(fine);
  defs.appendChild(coarse);
  sheet.appendChild(defs);
  sheet.appendChild(svg('rect', { width: '100%', height: '100%', fill: 'url(#grid-coarse)' }));
  return sheet;
}

function bodyCanvas(label: string, items: BodyItem[]): HTMLElement {
  const wrap = el('div', { class: 'body-view' });
  const canvas = el('canvas', { role: 'img', 'aria-label': label, class: 'body-canvas' });
  wrap.appendChild(canvas);
  requestAnimationFrame(() => {
    const labels = drawBodies(canvas, items);
    for (const entry of labels) {
      wrap.appendChild(
        el(
          'span',
          { class: 'body-label', style: `left:${entry.x}px; top:${entry.y}px` },
          [entry.text],
        ),
      );
    }
  });
  return wrap;
}

function placeholder(text: string): HTMLElement {
  return el('p', { class: 'canvas-placeholder' }, [text]);
}

function partView(part: Part): HTMLElement {
  const mesh = bodyOf(part);
  if (part.body.status === 'none' || !part.confirmed) return placeholder(COPY.noStoredBodyYet);
  if (mesh === 'unavailable') return placeholder(COPY.bodyViewUnavailable);
  if (mesh === null) return placeholder(COPY.noStoredBodyYet);
  return bodyCanvas(`Part view: ${part.name}`, [{ mesh, label: null }]);
}

function assemblyView(assembly: Assembly): HTMLElement {
  const items: BodyItem[] = [];
  let unavailable = false;
  const walk = (rows: TreeRow[]): void => {
    for (const row of rows) {
      if (row.component.type === 'part') {
        const part = state.parts.find((candidate) => candidate.id === row.component.id);
        if (!part) continue;
        const mesh = bodyOf(part);
        if (mesh === 'unavailable') unavailable = true;
        else if (mesh !== null) items.push({ mesh, label: `\u00d7${row.quantity}` });
      }
      if (row.children) walk(row.children);
    }
  };
  walk(state.rows);
  if (items.length === 0 && unavailable) return placeholder(COPY.bodyViewUnavailable);
  return bodyCanvas(`Assembly view: ${assembly.name}`, items);
}

function depthSlider(depthText: string, onInput: (value: string) => void, onCommit: () => void): HTMLElement {
  const display = displayOf(state.member);
  const step = depthStep();
  const parsed = parseLength(depthText, unit(), 'length');
  const current = parsed.ok ? parsed.mm : 0;
  const slider = el('input', {
    type: 'range',
    min: String(step),
    max: unit() === 'in' ? '393.7' : '10000',
    step: String(step),
    value: String(Number(show.plain(current, display))),
    'aria-label': 'Extrude depth',
    'aria-valuetext': show.length(current, display),
    class: 'depth-slider',
    'data-focus-key': 'depth-slider',
  });
  slider.addEventListener('input', () => {
    slider.setAttribute(
      'aria-valuetext',
      show.length(unit() === 'in' ? Number(slider.value) * 25.4 : Number(slider.value), display),
    );
    onInput(slider.value);
  });
  slider.addEventListener('change', () => {
    settleHandle(slider);
    onCommit();
  });
  slider.addEventListener('keydown', (event) => {
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.shiftKey) {
      event.preventDefault();
      const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * 10;
      slider.value = String(Math.max(step, Number(slider.value) + delta));
      onInput(slider.value);
      settleHandle(slider);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit();
    }
  });
  return el('div', { class: 'depth-handle' }, [slider]);
}

function sketchViewport(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width >= 1024) return { width, height, left: 288, right: 352, top: 72, bottom: 104 };
  if (width >= 768) return { width, height, left: 248, right: 312, top: 72, bottom: 104 };
  return { width, height, left: 16, right: 16, top: 64, bottom: 120 };
}

function canvasContent(): HTMLElement[] {
  const mode = state.mode;
  if (!mode) return [];
  if (mode.kind === 'assembly') {
    const assembly = state.assemblies.find((candidate) => candidate.id === mode.assemblyId);
    if (!assembly) return [];
    if (state.tab === 'bom') {
      return state.bom
        ? [el('div', { class: 'bom-scroll' }, [renderBomTable(ctx, state.bom)])]
        : [];
    }
    return [assemblyView(assembly)];
  }
  const part = partOf(ctx, mode);
  if (!part) return [];
  if (mode.kind === 'sketch' && state.sketch) {
    const render = renderSketchCanvas(ctx, state.sketch, displayOf(state.member), sketchViewport());
    attachCanvasEvents(render.root, render.toModel);
    const nodes: HTMLElement[] = [];
    const holder = el('div', { class: 'sketch-holder' });
    holder.appendChild(render.root);
    if (state.extrude) {
      holder.appendChild(
        depthSlider(
          state.extrude.depth,
          (value) => ctx.actions.setExtrudeField('depth', value),
          () => undefined,
        ),
      );
    }
    nodes.push(holder);
    return nodes;
  }
  const nodes: HTMLElement[] = [partView(part)];
  if (mode.kind === 'feature' && state.featureDraft) {
    nodes.push(
      depthSlider(
        state.featureDraft.depth,
        (value) => ctx.actions.setFeatureField('depth', value),
        () => ctx.actions.applyFeatureDepth(),
      ),
    );
  }
  return nodes;
}

function attachCanvasEvents(node: SVGSVGElement, toModel: (x: number, y: number) => [number, number]): void {
  node.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      ctx.actions.moveHighlight(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      ctx.actions.moveHighlight(-1);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      ctx.actions.toggleHighlighted();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      ctx.actions.zoomBy(1.2);
    } else if (event.key === '-') {
      event.preventDefault();
      ctx.actions.zoomBy(1 / 1.2);
    }
  });
  node.addEventListener('click', (event) => {
    clearGhost();
    if (state.tool !== 'select') {
      const box = node.getBoundingClientRect();
      const [x, y] = toModel(event.clientX - box.left, event.clientY - box.top);
      ctx.actions.canvasPoint(x, y);
      return;
    }
    const target = (event.target as Element).closest('[data-ref]');
    if (!target) {
      ctx.actions.clearSelection();
      return;
    }
    ctx.actions.clickItem(target.getAttribute('data-ref') as string, event.shiftKey);
  });
  node.addEventListener('wheel', (event) => {
    event.preventDefault();
    ctx.actions.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  });
  let dragging = false;
  node.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('[data-ref]')) return;
    dragging = true;
    node.setPointerCapture(event.pointerId);
  });
  node.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    ctx.actions.panBy(event.movementX, event.movementY);
  });
  node.addEventListener('pointerup', () => {
    dragging = false;
  });
}

function assemblyTabs(): HTMLElement {
  const list = el('div', { role: 'tablist', 'aria-label': 'Assembly view', class: 'tabs' });
  for (const entry of [
    { id: 'model', label: 'Model' },
    { id: 'bom', label: 'Bill of materials' },
  ] as const) {
    const tab = el(
      'button',
      {
        type: 'button',
        role: 'tab',
        'aria-selected': state.tab === entry.id ? 'true' : 'false',
        'data-focus-key': `tab-${entry.id}`,
      },
      [entry.label],
    );
    tab.addEventListener('click', () => ctx.actions.setTab(entry.id));
    list.appendChild(tab);
  }
  return list;
}

function messagesLayer(): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  if (state.storageDown) {
    nodes.push(
      el('div', { role: 'alert', 'aria-label': 'Storage outage', class: 'banner outage' }, [
        COPY.storageOutage,
      ]),
    );
  }
  if (state.conflict) {
    const reload = el('button', { type: 'button' }, ['Reload']);
    reload.addEventListener('click', () => ctx.actions.reloadAfterConflict());
    nodes.push(
      el('div', { role: 'alert', 'aria-label': 'Save conflict', class: 'banner conflict' }, [
        el('span', {}, [state.conflict]),
        reload,
      ]),
    );
  }
  nodes.push(
    el('div', { role: 'status', 'aria-label': 'Model message', class: 'model-message' }, [
      state.modelMessage,
    ]),
  );
  return nodes;
}

function sheetLayer(): HTMLElement {
  const sheet = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': state.sheet === 'tree' ? 'Feature tree' : 'Properties',
    class: 'sheet',
  });
  sheet.appendChild(
    state.sheet === 'tree' ? renderFeatureTree(ctx) : el('div', { class: 'panel-body' }, renderPropertiesContent(ctx)),
  );
  const close = el('button', { type: 'button' }, ['Close']);
  close.addEventListener('click', () => ctx.actions.closeSheet());
  sheet.appendChild(close);
  trapFocus(sheet, () => ctx.actions.closeSheet());
  const backdrop = el('div', { class: 'backdrop' }, [sheet]);
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) ctx.actions.closeSheet();
  });
  return backdrop;
}

function dialogLayer(kind: DialogKind): HTMLElement {
  const panel = renderDialog(ctx, kind);
  trapFocus(panel, () => ctx.actions.closeDialog());
  const backdrop = el('div', { class: 'backdrop' }, [panel]);
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) ctx.actions.closeDialog();
  });
  return backdrop;
}

function render(): void {
  const focus = captureFocus();
  clear(root);
  if (!state.member) {
    root.appendChild(signInScreen());
    restoreFocus(focus);
    return;
  }
  const assemblyMode = state.mode?.kind === 'assembly';
  const bomActive = assemblyMode && state.tab === 'bom';
  const wide = state.width >= 768;
  const scale = state.sketch ? 2 * state.zoom : 2;

  root.appendChild(brandCorner());
  if (wide && !bomActive) {
    root.appendChild(
      el('nav', { 'aria-label': 'Workspace', class: 'tree-panel panel' }, [renderFeatureTree(ctx)]),
    );
  }
  if (assemblyMode) root.appendChild(assemblyTabs());

  const layer = el('div', { class: 'canvas-layer' }, [gridLayer(scale)]);
  layer.appendChild(el('div', { class: 'canvas-content' }, canvasContent()));
  root.appendChild(layer);

  if (wide && !bomActive) {
    root.appendChild(
      el('aside', { 'aria-label': 'Properties', class: 'properties panel' }, [
        el('div', { class: 'panel-body' }, renderPropertiesContent(ctx)),
      ]),
    );
  }
  root.appendChild(renderCommandStrip(ctx));
  for (const node of messagesLayer()) root.appendChild(node);
  if (state.sheet) root.appendChild(sheetLayer());
  if (state.dialog) root.appendChild(dialogLayer(state.dialog));
  restoreFocus(focus);
}

// ------------------------------------------------------------------- wiring

function treeKeyTarget(key: string): void {
  const [kind, first, second] = key.split(':');
  if (kind === 'assembly') void openAssembly(first as string);
  else if (kind === 'part') {
    state.partsExpanded.add(first as string);
    void openPart(first as string);
  }
  else if (kind === 'sketch') void openSketch(first as string);
  else if (kind === 'feature') openFeature(first as string, second as string);
  if (state.sheet === 'tree') closeSheet();
}

function moveTreeActive(delta: number): void {
  const items = featureTreeItems(ctx);
  if (items.length === 0) return;
  const current = state.treeActive === null ? -1 : items.indexOf(state.treeActive);
  const next = Math.min(items.length - 1, Math.max(0, current + delta));
  state.treeActive = items[next] as string;
  render();
}

function setTreeExpanded(expanded: boolean): void {
  const key = state.treeActive;
  if (!key?.startsWith('part:')) return;
  const partId = key.slice('part:'.length);
  if (expanded) state.partsExpanded.add(partId);
  else state.partsExpanded.delete(partId);
  render();
}

const actions: Actions = {
  signIn: (email, password) => {
    state.signingIn = true;
    state.signInError = null;
    state.signInFields = { emailValue: email };
    render();
    void api.signIn(email, password).then(async (outcome) => {
      state.signingIn = false;
      if (outcome.kind !== 'ok') {
        applyFailure(outcome, 'signin');
        state.signInFields.emailValue = email;
        render();
        return;
      }
      state.member = outcome.data.member;
      state.signInFields = {};
      await boot();
    });
  },
  signOut: () => {
    void api.signOut().then(() => {
      state.member = null;
      state.mode = null;
      render();
    });
  },
  openAssembly: (id) => void openAssembly(id),
  openPart: (id) => void openPart(id),
  openSketch: (id) => void openSketch(id),
  openFeature: (partId, featureId) => openFeature(partId, featureId),
  setTab: (tab) => {
    state.tab = tab;
    render();
    if (state.mode?.kind === 'assembly') {
      void loadAssemblyView(state.mode.assemblyId).then(render);
    }
  },
  toggleTreeRow: (instanceId) => {
    if (state.treeExpanded.has(instanceId)) state.treeExpanded.delete(instanceId);
    else state.treeExpanded.add(instanceId);
    render();
  },
  moveTreeActive,
  setTreeExpanded,
  openTreeActive: () => {
    if (state.treeActive) treeKeyTarget(state.treeActive);
  },
  openTreeKey: (key) => {
    state.treeActive = key;
    treeKeyTarget(key);
  },
  togglePartItem: (partId) => {
    if (state.partsExpanded.has(partId)) state.partsExpanded.delete(partId);
    else state.partsExpanded.add(partId);
    render();
  },
  setQuantity: (instanceId, quantity) => void setQuantity(instanceId, quantity),
  removeInstance: (instanceId) => void removeInstance(instanceId),
  openDialog,
  closeDialog,
  setDialogField: (name, value) => {
    state.dialogFields[name] = value;
  },
  submitDialog: () => void submitDialog(),
  openSheet,
  closeSheet,
  setTool: (tool) => {
    clearGhost();
    state.tool = tool;
    state.toolErrors = {};
    state.toolPoints = [];
    if (tool !== 'select') {
      state.toolDraft = toolDefaults(tool);
      render();
      const firstField = root.querySelector('.tool-form input') as HTMLElement | null;
      firstField?.focus();
      return;
    }
    render();
  },
  setToolField: (name, value) => {
    state.toolDraft[name] = value;
  },
  placeEntity: () => void placeEntity(),
  canvasPoint,
  moveHighlight: (delta) => {
    if (!state.sketch) return;
    clearGhost();
    const items = canvasItems(state.sketch);
    state.highlight = Math.min(items.length - 1, Math.max(0, state.highlight + delta));
    render();
    focusCanvas();
  },
  toggleHighlighted: () => {
    if (!state.sketch) return;
    const item = canvasItems(state.sketch)[state.highlight];
    if (item) actions.clickItem(item.ref, true);
  },
  clickItem: (ref, additive) => {
    clearGhost();
    if (!additive) {
      state.selection = [ref];
    } else if (state.selection.includes(ref)) {
      state.selection = state.selection.filter((candidate) => candidate !== ref);
    } else {
      state.selection = [...state.selection, ref];
    }
    if (state.sketch) {
      const index = canvasItems(state.sketch).findIndex((item) => item.ref === ref);
      if (index >= 0) state.highlight = index;
    }
    render();
  },
  clearSelection: () => {
    state.selection = [];
    render();
  },
  applyConstraint: (kind) => void applyConstraint(kind),
  startDimension,
  editDimension,
  setDimensionField: (name, value) => {
    if (!state.dimension) return;
    if (name === 'value') state.dimension.value = value;
    else state.dimension.tolerance = value;
  },
  applyDimension: () => void applyDimension(),
  cancelDimension: () => {
    state.dimension = null;
    state.dimensionErrors = {};
    render();
    focusCanvas();
  },
  deleteConstraint: (constraintId) => void deleteConstraint(constraintId),
  deleteSelection: () => void deleteSelection(),
  closeSketch: () => {
    if (state.sketch) void openPart(state.sketch.part_id);
  },
  startExtrude,
  setExtrudeField: (name, value) => {
    const draft = state.extrude;
    const sketch = state.sketch;
    if (!draft || !sketch) return;
    if (name === 'depth') draft.depth = value;
    else if (name === 'operation') draft.operation = value as Operation;
    else draft.direction = value as Direction;
    const part = state.parts.find((candidate) => candidate.id === sketch.part_id);
    if (part) computePreview(part, sketch, draft.depth, draft.operation, 0);
    updatePreviewRegion();
    if (name !== 'depth') render();
  },
  confirmExtrude: () => void confirmExtrude(),
  cancelExtrude: () => {
    state.extrude = null;
    state.preview = null;
    render();
    focusCanvas();
  },
  setFeatureField: (name, value) => {
    const draft = state.featureDraft;
    if (!draft) return;
    if (name === 'depth') draft.depth = value;
    else draft.direction = value as Direction;
    const part = state.parts.find((candidate) => candidate.id === draft.partId);
    const feature = part?.features.find((candidate) => candidate.id === draft.featureId);
    if (part && feature) {
      void api.sketch(feature.sketch_id).then((outcome) => {
        if (outcome.kind !== 'ok') return;
        computePreview(part, outcome.data.sketch, draft.depth, feature.operation, feature.depth_mm);
        updatePreviewRegion();
      });
    }
    if (name !== 'depth') render();
  },
  applyFeatureDepth: () => void applyFeatureDepth(),
  setMaterial: (materialId) => void setMaterial(materialId),
  savePart: () => void savePart(),
  setUnits: (units) => {
    void api.setPreferences({ units }).then((outcome) => {
      if (outcome.kind === 'ok') state.member = outcome.data.member;
      render();
    });
  },
  setPrecision: (precision) => {
    void api.setPreferences({ precision }).then((outcome) => {
      if (outcome.kind === 'ok') state.member = outcome.data.member;
      render();
    });
  },
  reloadAfterConflict: () => {
    state.conflict = null;
    void (async () => {
      await loadCatalogue();
      if (state.mode?.kind === 'sketch') {
        const outcome = await api.sketch(state.mode.sketchId);
        if (outcome.kind === 'ok') {
          state.sketch = outcome.data.sketch;
          state.slackShown = outcome.data.sketch.slack;
          state.dimension = null;
        }
      }
      if (state.mode?.kind === 'assembly') await loadAssemblyView(state.mode.assemblyId);
      await loadBodiesForMode();
      render();
    })();
  },
  zoomBy: (factor) => {
    state.zoom = Math.min(20, Math.max(0.1, state.zoom * factor));
    render();
    focusCanvas();
  },
  panBy: (dx, dy) => {
    state.pan = { x: state.pan.x + dx, y: state.pan.y + dy };
    render();
  },
};

ctx.actions = actions;

function updatePreviewRegion(): void {
  const region = root.querySelector('.measurements');
  if (!region) return;
  const part = partOf(ctx, state.mode);
  if (!part) return;
  const fresh = renderPropertiesContent(ctx).find((node) => node.classList.contains('measurements'));
  if (fresh) region.replaceWith(fresh);
}

// ----------------------------------------------------------------- shortcuts

const TOOL_KEYS: Record<string, Tool> = { l: 'line', o: 'circle', a: 'arc', k: 'point' };
const CONSTRAINT_KEYS: Record<string, ConstraintKind> = {
  c: 'coincident',
  h: 'horizontal',
  v: 'vertical',
  p: 'parallel',
  r: 'perpendicular',
  e: 'equal',
  f: 'fix',
};

function inTypingContext(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') return true;
  return node.isContentEditable;
}

document.addEventListener('keydown', (event) => {
  if (!state.member) return;
  if (state.dialog !== null || state.sheet !== null) return;
  if (inTypingContext(event.target)) return;

  const tree = (event.target as HTMLElement | null)?.closest('[role="tree"]');
  if (tree) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveTreeActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveTreeActive(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setTreeExpanded(true);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setTreeExpanded(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      actions.openTreeActive();
      return;
    }
  }

  if (state.mode?.kind !== 'sketch' || !state.sketch) return;
  const key = event.key.toLowerCase();
  if (event.key === 'Escape') {
    event.preventDefault();
    clearGhost();
    if (state.selection.length > 0) actions.clearSelection();
    else actions.setTool('select');
    return;
  }
  if (key === 'x') {
    event.preventDefault();
    startExtrude();
    return;
  }
  if (TOOL_KEYS[key]) {
    event.preventDefault();
    actions.setTool(TOOL_KEYS[key] as Tool);
    return;
  }
  if (key === 'd') {
    event.preventDefault();
    startDimension();
    return;
  }
  if (CONSTRAINT_KEYS[key]) {
    event.preventDefault();
    void applyConstraint(CONSTRAINT_KEYS[key] as ConstraintKind);
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    void deleteSelection();
  }
});

// ---------------------------------------------------------------------- boot

async function boot(): Promise<void> {
  const [workspace, materials] = await Promise.all([api.workspace(), api.materials()]);
  if (workspace.kind === 'ok') state.workspace = workspace.data;
  if (materials.kind === 'ok') state.materials = materials.data.materials;
  await loadCatalogue();
  const productId = state.workspace?.product.assembly_id;
  if (productId) await openAssembly(productId);
  else render();
  await checkStorage();
  render();
}

window.addEventListener('resize', () => {
  state.width = window.innerWidth;
  render();
});

setInterval(() => {
  if (!state.member) return;
  const wasDown = state.storageDown;
  void checkStorage().then(() => {
    if (state.storageDown !== wasDown) render();
  });
}, 10000);

void (async () => {
  const me = await api.me();
  if (me.kind === 'ok') {
    state.member = me.data.member;
    await boot();
    return;
  }
  render();
})();
