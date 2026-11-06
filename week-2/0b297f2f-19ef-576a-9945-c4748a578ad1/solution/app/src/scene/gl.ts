// The 3D gallery, built entirely in code: floor, four lit walls at their seeded sizes, each work a
// thin framed panel at its true size, the accent hang line, the lux map and the grain dissolve.
import * as THREE from "three";
import type { Frame, Rect, SceneRenderer, WallLabelSpot } from "./director";
import { EYE_CM } from "./director";
import { frameWalls, luxColour, roomSize, uprightAngle, wallPoint, type WallFrame } from "./room";

const COLOURS = {
  ground: 0xf3f0e8,
  floor: 0xd8d1c3,
  stone: 0xb8b0a2,
  skirting: 0x9e968a,
  ink: 0x1c1b18,
  frame: 0x2b2925,
  paper: 0xf1ece1,
  accent: 0xb5501c,
  over: 0x8c2a1c,
};

const FOV = 55;
/** How much ceiling the eye-line view shows above the wall top, in metres, so the room reads as a room. */
const CEILING_MARGIN_M = 0.15;
/** How far past a wall's end the eye-line view may run, in metres: enough to show the corner. */
const CORNER_M = 0.9;
/** The wall shading's darkest point, at the floor and the ceiling, as a share of its light at the hang line. */
const WALL_FALLOFF = 0.84;
/** The selection outline: its width and its gap outside the frame, in metres (about 2 px and 4 px at the eye line). */
const SELECT_WIDTH_M = 0.024;
const SELECT_GAP_M = 0.045;
const FRAME_MM = 25;
/** The Light view outline's width, so it reads as a band of colour, not a hairline. */
const OUTLINE_M = 0.03;
/** Room left around the walls in the plan, in metres: enough for the wall names. */
const PLAN_MARGIN_M = 1.3;
/** How far outside its wall a wall name sits in the plan, in metres. */
const LABEL_OUT_M = 0.3;

function hatchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#FBFAF6";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "#8C2A1C";
  ctx.lineWidth = 6;
  for (let i = -64; i <= 128; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 64);
    ctx.lineTo(i + 64, 0);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const DISSOLVE_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const DISSOLVE_FRAGMENT = `
precision highp float;
uniform sampler2D picture;
uniform float progress;
uniform vec2 resolution;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float grain = 0.62 * hash(floor(gl_FragCoord.xy / 2.0)) + 0.38 * noise(vUv * resolution / 48.0);
  if (grain < progress) discard;
  gl_FragColor = texture2D(picture, vUv);
}`;

interface WorkMeshes {
  group: THREE.Group;
  frame: THREE.Mesh;
  hatch: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  outline: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  select: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  size: [number, number];
}

/** Shades a wall plane brightest along the hang line and a little darker toward the floor and the ceiling. */
function wallShading(geometry: THREE.PlaneGeometry, heightM: number): THREE.PlaneGeometry {
  const position = geometry.getAttribute("position");
  const eye = EYE_CM / 100;
  const shade = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) + heightM / 2;
    const t = y >= eye ? (y - eye) / (heightM - eye) : (eye - y) / eye;
    shade.fill(1 - (1 - WALL_FALLOFF) * t * t, i * 3, i * 3 + 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(shade, 3));
  return geometry;
}

/** A flat rectangular band around a work, `thickness` wide, starting `pad` outside its edges. */
function rectRing(w: number, h: number, pad: number, thickness: number): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  const rect = (x: number, y: number) =>
    [new THREE.Vector2(-x, -y), new THREE.Vector2(x, -y), new THREE.Vector2(x, y), new THREE.Vector2(-x, y)];
  const inner = w / 2 + pad;
  const shape = new THREE.Shape(rect(inner + thickness, h / 2 + pad + thickness));
  shape.holes.push(new THREE.Path(rect(inner, h / 2 + pad).reverse()));
  return new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: COLOURS.ink, transparent: true, opacity: 0, depthWrite: false }),
  );
}

