import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three';
import type { SessionSnapshot } from '../../shared/types.js';

const PAPER = 0xf7f3e9;
const FLOOR = 0xe4dac2;
const SLATE = 0x27463c;
const BRICK = 0xa33b2a;
const CELL = 1.2;
const RING_SEGMENTS = 36;

interface Avatar {
  body: Mesh;
  arm: Mesh;
  from: Vector3;
  to: Vector3;
  started: number;
  duration: number;
  raised: boolean;
  armAt: number;
}

export interface RoomScene {
  update: (
    snapshot: SessionSnapshot,
    options: { reduced: boolean; viewerSeat: string | null; teaching: boolean }
  ) => void;
  tickRings: (remaining: number | null) => void;
  dispose: () => void;
}

function tintFor(learnerId: string): number {
  let hash = 0;
  for (const character of learnerId) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return new Color().setHSL(hash / 360, 0.3, 0.56).getHex();
}

function textTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.fillStyle = 'rgba(247,243,233,0.88)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#16231d';
    context.font = '30px serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  return new CanvasTexture(canvas);
}

function label(text: string): Sprite {
  const sprite = new Sprite(new SpriteMaterial({ map: textTexture(text), transparent: true }));
  sprite.scale.set(0.95, 0.24, 1);
  return sprite;
}

