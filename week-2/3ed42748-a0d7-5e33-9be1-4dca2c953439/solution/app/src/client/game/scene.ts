// Bramble drawn from code: generated geometry, stepped "printed" shading with ink outlines, a
// paper-wash sky with drifting scraps and a ring of flat clouds, the courier figures and the
// route ribbon in exactly the route teal.
import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LinearFilter,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { unitVector, type LatLon } from "../../shared/geo";
import { iconPaths, type IconName } from "../lib/icons";
import type { Figure } from "./figures";
import type { RibbonSpan } from "./thread";
import { RADIUS, type Blocker, type Pose, type Walker } from "./world";

const ROUTE_TEAL = new Color(0x1f7f7a);
const INK = new Color(0x2b2140);
const PAPER = new Color(0xf6eedd);
const PINK = new Color(0xe2457a);
const SUN = new Color(0xf2be3a);
const KRAFT = new Color(0xa9814f);
const SATCHEL_COLOURS: Record<string, number> = {
  canvas: 0xd8c39a,
  "riso-pink": 0xe2457a,
  sunpatch: 0xf2be3a,
  "night-ink": 0x3a2f5c,
  tidewater: 0x4a6e9c,
};
const EMOTE_ICONS: Record<string, IconName> = { wave: "hand", cheer: "party-popper", sleepy: "moon", heart: "heart" };

export interface ResidentHome {
  id: string;
  name: string;
  home: string;
  door: LatLon;
}

function toonRamp(): DataTexture {
  const tex = new DataTexture(new Uint8Array([150, 205, 255]), 3, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const ramp = toonRamp();
const toon = (color: Color | number, extra: Partial<{ vertexColors: boolean; map: DataTexture }> = {}) =>
  new MeshToonMaterial({ color, gradientMap: ramp, ...extra });
const inkMaterial = new MeshBasicMaterial({ color: INK, side: BackSide });

/** An ink outline: the same shape drawn slightly larger from the inside. */
function outlined(geometry: BufferGeometry, material: Material, thickness: number, ink: Material = inkMaterial): Group {
  const g = new Group();
  g.add(new Mesh(geometry, material));
  const hull = new Mesh(geometry, ink);
  geometry.computeBoundingSphere();
  const r = geometry.boundingSphere!.radius || 1;
  hull.scale.setScalar(1 + thickness / r);
  hull.position.copy(geometry.boundingSphere!.center).multiplyScalar(-thickness / r);
  g.add(hull);
  return g;
}

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(v: Vector3, scale: number): number {
  const x = v.x * scale;
  const y = v.y * scale;
  const z = v.z * scale;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const s = (t: number) => t * t * (3 - 2 * t);
  let total = 0;
  for (let dx = 0; dx <= 1; dx++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = 0; dz <= 1; dz++) {
        const w = (dx ? s(fx) : 1 - s(fx)) * (dy ? s(fy) : 1 - s(fy)) * (dz ? s(fz) : 1 - s(fz));
        total += w * hash3(ix + dx, iy + dy, iz + dz);
      }
  return total;
}

/**
 * Bramble's ground as printed patches: meadow and moss greens, ochre and straw fields, each a
 * flat ink colour with a thin ink line where two patches meet (equirectangular, 1024×512).
 */
function printedGround(): DataTexture {
  const W = 1024;
  const H = 512;
  const inks = [0x9db86a, 0x86a85c, 0xc9a14a, 0xd9b872].map((hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
  const line = [0x2b, 0x21, 0x40];
  const band = new Uint8Array(W * H);
  const dir = new Vector3();
  for (let j = 0; j < H; j++) {
    const theta = (1 - (j + 0.5) / H) * Math.PI;
    for (let i = 0; i < W; i++) {
      const phi = ((i + 0.5) / W) * Math.PI * 2;
      dir.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
      const field = valueNoise(dir, 2.4) * 0.7 + valueNoise(dir, 6.5) * 0.3;
      band[j * W + i] = field > 0.6 ? (valueNoise(dir, 9) > 0.5 ? 2 : 3) : valueNoise(dir, 4.2) > 0.55 ? 1 : 0;
    }
  }
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const b = band[k]!;
      const edge = b !== band[j * W + ((i + 1) % W)] || (j + 1 < H && b !== band[k + W]);
      const rgb = edge ? line : inks[b]!;
      data.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], k * 4);
    }
  const tex = new DataTexture(data, W, H);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** A local frame on the surface: +Y out of the planet, +Z toward a target point. */
function surfaceFrame(at: Vector3, towards: Vector3): Matrix4 {
  const up = at.clone().normalize();
  let forward = towards.clone().sub(at);
  forward.addScaledVector(up, -forward.dot(up));
  if (forward.lengthSq() < 1e-8) forward = new Vector3(0, 1, 0).addScaledVector(up, -up.y);
  forward.normalize();
  const side = new Vector3().crossVectors(up, forward).normalize();
  return new Matrix4().makeBasis(side, up, forward).setPosition(up.clone().multiplyScalar(RADIUS));
}

function placed(geometry: BufferGeometry, frame: Matrix4, local: Matrix4 = new Matrix4()): BufferGeometry {
  return geometry.applyMatrix4(local).applyMatrix4(frame);
}

function paint(geometry: BufferGeometry, color: Color): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
  g.setAttribute("color", new BufferAttribute(colors, 3));
  g.deleteAttribute("uv");
  return g;
}

const T = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);

