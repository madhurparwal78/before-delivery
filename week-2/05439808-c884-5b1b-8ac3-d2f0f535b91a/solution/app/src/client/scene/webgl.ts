// The procedural 3D island: cracked salt crust, tidal channels around the deploy ring, low-poly
// buildings with distinct silhouettes, floating level badges and a low warm dusk light.
import * as THREE from 'three';
import { BUILD_AREA_MIN, BUILDINGS, GRID_SIZE, type BuildingType } from '../../shared/catalog';
import { footprint } from '../../shared/grid';
import { drawSaltCrust } from './salt';
import type { Camera, DrawState, Renderer, SceneBuilding } from './types';

const HALF = GRID_SIZE / 2;
const ELEVATION = (35 * Math.PI) / 180;
const DISTANCE = 64;

const C = {
  ground: 0x1a1838,
  salt: 0xede8da,
  saltShade: 0xc9c2b0,
  slab: 0xb3ab99,
  slate: 0x4a4670,
  dark: 0x2e2b55,
  peat: 0x3a3552,
  wood: 0x8e88a6,
  teal: 0x5fbfb3,
  patina: 0x4e9e95,
  brine: 0xb8e3dc,
  water: 0x4fa79d,
  sea: 0x22385a,
  ink: 0xf3efe4,
  accent: 0xf2933f,
  brick: 0xe06a58,
  rubble: 0x6d6782,
  light: 0xf6e2c8,
};

type Materials = Record<'salt' | 'saltShade' | 'slate' | 'dark' | 'peat' | 'wood' | 'teal' | 'patina' | 'brine' | 'rubble', THREE.MeshLambertMaterial>;

function materials(): Materials {
  const m = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true });
  return {
    salt: m(C.salt), saltShade: m(C.saltShade), slate: m(C.slate), dark: m(C.dark), peat: m(C.peat), wood: m(C.wood),
    teal: m(C.teal), patina: m(C.patina), brine: m(C.brine), rubble: m(C.rubble),
  };
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rTop: number, rBottom: number, h: number, mat: THREE.Material, segments = 8, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function prism(w: number, h: number, d: number, mat: THREE.Material, y: number): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  mesh.castShadow = true;
  return mesh;
}

/** One low-poly model per building type; footprint w × d (cells), origin at the footprint centre. */
function model(type: BuildingType, w: number, d: number, m: Materials): { group: THREE.Group; height: number } {
  const g = new THREE.Group();
  let height = 1;
  switch (type) {
    case 'brine_pan': {
      g.add(box(w - 0.2, 0.25, d - 0.2, m.saltShade));
      for (const [px, pz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) g.add(box(1.1, 0.06, 1.1, m.brine, px, 0.25, pz));
      const heap = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 6), m.salt);
      heap.position.set(w / 2 - 0.5, 0.6, -d / 2 + 0.5);
      heap.castShadow = true;
      g.add(heap);
      height = 1;
      break;
    }
    case 'peat_cutter': {
      g.add(box(w - 0.4, 0.9, d - 0.8, m.wood, 0, 0, -0.3));
      const roof = prism(w - 0.1, 0.7, d - 0.6, m.dark, 0.9);
      roof.position.z = -0.3;
      g.add(roof);
      for (let i = 0; i < 3; i += 1) g.add(box(0.5, 0.22, 0.32, m.peat, -0.35 + (i % 2) * 0.5, 0.22 * Math.floor(i / 2), d / 2 - 0.45));
      height = 1.6;
      break;
    }
    case 'copper_sluice': {
      const trough = box(0.7, 0.3, d - 0.3, m.patina);
      trough.rotation.x = -0.25;
      trough.position.y = 0.7;
      g.add(trough);
      for (const z of [-1, 0, 1]) g.add(box(0.12, 0.7 - z * 0.25, 0.12, m.wood, 0.45, 0, z));
      const wheel = cyl(0.55, 0.55, 0.18, m.teal, 10, -0.55, 0.3, d / 2 - 0.7);
      wheel.rotation.z = Math.PI / 2;
      g.add(wheel);
      height = 1.4;
      break;
    }
    case 'brine_cistern': {
      g.add(cyl(1.2, 1.3, 1.3, m.salt, 12));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.brine);
      dome.position.y = 1.3;
      dome.castShadow = true;
      g.add(dome);
      height = 2.5;
      break;
    }
    case 'peat_rick': {
      for (let row = 0; row < 3; row += 1) {
        const s = 2.4 - row * 0.65;
        g.add(box(s, 0.45, s, row % 2 ? m.dark : m.peat, 0, row * 0.45, 0));
      }
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.6, 4), m.wood);
      cap.position.y = 1.65;
      cap.rotation.y = Math.PI / 4;
      cap.castShadow = true;
      g.add(cap);
      height = 2;
      break;
    }
    case 'copper_vault': {
      g.add(box(2.4, 0.9, 2.2, m.slate));
      const vault = cyl(1.1, 1.1, 2.2, m.patina, 10, 0, 0, 0);
      vault.rotation.x = Math.PI / 2;
      vault.position.y = 0.9;
      vault.scale.set(1, 1, 0.6);
      g.add(vault);
      g.add(box(0.6, 0.6, 0.1, m.dark, 0, 0, 1.12));
      height = 2.1;
      break;
    }
    case 'tide_barracks': {
      g.add(box(2.6, 1, 1.8, m.wood));
      g.add(prism(2.9, 0.9, 2, m.slate, 1));
      g.add(cyl(0.05, 0.05, 2.6, m.dark, 5, 1.15, 0, 0.75));
      g.add(box(0.5, 0.32, 0.03, m.teal, 1.42, 2.15, 0.75));
      height = 2.6;
      break;
    }
    case 'driftwood_camp': {
      for (const [px, pz, s] of [[-0.7, -0.6, 1], [0.75, -0.4, 0.85], [0, 0.75, 0.95]] as const) {
        const tent = new THREE.Mesh(new THREE.ConeGeometry(0.62 * s, 1.15 * s, 5), m.wood);
        tent.position.set(px, (1.15 * s) / 2, pz);
        tent.castShadow = true;
        g.add(tent);
      }
      g.add(cyl(0.22, 0.26, 0.12, m.dark, 7, 0.1, 0, 0));
      height = 1.3;
      break;
    }
    case 'kiln_tower': {
      g.add(cyl(1.1, 1.35, 0.6, m.slate, 8));
      g.add(cyl(0.7, 1.0, 2.6, m.saltShade, 8, 0, 0.6));
      g.add(cyl(0.9, 0.75, 0.45, m.slate, 8, 0, 3.2));
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        g.add(box(0.26, 0.3, 0.26, m.slate, Math.cos(a) * 0.72, 3.65, Math.sin(a) * 0.72));
      }
      g.add(box(0.36, 0.5, 0.08, m.dark, 0, 1.0, 0.93));
      height = 4;
      break;
    }
  }
  return { group: g, height };
}