export function createScene(canvas: HTMLCanvasElement): RoomScene | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

  const scene = new Scene();
  scene.background = new Color(PAPER);
  const camera = new PerspectiveCamera(52, 1.6, 0.1, 100);
  camera.position.set(0, 2.8, 7.2);
  scene.add(new AmbientLight(0xffffff, 1.9));
  const lamp = new DirectionalLight(0xfff0d8, 0.5);
  lamp.position.set(2, 6, 4);
  scene.add(lamp);

  const floor = new Mesh(new PlaneGeometry(40, 40), new MeshLambertMaterial({ color: FLOOR }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const wall = new Mesh(new PlaneGeometry(40, 9), new MeshLambertMaterial({ color: 0xf2ecdd }));
  wall.position.set(0, 4.5, -6.2);
  scene.add(wall);

  const board = new Mesh(new BoxGeometry(4 * CELL, 2.1, 0.16), new MeshLambertMaterial({ color: SLATE }));
  board.position.set(0, 1.95, -5.9);
  scene.add(board);
  const slideFace = new Mesh(
    new PlaneGeometry(4 * CELL - 0.3, 1.8),
    new MeshBasicMaterial({ color: SLATE, transparent: true })
  );
  slideFace.position.set(0, 1.95, -5.8);
  scene.add(slideFace);

  const plinth = new Mesh(new BoxGeometry(0.72, 0.72, 0.72), new MeshLambertMaterial({ color: 0xd8cdb4 }));
  plinth.position.set(3.6, 0.36, -5.2);
  scene.add(plinth);
  const model = new Mesh(new IcosahedronGeometry(0.44, 0), new MeshLambertMaterial({ color: SLATE, flatShading: true }));
  model.position.set(3.6, 1.18, -5.2);
  scene.add(model);

  const pool = new Mesh(
    new CircleGeometry(0.78, 28),
    new MeshBasicMaterial({ color: 0xffd79a, transparent: true, opacity: 0 })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  scene.add(pool);

  const seats = new Map<string, Mesh>();
  const tables = new Map<string, { top: Mesh; segments: Mesh[]; count: Sprite }>();
  const avatars = new Map<string, Avatar>();
  const labels = new Map<string, Sprite>();

  let size = { columns: 8, rows: 6 };
  let reduced = false;
  let orbit = 0;
  let lift = 0;
  let cameraTarget = camera.position.clone();
  let cameraFrom = camera.position.clone();
  let cameraStarted = 0;
  let cameraDuration = 0;
  let poolWanted = 0;
  let turning = false;
  let frame = 0;
  let slideFileId: string | null = null;
  let roundLength = 1;
  let urgent = false;

  const spot = (column: number, row: number): Vector3 =>
    new Vector3((column - (size.columns - 1) / 2) * CELL, 0, (row - size.rows / 2) * CELL + 0.6);

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const ease = (value: number): number => 1 - Math.pow(1 - value, 3);
  const centre = new Vector3(0, 1.5, -4.4);
  let cameraWanted = camera.position.clone();

  /** Dragging orbits the view around the room's centre, up to a third of a right angle. */
  const paint = (): void => {
    const offsetX = cameraTarget.x - centre.x;
    const offsetZ = cameraTarget.z - centre.z;
    const cos = Math.cos(orbit);
    const sin = Math.sin(orbit);
    camera.position.set(
      centre.x + offsetX * cos - offsetZ * sin,
      cameraTarget.y + lift,
      centre.z + offsetX * sin + offsetZ * cos
    );
    camera.lookAt(centre);
    renderer.render(scene, camera);
  };

  const step = (): void => {
    const now = performance.now();
    let busy = false;

    if (cameraDuration > 0) {
      const progress = Math.min(1, (now - cameraStarted) / cameraDuration);
      const eased = ease(progress);
      cameraTarget = cameraFrom.clone().lerp(cameraWanted, eased);
      if (progress >= 1) cameraDuration = 0;
      else busy = true;
    }
    for (const avatar of avatars.values()) {
      if (avatar.duration > 0) {
        const progress = Math.min(1, (now - avatar.started) / avatar.duration);
        avatar.body.position.lerpVectors(avatar.from, avatar.to, ease(progress));
        if (progress >= 1) avatar.duration = 0;
        else busy = true;
      }
      const wanted = avatar.raised ? 1 : 0;
      if (Math.abs(avatar.armAt - wanted) > 0.02) {
        const amount = reduced ? 1 : 0.18;
        avatar.armAt += Math.sign(wanted - avatar.armAt) * Math.min(amount, Math.abs(wanted - avatar.armAt));
        avatar.arm.rotation.z = -avatar.armAt * 2.2;
        busy = true;
      }
    }
    const poolMaterial = pool.material as MeshBasicMaterial;
    if (Math.abs(poolMaterial.opacity - poolWanted) > 0.02) {
      const amount = reduced ? 1 : 0.12;
      poolMaterial.opacity += Math.sign(poolWanted - poolMaterial.opacity) * Math.min(amount, Math.abs(poolWanted - poolMaterial.opacity));
      busy = true;
    }
    if (turning && !reduced) {
      model.rotation.y += 0.005;
      busy = true;
    }

    paint();
    frame = busy ? requestAnimationFrame(step) : 0;
  };

  const wake = (): void => {
    if (frame === 0) frame = requestAnimationFrame(step);
  };

  const drawRings = (fullness: number, remaining: number | null): void => {
    for (const table of tables.values()) {
      const shown = reduced ? 0 : Math.round(fullness * RING_SEGMENTS);
      table.segments.forEach((segment, index) => {
        segment.visible = remaining !== null && index < shown;
        (segment.material as MeshBasicMaterial).color.set(urgent ? BRICK : SLATE);
      });
      const show = reduced && remaining !== null;
      table.count.visible = show;
      if (show) {
        const material = table.count.material;
        material.map?.dispose();
        material.map = textTexture(`${remaining}s`);
        material.needsUpdate = true;
      }
    }
  };

  const loader = new TextureLoader();

  const update: RoomScene['update'] = (snapshot, options) => {
    reduced = options.reduced;
    size = {
      columns: Math.max(4, ...snapshot.seats.map((seat) => seat.column + 1), ...snapshot.tables.map((table) => table.column + 1)),
      rows: Math.max(3, ...snapshot.seats.map((seat) => seat.row + 1), ...snapshot.tables.map((table) => table.row + 1))
    };

    for (const seat of snapshot.seats) {
      let mesh = seats.get(seat.seatId);
      if (mesh === undefined) {
        mesh = new Mesh(new BoxGeometry(0.52, 0.46, 0.52), new MeshLambertMaterial({ color: 0xcfc3a6 }));
        seats.set(seat.seatId, mesh);
        scene.add(mesh);
      }
      const at = spot(seat.column, seat.row);
      mesh.position.set(at.x, 0.23, at.z);
    }

    for (const table of snapshot.tables) {
      let entry = tables.get(table.tableId);
      if (entry === undefined) {
        const top = new Mesh(new BoxGeometry(CELL * 0.92, 0.12, CELL * 0.72), new MeshLambertMaterial({ color: 0xc3b48e }));
        scene.add(top);
        const segments: Mesh[] = [];
        for (let index = 0; index < RING_SEGMENTS; index += 1) {
          const segment = new Mesh(
            new RingGeometry(0.64, 0.78, 1, 1, (index / RING_SEGMENTS) * Math.PI * 2, (Math.PI * 2) / RING_SEGMENTS),
            new MeshBasicMaterial({ color: SLATE, transparent: true, opacity: 0.9 })
          );
          segment.rotation.x = -Math.PI / 2;
          segment.visible = false;
          segments.push(segment);
          scene.add(segment);
        }
        const count = label('');
        count.visible = false;
        scene.add(count);
        entry = { top, segments, count };
        tables.set(table.tableId, entry);
      }
      const at = spot(table.column, table.row);
      entry.top.position.set(at.x, 0.62, at.z);
      for (const segment of entry.segments) segment.position.set(at.x, 0.03, at.z);
      entry.count.position.set(at.x, 1.25, at.z);
    }

    const seated = new Map(
      snapshot.seats.filter((seat) => seat.learnerId !== null).map((seat) => [seat.learnerId as string, seat])
    );
    for (const [learnerId, avatar] of avatars) {
      if (seated.has(learnerId)) continue;
      scene.remove(avatar.body);
      avatars.delete(learnerId);
      const sprite = labels.get(learnerId);
      if (sprite !== undefined) scene.remove(sprite);
      labels.delete(learnerId);
    }

    for (const [learnerId, seat] of seated) {
      const home = spot(seat.column, seat.row);
      const table = snapshot.tables.find((item) => item.tableId === seat.breakoutTable);
      const place =
        table === undefined
          ? new Vector3(home.x, 0.52, home.z + 0.42)
          : (() => {
              const at = spot(table.column, table.row);
              return new Vector3(at.x, 0.52, at.z + 0.9);
            })();
      let avatar = avatars.get(learnerId);
      if (avatar === undefined) {
        const tint = tintFor(learnerId);
        const body = new Mesh(new BoxGeometry(0.34, 0.62, 0.26), new MeshLambertMaterial({ color: tint }));
        body.position.copy(place);
        const head = new Mesh(new SphereGeometry(0.17, 14, 10), new MeshLambertMaterial({ color: tint }));
        head.position.set(0, 0.47, 0);
        body.add(head);
        const arm = new Mesh(new BoxGeometry(0.09, 0.44, 0.09), new MeshLambertMaterial({ color: tint }));
        arm.position.set(0.22, 0.1, 0);
        body.add(arm);
        const sprite = label(seat.displayName ?? '');
        sprite.position.set(0, 1.02, 0);
        body.add(sprite);
        labels.set(learnerId, sprite);
        scene.add(body);
        avatar = { body, arm, from: place.clone(), to: place.clone(), started: 0, duration: 0, raised: false, armAt: 0 };
        avatars.set(learnerId, avatar);
      }
      if (place.distanceTo(avatar.to) > 0.02) {
        avatar.from = avatar.body.position.clone();
        avatar.to = place;
        avatar.started = performance.now();
        avatar.duration = reduced ? 0 : 640;
        if (reduced) avatar.body.position.copy(place);
      }
      avatar.raised = seat.hand === 'raised';
    }

    const spotlit = snapshot.spotlight === null ? undefined : seated.get(snapshot.spotlight);
    if (spotlit === undefined) {
      poolWanted = 0;
    } else {
      const at = spot(spotlit.column, spotlit.row);
      pool.position.set(at.x, 0.02, at.z + 0.42);
      poolWanted = 0.5;
    }

    const own = snapshot.seats.find((seat) => seat.seatId === options.viewerSeat);
    const wanted =
      own === undefined
        ? options.teaching
          ? new Vector3(4.2, 3.6, 4.2)
          : new Vector3(0, 3.4, 6.4)
        : (() => {
            const at = spot(own.column, own.row);
            return new Vector3(at.x * 0.5, 2.5, at.z + 3.6);
          })();
    if (wanted.distanceTo(cameraWanted) > 0.05) {
      cameraFrom = cameraTarget.clone();
      cameraWanted = wanted;
      cameraDuration = reduced ? 0 : 650;
      cameraStarted = performance.now();
      if (reduced) cameraTarget = wanted.clone();
    }

    const material = slideFace.material as MeshBasicMaterial;
    material.opacity = snapshot.state === 'breakouts' ? 0.4 : 1;
    if (snapshot.slide.fileId !== slideFileId) {
      slideFileId = snapshot.slide.fileId;
      if (slideFileId === null) {
        material.map = null;
        material.color.set(SLATE);
        material.needsUpdate = true;
      } else {
        loader.load(
          `/api/files/${slideFileId}`,
          (texture: Texture) => {
            material.map = texture;
            material.color.set(0xffffff);
            material.needsUpdate = true;
            paint();
          },
          undefined,
          () => undefined
        );
      }
    }
    model.visible = snapshot.modelFileId !== null;
    turning = snapshot.state === 'live' || snapshot.state === 'breakouts';

    if (snapshot.breakout === null) {
      drawRings(0, null);
    } else {
      urgent = snapshot.breakout.warning;
      roundLength = Math.max(1, snapshot.breakout.lengthSeconds);
      drawRings(Math.min(1, snapshot.breakout.remainingSeconds / roundLength), snapshot.breakout.remainingSeconds);
    }

    resize();
    wake();
    paint();
  };

  const tickRings: RoomScene['tickRings'] = (remaining) => {
    if (remaining === null) return;
    drawRings(Math.max(0, Math.min(1, remaining / roundLength)), remaining);
    paint();
  };

  let dragging = false;
  let dragFrom = { x: 0, y: 0, orbit: 0, lift: 0 };
  const onDown = (event: PointerEvent): void => {
    dragging = true;
    dragFrom = { x: event.clientX, y: event.clientY, orbit, lift };
    canvas.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const limit = Math.PI / 6;
    orbit = Math.max(-limit, Math.min(limit, dragFrom.orbit + (event.clientX - dragFrom.x) * 0.004));
    lift = Math.max(-0.7, Math.min(1.1, dragFrom.lift - (event.clientY - dragFrom.y) * 0.004));
    paint();
  };
  const onUp = (): void => {
    dragging = false;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const onResize = (): void => {
    resize();
    paint();
  };
  window.addEventListener('resize', onResize);

  resize();
  paint();

  return {
    update,
    tickRings,
    dispose: () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      renderer.dispose();
    }
  };
}