// ---- figures ----

class CourierFigure {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly satchel: Mesh;
  private readonly box: Group;
  private readonly tape: Mesh;
  tag: Sprite | null = null;
  private tagText = "";
  bubble: Sprite | null = null;
  private bubbleIcon = "";

  constructor(withTag: boolean) {
    const coat = toon(0xf0e6d2);
    const skin = toon(0xe9c9a3);
    const ink = new MeshBasicMaterial({ color: INK, side: BackSide });
    const torso = outlined(new CapsuleGeometry(0.3, 0.5, 4, 10), coat, 0.05, ink);
    torso.position.y = 0.62;
    const head = outlined(new SphereGeometry(0.25, 14, 10), skin, 0.05, ink);
    head.position.y = 1.32;
    const cap = new Mesh(new SphereGeometry(0.26, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), toon(INK));
    cap.position.y = 1.36;
    const satchelMat = toon(SATCHEL_COLOURS.canvas!);
    this.satchel = new Mesh(new BoxGeometry(0.34, 0.36, 0.16), satchelMat);
    this.satchel.position.set(0.32, 0.62, 0.12);
    const satchelLine = outlined(this.satchel.geometry, satchelMat, 0.03, ink);
    satchelLine.position.copy(this.satchel.position);
    this.box = new Group();
    const kraft = toon(KRAFT);
    const boxMesh = outlined(new BoxGeometry(0.46, 0.34, 0.36), kraft, 0.03, ink);
    const stringMat = new MeshBasicMaterial({ color: INK });
    const s1 = new Mesh(new BoxGeometry(0.5, 0.37, 0.05), stringMat);
    const s2 = new Mesh(new BoxGeometry(0.05, 0.37, 0.4), stringMat);
    const knot = new Mesh(new SphereGeometry(0.05, 6, 4), stringMat);
    knot.position.y = 0.2;
    this.tape = new Mesh(new BoxGeometry(0.47, 0.1, 0.37), new MeshBasicMaterial({ color: PINK }));
    this.box.add(boxMesh, s1, s2, knot, this.tape);
    this.box.position.set(-0.4, 0.82, -0.12);
    this.body.add(torso, head, cap, satchelLine, this.box);
    this.root.add(this.body);
    if (withTag) {
      this.tag = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false }));
      this.tag.position.y = 2.1;
      this.bubble = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false }));
      this.bubble.position.y = 2.75;
      this.root.add(this.tag, this.bubble);
    }
  }

  setSatchel(colour: string): void {
    (this.satchel.material as MeshToonMaterial).color.setHex(SATCHEL_COLOURS[colour] ?? SATCHEL_COLOURS.canvas!);
  }

  setCarrying(kind: "none" | "standard" | "rush"): void {
    this.box.visible = kind !== "none";
    this.tape.visible = kind === "rush";
  }

  /** Places the figure upright on the surface: its up is always the outward normal. */
  place(unit: Vector3, forward: Vector3, lift: number, walkPhase: number): void {
    const up = unit.clone().normalize();
    const fwd = forward.clone().addScaledVector(up, -forward.dot(up)).normalize();
    const right = new Vector3().crossVectors(fwd, up);
    this.root.matrixAutoUpdate = false;
    this.root.matrix.makeBasis(right, up, fwd.clone().negate()).setPosition(up.clone().multiplyScalar(RADIUS + lift));
    this.root.matrixWorldNeedsUpdate = true;
    this.body.position.y = Math.abs(Math.sin(walkPhase)) * 0.06;
    this.body.rotation.z = Math.sin(walkPhase) * 0.05;
  }

  setName(name: string): void {
    if (!this.tag || name === this.tagText) return;
    this.tagText = name;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = "600 30px 'Atkinson Hyperlegible', sans-serif";
    const w = Math.ceil(ctx.measureText(name).width) + 36;
    canvas.width = w;
    canvas.height = 52;
    ctx.fillStyle = "#f6eedd";
    ctx.strokeStyle = "#2b2140";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(14, 4);
    ctx.lineTo(w - 4, 4);
    ctx.lineTo(w - 4, 48);
    ctx.lineTo(14, 48);
    ctx.lineTo(4, 26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2b2140";
    ctx.font = "600 30px 'Atkinson Hyperlegible', sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 22, 27);
    const material = this.tag.material;
    material.map?.dispose();
    material.map = new CanvasTexture(canvas);
    material.map.colorSpace = SRGBColorSpace;
    material.needsUpdate = true;
    this.tag.scale.set((w / 52) * 0.24, 0.24, 1);
  }

  setBubble(icon: string, scale: number): void {
    if (!this.bubble) return;
    this.bubble.visible = scale > 0.01 && icon !== "";
    if (icon && icon !== this.bubbleIcon) {
      this.bubbleIcon = icon;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 96;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f6eedd";
      ctx.strokeStyle = "#2b2140";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(48, 42, 40, 34, 0, 0, Math.PI * 2);
      ctx.moveTo(40, 72);
      ctx.lineTo(48, 92);
      ctx.lineTo(58, 72);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(26, 20);
      ctx.scale(1.8, 1.8);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const name = EMOTE_ICONS[icon];
      if (name) for (const d of iconPaths(name).matchAll(/d="([^"]+)"/g)) ctx.stroke(new Path2D(d[1]));
      ctx.restore();
      const material = this.bubble.material;
      material.map?.dispose();
      material.map = new CanvasTexture(canvas);
      material.map.colorSpace = SRGBColorSpace;
      material.needsUpdate = true;
    }
    this.bubble.scale.setScalar(0.75 * Math.max(0.01, scale));
  }

  setOpacity(opacity: number): void {
    this.root.visible = opacity > 0.01;
    this.root.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      if (!m) return;
      m.transparent = opacity < 1;
      m.opacity = opacity;
    });
  }
}

