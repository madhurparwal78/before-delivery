import {
  Color,
  Group,
  Mesh,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Sprite,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { clockText } from '../../shared/clock';
import { isLiveState } from '../../shared/states';
import type { SeatView } from '../../shared/wire';
import { Avatar } from './avatars';
import { CameraRig, entryPose, overviewPose, seatPose, type Pose } from './camera';
import {
  BOARD_BRIGHTEN_MS,
  DIMMED_STRENGTH,
  MODEL_TURN_MS,
  RETURN_STAGGER_MS,
  RING_REFILL_MS,
  SPOTLIGHT_FADE_MS,
  cellCenter,
  tableSlot,
  type Room,
} from './geometry';
import { ModelStage } from './model';
import { Ring } from './rings';
import { buildRoom, type StaticRoom } from './room';
import type { SceneInput } from './types';

const DRAG_THRESHOLD_PX = 6;
const NAME_PIXELS = 22;
const SCENE_BACKGROUND = '#E9DFCB';

interface BuiltRoom {
  key: string;
  room: StaticRoom;
  shape: Room;
}

interface Slide {
  texture: Texture;
  aspect: number;
}

interface BreakoutClock {
  tableIds: Set<string>;
  remaining: number;
  receivedAt: number;
  total: number;
  warning: boolean;
}

/** Waits for one material's shader program to link; `state` is the renderer's record of the material. */
function awaitLink(state: unknown): void {
  if (typeof state !== 'object' || state === null || !('currentProgram' in state)) return;
  const program: unknown = state.currentProgram;
  if (typeof program !== 'object' || program === null || !('getUniforms' in program)) return;
  const getUniforms: unknown = program.getUniforms;
  if (typeof getUniforms === 'function') getUniforms.call(program);
}

/** Resolves on the next task, so the page handles messages and input in between. */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

const materialKey = (material: Material): string => `${material.uuid}:${material.version}`;

const roomKey = (input: SceneInput): string => {
  const { room, seats, tables } = input.snapshot;
  return JSON.stringify([room, seats.map((seat) => [seat.seatId, seat.row, seat.column]), tables]);
};

/** Draws the room with a WebGL renderer on the given context; `onSeatPick` is a tap or click on an empty seat. */
export async function createScene(
  canvas: HTMLCanvasElement,
  context: WebGLRenderingContext | WebGL2RenderingContext,
  options: { onSeatPick: (seatId: string) => void },
) {
  const renderer = new WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  scene.background = new Color(SCENE_BACKGROUND);
  const rig = new CameraRig();
  const stage = new ModelStage();
  const raycaster = new Raycaster();
  const slides = new Map<string, Slide>();
  const avatars = new Map<string, Avatar>();
  const rings = new Map<string, Ring>();
  const avatarLayer = new Group();
  const ringLayer = new Group();
  scene.add(avatarLayer, ringLayer, stage.pivot);
  canvas.style.touchAction = 'none';

  let current: SceneInput | null = null;
  let built: BuiltRoom | null = null;
  let breakout: BreakoutClock | null = null;
  let boardFileId: string | null = null;
  let viewerKey = '';
  let reduced = false;
  let frameId = 0;
  let labelTimer = 0;
  let lastTick = performance.now();
  let disposed = false;
  let turning = false;
  let warming = false;
  const warmed = new Set<string>();
  const seatOfPart = new Map<Object3D, string>();

  const loadSlide = (fileId: string, onReady: () => void): void => {
    if (slides.has(fileId)) return;
    new TextureLoader().load(
      `/api/files/${fileId}`,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        const { width, height } = texture.image;
        slides.set(fileId, { texture, aspect: width > 0 && height > 0 ? width / height : 1 });
        onReady();
      },
      undefined,
      () => undefined,
    );
  };

  const showBoardSlide = (): void => {
    if (!built) return;
    const slide = boardFileId ? slides.get(boardFileId) : undefined;
    built.room.board.showSlide(slide?.texture ?? null, slide?.aspect ?? 1);
  };

  const rebuildRoom = (input: SceneInput): void => {
    const key = roomKey(input);
    if (built?.key === key) return;
    if (built) {
      scene.remove(built.room.group);
      disposeTree(built.room.group);
    }
    const { room, seats, tables } = input.snapshot;
    const next = buildRoom(room, seats, tables);
    scene.add(next.group);
    seatOfPart.clear();
    for (const node of next.seats.values()) for (const part of node.parts) seatOfPart.set(part, node.seatId);
    built = { key, room: next, shape: room };
    stage.pivot.position.set(next.plinth.x, next.plinthTop, next.plinth.z);
    showBoardSlide();
  };

  const viewerPose = (input: SceneInput, aspect: number): { key: string; pose: Pose } => {
    const own = input.snapshot.seats.find((seat) => seat.learnerId !== null && seat.learnerId === input.snapshot.you.learnerId);
    if (own && built) {
      const position = cellCenter(built.shape, own.column, own.row);
      return { key: `seat:${own.seatId}`, pose: seatPose(built.shape, position, built.room.board.centreX) };
    }
    return { key: 'overview', pose: overviewPose(input.snapshot.room, aspect) };
  };

  const aspectOf = (): number => (canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.4);

  const destinationOf = (placed: BuiltRoom, input: SceneInput, seat: SeatView): Vector3 => {
    const tableNode = seat.breakoutTable ? placed.room.tables.get(seat.breakoutTable) : undefined;
    const members = input.snapshot.breakout?.tables.find((table) => table.tableId === seat.breakoutTable)?.learnerIds ?? [];
    if (tableNode && seat.learnerId) {
      return tableSlot(tableNode.centre, Math.max(0, members.indexOf(seat.learnerId)), members.length);
    }
    return cellCenter(placed.shape, seat.column, seat.row);
  };

  const applyAvatars = (input: SceneInput, previous: SceneInput | null, now: number): void => {
    if (!built) return;
    const { shape } = built;
    const present = new Set<string>();
    const priorOrder = previous?.snapshot.breakout?.tables.map((table) => table.tableId) ?? [];
    const direct = input.event === 'snapshot' || reduced || previous === null;
    for (const seat of input.snapshot.seats) {
      if (!seat.learnerId || !seat.displayName) continue;
      present.add(seat.learnerId);
      const destination = destinationOf(built, input, seat);
      let avatar = avatars.get(seat.learnerId);
      if (!avatar) {
        avatar = new Avatar(seat.learnerId, seat.displayName);
        avatars.set(seat.learnerId, avatar);
        avatarLayer.add(avatar.group);
        if (direct) {
          avatar.placeAt(destination);
        } else {
          avatar.placeAt(new Vector3(shape.columns / 2 - 0.2, 0, shape.rows / 2 + 0.9));
          avatar.walkTo(destination, now);
        }
        avatar.setHand(seat.hand === 'raised', now, false);
      } else {
        if ((seat.hand === 'raised') !== (avatar.handGoal === 1)) avatar.setHand(seat.hand === 'raised', now, !direct);
        if (!avatar.destination.equals(destination)) {
          if (direct) avatar.placeAt(destination);
          else {
            const returning = input.event === 'breakout-over' && avatar.breakoutTable !== null;
            const delay = returning ? Math.max(0, priorOrder.indexOf(avatar.breakoutTable ?? '')) * RETURN_STAGGER_MS : 0;
            avatar.walkTo(destination, now, delay);
          }
        }
      }
      avatar.breakoutTable = seat.breakoutTable;
    }
    for (const [learnerId, avatar] of avatars) {
      if (present.has(learnerId)) continue;
      avatarLayer.remove(avatar.group);
      disposeTree(avatar.group);
      avatars.delete(learnerId);
    }
  };

  const applyBreakout = (input: SceneInput, previous: SceneInput | null, now: number): void => {
    const view = input.snapshot.breakout;
    breakout = view ? { tableIds: new Set(view.tables.map((table) => table.tableId)), remaining: view.remainingSeconds, receivedAt: input.receivedAt, total: Math.max(1, view.totalSeconds), warning: view.warning } : null;
    for (const [tableId, ring] of rings) {
      if (view?.tables.some((table) => table.tableId === tableId)) continue;
      ringLayer.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      ring.mesh.material.dispose();
      rings.delete(tableId);
    }
    if (!view || !built || reduced) return;
    const extended = input.event === 'breakouts-extended' || (previous?.snapshot.breakout?.totalSeconds ?? view.totalSeconds) !== view.totalSeconds;
    for (const table of view.tables) {
      const node = built.room.tables.get(table.tableId);
      if (!node) continue;
      let ring = rings.get(table.tableId);
      if (!ring) {
        ring = new Ring(node.centre);
        rings.set(table.tableId, ring);
        ringLayer.add(ring.mesh);
      } else if (extended) {
        ring.startRefill(now, RING_REFILL_MS);
      }
    }
  };

  const applyLights = (input: SceneInput, now: number): void => {
    if (!built) return;
    const spotlit = input.snapshot.spotlight;
    for (const seat of input.snapshot.seats) {
      const node = built.room.seats.get(seat.seatId);
      const goal = spotlit !== null && seat.learnerId === spotlit ? 1 : 0;
      if (node && node.glow.goal !== goal) node.glow.retarget(goal, now, reduced ? 0 : SPOTLIGHT_FADE_MS);
    }
    const strength = input.snapshot.breakout ? DIMMED_STRENGTH : 1;
    if (built.room.board.strength.goal !== strength) {
      built.room.board.strength.retarget(strength, now, reduced || input.event === 'snapshot' ? 0 : BOARD_BRIGHTEN_MS);
    }
  };

  const countdown = (now: number): number => (breakout ? breakout.remaining - (now - breakout.receivedAt) / 1000 : 0);

  const refreshTableLabels = (now: number): void => {
    if (!built) return;
    for (const [tableId, node] of built.room.tables) {
      if (reduced && breakout?.tableIds.has(tableId)) {
        const seconds = Math.max(0, breakout.remaining - Math.floor((now - breakout.receivedAt) / 1000));
        node.label.setText(`${tableId} ${clockText(seconds)}`);
      } else {
        node.label.setText(tableId);
      }
    }
  };

  /** Moves every transition and the model to `now`; true while the scene must keep drawing frames. */
  const advance = (now: number): boolean => {
    if (!built) return false;
    const elapsed = Math.min(now - lastTick, 250);
    lastTick = now;
    let busy = rig.step(now);
    for (const avatar of avatars.values()) busy = avatar.step(now) || busy;
    for (const node of built.room.seats.values()) {
      busy = node.glow.step(now) || busy;
      node.applyGlow();
    }
    busy = built.room.board.strength.step(now) || busy;
    built.room.board.applyStrength();
    if (turning) {
      stage.pivot.rotation.y += (elapsed / MODEL_TURN_MS) * Math.PI * 2;
      busy = true;
    }
    if (breakout && !reduced) {
      const fullness = Math.max(0, countdown(now)) / breakout.total;
      for (const ring of rings.values()) {
        busy = ring.refill.step(now) || busy;
        ring.draw(fullness, breakout.warning);
      }
      busy = true;
    }
    return busy;
  };

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    rig.setAspect(width / height);
  };

  const coldParts = (): Array<Mesh | Sprite> => {
    const parts: Array<Mesh | Sprite> = [];
    const seen = new Set<string>();
    scene.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof Sprite)) return;
      const material: Material | Material[] = object.material;
      const key = Array.isArray(material) ? material.map(materialKey).join() : materialKey(material);
      if (warmed.has(key) || seen.has(key)) return;
      seen.add(key);
      parts.push(object);
    });
    return parts;
  };

  /**
   * Links the shaders of new materials one per task before a frame uses them. A software renderer can take a large
   * fraction of a second per link; one link at a time keeps the page answering messages and keys meanwhile.
   */
  const warmUp = async (): Promise<void> => {
    warming = true;
    for (let parts = coldParts(); parts.length > 0 && !disposed; parts = coldParts()) {
      for (const part of parts) {
        renderer.compile(part, rig.camera, scene);
        const materials: Material[] = Array.isArray(part.material) ? part.material : [part.material];
        for (const material of materials) awaitLink(renderer.properties.get(material));
        warmed.add(materials.map(materialKey).join());
        await nextTask();
        if (disposed) return;
      }
    }
    warming = false;
    refresh();
  };

  const draw = (): void => {
    if (!built || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    if (warming) return;
    if (coldParts().length > 0) {
      void warmUp();
      return;
    }
    rig.apply();
    const worldPerPixel = (2 * Math.tan((rig.camera.fov * Math.PI) / 360)) / canvas.clientHeight;
    const eye = rig.camera.position;
    for (const avatar of avatars.values()) {
      const point = avatar.group.localToWorld(avatar.label.sprite.position.clone());
      avatar.label.fit(point.distanceTo(eye), worldPerPixel, NAME_PIXELS);
    }
    for (const node of built.room.tables.values()) {
      node.label.fit(node.label.sprite.position.distanceTo(eye), worldPerPixel, NAME_PIXELS - 6);
    }
    renderer.render(scene, rig.camera);
  };

  const tick = (): void => {
    frameId = 0;
    const busy = advance(performance.now());
    draw();
    if (busy && !disposed) frameId = requestAnimationFrame(tick);
  };

  /** One synchronous frame now, then keep going on animation frames while something moves. */
  const refresh = (): void => {
    if (disposed) return;
    const busy = advance(performance.now());
    draw();
    if (busy && frameId === 0) frameId = requestAnimationFrame(tick);
  };

  /** Reduced motion has no rings: table labels step once per whole second while breakouts run. */
  const armLabelClock = (): void => {
    window.clearTimeout(labelTimer);
    labelTimer = 0;
    if (!reduced || !breakout || disposed) return;
    const start = breakout.receivedAt;
    const wait = 1000 - ((performance.now() - start) % 1000);
    labelTimer = window.setTimeout(() => {
      refreshTableLabels(performance.now());
      draw();
      armLabelClock();
    }, wait);
  };

  const update = (input: SceneInput): void => {
    if (disposed) return;
    const previous = current;
    current = input;
    reduced = input.reduced;
    const now = performance.now();
    rebuildRoom(input);
    if (!built) return;
    resize();
    turning = !reduced && isLiveState(input.snapshot.state);
    applyBreakout(input, previous, now);
    applyAvatars(input, previous, now);
    applyLights(input, now);
    refreshTableLabels(now);
    armLabelClock();
    const fileId = input.snapshot.slide.fileId;
    if (fileId !== boardFileId) {
      boardFileId = fileId;
      if (fileId) loadSlide(fileId, () => { showBoardSlide(); refresh(); });
      showBoardSlide();
    }
    stage.show(input.snapshot.modelFileId, refresh);
    const { key, pose } = viewerPose(input, aspectOf());
    if (key !== viewerKey) {
      const first = viewerKey === '';
      viewerKey = key;
      rig.moveTo(pose, now, !reduced, first ? entryPose(pose) : undefined);
    }
    refresh();
  };

  const resizer = new ResizeObserver(() => {
    resize();
    if (current && built) {
      const { pose } = viewerPose(current, aspectOf());
      rig.moveTo(pose, performance.now(), false);
    }
    refresh();
  });
  resizer.observe(canvas);

  let drag: { id: number; x: number; y: number; moved: number } | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved <= DRAG_THRESHOLD_PX) return;
    rig.orbit(-dx * 0.005, dy * 0.003);
    refresh();
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || drag.id !== event.pointerId) return;
    const tap = drag.moved <= DRAG_THRESHOLD_PX;
    drag = null;
    if (tap) pickSeat(event);
  };
  const onPointerCancel = (): void => {
    drag = null;
  };
  const pickSeat = (event: PointerEvent): void => {
    if (!current || !built) return;
    const box = canvas.getBoundingClientRect();
    const pointer = new Vector2(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, rig.camera);
    const hit = raycaster.intersectObjects([...seatOfPart.keys()], false)[0];
    const seatId = hit ? seatOfPart.get(hit.object) : undefined;
    const taken = current.snapshot.seats.some((seat) => seat.seatId === seatId && seat.learnerId !== null);
    if (seatId && !taken) options.onSeatPick(seatId);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  return {
    update,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(labelTimer);
      resizer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      disposeTree(scene);
      for (const slide of slides.values()) slide.texture.dispose();
      renderer.dispose();
    },
  };
}

function disposeMaterial(material: Material): void {
  if ('map' in material && material.map instanceof Texture) material.map.dispose();
  material.dispose();
}

function disposeTree(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Sprite) disposeMaterial(object.material);
    if (object instanceof Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) disposeMaterial(material);
    }
  });
}
