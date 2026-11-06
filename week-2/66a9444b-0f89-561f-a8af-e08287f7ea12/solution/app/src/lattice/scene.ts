// The Programme Lattice in WebGL (Three.js). It renders only while something moves: the opening camera move,
// pointer tilt, scroll flight, selection raise, agenda light and clash seams. Idle, it draws nothing new.
import {
  BoxGeometry, CanvasTexture, Color, DirectionalLight, EdgesGeometry, Group, HemisphereLight, LineBasicMaterial, LineSegments,
  Mesh, MeshLambertMaterial, PerspectiveCamera, Raycaster, Scene, Sprite, SpriteMaterial, Vector2, Vector3, WebGLRenderer,
  type Object3D,
} from "three";
import { colourOf, type LatticeModel } from "./model.ts";

const INTRO_MS = 1400;
const QUICK_MS = 160;
const SETTLE_MS = 320;
const SECTION_MS = 600;
const SCROLL_FLIGHT_PX = 900;
const YAW_MAX = 8;
const PITCH_MAX = 5;
const INK = new Color("#0E0E10");
const PAPER = new Color("#F4EDE1");
const LIME = new Color("#C8F031");
const VERMILION = new Color("#FF4A1F");

/** cubic-bezier(0.16, 1, 0.3, 1): the one easing feel, a fast start that settles softly. */
function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let lo = 0, hi = 1, u = t;
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2;
    const x = 3 * (1 - u) * (1 - u) * u * 0.16 + 3 * (1 - u) * u * u * 0.3 + u * u * u;
    if (x < t) lo = u; else hi = u;
  }
  return 3 * (1 - u) * (1 - u) * u * 1 + 3 * (1 - u) * u * u * 1 + u * u * u;
}

/** A springy settle for the selection raise: overshoots slightly, then rests. */
function spring(t: number): number {
  if (t >= 1) return 1;
  const c = 1.70158 * 1.2;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

type Tween = { from: number; to: number; start: number; duration: number; curve: (t: number) => number };

function tween(from: number, to: number, start: number, duration: number, curve = ease): Tween {
  return { from, to, start, duration, curve };
}

function valueAt(t: Tween, now: number): number {
  const p = t.duration <= 0 ? 1 : Math.min(1, (now - t.start) / t.duration);
  return p >= 1 ? t.to : t.from + (t.to - t.from) * t.curve(p);
}

const done = (t: Tween, now: number) => now - t.start >= t.duration;

type LatticeState = { day: string | null; venue: string | null; discipline: string | null; lit: ReadonlySet<string>; seams: readonly [string, string][] };

type Piece = { key: string; root: Object3D; materials: (MeshLambertMaterial | LineBasicMaterial | SpriteMaterial)[]; baseY: number; raise: Tween; fade: Tween; lift: number };
type BarPiece = Piece & { sessionId: string; base: Color; lit: Tween; material: MeshLambertMaterial | LineBasicMaterial; centre: Vector3 };
type SeamPiece = { key: string; mesh: Mesh; grow: Tween; ending: boolean };

function dayLabel(text: string): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#C8F031";
  ctx.font = "800 84px Anybody, 'Arial Narrow', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(text.toUpperCase(), 8, 64);
  const material = new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false });
  const sprite = new Sprite(material);
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

