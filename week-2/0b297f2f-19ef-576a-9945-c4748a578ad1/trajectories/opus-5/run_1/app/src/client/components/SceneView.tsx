import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { noWebglNotice } from '../../shared/copy';
import type { LuxStatus, Placement, Wall } from '../../shared/types';
import type { ViewParam } from '../state/store';
import {
  compassOf,
  facingYaw,
  luxTint,
  normaliseYaw,
  roomSize,
  workPosition,
  type Compass,
  type RoomSize,
} from './geometry';

const PLASTER = 0xf5f1ea;
const INK = 0x1a1816;
const STONE = 0xc4bcb0;
const ACCENT = 0xc25b20;

const EYE_HEIGHT_CM = 145;
const PLAN_HEIGHT_CM = 1800;
const EYE_DISTANCE_M = 5;
const DROP_MS = 700;
const HANG_LINE_MS = 200;
const LUX_MS = 500;
const SETTLE_MS = 250;

interface AnimationState {
  heightCm: number;
  yawDeg: number;
  hangLine: number;
  lux: number;
  grain: number;
}

type AnimationProperty = keyof AnimationState;

interface Tween {
  property: AnimationProperty;
  from: number;
  to: number;
  startMs: number;
  durationMs: number;
  shape: 'ease' | 'bump';
}

interface ThreeState {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  walls: { wall: Wall; compass: Compass; mesh: Mesh<BoxGeometry, MeshStandardMaterial> }[];
  hangLines: Map<Compass, Mesh<BoxGeometry, MeshBasicMaterial>>;
  works: Map<string, Group>;
}