function badgeTexture(level: number, pulse: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#211f45';
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = pulse ? '#f2933f' : '#f3efe4';
  ctx.stroke();
  ctx.fillStyle = '#f3efe4';
  ctx.font = '600 34px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(level), 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Piece {
  key: string;
  root: THREE.Group;
  body: THREE.Group;
  badge: THREE.Sprite;
  badgeLevel: number;
  scaffold: THREE.Mesh;
  height: number;
  meshes: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[];
  rubbled: boolean;
}

class WebglRenderer implements Renderer {
  readonly kind = 'webgl' as const;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  private readonly mats = materials();
  private readonly pieces = new Map<number, Piece>();
  private readonly water: THREE.Mesh;
  private readonly waterBase: Float32Array;
  private readonly ghost: THREE.Mesh;
  private readonly ghostEdges: THREE.LineSegments;
  private readonly cursor: THREE.LineLoop;
  private readonly selection: THREE.LineLoop;
  private readonly ring: THREE.LineSegments;
  private readonly unitPool: THREE.Group[] = [];
  private readonly badges = new Map<string, THREE.CanvasTexture>();
  private width = 1;
  private height = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(C.ground);
    this.scene.fog = new THREE.Fog(C.ground, 70, 150);

    this.scene.add(new THREE.HemisphereLight(0x9a97c9, C.ground, 1.25));
    const sun = new THREE.DirectionalLight(C.light, 1.9);
    sun.position.set(-34, 20, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 100 });
    this.scene.add(sun);

    const sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ color: C.sea }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.7;
    this.scene.add(sea);

    const waterGeo = new THREE.PlaneGeometry(GRID_SIZE + 1, GRID_SIZE + 1, 41, 41);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterBase = Float32Array.from(waterGeo.attributes.position?.array ?? []);
    this.water = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({ color: C.water, transparent: true, opacity: 0.92, flatShading: true }));
    this.water.position.y = -0.22;
    this.water.receiveShadow = true;
    this.scene.add(this.water);

    const bankMat = new THREE.MeshLambertMaterial({ color: C.slab, flatShading: true });
    for (const [x, z, w, d] of [[0, -HALF - 0.9, GRID_SIZE + 3.6, 1.8], [0, HALF + 0.9, GRID_SIZE + 3.6, 1.8], [-HALF - 0.9, 0, 1.8, GRID_SIZE], [HALF + 0.9, 0, 1.8, GRID_SIZE]] as const) {
      const bank = box(w, 0.35, d, bankMat, x, -0.45, z);
      bank.castShadow = false;
      this.scene.add(bank);
    }

    const crust = new THREE.CanvasTexture(drawSaltCrust(1024));
    crust.colorSpace = THREE.SRGBColorSpace;
    crust.anisotropy = 4;
    const inner = GRID_SIZE - BUILD_AREA_MIN * 2;
    const side = new THREE.MeshLambertMaterial({ color: C.slab });
    const top = new THREE.MeshLambertMaterial({ map: crust });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(inner, 0.6, inner), [side, side, top, side, side, side]);
    slab.position.y = -0.3;
    slab.receiveShadow = true;
    this.scene.add(slab);

    const ringPts: number[] = [];
    const edge = (a: number, b: number): void => void ringPts.push(a - HALF, 0.02, b - HALF);
    for (const [x0, y0, x1, y1] of [[2, 2, 38, 2], [38, 2, 38, 38], [38, 38, 2, 38], [2, 38, 2, 2], [0, 0, 40, 0], [40, 0, 40, 40], [40, 40, 0, 40], [0, 40, 0, 0]] as const) {
      edge(x0, y0);
      edge(x1, y1);
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
    this.ring = new THREE.LineSegments(ringGeo, new THREE.LineBasicMaterial({ color: C.ink }));
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.5, depthWrite: false }));
    this.ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: C.teal }));
    this.ghost.add(this.ghostEdges);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    this.cursor = this.square(C.accent);
    this.selection = this.square(C.ink);
    this.scene.add(this.cursor, this.selection);
  }

  private square(color: number): THREE.LineLoop {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], 3));
    return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color }));
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private place(cam: Camera): void {
    const az = (cam.azimuth * Math.PI) / 180;
    const dist = DISTANCE / cam.zoom;
    const target = new THREE.Vector3(cam.panX - HALF, 0, cam.panY - HALF);
    this.camera.position.set(
      target.x + dist * Math.cos(ELEVATION) * Math.sin(az),
      dist * Math.sin(ELEVATION),
      target.z + dist * Math.cos(ELEVATION) * Math.cos(az),
    );
    this.camera.lookAt(target);
    this.camera.setViewOffset(this.width, this.height, -cam.offsetX, -cam.offsetY, this.width, this.height);
    this.camera.updateMatrixWorld();
  }

  pick(px: number, py: number, cam: Camera): { x: number; y: number } | null {
    this.place(cam);
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.plane, hit) ? { x: hit.x + HALF, y: hit.z + HALF } : null;
  }

  project(x: number, y: number, cam: Camera): { x: number; y: number } {
    this.place(cam);
    const v = new THREE.Vector3(x - HALF, 0.5, y - HALF).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  private badge(level: number, pulse: boolean): THREE.CanvasTexture {
    const key = `${level}:${pulse}`;
    let tex = this.badges.get(key);
    if (!tex) {
      tex = badgeTexture(level, pulse);
      this.badges.set(key, tex);
    }
    return tex;
  }

  private piece(b: SceneBuilding): Piece {
    const f = footprint(b.type, b.x, b.y, b.rotation);
    const key = `${b.type}:${b.rotation}`;
    const existing = this.pieces.get(b.id);
    if (existing && existing.key === key) return existing;
    if (existing) this.scene.remove(existing.root);
    const spec = BUILDINGS[b.type];
    const { group, height } = model(b.type, spec.width, spec.depth, this.mats);
    group.rotation.y = (-b.rotation * Math.PI) / 180;
    const body = new THREE.Group();
    body.add(group);
    const root = new THREE.Group();
    root.add(body);
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.badge(Math.max(b.level, 0), false), depthTest: false }));
    badge.scale.set(1.1, 1.1, 1);
    badge.position.y = height + 0.9;
    badge.renderOrder = 2;
    root.add(badge);
    const scaffold = new THREE.Mesh(new THREE.TorusGeometry(Math.max(f.width, f.depth) * 0.62, 0.05, 4, 24), this.mats.wood);
    scaffold.rotation.x = Math.PI / 2;
    scaffold.position.y = 0.45;
    root.add(scaffold);
    const meshes: Piece['meshes'] = [];
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push({ mesh: o, material: o.material });
    });
    this.scene.add(root);
    const piece: Piece = { key, root, body, badge, badgeLevel: -1, scaffold, height, meshes, rubbled: false };
    this.pieces.set(b.id, piece);
    return piece;
  }

  draw(state: DrawState): void {
    this.place(state.camera);
    const seen = new Set<number>();
    for (const b of state.buildings) {
      seen.add(b.id);
      const p = this.piece(b);
      const f = footprint(b.type, b.x, b.y, b.rotation);
      const m = state.motion.get(b.id) ?? { rise: 1, collapse: 0, pulse: 0 };
      p.root.position.set(f.x + f.width / 2 - HALF, 0, f.y + f.depth / 2 - HALF);
      const building = b.level === 0;
      const rise = m.rise;
      const collapse = m.collapse;
      p.body.scale.y = (building ? 0.45 : 1) * (0.92 + 0.04 * Math.max(1, b.level));
      p.body.position.y = -p.height * (1 - rise) - p.height * 0.55 * collapse;
      p.body.rotation.z = 0.16 * collapse;
      p.body.rotation.x = -0.1 * collapse;
      const rubble = collapse > 0.5;
      if (rubble !== p.rubbled) {
        for (const { mesh, material } of p.meshes) mesh.material = rubble ? this.mats.rubble : material;
        p.rubbled = rubble;
      }
      const pulsing = m.pulse > 0 && m.pulse < 1;
      if (p.badgeLevel !== b.level * 10 + Number(pulsing)) {
        (p.badge.material as THREE.SpriteMaterial).map = this.badge(b.level, pulsing);
        p.badgeLevel = b.level * 10 + Number(pulsing);
      }
      const pulseScale = pulsing ? 1 + 0.35 * Math.sin(m.pulse * Math.PI) : 1;
      p.badge.scale.set(1.1 * pulseScale, 1.1 * pulseScale, 1);
      p.badge.position.y = p.height * p.body.scale.y + 0.9 + p.body.position.y * 0.3;
      p.badge.visible = !b.destroyed && rise > 0.6;
      p.scaffold.visible = b.working && !b.destroyed;
      p.scaffold.rotation.z = (state.loopTime / 5) * Math.PI * 2;
    }
    for (const [id, p] of this.pieces) {
      if (!seen.has(id)) {
        this.scene.remove(p.root);
        this.pieces.delete(id);
      }
    }

    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const phase = (state.loopTime / 8) * Math.PI * 2;
    for (let i = 0; i < pos.count; i += 1) {
      const x = this.waterBase[i * 3] as number;
      const z = this.waterBase[i * 3 + 2] as number;
      pos.setY(i, 0.07 * Math.sin(phase + x * 0.45) * Math.cos(phase * 0.5 + z * 0.38));
    }
    pos.needsUpdate = true;

    this.ring.visible = state.mode === 'raid';

    if (state.ghost) {
      const f = footprint(state.ghost.type, state.ghost.x, state.ghost.y, state.ghost.rotation);
      const color = state.ghost.valid ? C.teal : C.brick;
      this.ghost.visible = true;
      this.ghost.scale.set(f.width - 0.08, 1.2, f.depth - 0.08);
      this.ghost.position.set(f.x + f.width / 2 - HALF, 0.6, f.y + f.depth / 2 - HALF);
      (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(color);
      (this.ghostEdges.material as THREE.LineBasicMaterial).color.setHex(color);
    } else {
      this.ghost.visible = false;
    }

    const lift = (x: number, y: number): number => (x < BUILD_AREA_MIN || y < BUILD_AREA_MIN || x > GRID_SIZE - 3 || y > GRID_SIZE - 3 ? -0.15 : 0.03);
    this.cursor.position.set(state.cursor.x - HALF, lift(state.cursor.x, state.cursor.y), state.cursor.y - HALF);
    this.cursor.visible = state.mode !== 'replay';
    const sel = state.buildings.find((b) => b.id === state.selected);
    if (sel) {
      const f = footprint(sel.type, sel.x, sel.y, sel.rotation);
      this.selection.visible = true;
      this.selection.position.set(f.x - HALF, 0.04, f.y - HALF);
      this.selection.scale.set(f.width, 1, f.depth);
    } else {
      this.selection.visible = false;
    }

    while (this.unitPool.length < state.units.length) {
      const u = new THREE.Group();
      u.add(cyl(0.16, 0.2, 0.42, this.mats.dark, 6));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), this.mats.salt);
      head.position.y = 0.55;
      u.add(head);
      this.scene.add(u);
      this.unitPool.push(u);
    }
    this.unitPool.forEach((u, i) => {
      const unit = state.units[i];
      u.visible = unit !== undefined && unit.alive;
      if (unit) {
        u.position.set(unit.x / 1000 - HALF, 0, unit.y / 1000 - HALF);
        u.scale.setScalar(unit.unit === 'peat_slinger' ? 0.85 : 1);
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

/** The 3D renderer, or null when the browser offers no WebGL (the flat plan takes over). */
export function createWebglRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const context = canvas.getContext('webgl2', { antialias: true });
  if (!context) return null;
  try {
    return new WebglRenderer(canvas, context);
  } catch {
    return null;
  }
}
