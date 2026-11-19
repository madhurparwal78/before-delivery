import { el, announce } from '../dom.js';
import { ApiError } from '../api.js';
import type { LayerDoc, AssetDoc, PresenceMember, UserInfo } from '../api.js';
import type { ConsoleLine, BeatContext } from '../scripts.js';
import { SetStore } from '../store.js';
import { GraphEvaluator } from '../graph.js';
import type { StageRenderer, GizmoPositions } from '../stage.js';
import { openDialogWith } from '../dialogs.js';

export const KEYABLE_PROPERTIES = [
  'position.x', 'position.y', 'position.z',
  'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'scale.z',
  'props.fov', 'props.near', 'props.far',
  'props.twist', 'props.radius', 'props.intensity',
  'material.tint_alpha',
];

export const OUTPUT_BUS_LABELS: Record<string, string> = { main: 'Main', side: 'Side screens', led: 'LED strip' };

export type PluginNode = { typeName: string; inputs: string[]; outputs: string[]; run: (inputs: Record<string, number>) => Record<string, number> };

export interface TransportState {
  playing: boolean;
  tick: number;
  bpm: number;
  currentTick (): number;
  beat: number;
  play (): void;
  pause (): void;
  stop (): void;
  stepBeat (): void;
}

export interface EditorContext {
  setId: string;
  store: SetStore;
  evaluator: GraphEvaluator;
  renderer: StageRenderer | null;
  canvas: HTMLCanvasElement;
  regions: Record<string, HTMLElement>;
  user: UserInfo | null;
  selectedLayerId: string | null;
  gizmoMode: 'move' | 'rotate' | 'scale';
  gridSnap: boolean;
  angleSnap: boolean;
  activeTab: string;
  dockChoice: string;
  orbit: { yaw: number; pitch: number; distance: number };
  gizmoPositions: GizmoPositions | null;
  draggingGizmo: 'x' | 'y' | 'z' | null;
  scrubbing: boolean;
  orbiting: boolean;
  needsDraw: boolean;
  transport: TransportState;
  beat: number;
  expanded: Set<string>;
  drawerOpen: Map<string, boolean>;
  currentAssets: AssetDoc[];
  presence: PresenceMember[];
  pluginNodes: PluginNode[];
  scriptRuns: Map<string, { onBeat: ((ctx: BeatContext) => void) | undefined; stopped: boolean }>;
  consoleLines: ConsoleLine[];
  scriptOverrides: Map<string, Map<string, number>>;
  lastBeat: number;
  storageDown: boolean;
  collabDown: boolean;
  rebuildTree: () => void;
  rebuildInspector: () => void;
  rebuildTimeline: () => void;
  rebuildGraph: () => void;
  rebuildConsole: () => void;
  rebuildTabs: () => void;
  rebuildRigPanel: () => void;
  rebuildPresence: (members: PresenceMember[]) => void;
  rebuildBanners: () => void;
  rebuildCameraSelect: () => void;
  redrawOnce: () => void;
  updateAutosave: () => void;
  updatePlayhead: (tick: number, bpm: number) => void;
  runAllScripts: () => void;
}

// The beat transport: one clock for the stage, the graph and the scripts.
export function makeTransport (): TransportState {
  const state = { playing: false, tick: 0, bpm: 120, startBeat: 0, startWallMs: 0 };
  const currentBeat = (): number => state.playing
    ? state.startBeat + (performance.now() - state.startWallMs) / 1000 * (state.bpm / 60)
    : state.tick / 96;
  return {
    get playing () { return state.playing; },
    set playing (value) { state.playing = value; },
    get tick () { return state.tick; },
    set tick (value) { state.tick = value; },
    get bpm () { return state.bpm; },
    set bpm (value) { state.bpm = value; },
    currentTick: () => state.playing ? Math.round(currentBeat() * 96) : state.tick,
    get beat () { return currentBeat(); },
    play: () => { if (!state.playing) { state.playing = true; state.startBeat = state.tick / 96; state.startWallMs = performance.now(); } },
    pause: () => { if (state.playing) { state.tick = Math.round(currentBeat() * 96); state.playing = false; } },
    stop: () => { state.playing = false; state.tick = 0; },
    stepBeat: () => { if (state.playing) state.tick = Math.round(currentBeat() * 96); state.playing = false; state.tick = Math.min(24_575, state.tick + 96); },
  };
}