export class GlRenderer implements SceneRenderer {
  readonly kind = "webgl" as const;
  readonly element: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
  private readonly hatch = hatchTexture();
  private room = new THREE.Group();
  private wallMaterials = new Map<string, THREE.MeshLambertMaterial>();
  private hangLines: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[] = [];
  private frames: WallFrame[] = [];
  private roomKey = "";
  private works = new Map<string, WorkMeshes>();
  private width = 1;
  private height = 1;
  private lastEye = 0;
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly overlayScene = new THREE.Scene();
  private readonly overlayCamera = new THREE.Camera();
  private readonly overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  constructor() {
    this.element = document.createElement("canvas");
    this.element.className = "scene-canvas";
    this.renderer = new THREE.WebGLRenderer({ canvas: this.element, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(COLOURS.ground);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0xcfc6b6, 2.7));
    const sun = new THREE.DirectionalLight(0xfff6ea, 1.1);
    sun.position.set(2, 10, 4);
    this.scene.add(sun);
    this.scene.add(this.room);
    this.overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { picture: { value: null }, progress: { value: 0 }, resolution: { value: new THREE.Vector2(1, 1) } },
        vertexShader: DISSOLVE_VERTEX,
        fragmentShader: DISSOLVE_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.overlay.frustumCulled = false;
    this.overlayScene.add(this.overlay);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.target?.dispose();
    this.target = null;
  }

