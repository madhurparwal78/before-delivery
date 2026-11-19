// The island scene: terrain, water, creatures, weather and light, rendered with three.js.

import * as THREE from "three";
import { GRID, terrain, islandById } from "../../shared/world";
import { CreatureState, CREATURES } from "../../shared/creatures";

export interface SceneState {
  hour: number;
  weather: "clear" | "rain";
  dusk: boolean;
  lighthouse: "open" | "closed";
  preset: "full" | "balanced" | "light";
}

export class IslandScene {
  private renderer: THREE.WebGLRenderer | null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  private terrainGroup = new THREE.Group();
  private creatureMeshes = new Map<string, THREE.Group>();
  private explorer = new THREE.Group();
  private sun!: THREE.DirectionalLight;
  private sky: THREE.Color = new THREE.Color(0x9fd4e8);
  private grass: THREE.InstancedMesh | null = null;
  private rain: THREE.Points | null = null;
  private fireflies: THREE.Points | null = null;
  private water: THREE.Mesh | null = null;
  private lighthouseLamp: THREE.Mesh | null = null;
  private state: SceneState = { hour: 10, weather: "clear", dusk: false, lighthouse: "closed", preset: "full" };
  private grassSwayT = 0;
  private rainT = 0;
  private fireflyT = 0;
  private raf = 0;
  private running = true;
  readonly reduced: boolean;