export function makeContext (setId: string, store: SetStore, renderer: StageRenderer | null, canvas: HTMLCanvasElement, user: UserInfo | null): EditorContext {
  const regions: Record<string, HTMLElement> = {};
  for (const name of ['Autosave', 'Shader compile', 'Asset upload', 'Show status', 'Script status', 'Export status', 'Connection', 'Service status', 'Notifications']) {
    regions[name] = el('div', { class: 'status-region', role: 'status', 'aria-live': 'polite', 'aria-label': name });
  }
  const noop = (): void => {};
  return {
    setId,
    store,
    evaluator: new GraphEvaluator(),
    renderer,
    canvas,
    regions,
    user,
    selectedLayerId: null,
    gizmoMode: 'move',
    gridSnap: false,
    angleSnap: false,
    activeTab: 'timeline',
    dockChoice: 'layers',
    orbit: { yaw: 0.4, pitch: 0.3, distance: 12 },
    gizmoPositions: null,
    draggingGizmo: null,
    scrubbing: false,
    orbiting: false,
    needsDraw: false,
    transport: makeTransport(),
    beat: 0,
    expanded: new Set<string>(),
    drawerOpen: new Map<string, boolean>(),
    currentAssets: [],
    presence: [],
    pluginNodes: [],
    scriptRuns: new Map(),
    consoleLines: [],
    scriptOverrides: new Map(),
    lastBeat: 0,
    storageDown: false,
    collabDown: false,
    rebuildTree: noop,
    rebuildInspector: noop,
    rebuildTimeline: noop,
    rebuildGraph: noop,
    rebuildConsole: noop,
    rebuildTabs: noop,
    rebuildRigPanel: noop,
    rebuildPresence: noop,
    rebuildBanners: noop,
    rebuildCameraSelect: noop,
    redrawOnce: noop,
    updateAutosave: noop,
    updatePlayhead: noop,
    runAllScripts: noop,
  };
}

export const layerOf = (ctx: EditorContext, id: string | null): LayerDoc | null =>
  ctx.store.getDocument()?.layers.find((l) => l.id === id) ?? null;

// Sends an op through the store, mapping refusals to UI feedback. The
// conflict dialog is the one place a refused stale edit is resolved.
export async function commitOp (ctx: EditorContext, op: { target: string; baseVersion: number | undefined; type: string; payload: Record<string, unknown> }, applyLocal: () => void): Promise<void> {
  announce(ctx.regions['Autosave'], 'Saving');
  // The local copy applies the change and its version bump together, so the
  // next op's base version matches what the server committed.
  const applyLocalWithVersion = (): void => {
    applyLocal();
    bumpLocalVersion(ctx, op);
  };
  try {
    await ctx.store.sendOp({ ...op, applyLocal: applyLocalWithVersion });
    ctx.redrawOnce();
    ctx.updateAutosave();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.body.code === 'stale_version') {
      const layer = layerOf(ctx, op.target);
      openDialogWith({
        title: 'Someone changed this layer first',
        body: el('div', { text: `${error.body.changed_by?.display_name ?? 'Someone'} changed ${layer?.name ?? 'this layer'} before your edit arrived.` }),
        alert: true,
        dim: true,
        actions: [
          {
            label: 'Keep theirs',
            onClick: (close) => {
              // Discard the local edit; the server's state stays as it is.
              void ctx.store.load().then(() => {
                ctx.rebuildTree();
                ctx.rebuildInspector();
                ctx.rebuildTimeline();
                ctx.redrawOnce();
              });
              close();
            },
          },
          {
            label: 'Reapply mine',
            primary: true,
            onClick: (close) => {
              close();
              void commitOp(ctx, { ...op, baseVersion: ctx.store.layerVersion(op.target) }, applyLocal);
            },
          },
        ],
      });
      return;
    }
    if (error.body.code === 'layer_locked') {
      announce(ctx.regions['Notifications'], `This layer is locked by ${error.body.holder?.display_name ?? 'someone'}`);
      return;
    }
    if (error.status === 422) {
      announce(ctx.regions['Autosave'], 'Save failed');
      return;
    }
    throw error;
  }
}

// The local mirror of the server's version bump, decided in the same place
// the server decides it.
// A layer.add or script.add commits its new target at version 1; every other
// op bumps its target by one, mirroring the server.
function bumpLocalVersion (ctx: EditorContext, op: { target: string; type: string }): void {
  const doc = ctx.store.getDocument();
  if (doc === null) return;
  const creation = op.type === 'layer.add' || op.type === 'script.add';
  if (op.target === 'set') { doc.set.settings_version += 1; return; }
  if (op.target === 'graph') { doc.set.graph_version += 1; return; }
  const layer = doc.layers.find((l) => l.id === op.target);
  if (layer !== undefined) { if (!creation) layer.version += 1; return; }
  const script = doc.scripts.find((s) => s.id === op.target);
  if (script !== undefined && !creation) script.version += 1;
}

export async function commitValue (ctx: EditorContext, path: string, value: number | string[] | [number, number, number] | string | null, localSet: () => void): Promise<void> {
  const layerId = ctx.selectedLayerId;
  if (layerId === null) return;
  await commitOp(ctx, {
    target: layerId,
    baseVersion: ctx.store.layerVersion(layerId),
    type: 'layer.set',
    payload: { path, value },
  }, localSet);
}
