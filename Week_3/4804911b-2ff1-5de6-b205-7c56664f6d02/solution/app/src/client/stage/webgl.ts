// The WebGL renderer: one canvas, one context, any number of packs drawn each frame (two only under reduced motion).
import {
  BufferGeometry, ColorManagement, CanvasTexture, ExtrudeGeometry, Group, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace,
  Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Shape, ShapeGeometry, ShaderMaterial, WebGLRenderer, Vector3,
} from "three";
import type { PackFacts } from "../../shared/types";
import { addGrain, backOps, frontOps, lampOverlay, paintOps, stickerArt, type Op } from "./paint";
import { specFor, type PackSpec } from "./spec";
import { stickerPose, type View } from "./project";

ColorManagement.enabled = false;

const LAMP = new Vector3(-0.4, 0.5, 0.8).normalize();

const VERTEX = `
varying vec2 vUv; varying vec3 vN;
void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAGMENT = `
uniform sampler2D map; uniform float uOpacity; uniform vec3 uTint; uniform float uUseMap; uniform vec3 uLamp;
varying vec2 vUv; varying vec3 vN;
void main(){
  vec4 t = uUseMap > 0.5 ? texture2D(map, vUv) : vec4(uTint, 1.0);
  float ndl = max(dot(normalize(vN), uLamp), 0.0);
  float lit = 0.40 + 0.60 * smoothstep(0.0, 0.78, ndl);
  gl_FragColor = vec4(t.rgb * lit, t.a * uOpacity);
}`;

function litMaterial(texture: CanvasTexture | null, tint: [number, number, number]): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      map: { value: texture },
      uOpacity: { value: 1 },
      uTint: { value: new Vector3(...tint) },
      uUseMap: { value: texture ? 1 : 0 },
      uLamp: { value: LAMP },
    },
    transparent: true,
  });
}

function textureOf(width: number, height: number, ops: Op[], opts: { grain?: number; lamp?: boolean } = {}): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    paintOps(ctx, ops);
    if (opts.lamp) lampOverlay(ctx, width, height);
    if (opts.grain) addGrain(ctx, width, height, opts.grain);
  }
  const texture = new CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function normalise(geometry: BufferGeometry, spec: PackSpec): void {
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + spec.width / 2) / spec.width, (pos.getY(i) + spec.height / 2) / spec.height);
  uv.needsUpdate = true;
}

class PackLayer {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];
  private readonly basic: MeshBasicMaterial[] = [];
  private readonly textures: CanvasTexture[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly sticker: Mesh | null;
  readonly spec: PackSpec;

  constructor(readonly facts: PackFacts, readonly key: string) {
    const spec = (this.spec = specFor(facts.format));
    const shape = new Shape();
    spec.outline.forEach(([u, v], i) => {
      const x = (u - 0.5) * spec.width;
      const y = (0.5 - v) * spec.height;
      if (i) shape.lineTo(x, y);
      else shape.moveTo(x, y);
    });
    shape.closePath();

    const sides = new ExtrudeGeometry(shape, { depth: spec.depth, bevelEnabled: false, steps: 1 });
    sides.translate(0, 0, -spec.depth / 2);
    const hidden = new MeshBasicMaterial({ visible: false });
    const sideMat = litMaterial(null, [110 / 255, 12 / 255, 22 / 255]);
    this.materials.push(sideMat);
    this.basic.push(hidden);
    this.geometries.push(sides);
    this.group.add(new Mesh(sides, [hidden, sideMat]));

    const frontTex = textureOf(spec.texW, spec.texH, frontOps(spec, facts), { grain: seedOf(key + "f"), lamp: true });
    const backTex = textureOf(spec.texW, spec.texH, backOps(spec, facts), { grain: seedOf(key + "b"), lamp: true });
    this.textures.push(frontTex, backTex);
    const frontMat = litMaterial(frontTex, [1, 1, 1]);
    const backMat = litMaterial(backTex, [1, 1, 1]);
    this.materials.push(frontMat, backMat);

    const frontGeo = new ShapeGeometry(shape);
    normalise(frontGeo, spec);
    const front = new Mesh(frontGeo, frontMat);
    front.position.z = spec.depth / 2 + 0.0005;
    const backGeo = new ShapeGeometry(shape);
    normalise(backGeo, spec);
    const back = new Mesh(backGeo, backMat);
    back.rotation.y = Math.PI;
    back.position.z = -spec.depth / 2 - 0.0005;
    this.geometries.push(frontGeo, backGeo);
    this.group.add(front, back);

    const art = stickerArt(spec, facts);
    if (art) {
      const tex = textureOf(art.w, art.h, art.ops);
      this.textures.push(tex);
      const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.basic.push(mat);
      const pose = stickerPose(spec, facts.format, 1);
      const plane = new PlaneGeometry(pose.widthWorld, pose.heightWorld);
      this.geometries.push(plane);
      this.sticker = new Mesh(plane, mat);
      this.sticker.position.z = 0.004;
      back.add(this.sticker);
    } else this.sticker = null;
  }

  pose(yawDeg: number, progress: number, showSticker: boolean, opacity: number): void {
    this.group.rotation.y = (yawDeg * Math.PI) / 180;
    for (const m of this.materials) m.uniforms["uOpacity"]!.value = opacity;
    for (const m of this.basic) if (m instanceof MeshBasicMaterial) m.opacity = opacity;
    if (this.sticker) {
      this.sticker.visible = showSticker;
      const p = stickerPose(this.spec, this.facts.format, progress);
      this.sticker.position.x = (p.cx - 0.5) * this.spec.width;
      this.sticker.position.y = (0.5 - p.cy) * this.spec.height;
      this.sticker.rotation.z = (-p.tiltDeg * Math.PI) / 180;
    }
  }

  dispose(): void {
    for (const t of this.textures) t.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of this.basic) m.dispose();
  }
}

export interface DrawItem {
  id: string;
  /** layers to draw, back to front: `facts` with opacity */
  layers: Array<{ facts: PackFacts; key: string; opacity: number }>;
  view: View;
  yawDeg: number;
  progress: number;
  sticker: boolean;
}

interface Instance {
  scene: Scene;
  camera: PerspectiveCamera;
  layers: Map<string, PackLayer>;
}

export class WebglStage {
  private readonly renderer: WebGLRenderer;
  private readonly instances = new Map<string, Instance>();
  private width = 0;
  private height = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) throw new Error("WebGL is not available");
    this.renderer = new WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true, premultipliedAlpha: true });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(width, height, false);
  }

  isLost(): boolean {
    return this.renderer.getContext().isContextLost();
  }

  private instance(id: string): Instance {
    let found = this.instances.get(id);
    if (!found) {
      found = { scene: new Scene(), camera: new PerspectiveCamera(30, 1, 0.1, 50), layers: new Map() };
      this.instances.set(id, found);
    }
    return found;
  }

  draw(items: DrawItem[]): void {
    const r = this.renderer;
    r.clear(true, true, true);
    const live = new Set(items.map((i) => i.id));
    for (const [id, inst] of this.instances) {
      if (live.has(id)) continue;
      for (const layer of inst.layers.values()) {
        inst.scene.remove(layer.group);
        layer.dispose();
      }
      this.instances.delete(id);
    }
    for (const item of items) {
      const inst = this.instance(item.id);
      const wanted = new Set(item.layers.map((l) => l.key));
      for (const [key, layer] of inst.layers) {
        if (wanted.has(key)) continue;
        inst.scene.remove(layer.group);
        layer.dispose();
        inst.layers.delete(key);
      }
      item.layers.forEach((l, index) => {
        let layer = inst.layers.get(l.key);
        if (!layer) {
          layer = new PackLayer(l.facts, l.key);
          inst.layers.set(l.key, layer);
          inst.scene.add(layer.group);
        }
        layer.pose(item.yawDeg, item.progress, item.sticker, l.opacity);
        layer.group.renderOrder = index;
        layer.group.traverse((o) => (o.renderOrder = index));
      });
      const { view } = item;
      const cam = inst.camera;
      cam.fov = (2 * Math.atan(this.height / 2 / view.focal) * 180) / Math.PI;
      cam.aspect = this.width / this.height;
      cam.position.set(0, 0, view.camZ);
      cam.setViewOffset(this.width, this.height, this.width / 2 - view.cx, this.height / 2 - view.cy, this.width, this.height);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      r.clearDepth();
      r.render(inst.scene, cam);
    }
  }

  dispose(): void {
    for (const inst of this.instances.values()) for (const layer of inst.layers.values()) layer.dispose();
    this.instances.clear();
    this.renderer.dispose();
  }
}