  constructor(host: HTMLElement, island: number, reduced: boolean, preset: "full" | "balanced" | "light") {
    this.reduced = reduced;
    this.state.preset = preset;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: preset !== "light" });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      if (preset !== "light") {
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      host.append(this.renderer.domElement);
    } catch {
      this.renderer = null;
      return;
    }

    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.sun.castShadow = preset === "full";
    this.scene.add(this.sun);
    this.scene.add(new THREE.HemisphereLight(0xdfeaf2, 0x3a4a40, 0.8));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    this.buildTerrain(island);
    this.buildExplorer();
    this.scene.add(this.terrainGroup);
    this.scene.add(this.explorer);

    this.resize(host);
    const observer = new ResizeObserver(() => this.resize(host));
    observer.observe(host);
    this.applyLight();
  }

  get ok(): boolean {
    return this.renderer !== null;
  }

  private resize(host: HTMLElement): void {
    if (!this.renderer) return;
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 480;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private buildTerrain(islandId: number): void {
    const spec = islandById(islandId)!;
    const tile = 1;
    const landMat = new THREE.MeshStandardMaterial({ color: 0x69a05a, roughness: 1 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 1 });
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x2d6c8f, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9 });
    if (this.state.preset === "light") waterMat.transparent = false;

    const landGeo = new THREE.BoxGeometry(tile * 0.96, 0.22, tile * 0.96);
    const rockGeo = new THREE.DodecahedronGeometry(tile * 0.5);

    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const kind = terrain(islandId, x, y);
        if (kind === "water") continue;
        const mesh = new THREE.Mesh(kind === "land" ? landGeo : rockGeo, kind === "land" ? landMat : rockMat);
        mesh.position.set(x - GRID / 2, 0, y - GRID / 2);
        if (this.state.preset === "full") mesh.castShadow = mesh.receiveShadow = true;
        if (kind === "rock") mesh.position.y = 0.28;
        this.terrainGroup.add(mesh);
      }
    }

    // Water plane across the whole grid.
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID, GRID),
      this.state.preset === "light"
        ? new THREE.MeshBasicMaterial({ color: 0x2d6c8f })
        : new THREE.MeshStandardMaterial({ color: 0x2d6c8f, roughness: 0.15, metalness: 0.2 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.16;
    this.terrainGroup.add(water);
    this.water = water;

    if (spec.lighthouseTile) {
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.5, 3.2, 12),
        new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.8 })
      );
      const [lx, ly] = spec.lighthouseTile;
      tower.position.set(lx - GRID / 2, 1.6, ly - GRID / 2);
      this.terrainGroup.add(tower);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000 })
      );
      lamp.position.set(lx - GRID / 2, 3.4, ly - GRID / 2);
      this.terrainGroup.add(lamp);
      this.lighthouseLamp = lamp;
    }

    if (this.state.preset !== "light") this.buildGrass(islandId);
    this.buildRain();
    this.buildFireflies();
  }

  private buildGrass(islandId: number): void {
    const count = 400;
    const geo = new THREE.ConeGeometry(0.05, 0.4, 3);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7ab362, roughness: 1 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    let placed = 0;
    for (let i = 0; i < count * 8 && placed < count; i++) {
      const x = Math.floor(Math.random() * GRID);
      const y = Math.floor(Math.random() * GRID);
      if (terrain(islandId, x, y) !== "land") continue;
      const m = new THREE.Matrix4();
      m.setPosition(x - GRID / 2 + (Math.random() - 0.5) * 0.5, 0.28, y - GRID / 2 + (Math.random() - 0.5) * 0.5);
      mesh.setMatrixAt(placed, m);
      placed++;
    }
    mesh.count = placed;
    this.grass = mesh;
    this.terrainGroup.add(mesh);
  }

  private buildRain(): void {
    if (this.state.preset === "light") return;
    const count = 900;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * GRID - GRID / 2;
      positions[i * 3 + 1] = Math.random() * 14;
      positions[i * 3 + 2] = Math.random() * GRID - GRID / 2;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbcd8e8, size: 0.07, transparent: true, opacity: 0.7 }));
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  private buildFireflies(): void {
    if (this.state.preset === "light") return;
    const count = 60;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * GRID - GRID / 2;
      positions[i * 3 + 1] = 0.6 + Math.random() * 2.2;
      positions[i * 3 + 2] = Math.random() * GRID - GRID / 2;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffe084, size: 0.12, transparent: true, opacity: 0.9 }));
    this.fireflies.visible = false;
    this.scene.add(this.fireflies);
  }

  private buildExplorer(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd0563a, roughness: 0.8 });
    const pack = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 6, 12), mat);
    body.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat);
    head.position.y = 1.3;
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.2), pack);
    bag.position.set(0, 0.95, -0.26);
    if (this.state.preset !== "light") {
      body.castShadow = true;
      head.castShadow = true;
    }
    this.explorer.add(body, head, bag);
  }

  setExplorer(x: number, y: number, heading: "N" | "E" | "S" | "W"): void {
    this.explorer.position.set(x - GRID / 2, 0, y - GRID / 2);
    this.explorer.rotation.y = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[heading];
  }

  setState(state: Partial<SceneState>): void {
    const prev = { ...this.state };
    this.state = { ...this.state, ...state };
    if (prev.hour !== this.state.hour || prev.weather !== this.state.weather || prev.dusk !== this.state.dusk || prev.lighthouse !== this.state.lighthouse) {
      this.applyLight();
    }
  }

  private applyLight(): void {
    const hour = this.state.hour;
    // Sun arc across the day; warm at the edges.
    const dayT = (hour - 6) / 12;
    const elev = Math.sin(Math.PI * Math.max(0, Math.min(1, dayT)));
    const angle = Math.PI * Math.max(0, Math.min(1, dayT));
    this.sun.position.set(Math.cos(angle) * 30, 6 + elev * 28, 12);
    this.sun.intensity = 0.35 + elev * 1.5;

    const dayColor = new THREE.Color(0x9fd4e8);
    const duskColor = new THREE.Color(0xe8935a);
    const nightColor = new THREE.Color(0x1a2430);
    const t = this.state.dusk ? 1 : 0;
    const night = hour < 6 || hour >= 20;
    if (night) this.sky.copy(nightColor);
    else if (this.state.dusk) this.sky.lerpColors(duskColor, nightColor, (hour - 18) / 2 * 0.5);
    else this.sky.copy(dayColor);
    if (this.state.weather === "rain") this.sky.lerp(new THREE.Color(0x7a8a92), 0.5);
    void t;
    this.scene.background = this.sky;
    if (this.water && this.state.preset === "full") {
      (this.water.material as THREE.MeshStandardMaterial).color.copy(this.sky).lerp(new THREE.Color(0x2d6c8f), 0.5);
    }
    if (this.rain) this.rain.visible = this.state.weather === "rain" && !this.reduced;
    if (this.fireflies) this.fireflies.visible = this.state.dusk && !this.reduced;
    if (this.lighthouseLamp) {
      const mat = this.lighthouseLamp.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(this.state.lighthouse === "open" ? 0xffe9a8 : 0x000000);
      mat.emissiveIntensity = this.state.lighthouse === "open" ? 2 : 0;
    }
  }

  /** Place creatures by server truth; each mesh is created once. */
  updateCreatures(states: readonly CreatureState[]): void {
    const present = new Set(states.map(c => c.id));
    for (const [id, mesh] of this.creatureMeshes) {
      if (!present.has(id)) {
        mesh.visible = false;
      }
    }
    for (const c of states) {
      let mesh = this.creatureMeshes.get(c.id);
      if (!mesh) {
        mesh = buildCreatureMesh(c.id);
        this.creatureMeshes.set(c.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(c.x - GRID / 2, 0.3, c.y - GRID / 2);
      mesh.rotation.y = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[c.heading];
      const spec = CREATURES.find(s => s.id === c.id);
      const scale = spec ? Math.max(0.7, spec.size * 0.9) : 1;
      mesh.scale.setScalar(scale);
    }
  }

  /** Explore camera orbiting the explorer; photo camera at the explorer's eye. */
  setCameraExplore(yawDeg: number, zoom: number, tile: [number, number], heading: "N" | "E" | "S" | "W"): void {
    this.setExplorer(tile[0], tile[1], heading);
    const dist = 3 + zoom * 2.2;
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const cx = tile[0] - GRID / 2;
    const cz = tile[1] - GRID / 2;
    this.camera.position.set(cx + Math.sin(yaw) * dist, 2.1 + zoom * 0.5, cz + Math.cos(yaw) * dist);
    this.camera.lookAt(cx, 0.9, cz);
  }

  setCameraEye(tile: [number, number], heading: "N" | "E" | "S" | "W", zoom: number): void {
    this.setExplorer(tile[0], tile[1], heading);
    const cx = tile[0] - GRID / 2;
    const cz = tile[1] - GRID / 2;
    const fwd = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[heading];
    this.camera.position.set(cx, 1.55, cz);
    this.camera.fov = 40 / Math.max(1, zoom * 0.8);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(cx + fwd[0] * 6, 1.2, cz + fwd[1] * 6);
  }

  /** The camera hook value: position then look target, six numbers, two decimals. */
  cameraHook(): string {
    const p = this.camera.position;
    const t = new THREE.Vector3();
    this.camera.getWorldDirection(t).multiplyScalar(6).add(p);
    return [
      p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2),
      t.x.toFixed(2), t.y.toFixed(2), t.z.toFixed(2)
    ].join(",");
  }

  render(): void {
    this.renderer?.render(this.scene, this.camera);
  }

  /** Animated frame: grass sway, rain fall, firefly drift. Called on animation frames only. */
  tick(dtMs: number): void {
    if (this.reduced || this.state.preset === "light") return;
    const dt = dtMs / 1000;
    if (this.grass) {
      this.grassSwayT += dt;
      this.grass.rotation.z = Math.sin(this.grassSwayT * 2) * 0.04;
    }
    if (this.rain && this.rain.visible) {
      this.rainT += dt;
      const pos = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 9;
        if (y < 0) y = 14;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    if (this.fireflies && this.fireflies.visible) {
      this.fireflyT += dt;
      const pos = this.fireflies.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + Math.sin(this.fireflyT + i) * 0.004;
        pos.setX(i, x);
      }
      pos.needsUpdate = true;
    }
  }

  start(onFrame: (dtMs: number) => void): void {
    const loop = (time: number) => {
      if (!this.running) return;
      onFrame(time);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
  }

  captureCanvas(): string | null {
    if (!this.renderer) return null;
    const canvas = this.renderer.domElement;
    this.render();
    const scale = Math.min(1, 960 / Math.max(1, canvas.width));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, w, h);
    return out.toDataURL("image/png");
  }
}

function buildCreatureMesh(id: string): THREE.Group {
  const group = new THREE.Group();
  const palette: Record<string, number> = {
    "mossback-newt": 0x4c6b3f, "reedpipe-heron": 0x9aa7b8, "gloamfin-moth": 0x8a6fa8, "puddle-lark": 0xc9b458,
    "bracken-hare": 0xb08a5e, "mossfern-stag": 0x7a5b3a, "lantern-toad": 0xd8a441, "drizzle-snail": 0x8f9a8c,
    "glasswing-crab": 0x9fd4c8, "tidewhistle-otter": 0x6b5a4a, "duskshell-snipe": 0xa88ab0, "rainbead-gecko": 0x6fa8b8,
    "cragtail-goat": 0xd8d2c4, "fell-mouse": 0x91867a, "mistcrown-owl": 0x6f6a7a, "cloudpuff-vole": 0xc8c2b8,
    "beacon-gull": 0xe8e4dc, "shingle-plover": 0xb0a898, "wickwing-bat": 0x4a4252, "sleetfoot-fox": 0xd07a4a
  };
  const color = palette[id] ?? 0x888888;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.4, 6, 10), mat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.3;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mat);
  head.position.set(0, 0.4, 0.4);
  group.add(body, head);
  return group;
}