// ---- the ribbon ----

const RIBBON_POINTS = 160;
const RIBBON_PX = 7;

class Ribbon {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;

  constructor() {
    this.positions = new Float32Array(RIBBON_POINTS * 2 * 3);
    const geometry = new BufferGeometry();
    const attr = new BufferAttribute(this.positions, 3);
    attr.setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", attr);
    const index: number[] = [];
    for (let i = 0; i < RIBBON_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    const material = new MeshBasicMaterial({
      color: ROUTE_TEAL,
      side: DoubleSide,
      toneMapped: false,
      fog: false,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  /** A camera-facing strip along the great circle, at least RIBBON_PX wide on screen. */
  update(span: RibbonSpan | null, camera: PerspectiveCamera, viewportHeight: number): void {
    if (!span) {
      this.mesh.visible = false;
      return;
    }
    const a = span.from;
    const b = span.to;
    const angle = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
    if (angle * RADIUS < 0.05) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const s = Math.sin(angle);
    const pxWorld = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeight;
    const camPos = camera.position;
    const pts: Vector3[] = [];
    for (let i = 0; i < RIBBON_POINTS; i++) {
      const t = i / (RIBBON_POINTS - 1);
      const dir =
        s < 1e-6
          ? a.clone()
          : a
              .clone()
              .multiplyScalar(Math.sin((1 - t) * angle) / s)
              .addScaledVector(b, Math.sin(t * angle) / s)
              .normalize();
      const metresFromEnd = (1 - t) * angle * RADIUS;
      const rise = span.tiedToDoor && metresFromEnd < 1.5 ? (1 - metresFromEnd / 1.5) * 0.95 : 0;
      pts.push(dir.multiplyScalar(RADIUS + 0.12 + rise));
    }
    for (let i = 0; i < RIBBON_POINTS; i++) {
      const p = pts[i]!;
      const next = pts[Math.min(RIBBON_POINTS - 1, i + 1)]!;
      const prev = pts[Math.max(0, i - 1)]!;
      const tangent = next.clone().sub(prev).normalize();
      const toCam = camPos.clone().sub(p);
      const distance = toCam.length();
      const side = new Vector3().crossVectors(tangent, toCam).normalize();
      const half = Math.max(0.06, (distance * pxWorld * RIBBON_PX) / 2);
      const up = p.clone().normalize();
      const lift = Math.abs(side.dot(up)) * half;
      const left = p.clone().addScaledVector(up, lift).addScaledVector(side, half);
      const right = p.clone().addScaledVector(up, lift).addScaledVector(side, -half);
      this.positions.set([left.x, left.y, left.z, right.x, right.y, right.z], i * 6);
    }
    const attr = this.mesh.geometry.getAttribute("position") as BufferAttribute;
    attr.needsUpdate = true;
  }
}

// ---- the scene ----

export class BrambleScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.1, 3000);
  readonly courier = new CourierFigure(false);
  readonly blockers: Blocker[] = [];
  private readonly sky: Mesh;
  private readonly clouds = new Group();
  private readonly scraps: InstancedMesh;
  private readonly scrapSeeds: Array<{ axis: Vector3; start: Vector3; speed: number; spin: number }> = [];
  private readonly ribbon = new Ribbon();
  private readonly sun = new DirectionalLight(0xfff4dd, 1.5);
  private readonly others = new Map<Figure, CourierFigure>();
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement, residents: ResidentHome[], depot: LatLon) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xf8ecd2);
    this.scene.add(new AmbientLight(0xfff6e8, 1.25), this.sun, this.sun.target);