  private buildRoom(frame: Frame): void {
    const key = frame.walls.map((w) => `${w.id}:${w.lengthMm}:${w.heightMm}`).join("|");
    if (key === this.roomKey) return;
    this.roomKey = key;
    this.scene.remove(this.room);
    this.room = new THREE.Group();
    this.scene.add(this.room);
    this.wallMaterials.clear();
    this.hangLines = [];
    this.frames = frameWalls(frame.walls);
    const size = roomSize(frame.walls);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size.width, size.depth),
      new THREE.MeshLambertMaterial({ color: COLOURS.floor }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.room.add(floor);
    // A quiet one-metre grid on the floor gives the plan its scale.
    const grid: THREE.Vector3[] = [];
    for (let x = -size.width / 2 + 1; x < size.width / 2 - 0.01; x += 1) grid.push(new THREE.Vector3(x, 0.002, -size.depth / 2), new THREE.Vector3(x, 0.002, size.depth / 2));
    for (let z = -size.depth / 2 + 1; z < size.depth / 2 - 0.01; z += 1) grid.push(new THREE.Vector3(-size.width / 2, 0.002, z), new THREE.Vector3(size.width / 2, 0.002, z));
    this.room.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(grid),
        new THREE.LineBasicMaterial({ color: COLOURS.skirting, transparent: true, opacity: 0.35 }),
      ),
    );
    // The ceiling faces down, so the plan camera above it sees straight through.
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(size.width, size.depth),
      new THREE.MeshLambertMaterial({ color: COLOURS.ground }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = size.height;
    this.room.add(ceiling);
    for (const f of this.frames) {
      const length = f.spec.lengthMm / 1000;
      const height = f.spec.heightMm / 1000;
      const material = new THREE.MeshLambertMaterial({ color: COLOURS.stone, vertexColors: true });
      this.wallMaterials.set(f.spec.id, material);
      const wall = new THREE.Mesh(wallShading(new THREE.PlaneGeometry(length, height, 1, 16), height), material);
      const [cx, , cz] = wallPoint(f, f.spec.lengthMm / 2, 0);
      wall.position.set(cx, height / 2, cz);
      wall.rotation.y = Math.atan2(f.normal[0], f.normal[1]);
      this.room.add(wall);
      const skirting = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.08, 0.02),
        new THREE.MeshLambertMaterial({ color: COLOURS.skirting }),
      );
      skirting.position.set(cx + f.normal[0] * 0.01, 0.04, cz + f.normal[1] * 0.01);
      skirting.rotation.y = wall.rotation.y;
      this.room.add(skirting);
      const a = wallPoint(f, 0, EYE_CM * 10, 0.004);
      const b = wallPoint(f, f.spec.lengthMm, EYE_CM * 10, 0.004);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]),
        new THREE.LineBasicMaterial({ color: COLOURS.accent, transparent: true, opacity: 0 }),
      );
      this.hangLines.push(line);
      this.room.add(line);
    }
  }

  private syncWorks(frame: Frame): void {
    const ids = new Set(frame.works.map((w) => w.id));
    for (const [id, meshes] of this.works) {
      if (!ids.has(id)) {
        this.scene.remove(meshes.group);
        this.works.delete(id);
      }
    }
    for (const work of frame.works) {
      const w = work.widthMm / 1000;
      const h = work.heightMm / 1000;
      let meshes = this.works.get(work.id);
      if (!meshes || meshes.size[0] !== w || meshes.size[1] !== h) {
        if (meshes) this.scene.remove(meshes.group);
        const border = FRAME_MM / 1000;
        const group = new THREE.Group();
        const frameMesh = new THREE.Mesh(
          new THREE.BoxGeometry(w + border * 2, h + border * 2, 0.03),
          new THREE.MeshLambertMaterial({ color: COLOURS.frame }),
        );
        frameMesh.position.z = 0.015;
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ color: COLOURS.paper }));
        panel.position.z = 0.0305;
        const hatchMap = this.hatch.clone();
        hatchMap.repeat.set(Math.max(1, w / 0.12), Math.max(1, h / 0.12));
        hatchMap.needsUpdate = true;
        const hatchMaterial = new THREE.MeshBasicMaterial({ map: hatchMap, transparent: true, opacity: 0, depthWrite: false });
        const hatch = new THREE.Mesh(new THREE.PlaneGeometry(w + border * 2, h + border * 2), hatchMaterial);
        hatch.position.z = 0.032;
        const outline = rectRing(w, h, border + 0.006, OUTLINE_M);
        outline.position.z = 0.033;
        const select = rectRing(w, h, border + SELECT_GAP_M, SELECT_WIDTH_M);
        select.position.z = 0.034;
        group.add(frameMesh, panel, hatch, outline, select);
        meshes = { group, frame: frameMesh, hatch, outline, select, size: [w, h] };
        this.works.set(work.id, meshes);
        this.scene.add(group);
      }
      const f = this.frames.find((x) => x.spec.id === work.wallId);
      if (!f) continue;
      const [x, y, z] = wallPoint(f, work.offsetMm, work.centreHeightMm + work.liftMm, 0.002);
      meshes.group.position.set(x, y, z);
      meshes.group.rotation.y = Math.atan2(f.normal[0], f.normal[1]);
      const over = work.luxStatus === "over";
      meshes.outline.material.color.setHex(over ? COLOURS.over : COLOURS.ink);
      meshes.outline.material.opacity = frame.luxMix;
      meshes.hatch.material.opacity = over ? frame.luxMix : 0;
      meshes.select.material.opacity = work.id === frame.selectedId ? frame.selectAlpha : 0;
    }
  }

  private placeCamera(frame: Frame): void {
    const { camera: cam } = frame;
    const size = roomSize(frame.walls);
    const facing = this.frames.find((f) => f.spec.id === cam.facingWallId) ?? this.frames[0];
    const yaw = (cam.yaw * Math.PI) / 180;
    const forward = [Math.sin(yaw), -Math.cos(yaw)];
    let eyeX = 0;
    let eyeZ = 0;
    if (facing) {
      // At the eye line the camera stands back in front of the selected work (or the wall's middle),
      // far enough to see the floor, the ceiling line and, near a wall's end, the corner beyond it.
      const halfV = Math.tan((FOV * Math.PI) / 360);
      const halfH = halfV * this.camera.aspect;
      const lengthM = facing.spec.lengthMm / 1000;
      const across = facing.normal[0] === 0 ? size.depth : size.width;
      const above = facing.spec.heightMm / 1000 - EYE_CM / 100 + CEILING_MARGIN_M;
      const distance = Math.min(above / halfV, across - 0.4);
      const reach = Math.min(lengthM / 2, Math.max(0, distance * halfH - CORNER_M));
      const stand = Math.min(Math.max((cam.standMm ?? facing.spec.lengthMm / 2) / 1000, reach), lengthM - reach);
      const centre = wallPoint(facing, stand * 1000, 0);
      eyeX = centre[0] - forward[0] * distance;
      eyeZ = centre[2] - forward[1] * distance;
    }
    const e = cam.eye;
    this.lastEye = e;
    this.camera.position.set(eyeX * e, cam.heightCm / 100, eyeZ * e);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set((-Math.PI / 2) * (1 - e), -yaw, 0);
    const planFit = Math.max(size.depth + PLAN_MARGIN_M, (size.width + PLAN_MARGIN_M) / this.camera.aspect);
    // The wall tops are the nearest, widest part of the room seen from above: fit those.
    const planFov = (2 * Math.atan(planFit / 2 / (cam.heightCm / 100 - size.height)) * 180) / Math.PI;
    this.camera.fov = FOV + (Math.min(planFov, 80) - FOV) * (1 - e);
    this.camera.zoom = cam.zoom;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private applyLux(frame: Frame): void {
    for (const f of this.frames) {
      const lux = frame.walls.find((w) => w.id === f.spec.id)?.plannedLux ?? 0;
      const [r, g, b] = luxColour(lux);
      const stone = new THREE.Color(COLOURS.stone);
      stone.lerp(new THREE.Color(`rgb(${r},${g},${b})`), frame.luxMix);
      this.wallMaterials.get(f.spec.id)?.color.copy(stone);
    }
    for (const line of this.hangLines) line.material.opacity = frame.hangOpacity;
  }

  captureForDissolve(frame: Frame): void {
    this.prepare(frame);
    if (!this.target) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.target = new THREE.WebGLRenderTarget(size.x, size.y);
      this.target.texture.colorSpace = THREE.SRGBColorSpace;
    }
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  private prepare(frame: Frame): void {
    this.buildRoom(frame);
    this.syncWorks(frame);
    this.applyLux(frame);
    this.placeCamera(frame);
  }

  draw(frame: Frame): void {
    this.prepare(frame);
    this.renderer.render(this.scene, this.camera);
    if (frame.dissolve !== null && this.target) {
      const material = this.overlay.material;
      material.uniforms.picture.value = this.target.texture;
      material.uniforms.progress.value = frame.dissolve;
      material.uniforms.resolution.value.set(this.width, this.height);
      this.renderer.autoClear = false;
      this.renderer.render(this.overlayScene, this.overlayCamera);
      this.renderer.autoClear = true;
    }
  }

  workRect(id: string): Rect | null {
    const meshes = this.works.get(id);
    if (!meshes) return null;
    const box = new THREE.Box3().setFromObject(meshes.frame);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, y, z).project(this.camera);
          if (p.z > 1) return null;
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
    const left = ((minX + 1) / 2) * this.width;
    const right = ((maxX + 1) / 2) * this.width;
    const top = ((1 - maxY) / 2) * this.height;
    const bottom = ((1 - minY) / 2) * this.height;
    if (right < 0 || left > this.width || bottom < 0 || top > this.height) return null;
    const x = Math.max(0, left);
    const y = Math.max(0, top);
    return { x, y, width: Math.min(this.width, right) - x, height: Math.min(this.height, bottom) - y };
  }

  wallLabelSpot(wallId: string): WallLabelSpot | null {
    const f = this.frames.find((w) => w.spec.id === wallId);
    if (!f) return null;
    const screen = (offsetMm: number) => {
      const p = new THREE.Vector3(...wallPoint(f, offsetMm, f.spec.heightMm, -LABEL_OUT_M)).project(this.camera);
      return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height };
    };
    const mid = screen(f.spec.lengthMm / 2);
    const a = screen(0);
    const b = screen(f.spec.lengthMm);
    return { ...mid, angleDeg: uprightAngle(a, b) };
  }

  pointerOffset(wallId: string, x: number, y: number): number | null {
    const f = this.frames.find((w) => w.spec.id === wallId);
    if (!f) return null;
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // Looking down, a work slides along its wall's foot on the floor; at eye height, on the wall face.
    const plane =
      this.lastEye < 0.5
        ? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        : new THREE.Plane().setFromNormalAndCoplanarPoint(
            new THREE.Vector3(f.normal[0], 0, f.normal[1]),
            new THREE.Vector3(f.start[0], 0, f.start[1]),
          );
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    return ((hit.x - f.start[0]) * f.dir[0] + (hit.z - f.start[1]) * f.dir[1]) * 1000;
  }

  dispose(): void {
    this.target?.dispose();
    this.renderer.dispose();
  }
}
