// The Shot Rig's drawing: the client's GLB on a matte plinth beside a 1:1 card outline, a ring of wireframe camera
// frustums and a picture-in-picture camera view. Without WebGL it draws a top-down plan on a 2D canvas instead.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Dimensions } from "../api";
import { COBALT, EMBER, INK, VIOLET } from "./kit";

const CARD_M = { long: 0.0856, short: 0.054 };
const GROUND = 0x0b0d12;
const PLINTH = 0x121318;

type FrustumDraw = { code: string; azimuth: number; elevation: number; position: number; ember: number };
type RigFrame = {
  orbit: number;
  frustums: FrustumDraw[];
  stations: { azimuth: number; selected: boolean; focused: boolean }[];
  pip: { azimuth: number; elevation: number } | null;
};
type Stage = { productM: Dimensions | null; ring: number; plinthRadius: number; productOffset: number; cardOffset: number };

/** Lays the product (true size, metres) and the card out on the plinth and sizes the ring around them. */
function stageFor(productM: Dimensions | null): Stage {
  const size = productM ?? { x: 0.16, y: 0.16, z: 0.1 };
  const cardOffset = size.x / 2 + 0.02 + CARD_M.long / 2;
  const plinthRadius = Math.max(Math.hypot(size.x / 2, size.z / 2), cardOffset + CARD_M.long / 2) * 1.12 + 0.01;
  const span = Math.max(plinthRadius, size.y * 0.75);
  return { productM, ring: span * 1.18, plinthRadius, productOffset: -CARD_M.long * 0.35, cardOffset: cardOffset - CARD_M.long * 0.35 };
}

const toRad = THREE.MathUtils.degToRad;
const spherical = (azimuth: number, elevation: number, distance: number, target: THREE.Vector3): THREE.Vector3 =>
  new THREE.Vector3(
    target.x + distance * Math.sin(toRad(azimuth)) * Math.cos(toRad(elevation)),
    target.y + distance * Math.sin(toRad(elevation)),
    target.z + distance * Math.cos(toRad(azimuth)) * Math.cos(toRad(elevation)),
  );