    const sky = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { zenith: { value: new Color(0xfbf3e4) }, horizon: { value: new Color(0xf7de9a) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,1.0)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; varying vec3 vDir;
        void main(){ vec3 up = normalize(cameraPosition); float h = dot(normalize(vDir), up);
          float band = smoothstep(0.0, 0.55, abs(h + 0.08));
          gl_FragColor = vec4(mix(horizon, zenith, band), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new Mesh(new SphereGeometry(1500, 32, 16), sky);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.scene.add(this.planet(residents, depot));
    for (const r of residents) this.scene.add(this.home(r, depot));
    this.scene.add(this.depotStand(depot));
    this.scene.add(this.cloudRing());
    this.scraps = this.paperScraps();
    this.scene.add(this.scraps);
    this.scene.add(this.courier.root);
    this.scene.add(this.ribbon.mesh);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private planet(residents: ResidentHome[], depot: LatLon): Group {
    const geometry = new SphereGeometry(RADIUS, 128, 64);
    // The hull sits only 0.22 outside the ground: pushed back in depth so it never z-fights it near the horizon.
    const hullInk = new MeshBasicMaterial({ color: INK, side: BackSide, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
    const g = outlined(geometry, toon(0xffffff, { map: printedGround() }), 0.22, hullInk);

    const decor: BufferGeometry[] = [];
    const keepClear = [unitVector(depot), ...residents.map((r) => unitVector(r.door))].map((u) => new Vector3(...u));
    const routes = residents.map((r) => [new Vector3(...unitVector(depot)), new Vector3(...unitVector(r.door))] as const);
    const nearRoute = (u: Vector3): boolean =>
      routes.some(([a, b]) => {
        const angle = Math.acos(a.dot(b));
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const s = Math.sin(angle);
          const p = a.clone().multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(b, Math.sin(t * angle) / s);
          if (p.distanceTo(u) * RADIUS < 9) return true;
        }
        return false;
      });
    const trunk = new Color(0x7a5a3a);
    const leaf = [new Color(0x6f9a4e), new Color(0x8fb35c), new Color(0xc9a14a)];
    let placedCount = 0;
    for (let i = 0; placedCount < 70 && i < 600; i++) {
      const u = new Vector3(hash3(i, 1, 2) * 2 - 1, hash3(i, 3, 4) * 2 - 1, hash3(i, 5, 6) * 2 - 1);
      if (u.lengthSq() < 0.05) continue;
      u.normalize();
      if (keepClear.some((k) => k.distanceTo(u) * RADIUS < 13) || nearRoute(u)) continue;
      placedCount++;
      const frame = surfaceFrame(u.clone().multiplyScalar(RADIUS), new Vector3(0, 1, 0));
      const tall = 1.6 + hash3(i, 7, 8) * 1.6;
      decor.push(paint(placed(new CylinderGeometry(0.12, 0.16, tall * 0.5, 6), frame, T(0, tall * 0.25, 0)), trunk));
      decor.push(paint(placed(new ConeGeometry(0.75 + hash3(i, 9, 1) * 0.4, tall, 7), frame, T(0, tall * 0.85, 0)), leaf[i % 3]!));
    }
    for (let i = 0; i < 140; i++) {
      const u = new Vector3(hash3(i, 11, 2) * 2 - 1, hash3(i, 13, 4) * 2 - 1, hash3(i, 15, 6) * 2 - 1);
      if (u.lengthSq() < 0.05) continue;
      u.normalize();
      if (keepClear.some((k) => k.distanceTo(u) * RADIUS < 6)) continue;
      const frame = surfaceFrame(u.clone().multiplyScalar(RADIUS), new Vector3(1, 0, 0));
      decor.push(paint(placed(new ConeGeometry(0.18, 0.5, 4), frame, T(0, 0.2, 0)), leaf[(i + 1) % 2]!));
    }
    const merged = mergeGeometries(decor)!;
    g.add(outlined(merged, toon(0xffffff, { vertexColors: true }), 0.04));
    return g;
  }

  private home(r: ResidentHome, depot: LatLon): Group {
    const doorAt = new Vector3(...unitVector(r.door)).multiplyScalar(RADIUS);
    const depotAt = new Vector3(...unitVector(depot)).multiplyScalar(RADIUS);
    const frame = surfaceFrame(doorAt, depotAt);
    const group = new Group();
    group.matrixAutoUpdate = false;
    group.matrix.copy(frame);
    const wall = toon(0xeadcc0);
    const roof = toon(0xb8553f);
    const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number, thickness = 0.08): Group => {
      const o = outlined(geometry, material, thickness);
      o.position.set(x, y, z);
      group.add(o);
      return o;
    };
    // the body sits behind the door, away from the depot
    if (r.id === "ottoline") {
      add(new CylinderGeometry(1.5, 1.9, 4.6, 12), wall, 0, 2.3, -2.2);
      add(new ConeGeometry(2.2, 1.8, 12), roof, 0, 5.5, -2.2);
      const sail = toon(0xf6eedd);
      for (let k = 0; k < 4; k++) {
        const blade = add(new BoxGeometry(0.5, 3.2, 0.08), sail, 0, 4.4, -0.55, 0.05);
        blade.rotation.z = (k * Math.PI) / 2 + 0.4;
        blade.translateY(1.7);
      }
    } else if (r.id === "barnaby") {
      const gourd = add(new SphereGeometry(2.2, 18, 12), toon(0xe0a43c), 0, 2.0, -2.4);
      gourd.scale.set(1, 0.85, 1);
      add(new SphereGeometry(1.2, 14, 10), toon(0xe0a43c), 0, 3.9, -2.4);
      add(new CylinderGeometry(0.12, 0.18, 0.9, 6), toon(0x5d7a3a), 0, 5.3, -2.4);
    } else if (r.id === "pim") {
      add(new BoxGeometry(3.6, 2.6, 3.2), wall, 0, 1.3, -1.9);
      add(new SphereGeometry(1.7, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xb7c4d6), 0, 2.6, -1.9);
      const scope = add(new CylinderGeometry(0.22, 0.3, 1.8, 8), toon(INK), 0.8, 3.7, -1.9);
      scope.rotation.z = -0.7;
    } else {
      const arch = add(new TorusGeometry(2.0, 0.55, 8, 18, Math.PI), toon(0x6f9a4e), 0, 0.2, -0.9);
      arch.rotation.y = 0;
      add(new BoxGeometry(2.2, 0.4, 2.2), toon(0x8a7a5a), 0, 0.2, -2.4);
      add(new SphereGeometry(0.7, 10, 8), toon(0x8fb35c), -1.6, 2.2, -0.9);
      add(new SphereGeometry(0.6, 10, 8), toon(0x8fb35c), 1.7, 1.9, -0.9);
    }
    // the door stands just proud of the front wall, at the door's own point on the surface
    const doorBack = r.id === "ottoline" ? -0.22 : r.id === "barnaby" ? -0.12 : r.id === "pim" ? -0.22 : -0.9;
    add(new BoxGeometry(1.0, 1.9, 0.12), toon(INK), 0, 0.95, doorBack, 0.04);
    add(new BoxGeometry(0.5, 0.36, 0.06), toon(PINK), 0, 2.15, doorBack + 0.07, 0.03);
    group.updateMatrixWorld(true);
    const centre = new Vector3(0, 2, -2.2).applyMatrix4(frame);
    this.blockers.push({ centre, radius: 3.2 });
    return group;
  }

  private depotStand(depot: LatLon): Group {
    const at = new Vector3(...unitVector(depot)).multiplyScalar(RADIUS);
    const group = new Group();
    group.matrixAutoUpdate = false;
    group.matrix.copy(surfaceFrame(at, new Vector3(0, RADIUS, 0)));
    const wood = toon(0xb98b5a);
    // ahead and to one side of the spawn point, so the follow camera always sees the courier
    const stand = new Group();
    stand.position.set(4.5, 0, 4);
    stand.rotation.y = -0.7;
    group.add(stand);
    const put = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number): void => {
      const o = outlined(geometry, material, 0.05);
      o.position.set(x, y, z);
      stand.add(o);
    };
    put(new BoxGeometry(2.4, 0.9, 0.8), wood, 0, 0.45, 0);
    for (const x of [-1.15, 1.15]) put(new CylinderGeometry(0.06, 0.06, 1.45, 6), toon(INK), x, 0.72, 0.45);
    put(new BoxGeometry(2.8, 0.08, 1.3), toon(PINK), 0, 1.47, 0.2);
    put(new BoxGeometry(0.42, 0.3, 0.36), toon(KRAFT), -0.6, 1.05, 0);
    put(new BoxGeometry(0.36, 0.26, 0.3), toon(KRAFT), 0.5, 1.03, 0.05);
    return group;
  }

  private cloudRing(): Group {
    const white = new MeshBasicMaterial({ color: 0xfffaf0, side: DoubleSide });
    const ink = new MeshBasicMaterial({ color: INK, side: DoubleSide, transparent: true, opacity: 0.35 });
    for (let i = 0; i < 12; i++) {
      const shape = new Shape();
      const puffs = 3 + (i % 3);
      for (let k = 0; k < puffs; k++) shape.absarc(k * 3.2 - puffs * 1.6, (k % 2) * 1.2, 2.4 + (k % 2) * 0.6, 0, Math.PI * 2, false);
      const g = new ShapeGeometry(shape, 10);
      const cloud = new Group();
      const fill = new Mesh(g, white);
      const line = new Mesh(g, ink);
      line.scale.setScalar(1.06);
      line.position.z = -0.05;
      cloud.add(line, fill);
      const angle = (i / 12) * Math.PI * 2;
      cloud.position.set(Math.cos(angle) * 92, (i % 4) * 9 - 14, Math.sin(angle) * 92);
      cloud.userData.billboard = true;
      this.clouds.add(cloud);
    }
    this.clouds.rotation.x = 0.35;
    return this.clouds;
  }

  private paperScraps(): InstancedMesh {
    const geometry = new PlaneGeometry(1.4, 0.9);
    const material = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
    const mesh = new InstancedMesh(geometry, material, 36);
    const palette = [PAPER, PINK, SUN, new Color(0xe7d8b8)];
    for (let i = 0; i < 36; i++) {
      const axis = new Vector3(hash3(i, 1, 9) - 0.5, hash3(i, 2, 9) - 0.5, hash3(i, 3, 9) - 0.5).normalize();
      const start = new Vector3(hash3(i, 4, 9) - 0.5, hash3(i, 5, 9) - 0.5, hash3(i, 6, 9) - 0.5)
        .normalize()
        .multiplyScalar(74 + hash3(i, 7, 9) * 40);
      this.scrapSeeds.push({ axis, start, speed: 0.01 + hash3(i, 8, 9) * 0.015, spin: 0.3 + hash3(i, 9, 9) });
      mesh.setColorAt(i, palette[i % palette.length]!);
    }
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Ambient sky: `seconds` only advances while the page is visible and motion is allowed. */
  setAmbient(seconds: number, cloudDeg: number): void {
    this.clouds.rotation.y = (cloudDeg * Math.PI) / 180;
    const m = new Matrix4();
    const q = new Quaternion();
    for (let i = 0; i < this.scrapSeeds.length; i++) {
      const s = this.scrapSeeds[i]!;
      const p = s.start.clone().applyAxisAngle(s.axis, seconds * s.speed);
      q.setFromAxisAngle(s.axis, seconds * s.spin + i);
      m.compose(p, q, new Vector3(1, 1, 1));
      this.scraps.setMatrixAt(i, m);
    }
    this.scraps.instanceMatrix.needsUpdate = true;
  }

  apply(pose: Pose): void {
    this.camera.position.copy(pose.pos);
    this.camera.up.copy(pose.up);
    this.camera.lookAt(pose.target);
    if (this.camera.fov !== pose.fov) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  syncCourier(w: Walker, carrying: "none" | "standard" | "rush", satchel: string, walkPhase: number): void {
    this.courier.setSatchel(satchel);
    this.courier.setCarrying(carrying);
    this.courier.place(w.p, w.f, w.height, walkPhase);
  }

  /** Draws other couriers' figures from their animation state. */
  syncFigures(figures: Figure[], now: number, reduced: boolean): void {
    const seen = new Set<Figure>();
    for (const f of figures) {
      seen.add(f);
      let mesh = this.others.get(f);
      if (!mesh) {
        mesh = new CourierFigure(true);
        this.others.set(f, mesh);
        this.scene.add(mesh.root);
      }
      const up = f.shown.clone();
      const headingRad = (f.heading * Math.PI) / 180;
      const north = new Vector3(0, 1, 0).addScaledVector(up, -up.y);
      if (north.lengthSq() < 1e-8) north.set(0, 0, 1);
      north.normalize();
      const forward = north.applyAxisAngle(up, -headingRad);
      mesh.place(up, forward, 0, 0);
      mesh.setName(f.name);
      mesh.setSatchel(f.colour);
      mesh.setCarrying("none");
      mesh.setBubble(f.bubbleIcon, f.bubble(now, reduced));
      mesh.setOpacity(f.opacity(now, reduced));
    }
    for (const [f, mesh] of this.others)
      if (!seen.has(f)) {
        this.scene.remove(mesh.root);
        this.others.delete(f);
      }
  }

  render(span: RibbonSpan | null): void {
    this.sky.position.copy(this.camera.position);
    this.sun.position.copy(this.camera.position).addScaledVector(this.camera.up, 60);
    for (const cloud of this.clouds.children) cloud.lookAt(this.camera.position);
    this.ribbon.update(span, this.camera, this.height);
    this.renderer.render(this.scene, this.camera);
  }

  /** Projects a world point to whole viewport pixels, or null when it is off screen or behind Bramble. */
  project(point: Vector3): [number, number] | null {
    const cam = this.camera.position;
    const toPoint = point.clone().sub(cam);
    const length = toPoint.length();
    const dir = toPoint.divideScalar(length);
    const b = cam.dot(dir);
    const c = cam.lengthSq() - (RADIUS - 0.05) * (RADIUS - 0.05);
    const disc = b * b - c;
    if (disc > 0) {
      const hit = -b - Math.sqrt(disc);
      if (hit > 0 && hit < length - 0.05) return null;
    }
    const ndc = point.clone().project(this.camera);
    if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
    return [Math.round(((ndc.x + 1) / 2) * this.width), Math.round(((1 - ndc.y) / 2) * this.height)];
  }

  /** Renders a pose to a 1200×800 image of the photo camera's view. */
  capture(pose: Pose, span: RibbonSpan | null): ImageData {
    const width = 1200;
    const height = 800;
    const target = new WebGLRenderTarget(width, height);
    target.texture.colorSpace = SRGBColorSpace;
    const shot = new PerspectiveCamera(pose.fov, width / height, 0.1, 3000);
    shot.position.copy(pose.pos);
    shot.up.copy(pose.up);
    shot.lookAt(pose.target);
    shot.updateMatrixWorld();
    this.sky.position.copy(shot.position);
    this.ribbon.update(span, shot, height);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, shot);
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(null);
    target.dispose();
    const image = new ImageData(width, height);
    for (let y = 0; y < height; y++)
      image.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    return image;
  }
}