interface MarkerRect {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

/** The zoom that fits the whole room into the plan view at the current aspect ratio. */
function planFitZoom(camera: PerspectiveCamera, room: RoomSize): number {
  const visibleHeight = 2 * Math.tan(((camera.fov * Math.PI) / 180) / 2) * (PLAN_HEIGHT_CM / 100);
  const needDepth = room.depthMm / 1000 + 2;
  const needWidth = room.widthMm / 1000 + 2;
  return Math.max(
    0.6,
    Math.min(visibleHeight / needDepth, (visibleHeight * camera.aspect) / needWidth),
  );
}

function viewNameOf(view: ViewParam): 'plan' | 'wall' | 'light' {
  if (view === 'wall') return 'wall';
  if (view === 'plan') return 'plan';
  return 'light';
}

function isEyeView(view: ViewParam): boolean {
  return view === 'wall' || view === 'light-eye';
}

function isLightView(view: ViewParam): boolean {
  return view === 'light' || view === 'light-eye';
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function yawDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function overlayFor(view: ViewParam, status: LuxStatus): string {
  if (!isLightView(view)) return 'none';
  return status === 'over' ? 'red-hatch' : 'ink-outline';
}

export interface SceneViewProps {
  walls: Wall[];
  placements: Placement[];
  selectedId: string | null;
  viewParam: ViewParam;
  reducedMotion: boolean;
  onSelect: (placementId: string) => void;
  onDragTo: (placementId: string, offsetMm: number) => void;
  onDragEnd: (placementId: string) => void;
  onViewSettled: (view: 'plan' | 'wall' | 'light') => void;
}

export function SceneView(props: SceneViewProps): ReactElement {
  const { walls, placements, selectedId, viewParam, reducedMotion } = props;
  const regionRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const grainRef = useRef<HTMLDivElement | null>(null);
  const markerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const threeRef = useRef<ThreeState | null>(null);
  const [flat, setFlat] = useState(false);
  const [atEyeHeight, setAtEyeHeight] = useState(isEyeView(viewParam));
  const [settling, setSettling] = useState<string[]>([]);
  const [facedCompass, setFacedCompass] = useState<Compass>('north');

  const animation = useRef<AnimationState>({
    heightCm: isEyeView(viewParam) ? EYE_HEIGHT_CM : PLAN_HEIGHT_CM,
    yawDeg: 0,
    hangLine: isEyeView(viewParam) ? 1 : 0,
    lux: isLightView(viewParam) ? 1 : 0,
    grain: 0,
  });
  const hangLineVisible = useRef<boolean>(isEyeView(viewParam));
  const transitioning = useRef(false);
  const eyePosition = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const zoom = useRef(1);
  const frame = useRef<number | null>(null);
  const tweens = useRef<Tween[]>([]);
  const onSettle = useRef<(() => void) | null>(null);
  const previousView = useRef<ViewParam>(viewParam);
  const knownPlacements = useRef<Set<string>>(new Set());
  const settleStarts = useRef<Map<string, number>>(new Map());
  const awaitingFirstData = useRef(true);
  const placementsRef = useRef<Placement[]>(placements);
  const facedRef = useRef<Compass>('north');
  const viewRef = useRef<ViewParam>(viewParam);

  const callbacks = useRef(props);
  callbacks.current = props;

  const room = useMemo(() => roomSize(walls), [walls]);
  const wallById = useMemo(() => new Map(walls.map((wall) => [wall.id, wall])), [walls]);

  placementsRef.current = placements;
  viewRef.current = viewParam;

  const selectedPlacement = placements.find((placement) => placement.id === selectedId) ?? null;
  const openingCutKey = awaitingFirstData.current
    ? `${placements.length}:${selectedId ?? ''}`
    : 'settled';

  /* ------------------------------------------------------------- geometry */

  const facedWallFor = useCallback((): Compass => {
    const placement = placementsRef.current.find((item) => item.id === selectedId);
    const wall = placement ? wallById.get(placement.wallId) : undefined;
    return wall ? compassOf(wall) : 'north';
  }, [selectedId, wallById]);

  const computeEyePosition = useCallback(
    (compass: Compass): { x: number; z: number } => {
      const halfWidth = room.widthMm / 2000;
      const halfDepth = room.depthMm / 2000;
      const placement = placementsRef.current.find((item) => item.id === selectedId);
      const along = placement ? placement.offsetMm / 1000 : 0;
      switch (compass) {
        case 'north':
          return {
            x: placement ? Math.min(halfWidth - 1, Math.max(-halfWidth + 1, -halfWidth + along)) : 0,
            z: Math.min(halfDepth - 0.4, -halfDepth + EYE_DISTANCE_M),
          };
        case 'south':
          return {
            x: placement ? Math.min(halfWidth - 1, Math.max(-halfWidth + 1, halfWidth - along)) : 0,
            z: Math.max(-halfDepth + 0.4, halfDepth - EYE_DISTANCE_M),
          };
        case 'east':
          return {
            x: Math.max(-halfWidth + 0.4, halfWidth - EYE_DISTANCE_M),
            z: placement ? Math.min(halfDepth - 1, Math.max(-halfDepth + 1, -halfDepth + along)) : 0,
          };
        case 'west':
          return {
            x: Math.min(halfWidth - 0.4, -halfWidth + EYE_DISTANCE_M),
            z: placement ? Math.min(halfDepth - 1, Math.max(-halfDepth + 1, halfDepth - along)) : 0,
          };
      }
    },
    [room, selectedId],
  );

  /* ---------------------------------------------------------- three scene */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true });
    } catch {
      setFlat(true);
      return undefined;
    }
    const context = renderer.getContext();
    if (!context) {
      setFlat(true);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new Scene();
    scene.background = new Color(PLASTER);
    const camera = new PerspectiveCamera(50, 1, 0.1, 200);
    camera.rotation.order = 'YXZ';
    scene.add(new AmbientLight(0xffffff, 1.5));
    const directional = new DirectionalLight(0xffffff, 0.6);
    directional.position.set(2, 8, 4);
    scene.add(directional);

    const floor = new Mesh(
      new PlaneGeometry(room.widthMm / 1000, room.depthMm / 1000),
      new MeshStandardMaterial({ color: 0xe8e2d7 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const halfWidth = room.widthMm / 2000;
    const halfDepth = room.depthMm / 2000;
    const wallMeshes: ThreeState['walls'] = [];
    const hangLines = new Map<Compass, Mesh<BoxGeometry, MeshBasicMaterial>>();
    for (const wall of walls) {
      const compass = compassOf(wall);
      const length = wall.lengthMm / 1000;
      const height = wall.heightMm / 1000;
      const horizontal = compass === 'north' || compass === 'south';
      const geometry = horizontal
        ? new BoxGeometry(length, height, 0.1)
        : new BoxGeometry(0.1, height, length);
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: STONE }));
      mesh.position.set(
        horizontal ? 0 : compass === 'east' ? halfWidth + 0.05 : -halfWidth - 0.05,
        height / 2,
        horizontal ? (compass === 'south' ? halfDepth + 0.05 : -halfDepth - 0.05) : 0,
      );
      scene.add(mesh);
      wallMeshes.push({ wall, compass, mesh });

      const lineGeometry = horizontal
        ? new BoxGeometry(length, 0.012, 0.02)
        : new BoxGeometry(0.02, 0.012, length);
      const line = new Mesh(
        lineGeometry,
        new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 }),
      );
      line.position.set(
        horizontal ? 0 : compass === 'east' ? halfWidth - 0.02 : -halfWidth + 0.02,
        1.45,
        horizontal ? (compass === 'south' ? halfDepth - 0.02 : -halfDepth + 0.02) : 0,
      );
      line.visible = false;
      scene.add(line);
      hangLines.set(compass, line);
    }

    threeRef.current = { renderer, scene, camera, walls: wallMeshes, hangLines, works: new Map() };
    return () => {
      renderer.dispose();
      threeRef.current = null;
    };
  }, [room, walls]);

  /* ------------------------------------------------------------- drawing */

  const layoutMarkers = useCallback(() => {
    const region = regionRef.current;
    if (!region) return;
    const bounds = region.getBoundingClientRect();
    const state = threeRef.current;
    const faced = facedRef.current;
    const view = viewRef.current;
    for (const placement of placementsRef.current) {
      const marker = markerRefs.current.get(placement.id);
      if (!marker) continue;
      const wall = wallById.get(placement.wallId);
      if (!wall) continue;
      let rect: MarkerRect | null = null;
      if (state && !flat) {
        const group = state.works.get(placement.id);
        if (group) {
          const widthM = placement.widthMm / 2000;
          const heightM = placement.heightMm / 2000;
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const [dx, dy] of [
            [-widthM, -heightM],
            [widthM, -heightM],
            [-widthM, heightM],
            [widthM, heightM],
          ] as [number, number][]) {
            const point = new Vector3(dx, dy, 0);
            point.applyEuler(group.rotation);
            point.add(group.position);
            point.project(state.camera);
            const x = ((point.x + 1) / 2) * bounds.width;
            const y = ((1 - point.y) / 2) * bounds.height;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
          rect = {
            left: minX,
            top: minY,
            width: Math.max(6, maxX - minX),
            height: Math.max(6, maxY - minY),
            visible: true,
          };
        }
      } else {
        rect = flatMarkerRect(placement, wall, view, faced, room, bounds);
      }
      if (!rect || !rect.visible) {
        marker.style.display = 'none';
        continue;
      }
      marker.style.display = 'block';
      marker.style.left = `${rect.left}px`;
      marker.style.top = `${rect.top}px`;
      marker.style.width = `${rect.width}px`;
      marker.style.height = `${rect.height}px`;
    }
  }, [flat, room, wallById]);

  const writeAttributes = useCallback(() => {
    const region = regionRef.current;
    if (!region) return;
    const state = animation.current;
    region.dataset['view'] = viewNameOf(viewRef.current);
    region.dataset['transitioning'] = transitioning.current ? 'true' : 'false';
    region.dataset['cameraHeightCm'] = String(Math.round(state.heightCm));
    region.dataset['cameraYawDeg'] = String(normaliseYaw(state.yawDeg));
    region.dataset['hangLine'] = hangLineVisible.current ? 'visible' : 'hidden';
  }, []);

  const applyScene = useCallback(() => {
    const state = threeRef.current;
    const animated = animation.current;
    const grain = grainRef.current;
    if (grain) grain.style.opacity = String(animated.grain);
    if (state) {
      const fall = (animated.heightCm - EYE_HEIGHT_CM) / (PLAN_HEIGHT_CM - EYE_HEIGHT_CM);
      const eye = eyePosition.current;
      state.camera.position.set(
        eye.x * (1 - fall),
        animated.heightCm / 100,
        eye.z * (1 - fall),
      );
      state.camera.rotation.set(
        (-Math.PI / 2) * fall,
        (-animated.yawDeg * Math.PI) / 180,
        0,
      );
      state.camera.zoom = (1 + (planFitZoom(state.camera, room) - 1) * fall) * zoom.current;
      state.camera.updateProjectionMatrix();
      for (const entry of state.walls) {
        const tint = luxTint(entry.wall.plannedLux);
        const stone = new Color(STONE);
        const lux = new Color(tint[0], tint[1], tint[2]);
        entry.mesh.material.color.copy(stone).lerp(lux, animated.lux);
      }
      for (const [compass, line] of state.hangLines) {
        const show = compass === facedRef.current && animated.hangLine > 0;
        line.visible = show;
        line.material.opacity = animated.hangLine;
      }
      const now = performance.now();
      for (const [id, startedAt] of settleStarts.current) {
        const group = state.works.get(id);
        if (!group) {
          settleStarts.current.delete(id);
          continue;
        }
        const progress = Math.min(1, (now - startedAt) / SETTLE_MS);
        const restingY = Number(group.userData['restingY'] ?? group.position.y);
        group.position.y = restingY + 0.1 * (1 - easeOut(progress));
        if (progress >= 1) settleStarts.current.delete(id);
      }
      const bounds = regionRef.current?.getBoundingClientRect();
      if (bounds && bounds.width > 0) {
        state.renderer.setSize(bounds.width, bounds.height, false);
        state.camera.aspect = bounds.width / bounds.height;
        state.camera.updateProjectionMatrix();
      }
      state.renderer.render(state.scene, state.camera);
    }
    layoutMarkers();
    writeAttributes();
  }, [layoutMarkers, writeAttributes]);

  const applySceneRef = useRef<() => void>(() => undefined);
  applySceneRef.current = applyScene;
  const stepRef = useRef<() => void>(() => undefined);

  const requestRender = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      stepRef.current();
    });
  }, []);

  const step = useCallback(() => {
    const now = performance.now();
    let tweensRunning = false;
    for (const tween of tweens.current) {
      const t = Math.min(1, (now - tween.startMs) / tween.durationMs);
      const shaped = tween.shape === 'bump' ? Math.sin(Math.PI * t) : easeOut(t);
      animation.current[tween.property] = tween.from + (tween.to - tween.from) * shaped;
      if (t < 1) tweensRunning = true;
    }
    const finishedTweens = !tweensRunning && tweens.current.length > 0;
    if (finishedTweens) {
      tweens.current = [];
      const settle = onSettle.current;
      onSettle.current = null;
      applySceneRef.current();
      if (settle) settle();
      if (settleStarts.current.size === 0) return;
    }
    applySceneRef.current();
    if (tweensRunning || settleStarts.current.size > 0) {
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        stepRef.current();
      });
    }
  }, []);
  stepRef.current = step;

  const runTweens = useCallback(
    (list: Omit<Tween, 'startMs'>[], settle: () => void) => {
      const startMs = performance.now();
      tweens.current = list.map((tween) => ({ ...tween, startMs }));
      onSettle.current = settle;
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      stepRef.current();
    },
    [],
  );

  /* ----------------------------------------------------------- work mesh */

  useEffect(() => {
    const state = threeRef.current;
    if (state) {
      const seen = new Set<string>();
      for (const placement of placements) {
        const wall = wallById.get(placement.wallId);
        if (!wall) continue;
        seen.add(placement.id);
        const compass = compassOf(wall);
        const position = workPosition(
          compass,
          placement.offsetMm,
          placement.centreHeightMm,
          room,
        );
        let group = state.works.get(placement.id);
        if (!group) {
          group = new Group();
          const frameMesh = new Mesh(
            new BoxGeometry(1, 1, 0.015),
            new MeshStandardMaterial({ color: INK }),
          );
          const panel = new Mesh(
            new BoxGeometry(1, 1, 0.02),
            new MeshStandardMaterial({ color: PLASTER }),
          );
          panel.name = 'panel';
          frameMesh.name = 'frame';
          group.add(frameMesh);
          group.add(panel);
          state.scene.add(group);
          state.works.set(placement.id, group);
        }
        const widthM = placement.widthMm / 1000;
        const heightM = placement.heightMm / 1000;
        const frameMesh = group.getObjectByName('frame');
        const panel = group.getObjectByName('panel');
        if (frameMesh) frameMesh.scale.set(widthM + 0.05, heightM + 0.05, 1);
        if (panel) {
          panel.scale.set(widthM, heightM, 1);
          panel.position.z = 0.004;
        }
        const inset = 0.04;
        group.position.set(
          position.x + (compass === 'east' ? -inset : compass === 'west' ? inset : 0),
          position.y,
          position.z + (compass === 'north' ? inset : compass === 'south' ? -inset : 0),
        );
        group.userData['restingY'] = position.y;
        group.rotation.set(0, position.rotationY, 0);
      }
      for (const [id, group] of state.works) {
        if (!seen.has(id)) {
          state.scene.remove(group);
          state.works.delete(id);
        }
      }
    }
    const fresh = placements
      .map((placement) => placement.id)
      .filter((id) => !knownPlacements.current.has(id));
    for (const placement of placements) knownPlacements.current.add(placement.id);
    if (fresh.length > 0 && !reducedMotion && knownPlacements.current.size > fresh.length) {
      const startedAt = performance.now();
      for (const id of fresh) settleStarts.current.set(id, startedAt);
      setSettling((current) => [...current, ...fresh]);
      window.setTimeout(() => {
        setSettling((current) => current.filter((id) => !fresh.includes(id)));
      }, SETTLE_MS);
    }
    requestRender();
  }, [placements, reducedMotion, requestRender, room, wallById]);

  /* ---------------------------------------------------- view transitions */

  useEffect(() => {
    const from = previousView.current;
    previousView.current = viewParam;
    const compass = facedWallFor();
    const target: AnimationState = {
      heightCm: isEyeView(viewParam) ? EYE_HEIGHT_CM : PLAN_HEIGHT_CM,
      yawDeg: 0,
      hangLine: isEyeView(viewParam) ? 1 : 0,
      lux: isLightView(viewParam) ? 1 : 0,
      grain: 0,
    };
    if (viewParam === 'wall') target.yawDeg = facingYaw[compass];
    else if (viewParam === 'plan') target.yawDeg = 0;
    else if (viewParam === 'light-eye') {
      target.yawDeg =
        isEyeView(from) && from !== viewParam ? animation.current.yawDeg : facingYaw[compass];
    } else {
      target.yawDeg = isEyeView(from) ? 0 : animation.current.yawDeg;
    }

    const firstRun = from === viewParam;
    if (!firstRun || placements.length > 0) awaitingFirstData.current = false;
    // Light view entered from Wall keeps facing the wall the camera already faces.
    const keepsFacing = viewParam === 'light-eye' && isEyeView(from) && !firstRun;
    facedRef.current = keepsFacing ? facedRef.current : compass;
    setFacedCompass(facedRef.current);
    if (isEyeView(viewParam)) {
      eyePosition.current = computeEyePosition(facedRef.current);
    }

    const settle = (): void => {
      transitioning.current = false;
      hangLineVisible.current = target.hangLine === 1;
      animation.current = { ...target };
      setAtEyeHeight(isEyeView(viewParam));
      applySceneRef.current();
      if (!firstRun) callbacks.current.onViewSettled(viewNameOf(viewParam));
    };

    if (firstRun || reducedMotion) {
      tweens.current = [];
      animation.current = { ...target };
      transitioning.current = false;
      hangLineVisible.current = target.hangLine === 1;
      setAtEyeHeight(isEyeView(viewParam));
      applySceneRef.current();
      if (!firstRun) callbacks.current.onViewSettled(viewNameOf(viewParam));
      return;
    }

    const current = { ...animation.current };
    const list: Omit<Tween, 'startMs'>[] = [];
    const heightChanges = Math.round(current.heightCm) !== Math.round(target.heightCm);
    transitioning.current = true;
    if (current.hangLine === 1 && target.hangLine === 0) hangLineVisible.current = false;
    writeAttributes();

    if (heightChanges) {
      list.push({
        property: 'heightCm',
        from: current.heightCm,
        to: target.heightCm,
        durationMs: DROP_MS,
        shape: 'ease',
      });
      list.push({
        property: 'yawDeg',
        from: current.yawDeg,
        to: current.yawDeg + yawDelta(current.yawDeg, target.yawDeg),
        durationMs: DROP_MS,
        shape: 'ease',
      });
      list.push({
        property: 'grain',
        from: 0,
        to: 0.85,
        durationMs: DROP_MS,
        shape: 'bump',
      });
    } else if (current.yawDeg !== target.yawDeg) {
      list.push({
        property: 'yawDeg',
        from: current.yawDeg,
        to: current.yawDeg + yawDelta(current.yawDeg, target.yawDeg),
        durationMs: LUX_MS,
        shape: 'ease',
      });
    }
    if (current.lux !== target.lux) {
      list.push({
        property: 'lux',
        from: current.lux,
        to: target.lux,
        durationMs: LUX_MS,
        shape: 'ease',
      });
    }

    const finishHangLine = (): void => {
      if (target.hangLine === 1 && current.hangLine !== 1) {
        runTweens(
          [
            {
              property: 'hangLine',
              from: 0,
              to: 1,
              durationMs: HANG_LINE_MS,
              shape: 'ease',
            },
          ],
          settle,
        );
      } else {
        settle();
      }
    };

    if (current.hangLine === 1 && target.hangLine === 0) {
      runTweens(
        [{ property: 'hangLine', from: 1, to: 0, durationMs: HANG_LINE_MS, shape: 'ease' }],
        () => {
          if (list.length === 0) settle();
          else runTweens(list, finishHangLine);
        },
      );
    } else if (list.length === 0) {
      finishHangLine();
    } else {
      runTweens(list, finishHangLine);
    }
    // A view change starts a transition; the rest is read from refs. While the first
    // placements are still loading, the opening cut is re-applied as they arrive so that
    // it faces the selected work's wall.
  }, [viewParam, reducedMotion, openingCutKey]);

  /* ------------------------------------------------------------- resizing */

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return undefined;
    const observer = new ResizeObserver(() => requestRender());
    observer.observe(region);
    return () => observer.disconnect();
  }, [requestRender]);

  useEffect(() => {
    requestRender();
  }, [requestRender, selectedId, flat]);

  /* ------------------------------------------------------------ pointers */

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragState = useRef<{
    placementId: string;
    startOffsetMm: number;
    startX: number;
    startY: number;
    mmPerPixel: { x: number; y: number };
  } | null>(null);
  const orbitState = useRef<{ x: number; yaw: number; distance: number; zoom: number } | null>(
    null,
  );

  const alongWallScreenVector = useCallback(
    (placement: Placement): { x: number; y: number } => {
      const state = threeRef.current;
      const region = regionRef.current;
      const wall = wallById.get(placement.wallId);
      if (!wall || !region) return { x: 1, y: 0 };
      const bounds = region.getBoundingClientRect();
      const compass = compassOf(wall);
      const project = (offsetMm: number): { x: number; y: number } => {
        const position = workPosition(compass, offsetMm, placement.centreHeightMm, room);
        if (state && !flat) {
          const point = new Vector3(position.x, position.y, position.z);
          point.project(state.camera);
          return {
            x: ((point.x + 1) / 2) * bounds.width,
            y: ((1 - point.y) / 2) * bounds.height,
          };
        }
        const rect = flatMarkerRect(
          { ...placement, offsetMm },
          wall,
          viewRef.current,
          facedRef.current,
          room,
          bounds,
        );
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      const a = project(placement.offsetMm);
      const b = project(placement.offsetMm + 100);
      return { x: b.x - a.x, y: b.y - a.y };
    },
    [flat, room, wallById],
  );

  const onMarkerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, placement: Placement) => {
      event.stopPropagation();
      callbacks.current.onSelect(placement.id);
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (pointers.current.size > 0) return;
      const vector = alongWallScreenVector(placement);
      const magnitude = vector.x * vector.x + vector.y * vector.y;
      if (magnitude === 0) return;
      dragState.current = {
        placementId: placement.id,
        startOffsetMm: placement.offsetMm,
        startX: event.clientX,
        startY: event.clientY,
        mmPerPixel: { x: (vector.x / magnitude) * 100, y: (vector.y / magnitude) * 100 },
      };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [alongWallScreenVector],
  );

  const onMarkerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const deltaMm = dx * drag.mmPerPixel.x + dy * drag.mmPerPixel.y;
      const stepped = Math.round(deltaMm / 10) * 10;
      callbacks.current.onDragTo(drag.placementId, drag.startOffsetMm + stepped);
    },
    [],
  );

  const onMarkerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      dragState.current = null;
      if (!drag) return;
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
      callbacks.current.onDragEnd(drag.placementId);
    },
    [],
  );

  const yawLimits = useCallback((): { min: number; max: number } | null => {
    if (!isEyeView(viewRef.current)) return null;
    const centre = facingYaw[facedRef.current];
    return { min: centre - 30, max: centre + 30 };
  }, []);

  const applyYaw = useCallback(
    (yaw: number) => {
      const limits = yawLimits();
      const next = limits ? Math.min(limits.max, Math.max(limits.min, yaw)) : yaw;
      animation.current.yawDeg = next;
      applyScene();
    },
    [applyScene, yawLimits],
  );

  const onScenePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1 && event.pointerType === 'mouse') {
      orbitState.current = {
        x: event.clientX,
        yaw: animation.current.yawDeg,
        distance: 0,
        zoom: zoom.current,
      };
    }
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      if (first && second) {
        orbitState.current = {
          x: (first.x + second.x) / 2,
          yaw: animation.current.yawDeg,
          distance: Math.hypot(first.x - second.x, first.y - second.y),
          zoom: zoom.current,
        };
      }
    }
  }, []);

  const onScenePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const orbit = orbitState.current;
      if (!orbit) return;
      if (pointers.current.size === 2) {
        const [first, second] = [...pointers.current.values()];
        if (!first || !second) return;
        const midpoint = (first.x + second.x) / 2;
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        if (orbit.distance > 0 && Math.abs(distance - orbit.distance) > 20) {
          zoom.current = Math.min(2, Math.max(0.5, orbit.zoom * (distance / orbit.distance)));
        }
        applyYaw(orbit.yaw + (midpoint - orbit.x) * 0.3);
      } else if (event.pointerType === 'mouse') {
        applyYaw(orbit.yaw + (event.clientX - orbit.x) * 0.3);
      }
    },
    [applyYaw],
  );

  const onScenePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) orbitState.current = null;
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      zoom.current = Math.min(
        2,
        Math.max(0.5, zoom.current * (event.deltaY < 0 ? 1.1 : 1 / 1.1)),
      );
      applyScene();
    },
    [applyScene],
  );

  /* -------------------------------------------------------------- render */

  const facedWall = walls.find((wall) => compassOf(wall) === facedCompass) ?? walls[0];

  return (
    <section
      className="scene-region"
      aria-label="Gallery scene"
      ref={regionRef}
      data-view={viewNameOf(viewParam)}
      onPointerDown={onScenePointerDown}
      onPointerMove={onScenePointerMove}
      onPointerUp={onScenePointerUp}
      onPointerCancel={onScenePointerUp}
      onWheel={onWheel}
    >
      <canvas className="scene-canvas" ref={canvasRef} hidden={flat} />
      {flat && facedWall ? (
        <FlatDrawing
          walls={walls}
          placements={placements}
          view={viewParam}
          facedWall={facedWall}
          room={room}
        />
      ) : null}
      <div className="scene-grain" ref={grainRef} aria-hidden="true" />
      <p className="scene-readout">{atEyeHeight ? 'Eye height 145 cm' : 'Plan view'}</p>
      {flat ? <p className="scene-notice">{noWebglNotice}</p> : null}
      <div className="scene-markers">
        {placements.map((placement) => (
          <div
            key={placement.id}
            className={`work-marker${placement.id === selectedId ? ' is-selected' : ''}`}
            ref={(element) => {
              if (element) markerRefs.current.set(placement.id, element);
              else markerRefs.current.delete(placement.id);
            }}
            data-placement-id={placement.id}
            data-lux-status={placement.luxStatus}
            data-settling={settling.includes(placement.id) ? 'true' : 'false'}
            data-overlay={overlayFor(viewParam, placement.luxStatus)}
            onPointerDown={(event) => onMarkerPointerDown(event, placement)}
            onPointerMove={onMarkerPointerMove}
            onPointerUp={onMarkerPointerUp}
            onPointerCancel={onMarkerPointerUp}
          />
        ))}
      </div>
      {selectedPlacement ? (
        <p className="scene-selected-note">{selectedPlacement.objectTitle} selected</p>
      ) : null}
    </section>
  );
}

