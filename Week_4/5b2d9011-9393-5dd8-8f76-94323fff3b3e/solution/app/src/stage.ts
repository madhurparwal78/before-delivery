import * as THREE from "three";
import { app, isReduced, on } from "./state";
import type { GameMap, RoomState } from "./types";

type StageKind = "title" | "siege" | "convoy";

interface LocalCar {
  x: number;
  z: number;
  heading: number;
}

interface StageView {
  state: RoomState | null;
  me: string;
  car: LocalCar | null;
  aim: number | null;
}

const SEAT_COLORS = [0x7fe0c3, 0x7cc4ff, 0xbba8ff, 0xffcf8a];
const NAMES: Record<StageKind, string> = { title: "Block field", siege: "Siege field", convoy: "Saltpan Loop" };
const TITLE_LOOP_MS = 60_000;
const SHAKE_MS = 300;
const SHAKE_RANGE = 5;
const STEPS_PER_SECOND = 2;

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TitleBlock {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  shade: number;
}

/** The procedural low-poly field behind the title: the same blocks in 3D and in the 2D fallback. */
function titleBlocks(): TitleBlock[] {
  const rand = seeded(11);
  const blocks: TitleBlock[] = [];
  for (let i = 0; i < 170; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 6 + Math.sqrt(rand()) * 34;
    blocks.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, w: 1 + rand() * 2.4, d: 1 + rand() * 2.4, h: 0.6 + rand() * rand() * 7, shade: rand() });
  }
  return blocks;
}