export class LatticeScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(38, 16 / 9, 0.1, 200);
  private readonly world = new Group();
  private readonly raycaster = new Raycaster();
  private pieces: Piece[] = [];
  private bars: BarPiece[] = [];
  private seams: SeamPiece[] = [];
  private pickable: Object3D[] = [];
  private introStart: number | null = null;
  private yaw = tween(0, 0, 0, 0);
  private pitch = tween(0, 0, 0, 0);
  private progress = 0;
  private frame = 0;
  private state: LatticeState = { day: null, venue: null, discipline: null, lit: new Set(), seams: [] };
  private model: LatticeModel | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, context: WebGLRenderingContext | WebGL2RenderingContext,
    private readonly figure: HTMLElement, private readonly onPick: (key: string) => void) {
    this.renderer = new WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(INK, 1);
    this.scene.add(this.world);
    this.scene.add(new HemisphereLight(0xf4ede1, 0x15151c, 1.1));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 12, 9);
    this.scene.add(sun);
    canvas.addEventListener("click", this.handleClick);
  }

  private now(): number {
    return performance.now();
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.request();
  }

  setModel(model: LatticeModel): void {
    this.model = model;
    for (const child of [...this.world.children]) this.world.remove(child);
    this.pieces = [];
    this.bars = [];
    this.seams = [];
    this.pickable = [];
    const now = this.now();
    const add = (key: string, root: Object3D, materials: Piece["materials"], lift: number): Piece => {
      const piece: Piece = { key, root, materials, baseY: root.position.y, raise: tween(0, 0, now, 0), fade: tween(1, 1, now, 0), lift };
      this.world.add(root);
      this.pieces.push(piece);
      return piece;
    };
    for (const slab of model.slabs) {
      const group = new Group();
      const plateMaterial = new MeshLambertMaterial({ color: new Color("#2A2A38"), transparent: true, depthWrite: false });
      plateMaterial.userData.base = 0.42;
      const plate = new Mesh(new BoxGeometry(slab.width + 1.4, slab.height + 0.8, 0.12), plateMaterial);
      plate.renderOrder = -1;
      plate.userData.key = slab.key;
      const edgeMaterial = new LineBasicMaterial({ color: LIME, transparent: true });
      const edges = new LineSegments(new EdgesGeometry(plate.geometry), edgeMaterial);
      const label = dayLabel(slab.label);
      label.position.set(-slab.width / 2 + 2.2, slab.height / 2 + 0.85, 0.1);
      group.add(plate, edges, label);
      group.position.set(0, 0, slab.z);
      this.pickable.push(plate);
      add(slab.key, group, [plateMaterial, edgeMaterial, label.material], 0.55);
    }
    const depth = (model.slabs.length - 1) * Math.abs(model.slabs[1]?.z ?? 0) + 3;
    for (const pillar of model.pillars) {
      const material = new MeshLambertMaterial({ color: PAPER, transparent: true });
      const rod = new Mesh(new BoxGeometry(0.16, 0.16, depth), material);
      rod.position.set(-model.slabs[0]!.width / 2 - 0.35, pillar.y, model.slabs[0] ? -depth / 2 + 1.5 : 0);
      rod.userData.key = pillar.key;
      const hit = new Mesh(new BoxGeometry(0.7, 0.6, depth), new MeshLambertMaterial({ visible: false }));
      hit.userData.key = pillar.key;
      rod.add(hit);
      hit.position.set(0, 0, 0);
      this.pickable.push(hit);
      add(pillar.key, rod, [material], 0.3);
    }
    for (const bar of model.bars) {
      const width = bar.x1 - bar.x0;
      const geometry = new BoxGeometry(width, 0.62, 0.5);
      const base = new Color(colourOf(bar.discipline));
      const material = bar.cancelled ? new LineBasicMaterial({ color: base, transparent: true }) : new MeshLambertMaterial({ color: base.clone(), transparent: true });
      const object = bar.cancelled ? new LineSegments(new EdgesGeometry(geometry), material) : new Mesh(geometry, material);
      object.position.set((bar.x0 + bar.x1) / 2, bar.y, bar.z);
      const piece = add(bar.key, object, [material], 0) as BarPiece;
      Object.assign(piece, { sessionId: bar.sessionId, base, lit: tween(0, 0, now, 0), material, centre: object.position.clone() });
      this.bars.push(piece);
    }
    for (const swatch of model.swatches) {
      const material = new MeshLambertMaterial({ color: new Color(colourOf(swatch.disciplineId)), transparent: true });
      const cube = new Mesh(new BoxGeometry(0.9, 0.9, 0.9), material);
      cube.position.set(swatch.x, swatch.y, swatch.z);
      cube.userData.key = swatch.key;
      this.pickable.push(cube);
      add(swatch.key, cube, [material], 0.5);
    }
    this.applyState(true);
    if (this.introStart === null) {
      this.introStart = now;
      this.figure.dataset.intro = "running";
    }
    this.request();
  }

  setState(state: LatticeState): void {
    this.state = state;
    this.applyState(false);
    this.request();
  }

  private selected(key: string): boolean {
    const s = this.state;
    return key === `day:${s.day}` || key === `venue:${s.venue}` || key === `discipline:${s.discipline}`;
  }

  private applyState(instant: boolean): void {
    const now = this.now();
    const s = this.state;
    const any = !!(s.day || s.venue || s.discipline);
    const bars = new Map(this.model?.bars.map((b) => [b.key, b]) ?? []);
    for (const piece of this.pieces) {
      const bar = bars.get(piece.key);
      let visible: boolean;
      if (bar) visible = (!s.day || bar.date === s.day) && (!s.venue || bar.venueId === s.venue) && (!s.discipline || bar.discipline === s.discipline);
      else {
        const kind = piece.key.split(":")[0] as "day" | "venue" | "discipline";
        visible = !any || !s[kind] || this.selected(piece.key);
      }
      const raiseTo = this.selected(piece.key) ? 1 : 0;
      const fadeTo = visible ? 1 : 0.25;
      if (piece.raise.to !== raiseTo) piece.raise = tween(valueAt(piece.raise, now), raiseTo, now, instant ? 0 : SETTLE_MS, spring);
      if (piece.fade.to !== fadeTo) piece.fade = tween(valueAt(piece.fade, now), fadeTo, now, instant ? 0 : SETTLE_MS);
    }
    for (const bar of this.bars) {
      const litTo = s.lit.has(bar.sessionId) ? 1 : 0;
      if (bar.lit.to !== litTo) bar.lit = tween(valueAt(bar.lit, now), litTo, now, instant ? 0 : QUICK_MS);
    }
    const wanted = new Set(s.seams.map(([a, b]) => [a, b].sort().join("+")));
    for (const seam of this.seams) {
      if (!wanted.has(seam.key) && !seam.ending) {
        seam.ending = true;
        seam.grow = tween(valueAt(seam.grow, now), 0, now, instant ? 0 : SETTLE_MS);
      }
    }
    for (const key of wanted) {
      const existing = this.seams.find((x) => x.key === key);
      if (existing) {
        if (existing.ending) { existing.ending = false; existing.grow = tween(valueAt(existing.grow, now), 1, now, instant ? 0 : SETTLE_MS); }
        continue;
      }
      const [a, b] = key.split("+").map((id) => this.bars.find((x) => x.sessionId === id));
      if (!a || !b) continue;
      const mid = a.centre.clone().add(b.centre).multiplyScalar(0.5);
      const length = Math.max(0.2, a.centre.distanceTo(b.centre));
      const mesh = new Mesh(new BoxGeometry(0.14, 0.14, length), new MeshLambertMaterial({ color: VERMILION, emissive: VERMILION, emissiveIntensity: 0.6 }));
      mesh.position.copy(mid);
      mesh.lookAt(b.centre);
      mesh.scale.set(1, 1, 0.001);
      this.world.add(mesh);
      this.seams.push({ key, mesh, grow: tween(0, 1, now, instant ? 0 : SETTLE_MS), ending: false });
    }
  }

  pointer(nx: number, ny: number): void {
    const now = this.now();
    const yawTo = Math.max(-YAW_MAX, Math.min(YAW_MAX, (nx * 2 - 1) * YAW_MAX));
    const pitchTo = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, (1 - ny * 2) * PITCH_MAX));
    this.yaw = tween(valueAt(this.yaw, now), yawTo, now, 200);
    this.pitch = tween(valueAt(this.pitch, now), pitchTo, now, 200);
    this.request();
  }

  pointerLeave(): void {
    const now = this.now();
    this.yaw = tween(valueAt(this.yaw, now), 0, now, SECTION_MS);
    this.pitch = tween(valueAt(this.pitch, now), 0, now, SECTION_MS);
    this.request();
  }

  setScroll(scrollY: number): void {
    const progress = Math.min(Math.max(scrollY / SCROLL_FLIGHT_PX, 0), 1);
    if (progress === this.progress) return;
    this.progress = progress;
    this.request();
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const point = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(point, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickable, false)[0];
    const key = hit?.object.userData.key as string | undefined;
    if (key) this.onPick(key);
  };

  private request(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.render);
  }

  private readonly render = (): void => {
    this.frame = 0;
    if (!this.model) return;
    const now = this.now();
    let moving = false;

    const intro = this.introStart === null ? 1 : Math.min(1, (now - this.introStart) / INTRO_MS);
    if (intro < 1) moving = true;
    else if (this.figure.dataset.intro !== "done") this.figure.dataset.intro = "done";
    const k = ease(intro);
    const yaw = valueAt(this.yaw, now);
    const pitch = valueAt(this.pitch, now);
    if (!done(this.yaw, now) || !done(this.pitch, now)) moving = true;

    // Camera: a high oblique view settling to a three-quarter view, flown in depth by scroll, tilted by the pointer.
    const firstZ = this.model.slabs[0]?.z ?? 0;
    const lastZ = this.model.slabs[this.model.slabs.length - 1]?.z ?? 0;
    const focusZ = firstZ + (lastZ - firstZ) * this.progress;
    const azimuth = ((8 + (32 - 8) * k) + yaw) * (Math.PI / 180);
    const elevation = ((66 + (19 - 66) * k) + pitch) * (Math.PI / 180);
    // Narrow canvases step back so the whole lattice stays in frame.
    const radius = (44 + (30 - 44) * k) * Math.max(1, 1.15 / this.camera.aspect);
    const target = new Vector3(0.6, -2.4, focusZ - 2.6);
    this.camera.position.set(
      target.x + radius * Math.sin(azimuth) * Math.cos(elevation),
      target.y + radius * Math.sin(elevation),
      target.z + radius * Math.cos(azimuth) * Math.cos(elevation),
    );
    this.camera.lookAt(target);

    for (const piece of this.pieces) {
      piece.root.position.y = piece.baseY + valueAt(piece.raise, now) * piece.lift;
      const opacity = valueAt(piece.fade, now);
      for (const m of piece.materials) m.opacity = opacity * (m.userData.base ?? 1);
      if (!done(piece.raise, now) || !done(piece.fade, now)) moving = true;
    }
    for (const bar of this.bars) {
      const lit = valueAt(bar.lit, now);
      bar.material.color.copy(bar.base).lerp(LIME, lit);
      if (bar.material instanceof MeshLambertMaterial) bar.material.emissive.copy(LIME).multiplyScalar(lit * 0.35);
      if (!done(bar.lit, now)) moving = true;
    }
    for (const seam of [...this.seams]) {
      const grow = valueAt(seam.grow, now);
      seam.mesh.scale.set(1, 1, Math.max(0.001, grow));
      if (!done(seam.grow, now)) moving = true;
      else if (seam.ending) {
        this.world.remove(seam.mesh);
        this.seams.splice(this.seams.indexOf(seam), 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
    const day = Math.round(this.progress * (this.model.slabs.length - 1)) + 1;
    const set = (name: string, value: string) => { if (this.figure.getAttribute(name) !== value) this.figure.setAttribute(name, value); };
    set("data-camera-progress", this.progress.toFixed(2));
    set("data-camera-day", String(day));
    set("data-yaw", (Math.abs(yaw) < 0.05 ? 0 : yaw).toFixed(1));
    set("data-pitch", (Math.abs(pitch) < 0.05 ? 0 : pitch).toFixed(1));
    if (moving) this.request();
  };

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("click", this.handleClick);
    this.renderer.dispose();
  }
}