function flatMarkerRect(
  placement: Placement,
  wall: Wall,
  view: ViewParam,
  faced: Compass,
  room: { widthMm: number; depthMm: number; heightMm: number },
  bounds: { width: number; height: number },
): MarkerRect {
  const compass = compassOf(wall);
  if (view === 'plan') {
    const box = fitBox(room.widthMm, room.depthMm, bounds);
    const thickness = 160 * box.scale;
    if (compass === 'north' || compass === 'south') {
      const centre =
        compass === 'north' ? placement.offsetMm : room.widthMm - placement.offsetMm;
      return {
        left: box.left + (centre - placement.widthMm / 2) * box.scale,
        top:
          compass === 'north'
            ? box.top
            : box.top + room.depthMm * box.scale - thickness,
        width: placement.widthMm * box.scale,
        height: thickness,
        visible: true,
      };
    }
    const centre = compass === 'east' ? placement.offsetMm : room.depthMm - placement.offsetMm;
    return {
      left:
        compass === 'east' ? box.left + room.widthMm * box.scale - thickness : box.left,
      top: box.top + (centre - placement.widthMm / 2) * box.scale,
      width: thickness,
      height: placement.widthMm * box.scale,
      visible: true,
    };
  }
  if (compass !== faced) return { left: 0, top: 0, width: 0, height: 0, visible: false };
  const box = fitBox(wall.lengthMm, wall.heightMm, bounds);
  return {
    left: box.left + (placement.offsetMm - placement.widthMm / 2) * box.scale,
    top:
      box.top +
      (wall.heightMm - (placement.centreHeightMm + placement.heightMm / 2)) * box.scale,
    width: placement.widthMm * box.scale,
    height: placement.heightMm * box.scale,
    visible: true,
  };
}

