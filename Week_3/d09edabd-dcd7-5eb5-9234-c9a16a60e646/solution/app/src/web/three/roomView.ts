import {
  AmbientLight, Box3, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DataTexture, DirectionalLight, DoubleSide, EdgesGeometry, Float32BufferAttribute,
  Group, HemisphereLight, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshToonMaterial, NearestFilter, Object3D, PerspectiveCamera, PlaneGeometry, Raycaster,
  RedFormat, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector2, Vector3, WebGLRenderer, type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface RoomDims {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface DrawPlacement {
  id: string;
  kind: 'door' | 'box' | 'cylinder' | 'prop';
  label: string;
  propId: string | null;
  xMm: number;
  yMm: number;
  zMm: number;
  rotationDeg: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface Marker {
  id: string;
  label: string;
  xMm: number;
  zMm: number;
  headingDeg: number;
}

export interface CuePoint {
  id: string;
  xMm: number;
  yMm: number;
  zMm: number;
  lit: boolean;
}

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

type Pick = { kind: 'placement'; id: string } | { kind: 'handle'; id: string; corner: number } | { kind: 'floor'; xMm: number; zMm: number };

const MM = 0.001;
export const worldOf = (xMm: number, yMm: number, zMm: number): Vector3 => new Vector3(xMm * MM, yMm * MM, -zMm * MM);

export function webglSupported(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

const PALETTE = { wood: 0xb5713a, woodDark: 0x8e5429, brass: 0xc9a227, sea: 0x1f7a8c, seaDeep: 0x185a73, prop: 0x7a4fb0, floor: 0x232a38, floorBright: 0x5a3d2b, wall: 0x2b3446, wallBright: 0x2f6f8f };

function toonGradient(): DataTexture {
  const texture = new DataTexture(new Uint8Array([70, 140, 210, 255]), 4, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const GRID_VERTEX = `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GRID_FRAGMENT = `
  varying vec3 vWorld; uniform vec3 uCentre; uniform vec3 uColour;
  float line(float coord, float width) { float d = abs(fract(coord - 0.5) - 0.5) / fwidth(coord); return 1.0 - min(d / width, 1.0); }
  void main() {
    float minor = max(line(vWorld.x, 1.0), line(vWorld.z, 1.0));
    float major = max(line(vWorld.x / 8.0, 1.4), line(vWorld.z / 8.0, 1.4));
    float dist = distance(vWorld.xz, uCentre.xz);
    float fade = 1.0 - smoothstep(14.0, 70.0, dist);
    float alpha = (minor * 0.28 + major * 0.5) * fade;
    gl_FragColor = vec4(uColour, alpha);
  }`;

const loader = new GLTFLoader();
const modelCache = new Map<string, Promise<Object3D | null>>();

/** The uploaded model of a prop, fetched once; null when it cannot be read (a plain box stands in). */
function propModel(propId: string): Promise<Object3D | null> {
  let model = modelCache.get(propId);
  if (!model) {
    model = fetch(`/api/props/${propId}/file`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('no file'))))
      .then((buffer) => loader.parseAsync(buffer, ''))
      .then((gltf) => {
        let meshes = 0;
        gltf.scene.traverse((o) => void ((o as Mesh).isMesh && meshes++));
        return meshes > 0 ? gltf.scene : null;
      })
      .catch(() => null);
    modelCache.set(propId, model);
  }
  return model;
}

function labelSprite(text: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgba(17,21,29,0.85)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 12);
  g.fill();
  g.fillStyle = '#e6e9ef';
  g.font = '600 26px Inter, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 18), 128, 33);
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set(0.9, 0.225, 1);
  sprite.renderOrder = 10;
  return sprite;
}

interface Options {
  /** A static card render: bright toon colours, no endless grid. */
  thumbnail?: boolean;
}

/** The 3D stage: a room built from stored millimetres, drawn on demand (no idle frames). */
export class RoomView {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.05, 600);
  private readonly roomGroup = new Group();
  private readonly placementGroup = new Group();
  private readonly markerGroup = new Group();
  private readonly cueGroup = new Group();
  private readonly gradient = toonGradient();
  private readonly bright: boolean;
  private grid: ShaderMaterial | null = null;
  private dims: RoomDims = { widthMm: 3000, depthMm: 3000, heightMm: 2400 };
  private frame = 0;
  private size = new Vector2(1, 1);
  private selected: string | null = null;
  private showHandles = false;
  private readonly raycaster = new Raycaster();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: Options = {}) {
    this.canvas = canvas;
    this.bright = options.thumbnail === true;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: this.bright, alpha: false });
    this.renderer.setClearColor(this.bright ? 0x16324a : 0x11151d, 1);
    this.scene.add(this.roomGroup, this.placementGroup, this.markerGroup, this.cueGroup);
    this.scene.add(new AmbientLight(0xffffff, this.bright ? 1.1 : 0.7));
    this.scene.add(new HemisphereLight(0x9bb7ff, 0x2a2018, this.bright ? 0.9 : 0.55));
    const sun = new DirectionalLight(0xfff1dc, this.bright ? 2.4 : 1.6);
    sun.position.set(4, 9, 6);
    this.scene.add(sun);
    if (!this.bright) this.addGrid();
  }

  private addGrid(): void {
    this.grid = new ShaderMaterial({
      vertexShader: GRID_VERTEX, fragmentShader: GRID_FRAGMENT, transparent: true, depthWrite: false,
      uniforms: { uCentre: { value: new Vector3() }, uColour: { value: new Color(0x6f7d99) } },
    });
    const plane = new Mesh(new PlaneGeometry(400, 400), this.grid);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.004;
    plane.renderOrder = -1;
    this.scene.add(plane);
  }

  setSize(width: number, height: number, ratio: number): void {
    this.size.set(Math.max(1, width), Math.max(1, height));
    this.renderer.setPixelRatio(Math.min(2, ratio));
    this.renderer.setSize(this.size.x, this.size.y, false);
    this.camera.aspect = this.size.x / this.size.y;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  setPose(pose: Pose): void {
    this.camera.position.set(...pose.position);
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(...pose.target);
    this.grid?.uniforms.uCentre!.value.set(pose.target[0], 0, pose.target[2]);
    this.sizeCues();
    this.invalidate();
  }

  setRoom(dims: RoomDims): void {
    this.dims = dims;
    this.roomGroup.clear();
    const { widthMm, depthMm, heightMm } = dims;
    const w = widthMm * MM;
    const d = depthMm * MM;
    const h = heightMm * MM;
    const floorMaterial = new MeshToonMaterial({ color: this.bright ? PALETTE.floorBright : PALETTE.floor, gradientMap: this.gradient });
    const floor = new Mesh(new PlaneGeometry(w, d), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w / 2, 0, -d / 2);
    floor.name = 'floor';
    this.roomGroup.add(floor);
    // Planes facing inward: front (z = 0), back, left, right. Only the faces seen from inside draw, so near walls never hide the room.
    const quads: { length: number; x: number; z: number; turn: number }[] = [
      { length: w, x: w / 2, z: 0, turn: Math.PI },
      { length: w, x: w / 2, z: -d, turn: 0 },
      { length: d, x: 0, z: -d / 2, turn: Math.PI / 2 },
      { length: d, x: w, z: -d / 2, turn: -Math.PI / 2 },
    ];
    for (const q of quads) {
      const wall = new Mesh(new PlaneGeometry(q.length, h), new MeshToonMaterial({ color: this.bright ? PALETTE.wallBright : PALETTE.wall, gradientMap: this.gradient }));
      wall.position.set(q.x, h / 2, q.z);
      wall.rotation.y = q.turn;
      this.roomGroup.add(wall);
    }
    const rim = new BufferGeometry();
    const corners = [[0, 0], [w, 0], [w, -d], [0, -d]] as const;
    const positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]!;
      const [bx, bz] = corners[(i + 1) % 4]!;
      positions.push(ax, h, az, bx, h, bz, ax, 0, az, ax, h, az);
    }
    rim.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.roomGroup.add(new LineSegments(rim, new LineBasicMaterial({ color: this.bright ? 0xbfd9ea : 0x56627a })));
    this.invalidate();
  }

  private placementMaterial(p: DrawPlacement, index: number): Material {
    const colour = p.kind === 'door' ? PALETTE.brass : p.kind === 'cylinder' ? (index % 2 ? PALETTE.sea : PALETTE.seaDeep) : p.kind === 'prop' ? PALETTE.prop : index % 2 ? PALETTE.wood : PALETTE.woodDark;
    return new MeshToonMaterial({ color: colour, gradientMap: this.gradient, side: DoubleSide });
  }

  setPlacements(placements: DrawPlacement[], selectedId: string | null = null, showHandles = false): void {
    this.selected = selectedId;
    this.showHandles = showHandles;
    this.placementGroup.clear();
    placements.forEach((p, index) => this.placementGroup.add(this.buildPlacement(p, index, p.id === selectedId)));
    this.invalidate();
  }

  private buildPlacement(p: DrawPlacement, index: number, selected: boolean): Group {
    const group = new Group();
    group.userData.placementId = p.id;
    const w = p.widthMm * MM;
    const h = p.heightMm * MM;
    const d = p.depthMm * MM;
    const material = this.placementMaterial(p, index);
    let body: Mesh;
    if (p.kind === 'cylinder') {
      body = new Mesh(new CylinderGeometry(0.5, 0.5, h, 18), material);
      body.scale.set(w, 1, d);
    } else {
      body = new Mesh(new BoxGeometry(w, h, d), material);
    }
    body.position.y = h / 2;
    body.userData.placementId = p.id;
    group.add(body);
    if (p.kind === 'prop' && p.propId) {
      void propModel(p.propId).then((model) => {
        if (!model || this.disposed) return;
        const copy = model.clone(true);
        const extent = new Box3().setFromObject(copy).getSize(new Vector3());
        copy.scale.set(w / (extent.x || 1), h / (extent.y || 1), d / (extent.z || 1));
        copy.traverse((o) => (o.userData.placementId = p.id));
        body.visible = false;
        group.add(copy);
        this.invalidate();
      });
    }
    group.position.copy(worldOf(p.xMm, p.yMm, p.zMm));
    group.rotation.y = (p.rotationDeg * Math.PI) / 180;
    if (selected) {
      group.add(new LineSegments(new EdgesGeometry(body.geometry), new LineBasicMaterial({ color: 0x3b82f6 })));
      group.children[group.children.length - 1]!.position.y = h / 2;
      group.children[group.children.length - 1]!.scale.copy(body.scale);
      if (this.showHandles) this.addHandles(group, w, h, d);
    }
    return group;
  }

  private addHandles(group: Group, w: number, h: number, d: number): void {
    const size = Math.max(0.12, Math.min(w, d) * 0.12);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], corner) => {
      const handle = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial({ color: 0x3b82f6, depthTest: false }));
      handle.position.set((sx! * w) / 2, h, (sz! * d) / 2);
      handle.renderOrder = 5;
      handle.userData.placementId = this.selected;
      handle.userData.handle = corner;
      group.add(handle);
    });
  }

  setMarkers(markers: Marker[]): void {
    this.markerGroup.clear();
    for (const m of markers) {
      const body = new Mesh(new CylinderGeometry(0.16, 0.2, 1.5, 12), new MeshToonMaterial({ color: 0xe8572e, gradientMap: this.gradient }));
      body.position.set(m.xMm * MM, 0.75, -m.zMm * MM);
      const label = labelSprite(m.label);
      label.position.set(m.xMm * MM, 1.95, -m.zMm * MM);
      this.markerGroup.add(body, label);
    }
    this.invalidate();
  }

  setCues(cues: CuePoint[]): void {
    this.cueGroup.clear();
    for (const c of cues) {
      const sphere = new Mesh(new SphereGeometry(0.07, 24, 16), new MeshBasicMaterial({ color: c.lit ? 0x3b82f6 : 0x4b5568 }));
      sphere.position.copy(worldOf(c.xMm, c.yMm, c.zMm));
      this.cueGroup.add(sphere);
    }
    this.sizeCues();
    this.invalidate();
  }

  /** Cue markers shrink as the camera nears them, so they stay small dots at player height. */
  private sizeCues(): void {
    for (const cue of this.cueGroup.children) cue.scale.setScalar(Math.max(0.3, Math.min(1.4, cue.position.distanceTo(this.camera.position) / 4)));
  }

  /** What is under a canvas point: a scale handle, a placement, or the floor (in whole millimetres). */
  pick(clientX: number, clientY: number): Pick | null {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    this.scene.updateMatrixWorld(true);
    const hits = this.raycaster.intersectObjects(this.placementGroup.children, true);
    for (const hit of hits) {
      const id = hit.object.userData.placementId as string | undefined;
      if (id === undefined) continue;
      if (typeof hit.object.userData.handle === 'number') return { kind: 'handle', id, corner: hit.object.userData.handle };
      return { kind: 'placement', id };
    }
    const point = this.floorPoint(clientX, clientY);
    return point ? { kind: 'floor', ...point } : null;
  }

  floorPoint(clientX: number, clientY: number): { xMm: number; zMm: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const { origin, direction } = this.raycaster.ray;
    if (Math.abs(direction.y) < 1e-6) return null;
    const t = -origin.y / direction.y;
    if (t < 0) return null;
    return { xMm: Math.round((origin.x + direction.x * t) / MM), zMm: Math.round(-(origin.z + direction.z * t) / MM) };
  }

  invalidate(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Renders right now (used for stills such as thumbnails). */
  renderNow(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get roomDims(): RoomDims {
    return this.dims;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
  }
}
