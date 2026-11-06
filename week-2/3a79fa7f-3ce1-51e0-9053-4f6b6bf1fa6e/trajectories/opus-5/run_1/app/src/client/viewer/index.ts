import * as THREE from 'three';
import { el } from '../dom.js';
import { reducedMotion } from '../ui.js';
import type { Build, Catalog, SlotName } from '../types.js';
import { cssOf } from './colours.js';
import {
  batteryShape,
  boardPackageShape,
  controllerShape,
  deckWindow,
  mastShape,
  propulsionShape,
  setChargeBars,
  setOpacity,
  wingShape,
} from './parts.js';

export type CameraPreset = 'front' | 'side' | 'top' | 'three-quarter' | 'custom';

interface Pose {
  yaw: number;
  pitch: number;
  distance: number;
}

const TARGET = new THREE.Vector3(0, -0.3, 0);
const BASE_DISTANCE = 3.4;
const MIN_DISTANCE = 1.8;
const MAX_DISTANCE = 6.0;
const MIN_PITCH = -10;
const MAX_PITCH = 90;
const FOV = 35;

export const PRESET_POSES: Record<Exclude<CameraPreset, 'custom'>, Pose> = {
  front: { yaw: 90, pitch: 0, distance: BASE_DISTANCE },
  side: { yaw: 0, pitch: 0, distance: BASE_DISTANCE },
  top: { yaw: 0, pitch: 90, distance: BASE_DISTANCE },
  'three-quarter': { yaw: 45, pitch: 25, distance: BASE_DISTANCE },
};

const PRESET_BUTTONS: { preset: Exclude<CameraPreset, 'custom'>; label: string }[] = [
  { preset: 'front', label: 'Front view' },
  { preset: 'side', label: 'Side view' },
  { preset: 'top', label: 'Top view' },
  { preset: 'three-quarter', label: 'Three-quarter view' },
];

function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 0.5) / factor;
}

function fixed(value: number, decimals: number): string {
  return roundHalfUp(value, decimals).toFixed(decimals);
}

function normaliseYaw(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}

export interface ViewParam {
  preset?: Exclude<CameraPreset, 'custom'>;
  orbit?: Pose;
}

export function parseViewParam(params: URLSearchParams): ViewParam {
  const view = params.get('view');
  if (view && view in PRESET_POSES) return { preset: view as Exclude<CameraPreset, 'custom'> };
  const orbit = params.get('orbit');
  if (orbit) {
    const parts = orbit.split(',').map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return { orbit: { yaw: parts[0]!, pitch: parts[1]!, distance: parts[2]! / 100 } };
    }
  }
  return {};
}

export function viewParamString(preset: CameraPreset, pose: Pose): string {
  if (preset !== 'custom') return `view=${preset}`;
  const yaw = Math.floor(normaliseYaw(pose.yaw) + 0.5) % 360;
  const pitch = Math.floor(pose.pitch + 0.5);
  const centimetres = Math.floor(pose.distance * 100 + 0.5);
  return `orbit=${yaw},${pitch},${centimetres}`;
}

export interface ViewerHandle {
  region: HTMLElement;
  shell: HTMLElement;
  setBuild(build: Build, animateSwap: boolean): void;
  setBatteryFill(bars: number): void;
  setGhost(sku: string | null): void;
  applyViewParam(param: ViewParam): void;
  setCameraLabel(preset: CameraPreset, pose: Pose): void;
  currentView(): { preset: CameraPreset; pose: Pose };
  destroy(): void;
}

export interface ViewerOptions {
  catalog: Catalog;
  withControls: boolean;
  onViewSettled?: (preset: CameraPreset, pose: Pose) => void;
}

interface SlotNode {
  sku: string;
  node: THREE.Object3D;
}

const SLOT_ORDER: SlotName[] = ['wing', 'mast', 'propulsion', 'battery', 'controller'];