function fitBox(
  contentWidth: number,
  contentHeight: number,
  bounds: { width: number; height: number },
): { left: number; top: number; scale: number } {
  const padding = 24;
  const scale = Math.min(
    (bounds.width - padding * 2) / contentWidth,
    (bounds.height - padding * 2) / contentHeight,
  );
  return {
    left: (bounds.width - contentWidth * scale) / 2,
    top: (bounds.height - contentHeight * scale) / 2,
    scale,
  };
}

interface FlatDrawingProps {
  walls: Wall[];
  placements: Placement[];
  view: ViewParam;
  facedWall: Wall;
  room: { widthMm: number; depthMm: number; heightMm: number };
}

function FlatDrawing({
  walls,
  placements,
  view,
  facedWall,
  room,
}: FlatDrawingProps): ReactElement {
  if (view === 'plan') {
    const thickness = 160;
    return (
      <svg
        className="scene-flat"
        viewBox={`0 0 ${room.widthMm} ${room.depthMm}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <rect
          x={0}
          y={0}
          width={room.widthMm}
          height={room.depthMm}
          fill="none"
          stroke="#1a1816"
          strokeWidth={40}
        />
        {walls.map((wall) => {
          const compass = compassOf(wall);
          const horizontal = compass === 'north' || compass === 'south';
          return (
            <rect
              key={wall.id}
              x={compass === 'east' ? room.widthMm - thickness : 0}
              y={compass === 'south' ? room.depthMm - thickness : 0}
              width={horizontal ? room.widthMm : thickness}
              height={horizontal ? thickness : room.depthMm}
              fill="#c4bcb0"
            />
          );
        })}
        {placements.map((placement) => {
          const wall = walls.find((item) => item.id === placement.wallId);
          if (!wall) return null;
          const compass = compassOf(wall);
          const horizontal = compass === 'north' || compass === 'south';
          const centre = horizontal
            ? compass === 'north'
              ? placement.offsetMm
              : room.widthMm - placement.offsetMm
            : compass === 'east'
              ? placement.offsetMm
              : room.depthMm - placement.offsetMm;
          return (
            <rect
              key={placement.id}
              x={
                horizontal
                  ? centre - placement.widthMm / 2
                  : compass === 'east'
                    ? room.widthMm - thickness
                    : 0
              }
              y={
                horizontal
                  ? compass === 'south'
                    ? room.depthMm - thickness
                    : 0
                  : centre - placement.widthMm / 2
              }
              width={horizontal ? placement.widthMm : thickness}
              height={horizontal ? thickness : placement.widthMm}
              fill="none"
              stroke="#1a1816"
              strokeWidth={30}
            />
          );
        })}
      </svg>
    );
  }
  return (
    <svg
      className="scene-flat"
      viewBox={`0 0 ${facedWall.lengthMm} ${facedWall.heightMm}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect
        x={0}
        y={0}
        width={facedWall.lengthMm}
        height={facedWall.heightMm}
        fill="#c4bcb0"
        stroke="#1a1816"
        strokeWidth={20}
      />
      <line
        x1={0}
        x2={facedWall.lengthMm}
        y1={facedWall.heightMm - 1450}
        y2={facedWall.heightMm - 1450}
        stroke="#c25b20"
        strokeWidth={14}
      />
      {placements
        .filter((placement) => placement.wallId === facedWall.id)
        .map((placement) => (
          <rect
            key={placement.id}
            x={placement.offsetMm - placement.widthMm / 2}
            y={facedWall.heightMm - (placement.centreHeightMm + placement.heightMm / 2)}
            width={placement.widthMm}
            height={placement.heightMm}
            fill="#f5f1ea"
            stroke="#1a1816"
            strokeWidth={20}
          />
        ))}
    </svg>
  );
}