export class Stage {
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
  private readonly titleGroup = new THREE.Group();
  private readonly siegeGroup = new THREE.Group();
  private readonly convoyGroup = new THREE.Group();
  private kind: StageKind = "title";
  private view: StageView = { state: null, me: "", car: null, aim: null };
  private maps = new Map<string, GameMap>();
  private dirty = true;
  private lastFrame = 0;
  private shakeAt = -Infinity;
  private walkPhase = 0;
  private focus = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 14, 34);
  private readonly pool = {
    players: [] as THREE.Mesh[], enemies: [] as THREE.Mesh[], barrels: [] as THREE.Mesh[], grenades: [] as THREE.Mesh[],
    cars: [] as THREE.Mesh[], flashes: [] as { mesh: THREE.Mesh; born: number }[],
  };
  private reticle: THREE.Mesh | null = null;
  private seenExplosions = new Set<number>();
  private explosionsSeeded = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
      this.renderer.setClearColor(0x070d0d, 1);
    } catch {
      this.renderer = null;
      this.ctx2d = canvas.getContext("2d");
    }
    this.scene.background = new THREE.Color(0x070d0d);
    this.scene.fog = new THREE.Fog(0x070d0d, 24, 120);
    this.scene.add(new THREE.AmbientLight(0x3d7a6c, 1.3), this.titleGroup, this.siegeGroup, this.convoyGroup);
    const sun = new THREE.DirectionalLight(0xbdf2df, 2.2);
    sun.position.set(-18, 30, 12);
    this.scene.add(sun);
    this.buildTitle();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => this.refresh());
    on("comfort", () => this.refresh());
    this.setKind("title");
    requestAnimationFrame((t) => this.loop(t));
  }

  get hasWebGL(): boolean {
    return this.renderer !== null;
  }

  // ---- scenes

  private material(color: number): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color, flatShading: true });
  }

  private floor(group: THREE.Group, width: number, depth: number, cx: number, cz: number): void {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshLambertMaterial({ color: 0x0b1a18 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(cx, 0, cz);
    const grid = new THREE.GridHelper(Math.max(width, depth), Math.max(width, depth) / (width > 100 ? 10 : 2), 0x1d5a4c, 0x12302a);
    grid.position.set(cx, 0.01, cz);
    group.add(plane, grid);
  }

  private blocksMesh(blocks: TitleBlock[]): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material(0xffffff), blocks.length);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    blocks.forEach((b, i) => {
      m.compose(new THREE.Vector3(b.x, b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
      color.setHSL(0.46 + b.shade * 0.04, 0.45, 0.16 + b.shade * 0.14);
      mesh.setColorAt(i, color);
    });
    return mesh;
  }

  private buildTitle(): void {
    this.floor(this.titleGroup, 120, 120, 0, 0);
    this.titleGroup.add(this.blocksMesh(titleBlocks()));
  }

  /** Low-poly blocks scattered around the playfield for depth; they are scenery, never solid. */
  private outskirts(map: GameMap, count: number, margin: number, seed: number): TitleBlock[] {
    const rand = seeded(seed);
    const blocks: TitleBlock[] = [];
    while (blocks.length < count) {
      const x = -margin + rand() * (map.width + margin * 2);
      const z = -margin + rand() * (map.depth + margin * 2);
      if (x > -3 && x < map.width + 3 && z > -3 && z < map.depth + 3) continue;
      blocks.push({ x, z: -z, w: 1.5 + rand() * 4, d: 1.5 + rand() * 4, h: 0.8 + rand() * rand() * 9, shade: rand() });
    }
    return blocks;
  }

  private buildSiege(map: GameMap): void {
    const g = this.siegeGroup;
    g.add(this.blocksMesh(this.outskirts(map, 80, 34, 3)));
    this.floor(g, map.width, map.depth, map.width / 2, -map.depth / 2);
    const cells = map.blocks.flatMap((b) => {
      const out: TitleBlock[] = [];
      for (let x = b.x; x < b.x + b.w; x++) for (let z = b.z; z < b.z + b.d; z++) out.push({ x: x + 0.5, z: -(z + 0.5), w: 1, d: 1, h: 1.6, shade: 0.7 });
      return out;
    });
    g.add(this.blocksMesh(cells));
    map.barrels.forEach(() => {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 10), this.material(0xb0703c));
      g.add(barrel);
      this.pool.barrels.push(barrel);
    });
    for (let i = 0; i < 4; i++) {
      const player = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.7), this.material(SEAT_COLORS[i]));
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), this.material(0x070d0d));
      visor.position.set(0.25, 0.3, 0);
      player.add(visor);
      player.visible = false;
      g.add(player);
      this.pool.players.push(player);
    }
    for (let i = 0; i < 10; i++) {
      const foe = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material(0xd98a5e));
      foe.visible = false;
      g.add(foe);
      this.pool.enemies.push(foe);
    }
    for (let i = 0; i < 6; i++) {
      const grenade = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), this.material(0xe9e3a0));
      grenade.visible = false;
      g.add(grenade);
      this.pool.grenades.push(grenade);
    }
    for (let i = 0; i < 6; i++) {
      const flash = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 24), new THREE.MeshBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      flash.rotation.x = -Math.PI / 2;
      flash.visible = false;
      g.add(flash);
      this.pool.flashes.push({ mesh: flash, born: -Infinity });
    }
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 20), new THREE.MeshBasicMaterial({ color: 0x9fe6cf, side: THREE.DoubleSide }));
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.position.y = 0.05;
    this.reticle.visible = false;
    g.add(this.reticle);
  }

  private buildConvoy(map: GameMap): void {
    const g = this.convoyGroup;
    this.floor(g, map.width, map.depth, map.width / 2, -map.depth / 2);
    const rand = seeded(5);
    const island: TitleBlock[] = [];
    for (const b of map.blocks) {
      for (let i = 0; i < 26; i++) {
        const w = 8 + rand() * 14;
        const d = 6 + rand() * 10;
        island.push({ x: b.x + w / 2 + rand() * (b.w - w), z: -(b.z + d / 2 + rand() * (b.d - d)), w, d, h: 1 + rand() * 4, shade: rand() });
      }
    }
    g.add(this.blocksMesh(island));
    g.add(this.blocksMesh(this.outskirts(map, 110, 60, 9)));
    map.checkpoints.forEach((c, index) => {
      const gate = new THREE.Group();
      const color = c.id === "C0" ? 0xe6efec : 0x9fe6cf;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 0.8), this.material(color));
        post.position.set(side * 5.5, 2.5, 0);
        gate.add(post);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.7, 0.8), this.material(color));
      bar.position.y = 5;
      gate.add(bar);
      const next = map.checkpoints[(index + 1) % map.checkpoints.length];
      gate.position.set(c.x, 0, -c.z);
      gate.rotation.y = Math.atan2(next.z - c.z, next.x - c.x) + Math.PI / 2;
      g.add(gate);
    });
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 1.8), this.material(SEAT_COLORS[i]));
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 1.4), this.material(0x070d0d));
      cabin.position.set(-0.2, 0.9, 0);
      car.add(cabin);
      car.position.y = 0.6;
      car.visible = false;
      g.add(car);
      this.pool.cars.push(car);
    }
  }

  setMap(map: GameMap): void {
    if (this.maps.has(map.id)) return;
    this.maps.set(map.id, map);
    if (map.checkpoints.length > 0) this.buildConvoy(map);
    else this.buildSiege(map);
    this.refresh();
  }

  setKind(kind: StageKind): void {
    this.kind = kind;
    this.titleGroup.visible = kind === "title";
    this.siegeGroup.visible = kind === "siege";
    this.convoyGroup.visible = kind === "convoy";
    this.canvas.setAttribute("aria-label", NAMES[kind]);
    this.seenExplosions.clear();
    this.explosionsSeeded = false;
    this.dirty = true;
    this.draw(performance.now());
    if (this.ctx2d) this.draw2D();
  }

  setView(view: StageView): void {
    this.view = view;
    if (view.state) this.noteExplosions(view.state);
    this.refresh();
  }

  /** An explosion within range of the player shakes the camera for a short moment. */
  private noteExplosions(state: RoomState): void {
    const me = state.players.find((p) => p.id === this.view.me);
    const first = !this.explosionsSeeded;
    this.explosionsSeeded = true;
    for (const event of state.events) {
      if (event.type !== "explosion" || this.seenExplosions.has(event.seq)) continue;
      this.seenExplosions.add(event.seq);
      if (first) continue;
      const x = Number(event.x);
      const z = Number(event.z);
      if (me && Math.hypot(me.x - x, me.z - z) <= SHAKE_RANGE && app.settings.screen_shake && !isReduced()) this.shakeAt = performance.now();
      const flash = this.pool.flashes.find((f) => !f.mesh.visible);
      if (flash && !isReduced() && this.kind === "siege") {
        flash.born = performance.now();
        flash.mesh.position.set(x, 0.08, -z);
        flash.mesh.visible = true;
      }
    }
  }

  /** The aim reticle follows the pointer. */
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    return { x: hit.x, z: -hit.z };
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
    } else {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    this.refresh();
  }

  // ---- frame

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    if (!this.renderer || document.hidden) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const live = !isReduced() && (this.kind === "title" || this.view.state !== null);
    if (live || this.dirty) this.draw(now, dt);
  }

  /** Renders one frame now. Reduced effects draw only when something changed, and draw at once. */
  private draw(now: number, dt = 1 / 60): void {
    if (!this.renderer) return;
    this.dirty = false;
    const reduced = isReduced();
    this.placeEntities(dt, reduced);
    this.placeCamera(now, dt, reduced);
    this.renderer.render(this.scene, this.camera);
  }

  /** Something changed: reduced effects redraw immediately, live scenes on the next frame. */
  private refresh(): void {
    this.dirty = true;
    if (isReduced()) this.draw(performance.now());
    if (this.ctx2d) this.draw2D();
  }

  private placeCamera(now: number, dt: number, reduced: boolean): void {
    const cam = this.camera;
    const snap = reduced ? 1 : 1 - Math.exp(-7 * dt);
    if (this.kind === "title") {
      const angle = reduced ? 0.6 : (now / TITLE_LOOP_MS) * Math.PI * 2;
      cam.position.set(Math.sin(angle) * 36, 15, Math.cos(angle) * 36);
      cam.lookAt(0, 2, 0);
      return;
    }
    const me = this.view.state?.players.find((p) => p.id === this.view.me);
    let desired: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.kind === "siege") {
      const target = me ? new THREE.Vector3(me.x, 0, -me.z) : new THREE.Vector3(16, 0, -10);
      this.focus.lerp(target, snap);
      desired = this.focus.clone().add(new THREE.Vector3(0, 12, 9.5));
      look = this.focus.clone();
      if (me && app.settings.camera_bob && !reduced && (me.status === "up") && this.moving) {
        this.walkPhase += dt * Math.PI * 2 * STEPS_PER_SECOND;
        desired.y += Math.sin(this.walkPhase) * 0.12;
      }
    } else {
      const car = this.view.car ?? this.view.state?.vehicles.find((v) => v.player === this.view.me);
      const heading = ((car?.heading ?? 0) * Math.PI) / 180;
      const base = car ? new THREE.Vector3(car.x, 0, -car.z) : new THREE.Vector3(24, 0, -10);
      this.focus.lerp(base, snap);
      const forward = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      desired = this.focus.clone().addScaledVector(forward, -15).add(new THREE.Vector3(0, 9, 0));
      look = this.focus.clone().addScaledVector(forward, 8);
    }
    const age = now - this.shakeAt;
    if (age >= 0 && age < SHAKE_MS) {
      const strength = 0.4 * (1 - age / SHAKE_MS);
      desired.x += Math.sin(age * 0.09) * strength;
      desired.y += Math.cos(age * 0.11) * strength;
    }
    this.camPos.lerp(desired, snap);
    cam.position.copy(this.camPos);
    cam.lookAt(look);
  }

  private moving = false;

  private placeEntities(dt: number, reduced: boolean): void {
    const state = this.view.state;
    if (!state || this.kind === "title") return;
    const k = reduced ? 1 : 1 - Math.exp(-14 * dt);
    const setPos = (mesh: THREE.Object3D, x: number, y: number, z: number): void => {
      mesh.position.x += (x - mesh.position.x) * k;
      mesh.position.y = y;
      mesh.position.z += (-z - mesh.position.z) * k;
    };
    if (this.kind === "siege") {
      state.players.forEach((p, i) => {
        const mesh = this.pool.players[p.seat - 1] ?? this.pool.players[i];
        mesh.visible = p.connection !== "left" && p.status !== "out";
        const down = p.status === "downed";
        setPos(mesh, p.x, down ? 0.35 : 0.6, p.z);
        mesh.scale.y = down ? 0.4 : 1;
        const aim = p.id === this.view.me && this.view.aim !== null ? this.view.aim : p.aim;
        mesh.rotation.y = (aim * Math.PI) / 180;
        if (p.id === this.view.me) {
          this.moving = Math.hypot(mesh.position.x - p.x, mesh.position.z + p.z) > 0.05;
          if (this.reticle) {
            const ahead = this.view.aim ?? p.aim;
            this.reticle.visible = p.status === "up";
            this.reticle.position.set(p.x + Math.cos((ahead * Math.PI) / 180) * 8, 0.05, -(p.z + Math.sin((ahead * Math.PI) / 180) * 8));
          }
        }
      });
      this.pool.players.forEach((mesh, i) => { if (!state.players.some((p) => (p.seat - 1) === i)) mesh.visible = false; });
      this.pool.enemies.forEach((mesh, i) => {
        const foe = state.enemies[i];
        mesh.visible = foe !== undefined;
        if (!foe) return;
        const size = foe.kind === "boss" ? 2.2 : foe.kind === "brute" ? 1.4 : 0.9;
        const dead = foe.state === "dead";
        mesh.scale.set(size, dead ? 0.15 : size, size);
        setPos(mesh, foe.x, dead ? 0.08 : size / 2, foe.z);
        (mesh.material as THREE.MeshLambertMaterial).color.setHex(dead ? 0x3a2b24 : foe.state === "attack" ? 0xff7a5a : foe.state === "pursue" ? 0xe0894f : 0xd98a5e);
      });
      this.pool.barrels.forEach((mesh, i) => {
        const barrel = state.barrels[i];
        if (!barrel) return;
        mesh.position.set(barrel.x, barrel.destroyed ? 0.06 : 0.45, -barrel.z);
        mesh.scale.y = barrel.destroyed ? 0.12 : 1;
        (mesh.material as THREE.MeshLambertMaterial).color.setHex(barrel.destroyed ? 0x2c2018 : 0xb0703c);
      });
      this.pool.grenades.forEach((mesh, i) => {
        const grenade = state.grenades[i];
        mesh.visible = grenade !== undefined;
        if (grenade) mesh.position.set(grenade.x, 0.3, -grenade.z);
      });
      const now = performance.now();
      for (const flash of this.pool.flashes) {
        if (!flash.mesh.visible) continue;
        const age = (now - flash.born) / 400;
        if (age >= 1) flash.mesh.visible = false;
        else {
          flash.mesh.scale.setScalar(1 + age * 4);
          (flash.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - age);
        }
      }
    } else {
      this.pool.cars.forEach((mesh, i) => {
        const player = state.players[i];
        const vehicle = player ? state.vehicles.find((v) => v.player === player.id) : undefined;
        mesh.visible = vehicle !== undefined;
        if (!vehicle) return;
        const own = player.id === this.view.me && this.view.car && vehicle.state === "running";
        const pose = own ? this.view.car! : vehicle;
        mesh.position.set(pose.x, 0.6, -pose.z);
        mesh.rotation.y = (pose.heading * Math.PI) / 180;
        mesh.scale.y = vehicle.state === "wrecked" ? 0.5 : 1;
      });
    }
  }

  // ---- 2D fallback: a still top-down drawing of the same blocks and entities

  private draw2D(): void {
    const ctx = this.ctx2d;
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.fillStyle = "#070d0d";
    ctx.fillRect(0, 0, width, height);
    const state = this.view.state;
    const map = this.maps.get(this.kind === "convoy" ? "saltpan-loop" : "breakwater-yard");
    if (this.kind === "title" || !map) {
      const scale = Math.min(width, height) / 90;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      for (const b of titleBlocks()) {
        ctx.fillStyle = `hsl(${166 + b.shade * 14} 45% ${16 + b.shade * 14}%)`;
        ctx.fillRect((b.x - b.w / 2) * scale, (b.z - b.d / 2) * scale, b.w * scale, b.d * scale);
      }
      ctx.restore();
      return;
    }
    const scale = Math.min(width / map.width, height / map.depth) * 0.86;
    ctx.save();
    ctx.translate((width - map.width * scale) / 2, (height - map.depth * scale) / 2);
    ctx.fillStyle = "#0d1c1a";
    ctx.fillRect(0, 0, map.width * scale, map.depth * scale);
    ctx.strokeStyle = "#12302a";
    const step = map.width > 100 ? 10 : 2;
    for (let i = 0; i <= map.width; i += step) { ctx.beginPath(); ctx.moveTo(i * scale, 0); ctx.lineTo(i * scale, map.depth * scale); ctx.stroke(); }
    for (let i = 0; i <= map.depth; i += step) { ctx.beginPath(); ctx.moveTo(0, i * scale); ctx.lineTo(map.width * scale, i * scale); ctx.stroke(); }
    const at = (x: number, z: number): [number, number] => [x * scale, (map.depth - z) * scale];
    ctx.fillStyle = "#1f6b5a";
    for (const b of map.blocks) ctx.fillRect(b.x * scale, (map.depth - b.z - b.d) * scale, b.w * scale, b.d * scale);
    ctx.fillStyle = "#e6efec";
    for (const c of map.checkpoints) { const [x, y] = at(c.x, c.z); ctx.fillRect(x - 3, y - 3, 6, 6); }
    const dot = (x: number, z: number, radius: number, color: string): void => {
      const [px, py] = at(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, radius * scale, 0, Math.PI * 2);
      ctx.fill();
    };
    if (state) {
      state.barrels.forEach((b) => dot(b.x, b.z, 0.4, b.destroyed ? "#2c2018" : "#b0703c"));
      state.enemies.forEach((e) => dot(e.x, e.z, e.kind === "boss" ? 1 : 0.55, e.state === "dead" ? "#3a2b24" : "#d98a5e"));
      state.grenades.forEach((g) => dot(g.x, g.z, 0.3, "#e9e3a0"));
      state.players.forEach((p) => {
        if (p.status !== "out") dot(p.x, p.z, 0.5, `#${SEAT_COLORS[p.seat - 1].toString(16).padStart(6, "0")}`);
      });
      state.vehicles.forEach((v) => dot(v.x, v.z, 1.4, "#7fe0c3"));
    }
    ctx.restore();
  }
}

let shared: Stage | null = null;

export function createStage(canvas: HTMLCanvasElement): Stage {
  shared = new Stage(canvas);
  return shared;
}

export function stage(): Stage {
  if (!shared) throw new Error("the stage is not created yet");
  return shared;
}