export function createViewer(options: ViewerOptions): ViewerHandle {
  const { catalog } = options;
  const region = el('div', {
    class: 'viewer-region',
    role: 'region',
    'aria-label': 'Board viewer',
    tabindex: '0',
    'data-ready': 'false',
    'data-renderer': 'webgl',
    'data-parts': '',
    'data-colours': '',
    'data-mast-m': '0.000',
    'data-spares': '0',
    'data-finish': '',
    'data-battery-fill': '1',
    'data-ghost': '',
    'data-swap': '',
    'data-preset': 'three-quarter',
    'data-camera': '2.179,1.137,2.179',
    'data-target': '0.000,-0.300,0.000',
    'data-camera-yaw': '45.0',
    'data-camera-pitch': '25.0',
    'data-camera-zoom': '1.00',
    'data-fov': '35',
  });

  const viewButtons = new Map<string, HTMLButtonElement>();
  const controls = el('div', { class: 'camera-views', role: 'group', 'aria-label': 'Camera views' });
  const shell = el('div', { class: 'viewer-shell' }, options.withControls ? [controls, region] : [region]);

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    renderer = null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.1, 100);
  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d2d4, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(2.5, 4, 3);
  scene.add(key);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 36),
    new THREE.MeshBasicMaterial({ color: 0x9aa4a7, transparent: true, opacity: 0.22 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.05;
  scene.add(shadow);

  let pose: Pose = { ...PRESET_POSES['three-quarter'] };
  let preset: CameraPreset = 'three-quarter';
  let currentBuild: Build | null = null;
  let ghostSku: string | null = null;
  let ghostNode: THREE.Object3D | null = null;
  let hiddenForGhost: THREE.Object3D | null = null;
  const slotNodes = new Map<SlotName, SlotNode>();
  let boardNode: THREE.Object3D | null = null;
  let spareNodes: THREE.Object3D[] = [];
  let animationFrame = 0;
  const fallback = renderer === null;

  if (renderer) {
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    region.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
  } else {
    region.setAttribute('data-renderer', 'fallback');
    if (options.withControls) controls.hidden = true;
  }

  const fallbackPanel = el('div', { class: 'viewer-fallback' });
  if (fallback) region.appendChild(fallbackPanel);

  function componentOf(sku: string) {
    return catalog.components.find((part) => part.sku === sku);
  }

  function boardOf(sku: string) {
    return catalog.boards.find((board) => board.sku === sku);
  }

  function cameraPosition(from: Pose): THREE.Vector3 {
    const yaw = (from.yaw * Math.PI) / 180;
    const pitch = (from.pitch * Math.PI) / 180;
    return new THREE.Vector3(
      TARGET.x + from.distance * Math.sin(yaw) * Math.cos(pitch),
      TARGET.y + from.distance * Math.sin(pitch),
      TARGET.z + from.distance * Math.cos(yaw) * Math.cos(pitch),
    );
  }

  function writeCameraAttributes(): void {
    const position = cameraPosition(pose);
    region.setAttribute('data-preset', preset);
    region.setAttribute('data-camera', `${fixed(position.x, 3)},${fixed(position.y, 3)},${fixed(position.z, 3)}`);
    region.setAttribute('data-camera-yaw', fixed(normaliseYaw(pose.yaw), 1));
    region.setAttribute('data-camera-pitch', fixed(pose.pitch, 1));
    region.setAttribute('data-camera-zoom', fixed(BASE_DISTANCE / pose.distance, 2));
  }

  function render(): void {
    if (!renderer) return;
    const width = region.clientWidth || 640;
    const height = region.clientHeight || 400;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.copy(cameraPosition(pose));
    camera.lookAt(TARGET);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function invalidate(): void {
    writeCameraAttributes();
    render();
  }

  function clampPose(next: Pose): Pose {
    return {
      yaw: normaliseYaw(next.yaw),
      pitch: Math.min(MAX_PITCH, Math.max(MIN_PITCH, next.pitch)),
      distance: Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, next.distance)),
    };
  }

  function settle(): void {
    writeCameraAttributes();
    options.onViewSettled?.(preset, pose);
  }

  function glideTo(next: Pose, nextPreset: CameraPreset, durationMs: number): void {
    const target = clampPose(next);
    if (animationFrame) cancelAnimationFrame(animationFrame);
    preset = nextPreset;
    if (reducedMotion() || durationMs === 0) {
      pose = target;
      invalidate();
      settle();
      return;
    }
    const start = { ...pose };
    let delta = target.yaw - start.yaw;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    const began = performance.now();
    const step = (stamp: number): void => {
      const ratio = Math.min(1, (stamp - began) / durationMs);
      const eased = ratio < 0.5 ? 2 * ratio * ratio : 1 - (-2 * ratio + 2) ** 2 / 2;
      pose = {
        yaw: normaliseYaw(start.yaw + delta * eased),
        pitch: start.pitch + (target.pitch - start.pitch) * eased,
        distance: start.distance + (target.distance - start.distance) * eased,
      };
      invalidate();
      if (ratio < 1) animationFrame = requestAnimationFrame(step);
      else {
        animationFrame = 0;
        pose = target;
        invalidate();
        settle();
      }
    };
    animationFrame = requestAnimationFrame(step);
  }

  function nudge(change: Partial<Pose>): void {
    glideTo(
      {
        yaw: pose.yaw + (change.yaw ?? 0),
        pitch: pose.pitch + (change.pitch ?? 0),
        distance: pose.distance + (change.distance ?? 0),
      },
      'custom',
      200,
    );
  }

  function updatePresetButtons(): void {
    for (const [name, node] of viewButtons) node.setAttribute('aria-pressed', String(preset === name));
  }

  if (options.withControls && renderer) {
    for (const spec of PRESET_BUTTONS) {
      const node = el('button', { type: 'button', 'aria-pressed': String(preset === spec.preset) }, spec.label);
      node.addEventListener('click', () => {
        glideTo(PRESET_POSES[spec.preset], spec.preset, 600);
        updatePresetButtons();
      });
      viewButtons.set(spec.preset, node);
      controls.appendChild(node);
    }
    const reset = el('button', { type: 'button' }, 'Reset view');
    reset.addEventListener('click', () => {
      glideTo(PRESET_POSES['three-quarter'], 'three-quarter', 600);
      updatePresetButtons();
    });
    controls.appendChild(reset);
  }

  region.addEventListener('keydown', (event) => {
    const handled: Record<string, () => void> = {
      ArrowLeft: () => nudge({ yaw: -15 }),
      ArrowRight: () => nudge({ yaw: 15 }),
      ArrowUp: () => nudge({ pitch: 10 }),
      ArrowDown: () => nudge({ pitch: -10 }),
      '+': () => nudge({ distance: -0.4 }),
      '=': () => nudge({ distance: -0.4 }),
      '-': () => nudge({ distance: 0.4 }),
      Home: () => {
        glideTo(PRESET_POSES['three-quarter'], 'three-quarter', 600);
        updatePresetButtons();
      },
    };
    const action = handled[event.key];
    if (!action) return;
    event.preventDefault();
    action();
    updatePresetButtons();
  });

  let dragging = false;
  let lastPointer = { x: 0, y: 0 };
  region.addEventListener('pointerdown', (event) => {
    if (fallback) return;
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    region.setPointerCapture(event.pointerId);
  });
  region.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    preset = 'custom';
    pose = clampPose({ yaw: pose.yaw + dx * 0.4, pitch: pose.pitch + dy * 0.3, distance: pose.distance });
    invalidate();
    updatePresetButtons();
  });
  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    settle();
  };
  region.addEventListener('pointerup', endDrag);
  region.addEventListener('pointercancel', endDrag);
  region.addEventListener(
    'wheel',
    (event) => {
      if (fallback) return;
      event.preventDefault();
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      preset = 'custom';
      pose = clampPose({ ...pose, distance: pose.distance + Math.sign(event.deltaY) * 0.3 });
      invalidate();
      updatePresetButtons();
      settle();
    },
    { passive: false },
  );

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(region);

  function placeSlotNode(slot: SlotName, node: THREE.Object3D, build: Build): void {
    const mast = componentOf(build.slots.mast.sku);
    const mastM = mast?.mast_m ? Number(mast.mast_m) : 0.711;
    if (slot === 'mast') node.position.set(0, -0.06, 0);
    else if (slot === 'wing') node.position.set(0.05, -0.06 - mastM, 0);
    else if (slot === 'propulsion') node.position.set(-0.12, -0.06 - mastM * 0.62, 0);
    else if (slot === 'battery') node.position.set(-0.18, 0.095, 0);
    else node.position.set(0.12, 0.1, 0.52);
  }

  function buildSlotNode(slot: SlotName, sku: string, build: Build): THREE.Object3D {
    const part = componentOf(sku);
    const colour = part?.colour ?? 'light grey';
    const mast = componentOf(build.slots.mast.sku);
    const mastM = mast?.mast_m ? Number(mast.mast_m) : 0.711;
    if (slot === 'wing') return wingShape(sku, colour);
    if (slot === 'mast') return mastShape(sku, colour, part?.mast_m ? Number(part.mast_m) : mastM);
    if (slot === 'propulsion') return propulsionShape(sku, colour);
    if (slot === 'battery') {
      const node = batteryShape(sku, colour);
      setChargeBars(node, build.battery_bars);
      return node;
    }
    return controllerShape(sku, colour);
  }

  function swapSlot(slot: SlotName, sku: string, build: Build, animate: boolean): void {
    const existing = slotNodes.get(slot);
    const node = buildSlotNode(slot, sku, build);
    placeSlotNode(slot, node, build);
    root.add(node);
    slotNodes.set(slot, { sku, node });

    if (!existing || !animate || reducedMotion()) {
      if (existing) root.remove(existing.node);
      invalidate();
      return;
    }

    region.setAttribute('data-swap', `${existing.sku} to ${sku}`);
    const oldStart = performance.now();
    const oldBase = existing.node.position.y;
    const newBase = node.position.y;
    node.position.y = newBase + 0.35;
    setOpacity(node, 0);

    const tick = (stamp: number): void => {
      const elapsed = stamp - oldStart;
      const outRatio = Math.min(1, elapsed / 250);
      const outEased = outRatio * outRatio;
      existing.node.position.y = oldBase - 0.35 * outEased;
      setOpacity(existing.node, 1 - outEased);
      const inElapsed = elapsed - 100;
      if (inElapsed >= 0) {
        const inRatio = Math.min(1, inElapsed / 350);
        const inEased = 1 - (1 - inRatio) ** 3;
        node.position.y = newBase + 0.35 * (1 - inEased);
        setOpacity(node, inEased);
      }
      render();
      if (elapsed < 450) requestAnimationFrame(tick);
      else {
        root.remove(existing.node);
        node.position.y = newBase;
        setOpacity(node, 1);
        region.setAttribute('data-swap', '');
        invalidate();
      }
    };
    requestAnimationFrame(tick);
  }

  function renderFallback(build: Build): void {
    const board = boardOf(build.board_sku);
    fallbackPanel.replaceChildren(
      el('p', { class: 'caption' }, 'Still drawing of your build'),
      el(
        'ul',
        { class: 'stack', style: 'list-style:none;padding:0;margin:0' },
        [
          el('li', {}, `Board: ${build.board_name} in ${board?.finish ?? ''}`),
          ...SLOT_ORDER.map((slot) => {
            const part = componentOf(build.slots[slot].sku);
            return el('li', {}, `${slot[0]!.toUpperCase()}${slot.slice(1)}: ${build.slots[slot].name} (${part?.colour ?? ''})`);
          }),
          el('li', {}, `Spare batteries: ${build.spares}`),
          el('li', {}, `Battery charge: ${build.battery_bars} of 4 bars`),
        ],
      ),
    );
  }

  function setBuild(build: Build, animateSwap: boolean): void {
    const previous = currentBuild;
    currentBuild = build;
    region.setAttribute('data-ready', 'false');

    const board = boardOf(build.board_sku);
    const mast = componentOf(build.slots.mast.sku);
    const mastM = mast?.mast_m ?? '0.711';

    if (!boardNode || previous?.board_sku !== build.board_sku) {
      if (boardNode) root.remove(boardNode);
      boardNode = new THREE.Group();
      boardNode.add(boardPackageShape(board?.finish ?? 'graphite', board?.size ?? "4'9"));
      boardNode.add(deckWindow());
      root.add(boardNode);
    }

    for (const slot of SLOT_ORDER) {
      const sku = build.slots[slot].sku;
      const existing = slotNodes.get(slot);
      if (!existing) {
        const node = buildSlotNode(slot, sku, build);
        placeSlotNode(slot, node, build);
        root.add(node);
        slotNodes.set(slot, { sku, node });
      } else if (existing.sku !== sku) {
        swapSlot(slot, sku, build, animateSwap);
      }
    }

    for (const slot of SLOT_ORDER) {
      const entry = slotNodes.get(slot);
      if (entry) placeSlotNode(slot, entry.node, build);
    }
    for (const node of spareNodes) root.remove(node);
    spareNodes = [];
    for (let i = 0; i < build.spares; i += 1) {
      const spare = buildSlotNode('battery', build.slots.battery.sku, build);
      spare.position.set(-0.05 + i * 0.12, -1.0, -0.62 - i * 0.3);
      root.add(spare);
      spareNodes.push(spare);
    }

    const colours = [
      board?.finish ?? '',
      ...SLOT_ORDER.map((slot) => componentOf(build.slots[slot].sku)?.colour ?? ''),
    ];
    region.setAttribute('data-parts', [build.board_sku, ...SLOT_ORDER.map((slot) => build.slots[slot].sku)].join(','));
    region.setAttribute('data-colours', colours.join(','));
    region.setAttribute('data-mast-m', mastM);
    region.setAttribute('data-spares', String(build.spares));
    region.setAttribute('data-finish', board?.finish ?? '');
    if (fallback) renderFallback(build);
    invalidate();
    region.setAttribute('data-ready', 'true');
  }

  /** The charge bar and data-battery-fill settle with the ride-time count. */
  function setBatteryFill(bars: number): void {
    region.setAttribute('data-battery-fill', String(bars));
    const battery = slotNodes.get('battery');
    if (battery) setChargeBars(battery.node, bars);
    for (const spare of spareNodes) setChargeBars(spare, bars);
    render();
  }

  /** Hovering a disabled part ghosts it in place of the current part of that slot. */
  function setGhost(sku: string | null): void {
    if (ghostSku === sku) return;
    ghostSku = sku;
    if (ghostNode) {
      root.remove(ghostNode);
      ghostNode = null;
    }
    if (hiddenForGhost) {
      hiddenForGhost.visible = true;
      hiddenForGhost = null;
    }
    region.setAttribute('data-ghost', sku ?? '');
    if (sku && currentBuild) {
      const part = componentOf(sku);
      if (part) {
        const existing = slotNodes.get(part.slot);
        if (existing) {
          existing.node.visible = false;
          hiddenForGhost = existing.node;
        }
        ghostNode = buildSlotNode(part.slot, sku, currentBuild);
        placeSlotNode(part.slot, ghostNode, currentBuild);
        setOpacity(ghostNode, 0.25);
        root.add(ghostNode);
      }
    }
    render();
  }

  function applyViewParam(param: ViewParam): void {
    if (param.preset) {
      preset = param.preset;
      pose = { ...PRESET_POSES[param.preset] };
    } else if (param.orbit) {
      preset = 'custom';
      pose = clampPose(param.orbit);
    } else {
      preset = 'three-quarter';
      pose = { ...PRESET_POSES['three-quarter'] };
    }
    updatePresetButtons();
    invalidate();
    options.onViewSettled?.(preset, pose);
  }

  writeCameraAttributes();
  render();

  return {
    region,
    shell,
    setBuild,
    setBatteryFill,
    setGhost,
    applyViewParam,
    setCameraLabel(nextPreset, nextPose) {
      preset = nextPreset;
      pose = nextPose;
      invalidate();
    },
    currentView: () => ({ preset, pose: { ...pose } }),
    destroy() {
      resizeObserver.disconnect();
      if (animationFrame) cancelAnimationFrame(animationFrame);
      renderer?.dispose();
    },
  };
}

export { cssOf };
