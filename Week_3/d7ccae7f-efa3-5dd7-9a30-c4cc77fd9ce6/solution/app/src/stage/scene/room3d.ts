import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { PILLAR_GAP_MS, PILLAR_SETTLE_MS, PODIUM_DOLLY_MS } from "../../../shared/schemas";

const GROUND = 0x0b1a14;
const CHALK = 0xede9e1;
const BRASS = 0xd2a24c;
const SLATE = 0x5b786b;
const SPRING_RATE = 11;
const SPRING_INERTIA = 0.35;
const FLAT_HEIGHT = 0.02;
const PILLAR_RENDER_ORDER = 10;
const WIDE_POSE = { position: new Vector3(0, 6.4, 22), target: new Vector3(0, 2.6, 0) };
// A portrait stage looks further down, so the floor the pillars stand on reaches up behind the stacked column.
const TALL_WIDE_POSE = { position: WIDE_POSE.position, target: new Vector3(0, 0.8, 0) };
const PODIUM_POSE = { position: new Vector3(0, 3.4, 14.5), target: new Vector3(0, 1.5, 0) };
const PLINTH_HEIGHTS = [2.2, 1.6, 1.2];
const LABEL_ROOM_PX = 72;

type RevealSpec = {
  counts: number[];
  correct: number[];
  plate: number[];
  list: HTMLElement;
  // Screen y (viewport pixels) the count labels must stay below: the bottom of the question band.
  ceiling: number;
};
type RevealCallbacks = { onValues: (values: number[]) => void; onSettled: () => void };

// Critically damped spring: quick at first, eases into place, never passes 1.
function spring(seconds: number): number {
  const x = SPRING_RATE * seconds;
  return 1 - Math.exp(-x) * (1 + SPRING_INERTIA * x);
}
const easeOutCubic = (k: number): number => 1 - (1 - k) ** 3;

function material(color: number, roughness = 0.9, emissive = 0x000000, emissiveIntensity = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0.05, emissive, emissiveIntensity });
}

function box(width: number, height: number, depth: number, color: number, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material(color));
  mesh.position.set(x, y, z);
  return mesh;
}

function chalkboardTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 448;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = "#0a1511";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(237,233,225,0.5)";
  context.lineCap = "round";
  context.lineWidth = 5;
  for (let group = 0; group < 6; group++) {
    const x = 90 + group * 150;
    for (let stroke = 0; stroke < 4; stroke++) {
      context.beginPath();
      context.moveTo(x + stroke * 18, 120);
      context.lineTo(x + stroke * 18 + 2, 210);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(x - 12, 200);
    context.lineTo(x + 76, 128);
    context.stroke();
  }
  context.lineWidth = 3;
  context.strokeStyle = "rgba(237,233,225,0.22)";
  for (const y of [290, 340, 390]) {
    context.beginPath();
    context.moveTo(80, y);
    context.lineTo(944, y + 4);
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function buildRoom(scene: Scene): void {
  scene.add(new HemisphereLight(0x8fb2a1, GROUND, 0.16), new AmbientLight(0x6f8d7f, 0.1));
  const key = new DirectionalLight(0xffffff, 0.42);
  key.position.set(5, 12, 16);
  const fill = new DirectionalLight(0xdfece5, 0.2);
  fill.position.set(-6, 5, 18);
  scene.add(key, fill);

  const floor = new Mesh(new PlaneGeometry(60, 40), material(0x07150f, 0.95));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -4;
  scene.add(floor);
  for (let lane = -3; lane <= 3; lane++) scene.add(box(0.06, 0.01, 30, 0x1b4437, lane * 4.5, 0.01, -2));

  scene.add(new Mesh(new PlaneGeometry(60, 18), material(0x0c211a, 1)).translateY(9).translateZ(-9));
  scene.add(box(60, 3.4, 0.2, 0x123027, 0, 1.7, -8.9), box(60, 0.14, 0.3, 0x1f4a3b, 0, 3.45, -8.8));
  for (let panel = -7; panel <= 7; panel++) scene.add(box(0.08, 3.2, 0.1, 0x0f2a21, panel * 4, 1.7, -8.75));

  const board = new Group();
  board.add(box(9.6, 4.2, 0.2, 0x16332a, 0, 0, 0));
  const face = new Mesh(new PlaneGeometry(8.9, 3.6), new MeshBasicMaterial({ map: chalkboardTexture() }));
  face.position.z = 0.11;
  board.add(face);
  board.position.set(0, 6.1, -8.7);
  scene.add(board);

  for (const x of [-7, 0, 7]) {
    const cord = new Mesh(new CylinderGeometry(0.02, 0.02, 3.4, 6), material(0x1f4a3b));
    cord.position.set(x, 8.9, -3);
    const shade = new Mesh(new ConeGeometry(0.85, 0.7, 28, 1, true), material(0x1b4538, 0.7));
    shade.material.side = DoubleSide;
    shade.position.set(x, 6.9, -3);
    const bulb = new Mesh(new SphereGeometry(0.22, 16, 12), new MeshBasicMaterial({ color: CHALK }));
    bulb.position.set(x, 6.65, -3);
    const lamp = new PointLight(0xf3efe6, 42, 24, 1.5);
    lamp.position.set(x, 6.4, -3);
    scene.add(cord, shade, bulb, lamp);
  }

  scene.add(box(5, 2.3, 1.8, 0x12302a, -7.4, 1.15, -7.4), box(5.4, 0.16, 2.1, 0x1f4a3c, -7.4, 2.35, -7.4));
  for (const x of [-9.2, -7.6, -6, -4.4]) {
    const seat = new Mesh(new CylinderGeometry(0.38, 0.38, 0.14, 20), material(0x1f4a3c));
    seat.position.set(x, 1.75, -5.4);
    const post = new Mesh(new CylinderGeometry(0.07, 0.07, 1.7, 8), material(0x143b30));
    post.position.set(x, 0.85, -5.4);
    scene.add(seat, post);
  }
  for (const [x, z] of [
    [7.2, -5.6],
    [10.2, -6.6],
  ] as const) {
    const top = new Mesh(new CylinderGeometry(1.2, 1.2, 0.1, 28), material(0x1b4538));
    top.position.set(x, 1.6, z);
    const stem = new Mesh(new CylinderGeometry(0.1, 0.1, 1.6, 10), material(0x143b30));
    stem.position.set(x, 0.8, z);
    const base = new Mesh(new CylinderGeometry(0.6, 0.7, 0.08, 20), material(0x143b30));
    base.position.set(x, 0.04, z);
    scene.add(top, stem, base);
  }
}

// Intersects the ray through a screen point (in pixels, relative to the canvas) with the floor plane y = 0.
function floorPoint(camera: PerspectiveCamera, width: number, height: number, x: number, y: number): Vector3 {
  camera.updateMatrixWorld();
  const ndc = new Vector3((x / width) * 2 - 1, -(y / height) * 2 + 1, 0.5).unproject(camera);
  const direction = ndc.sub(camera.position).normalize();
  return camera.position.clone().addScaledVector(direction, -camera.position.y / direction.y);
}

function projectToScreen(camera: PerspectiveCamera, width: number, height: number, point: Vector3): { x: number; y: number } {
  camera.updateMatrixWorld();
  const projected = point.clone().project(camera);
  return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
}

type Pillar = { mesh: Mesh; height: number; label: HTMLElement; top: Vector3 };

export class StageRoom {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(26, 1, 0.1, 160);
  private readonly pillars = new Group();
  private readonly plate: Mesh;
  private readonly plinths = new Group();
  private readonly chalk = material(CHALK, 0.8);
  private readonly brass = new MeshLambertMaterial({ color: BRASS });
  private readonly slate = material(SLATE, 0.9);
  private rows: Pillar[] = [];
  private reveal: { startedAt: number; spec: RevealSpec; callbacks: RevealCallbacks; shown: number[]; settled: boolean } | null = null;
  private podium: { startedAt: number; onArrived: () => void; arrived: boolean } | null = null;
  private frame = 0;
  private disposed = false;
  private width = 1;
  private height = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly labels: HTMLElement,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(new Color(GROUND));
    this.scene.background = new Color(GROUND);
    buildRoom(this.scene);
    this.plate = new Mesh(new BoxGeometry(1, 0.04, 2.4), material(0x8fa89b, 0.7, 0x8fa89b, 0.22));
    this.plate.visible = false;
    this.pillars.renderOrder = PILLAR_RENDER_ORDER;
    this.plinths.visible = false;
    this.scene.add(this.pillars, this.plate, this.plinths);
    this.resize();
  }

  private widePose(): typeof WIDE_POSE {
    return this.width < this.height ? TALL_WIDE_POSE : WIDE_POSE;
  }

  resize(): void {
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (!this.podium) this.placeCamera(this.widePose().position, this.widePose().target);
    this.invalidate();
  }

  private placeCamera(position: Vector3, target: Vector3): void {
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  private invalidate(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.frame = 0;
    if (this.disposed) return;
    const now = performance.now();
    let animating = false;
    if (this.reveal) animating = this.stepReveal(now) || animating;
    if (this.podium) animating = this.stepPodium(now) || animating;
    this.renderer.render(this.scene, this.camera);
    this.positionLabels();
    if (animating) this.invalidate();
  }

  showReveal(spec: RevealSpec, callbacks: RevealCallbacks, instant: boolean): void {
    this.clearReveal();
    const box0 = this.canvas.getBoundingClientRect();
    const items = [...spec.list.querySelectorAll("li")].map((item) => item.getBoundingClientRect());
    const listTop = spec.list.getBoundingClientRect().top - box0.top;
    this.camera.updateMatrixWorld();
    const base = items.map((rect) => floorPoint(this.camera, this.width, this.height, rect.left + rect.width / 2 - box0.left, listTop - 10));
    const lift = projectToScreen(this.camera, this.width, this.height, (base[0] ?? new Vector3()).clone().setY(1));
    const lower = projectToScreen(this.camera, this.width, this.height, (base[0] ?? new Vector3()).clone());
    const pixelsPerUnit = Math.max(1, lower.y - lift.y);
    const headroom = listTop - 10 - (spec.ceiling - box0.top) - LABEL_ROOM_PX;
    const fullHeight = Math.max(LABEL_ROOM_PX, Math.min(this.height * 0.34, headroom)) / pixelsPerUnit;
    const widest = Math.max(...spec.counts, 0);
    const spacing = base.length > 1 ? Math.abs((base[1] as Vector3).x - (base[0] as Vector3).x) : 2;
    const width = Math.min(spacing * 0.56, 2.2);

    this.rows = spec.counts.map((count, index) => {
      const mesh = new Mesh(new BoxGeometry(width, 1, width), this.chalk);
      mesh.geometry.translate(0, 0.5, 0);
      mesh.renderOrder = PILLAR_RENDER_ORDER;
      const at = (base[index] as Vector3).clone();
      at.z -= width / 2;
      mesh.position.copy(at);
      mesh.scale.y = FLAT_HEIGHT;
      this.pillars.add(mesh);
      const label = document.createElement("span");
      label.className = "pillar-count display";
      label.textContent = "0";
      this.labels.append(label);
      return { mesh, height: widest === 0 ? FLAT_HEIGHT : (count / widest) * fullHeight, label, top: at.clone() };
    });
    const plateBins = spec.plate;
    if (plateBins.length > 0) {
      const first = base[Math.min(...plateBins)] as Vector3;
      const last = base[Math.max(...plateBins)] as Vector3;
      this.plate.scale.x = Math.abs(last.x - first.x) + spacing;
      // The plate lies under the pillar footprints and stops at their front edge, clear of the label row.
      this.plate.position.set((first.x + last.x) / 2, 0.03, first.z - 1.2);
    }
    this.reveal = { startedAt: performance.now() - (instant ? PILLAR_SETTLE_MS + PILLAR_GAP_MS * spec.counts.length : 0), spec, callbacks, shown: spec.counts.map(() => 0), settled: false };
    if (instant) this.drawNow();
    else this.invalidate();
  }

  // A resumed or replayed scene is drawn in its end state at once, without waiting for an animation frame.
  private drawNow(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.tick();
  }

  private stepReveal(now: number): boolean {
    const reveal = this.reveal;
    if (!reveal) return false;
    const elapsed = now - reveal.startedAt;
    const values = reveal.spec.counts.map((count, index) => {
      const row = this.rows[index] as Pillar;
      const local = elapsed - index * PILLAR_GAP_MS;
      const progress = local <= 0 ? 0 : local >= PILLAR_SETTLE_MS ? 1 : spring(local / 1000);
      row.mesh.scale.y = Math.max(FLAT_HEIGHT, row.height * progress);
      row.top.y = row.mesh.scale.y;
      return progress >= 1 ? count : Math.round(count * progress);
    });
    if (values.some((value, index) => value !== reveal.shown[index])) {
      reveal.shown = values;
      reveal.callbacks.onValues(values);
      this.rows.forEach((row, index) => (row.label.textContent = String(values[index])));
    }
    const done = elapsed >= (reveal.spec.counts.length - 1) * PILLAR_GAP_MS + PILLAR_SETTLE_MS;
    if (done && !reveal.settled) {
      reveal.settled = true;
      this.rows.forEach((row, index) => {
        row.mesh.material = reveal.spec.correct.includes(index) ? this.brass : this.slate;
      });
      this.plate.visible = reveal.spec.plate.length > 0;
      reveal.callbacks.onSettled();
    }
    return !done;
  }

  clearReveal(): void {
    this.reveal = null;
    for (const row of this.rows) {
      this.pillars.remove(row.mesh);
      row.mesh.geometry.dispose();
      row.label.remove();
    }
    this.rows = [];
    this.plate.visible = false;
    this.invalidate();
  }

  showPodium(list: HTMLElement, ranks: number, onArrived: () => void, instant: boolean): void {
    this.clearPodium();
    const box0 = this.canvas.getBoundingClientRect();
    const items = [...list.querySelectorAll("li")].map((item) => item.getBoundingClientRect());
    const finalCamera = this.camera.clone();
    finalCamera.position.copy(PODIUM_POSE.position);
    finalCamera.lookAt(PODIUM_POSE.target);
    const listTop = list.getBoundingClientRect().top - box0.top;
    this.plinths.clear();
    const places = Array.from({ length: ranks }, (_, place) => {
      const rect = items[place];
      return rect ? floorPoint(finalCamera, this.width, this.height, rect.left + rect.width / 2 - box0.left, listTop - 6) : new Vector3((place - 1) * 3, 0, 0);
    });
    const gap = places.length > 1 ? Math.min(...places.slice(1).map((at) => Math.abs(at.x - (places[0] as Vector3).x))) : 3;
    const plinthWidth = Math.min(3, gap * 0.78);
    for (let place = 0; place < ranks; place++) {
      const at = (places[place] as Vector3).clone();
      at.z -= 1.2;
      const plinth = new Mesh(new BoxGeometry(plinthWidth, PLINTH_HEIGHTS[place] ?? 1, 2.4), this.brass);
      plinth.position.set(at.x, (PLINTH_HEIGHTS[place] ?? 1) / 2, at.z);
      this.plinths.add(plinth);
    }
    this.plinths.visible = true;
    this.podium = { startedAt: performance.now() - (instant ? PODIUM_DOLLY_MS : 0), onArrived, arrived: false };
    if (instant) this.drawNow();
    else this.invalidate();
  }

  private stepPodium(now: number): boolean {
    const podium = this.podium;
    if (!podium) return false;
    const progress = Math.min(1, (now - podium.startedAt) / PODIUM_DOLLY_MS);
    const eased = easeOutCubic(progress);
    const wide = this.widePose();
    this.camera.position.lerpVectors(wide.position, PODIUM_POSE.position, eased);
    const target = new Vector3().lerpVectors(wide.target, PODIUM_POSE.target, eased);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    if (progress >= 1 && !podium.arrived) {
      podium.arrived = true;
      podium.onArrived();
    }
    return progress < 1;
  }

  clearPodium(): void {
    this.podium = null;
    this.plinths.visible = false;
    this.placeCamera(this.widePose().position, this.widePose().target);
    this.invalidate();
  }

  private positionLabels(): void {
    if (!this.reveal) return;
    this.rows.forEach((row) => {
      const screen = projectToScreen(this.camera, this.width, this.height, row.top);
      row.label.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -150%)`;
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clearReveal();
    this.scene.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    this.renderer.dispose();
  }
}