function frustumGeometry(size: number): THREE.BufferGeometry {
  const d = size;
  const w = size * 0.42;
  const h = size * 0.3;
  const corners = [
    [-w, -h, -d],
    [w, -h, -d],
    [w, h, -d],
    [-w, h, -d],
  ] as const;
  const points: number[] = [];
  for (const c of corners) points.push(0, 0, 0, ...c);
  for (let i = 0; i < 4; i++) {
    const a = corners[i] ?? corners[0];
    const b = corners[(i + 1) % 4] ?? corners[0];
    points.push(...a, ...b);
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
}

export class RigScene {
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly scene = new THREE.Scene();
  private readonly main = new THREE.PerspectiveCamera(32, 1, 0.001, 100);
  private readonly pipCamera = new THREE.PerspectiveCamera(34, 4 / 3, 0.001, 100);
  private readonly frustums = new Map<string, THREE.LineSegments>();
  private readonly stageGroup = new THREE.Group();
  private readonly product = new THREE.Group();
  private readonly cobalt = new THREE.PointLight(COBALT, 0, 0, 2);
  private readonly violet = new THREE.PointLight(VIOLET, 0, 0, 2);
  private stage: Stage = stageFor(null);
  private readonly plan: CanvasRenderingContext2D | null;
  private modelUrl: string | null = null;
  private loaded: { url: string; model: THREE.Object3D } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly pipBox: () => DOMRect | null) {
    let renderer: THREE.WebGLRenderer | null = null;
    const context = canvas.getContext("webgl2", { antialias: true });
    try {
      if (!context) throw new Error("no WebGL2");
      renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
      renderer.setClearColor(GROUND, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.autoClear = false;
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
    this.plan = renderer ? null : canvas.getContext("2d");
    this.scene.add(new THREE.HemisphereLight(0xb8bccb, 0x050608, 0.45));
    const key = new THREE.DirectionalLight(0xf3eee6, 0.9);
    key.position.set(1, 2, 1.5);
    this.scene.add(key, this.cobalt, this.violet, this.stageGroup, this.product);
    this.rebuildStage();
  }

  get webgl(): boolean {
    return this.renderer !== null;
  }

  private rebuildStage(): void {
    this.stageGroup.clear();
    const { plinthRadius, ring, cardOffset } = this.stage;
    const height = plinthRadius * 0.55;
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(plinthRadius, plinthRadius * 1.02, height, 96), new THREE.MeshStandardMaterial({ color: PLINTH, roughness: 0.97, metalness: 0 }));
    plinth.position.y = -height / 2;
    const card = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(cardOffset - CARD_M.long / 2, 0.0006, -CARD_M.short / 2),
        new THREE.Vector3(cardOffset + CARD_M.long / 2, 0.0006, -CARD_M.short / 2),
        new THREE.Vector3(cardOffset + CARD_M.long / 2, 0.0006, CARD_M.short / 2),
        new THREE.Vector3(cardOffset - CARD_M.long / 2, 0.0006, CARD_M.short / 2),
      ]),
      new THREE.LineBasicMaterial({ color: INK }),
    );
    const ringLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.sin((i / 128) * Math.PI * 2) * ring, 0.001, Math.cos((i / 128) * Math.PI * 2) * ring))),
      new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.22 }),
    );
    this.stageGroup.add(plinth, card, ringLine);
    for (const frustum of this.frustums.values()) frustum.geometry = frustumGeometry(ring * 0.22);
    this.cobalt.distance = ring * 6;
    this.violet.distance = ring * 6;
    this.cobalt.intensity = 10 * ring * ring;
    this.violet.intensity = 8 * ring * ring;
  }

  /** Shows the client's GLB at true size; `productMm` already carries the unit decision. */
  setModel(url: string | null, productM: Dimensions | null, productMm: Dimensions | null): void {
    const sized = productMm ? { x: productMm.x / 1000, y: productMm.y / 1000, z: productMm.z / 1000 } : null;
    this.stage = stageFor(sized);
    this.rebuildStage();
    this.product.clear();
    if (!sized || !productM) return;
    const bounds = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(sized.x, sized.y, sized.z)),
      new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.28 }),
    );
    bounds.position.set(this.stage.productOffset, sized.y / 2, 0);
    this.product.add(bounds);
    if (!this.renderer || !url) return;
    const unitScale = productM.x > 0 ? sized.x / productM.x : 1;
    if (this.loaded?.url === url) return this.place(this.loaded.model, unitScale);
    this.modelUrl = url;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (this.modelUrl !== url) return;
        gltf.scene.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          if (!node.geometry.getAttribute("normal")) node.geometry.computeVertexNormals();
          node.material = new THREE.MeshStandardMaterial({ color: 0xd9d2c7, metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide });
        });
        this.loaded = { url, model: gltf.scene };
        this.place(gltf.scene, unitScale);
      },
      undefined,
      () => undefined,
    );
  }

  /** Scales the loaded model by the unit decision and stands it on the plinth top. */
  private place(model: THREE.Object3D, unitScale: number): void {
    model.position.set(0, 0, 0);
    model.scale.setScalar(unitScale);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const centre = box.getCenter(new THREE.Vector3());
    model.position.set(this.stage.productOffset - centre.x, -box.min.y, -centre.z);
    this.product.add(model);
  }

  private target(): THREE.Vector3 {
    return new THREE.Vector3(0, (this.stage.productM?.y ?? 0.12) * 0.42, 0);
  }

  render(frame: RigFrame): void {
    if (!this.renderer) return this.drawPlan(frame);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
    }
    const ring = this.stage.ring;
    const target = this.target();
    for (const [code, line] of this.frustums) if (!frame.frustums.some((f) => f.code === code)) (this.scene.remove(line), this.frustums.delete(code));
    for (const f of frame.frustums) {
      let line = this.frustums.get(f.code);
      if (!line) {
        line = new THREE.LineSegments(frustumGeometry(ring * 0.22), new THREE.LineBasicMaterial({ color: INK }));
        this.frustums.set(f.code, line);
        this.scene.add(line);
      }
      const distance = ring * (1.6 - 0.6 * f.position);
      line.position.copy(spherical(f.azimuth, f.elevation, distance, new THREE.Vector3(0, 0, 0)));
      line.up.set(0, 1, 0);
      if (f.elevation > 80) line.up.set(0, 0, -1);
      line.lookAt(target);
      (line.material as THREE.LineBasicMaterial).color.copy(INK).lerp(EMBER, f.ember);
    }
    this.main.position.copy(spherical(frame.orbit, 24, ring * 4.2, target));
    this.main.up.set(0, 1, 0);
    this.main.lookAt(target);
    this.main.aspect = width / height;
    this.main.updateProjectionMatrix();
    this.cobalt.position.copy(spherical(frame.orbit + 70, 35, ring * 1.6, target));
    this.violet.position.copy(spherical(frame.orbit - 80, 18, ring * 1.5, target));
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.clear();
    this.renderer.render(this.scene, this.main);
    const inset = this.pipBox();
    if (!inset) return;
    const canvasBox = this.canvas.getBoundingClientRect();
    const x = inset.left - canvasBox.left;
    const y = canvasBox.bottom - inset.bottom;
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(x, y, inset.width, inset.height);
    this.renderer.setScissor(x, y, inset.width, inset.height);
    this.renderer.clear();
    const view = frame.pip ?? { azimuth: 30, elevation: 28 };
    this.pipCamera.position.copy(spherical(view.azimuth, view.elevation, ring * (frame.pip ? 2.2 : 3.2), target));
    this.pipCamera.up.set(0, 1, 0);
    if (view.elevation > 80) this.pipCamera.up.set(0, 0, -1);
    this.pipCamera.lookAt(target);
    this.pipCamera.aspect = inset.width / inset.height;
    this.pipCamera.updateProjectionMatrix();
    const hidden = [...this.frustums.values()];
    hidden.forEach((line) => (line.visible = false));
    this.renderer.render(this.scene, this.pipCamera);
    hidden.forEach((line) => (line.visible = true));
    this.renderer.setScissorTest(false);
  }

  /** Top-down plan: plinth, the product's footprint at true scale, the card, the ring and a tick per station. */
  private drawPlan(frame: RigFrame): void {
    const ctx = this.plan;
    if (!ctx) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, width, height);
    const { ring, plinthRadius, productM, productOffset, cardOffset } = this.stage;
    const scale = (Math.min(width, height) * 0.42) / (ring * 1.15);
    const cx = width / 2;
    const cy = height / 2;
    const rotate = toRad(frame.orbit);
    const toScreen = (x: number, z: number): [number, number] => {
      const rx = x * Math.cos(rotate) - z * Math.sin(rotate);
      const rz = x * Math.sin(rotate) + z * Math.cos(rotate);
      return [cx + rx * scale, cy + rz * scale];
    };
    ctx.strokeStyle = "rgba(243,238,230,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, ring * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#1a1c22";
    ctx.beginPath();
    ctx.arc(cx, cy, plinthRadius * scale, 0, Math.PI * 2);
    ctx.fill();
    const rect = (x: number, z: number, w: number, d: number, stroke: string, fill: string | null): void => {
      const pts = [toScreen(x - w / 2, z - d / 2), toScreen(x + w / 2, z - d / 2), toScreen(x + w / 2, z + d / 2), toScreen(x - w / 2, z + d / 2)];
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };
    if (productM) rect(productOffset, 0, productM.x, productM.z, "#f3eee6", "#3a3d46");
    rect(cardOffset, 0, CARD_M.long, CARD_M.short, "#f3eee6", null);
    for (const station of frame.stations) {
      const [ix, iy] = toScreen(Math.sin(toRad(station.azimuth)) * ring * 0.93, Math.cos(toRad(station.azimuth)) * ring * 0.93);
      const [ox, oy] = toScreen(Math.sin(toRad(station.azimuth)) * ring * 1.07, Math.cos(toRad(station.azimuth)) * ring * 1.07);
      ctx.strokeStyle = station.focused ? "#ff6a1f" : "rgba(243,238,230,0.6)";
      ctx.lineWidth = station.focused ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ox, oy);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    for (const f of frame.frustums) {
      const [px, py] = toScreen(Math.sin(toRad(f.azimuth)) * ring * (1.6 - 0.6 * f.position), Math.cos(toRad(f.azimuth)) * ring * (1.6 - 0.6 * f.position));
      ctx.fillStyle = f.ember > 0.5 ? "#ff6a1f" : "#f3eee6";
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
