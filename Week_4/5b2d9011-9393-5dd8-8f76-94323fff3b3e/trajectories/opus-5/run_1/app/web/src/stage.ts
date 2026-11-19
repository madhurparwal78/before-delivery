// The siege field stage: low-poly teal blocks on a dark grid under a radial
// vignette with faint vertical streaks. It sits behind every screen.
//
// Without WebGL the same blocks and entities are drawn as a still 2D top-down
// picture, redrawn on each snapshot, under the same accessible name.

import * as THREE from 'three';
import { RoomState } from './api';
import { comfort } from './comfort';
import { el } from './core';

export type StageScene = 'title' | 'siege' | 'convoy';

const sceneNames: Record<StageScene, string> = {
  title: 'Block field',
  siege: 'Siege field',
  convoy: 'Saltpan Loop',
};

interface MapShape {
  width: number;
  depth: number;
  blocks: { x: number; z: number; w: number; d: number }[];
}

const titleField: MapShape = {
  width: 32,
  depth: 32,
  blocks: [
    { x: 4, z: 6, w: 2, d: 2 },
    { x: 9, z: 14, w: 4, d: 1 },
    { x: 20, z: 14, w: 4, d: 1 },
    { x: 15, z: 22, w: 2, d: 2 },
    { x: 26, z: 7, w: 2, d: 3 },
    { x: 7, z: 25, w: 3, d: 2 },
    { x: 22, z: 25, w: 2, d: 2 },
  ],
};

const colours = {
  ground: 0x03090b,
  block: 0x1d4f4a,
  blockEdge: 0x2f7d6c,
  grid: 0x10312f,
  player: 0x9ff2d0,
  enemy: 0xc8705f,
  barrel: 0xd1a84c,
  grenade: 0xeae2a8,
  vehicle: 0x9ff2d0,
  checkpoint: 0x3f8f7a,
};

/** Stage drives the scene behind every screen. */
export class Stage {
  readonly root: HTMLElement;
  private scene: StageScene = 'title';
  private shape: MapShape = titleField;
  private state: RoomState | null = null;
  private selfID: string | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private three: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private blockGroup: THREE.Group | null = null;
  private entityGroup: THREE.Group | null = null;
  private fallback: HTMLCanvasElement | null = null;

  private reticle: HTMLElement;
  private shakeUntil = 0;
  private lastExplosionSeq = 0;
  private walkPhase = 0;
  private hidden = false;
  private started = 0;

  constructor() {
    this.root = el('div', {
      class: 'stage-root',
      role: 'img',
      'aria-label': sceneNames.title,
      style: 'position:absolute;inset:0;',
    });
    this.reticle = el('div', {
      'aria-hidden': 'true',
      style:
        'position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;display:none;' +
        'border:1px solid #9ff2d0;border-radius:50%;pointer-events:none;',
    });
    this.started = performance.now();
    if (!this.initThree()) this.initFallback();
    this.root.appendChild(this.reticle);

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
    });
    comfort.onChange(() => this.draw());
  }

  /** setScene swaps the stage and its accessible name. */
  setScene(scene: StageScene, shape?: MapShape): void {
    this.scene = scene;
    this.root.setAttribute('aria-label', sceneNames[scene]);
    if (shape) this.shape = shape;
    else if (scene === 'title') this.shape = titleField;
    this.buildBlocks();
    this.draw();
  }

  /** setSnapshot takes the latest room state so entities move to its positions. */
  setSnapshot(state: RoomState | null, selfID: string | null): void {
    this.state = state;
    this.selfID = selfID;
    if (state) this.watchExplosions(state);
    if (!this.renderer) this.draw();
  }

  /** aimAt moves the aim reticle. This happens with reduced motion too; the
   *  player model turns to the server's aim, which the pointer drives. */
  aimAt(fractionX: number, fractionZ: number): void {
    this.reticle.style.display = this.scene === 'siege' ? '' : 'none';
    this.reticle.style.left = `${fractionX * 100}%`;
    this.reticle.style.top = `${fractionZ * 100}%`;
  }

  /** start runs the draw loop. The scene stops drawing while the tab is hidden. */
  start(): void {
    const loop = () => {
      window.requestAnimationFrame(loop);
      if (this.hidden) return;
      this.draw();
    };
    window.requestAnimationFrame(loop);
  }

  // ---------- WebGL ----------

  private initThree(): boolean {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
    } catch {
      return false;
    }
    if (!renderer.getContext()) return false;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = 'block';
    this.root.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(colours.ground);
    scene.fog = new THREE.Fog(colours.ground, 26, 68);
    this.three = scene;

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
    this.camera = camera;

    scene.add(new THREE.AmbientLight(0x4f7f78, 1.1));
    const key = new THREE.DirectionalLight(0xbdf0e0, 0.85);
    key.position.set(8, 22, 10);
    scene.add(key);

    const grid = new THREE.GridHelper(96, 48, colours.grid, colours.grid);
    (grid.material as THREE.Material).opacity = 0.42;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    this.blockGroup = new THREE.Group();
    this.entityGroup = new THREE.Group();
    scene.add(this.blockGroup, this.entityGroup);

    this.addStreaks(scene);
    this.buildBlocks();
    this.resize();
    return true;
  }

  /** addStreaks hangs the faint vertical streaks over the field. */
  private addStreaks(scene: THREE.Scene): void {
    const geometry = new THREE.BufferGeometry();
    const points: number[] = [];
    for (let i = 0; i < 48; i += 1) {
      const x = (i % 12) * 8 - 44 + (i % 3);
      const z = Math.floor(i / 12) * 14 - 28;
      points.push(x, 0, z, x, 16 + (i % 5) * 2, z);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: colours.grid, transparent: true, opacity: 0.2 });
    scene.add(new THREE.LineSegments(geometry, material));
  }

  private buildBlocks(): void {
    if (!this.blockGroup) return;
    // The field only changes when the stage does, so release the old geometry
    // rather than leaving it on the GPU.
    for (const child of this.blockGroup.children) {
      const mesh = child as THREE.Mesh | THREE.LineSegments;
      mesh.geometry?.dispose();
    }
    this.blockGroup.clear();

    const material = this.material('block', colours.block, 1);
    const edgeMaterial = this.edgeMaterial();

    for (const block of this.shape.blocks) {
      const height = 1.6 + ((block.x * 7 + block.z * 3) % 5) * 0.45;
      const geometry = new THREE.BoxGeometry(block.w, height, block.d);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        block.x + block.w / 2 - this.shape.width / 2,
        height / 2,
        -(block.z + block.d / 2 - this.shape.depth / 2),
      );
      this.blockGroup.add(mesh);
      this.blockGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
      const edges = this.blockGroup.children[this.blockGroup.children.length - 1];
      edges.position.copy(mesh.position);
    }
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (this.renderer && this.camera) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    if (this.fallback) {
      const ratio = Math.min(window.devicePixelRatio, 2);
      this.fallback.width = Math.floor(width * ratio);
      this.fallback.height = Math.floor(height * ratio);
      this.fallback.style.width = `${width}px`;
      this.fallback.style.height = `${height}px`;
    }
  }

  private watchExplosions(state: RoomState): void {
    const self = state.players.find((p) => p.id === this.selfID);
    for (const event of state.events) {
      if (event.type !== 'explosion' || event.seq <= this.lastExplosionSeq) continue;
      this.lastExplosionSeq = event.seq;
      if (!self || !comfort.shake()) continue;
      const dx = (event.x as number) - self.x;
      const dz = (event.z as number) - self.z;
      if (Math.hypot(dx, dz) <= 5) this.shakeUntil = performance.now() + 300;
    }
  }

  private draw(): void {
    if (this.renderer && this.three && this.camera) {
      this.drawThree();
      this.renderer.render(this.three, this.camera);
      return;
    }
    this.drawFallback();
  }

  private drawThree(): void {
    const camera = this.camera as THREE.PerspectiveCamera;
    const now = performance.now();

    if (this.scene === 'title' || !this.state) {
      // The title camera drifts one full loop every 60 seconds, and holds still
      // under reduced motion so idle frames are identical.
      const angle = comfort.reduced() ? 0.6 : ((now - this.started) / 60_000) * Math.PI * 2;
      camera.position.set(Math.cos(angle) * 30, 19, Math.sin(angle) * 30);
      camera.lookAt(0, 1.5, 0);
      this.drawEntities();
      return;
    }

    const self = this.state.players.find((p) => p.id === this.selfID) ?? this.state.players[0];
    const vehicle = this.state.vehicles.find((v) => v.player === this.selfID) ?? this.state.vehicles[0];
    const focusX = vehicle ? vehicle.x : self ? self.x : this.shape.width / 2;
    const focusZ = vehicle ? vehicle.z : self ? self.z : this.shape.depth / 2;

    const worldX = focusX - this.shape.width / 2;
    const worldZ = -(focusZ - this.shape.depth / 2);

    // Walking bobs the camera at about two steps a second, and an explosion
    // within 5 m shakes it for no more than a third of a second.
    let bob = 0;
    if (comfort.bob() && this.moving()) {
      this.walkPhase = (now / 1000) * 2 * Math.PI * 2;
      bob = Math.sin(this.walkPhase) * 0.16;
    }
    let shakeX = 0;
    let shakeY = 0;
    if (comfort.shake() && now < this.shakeUntil) {
      const strength = ((this.shakeUntil - now) / 300) * 0.5;
      shakeX = (Math.random() - 0.5) * strength;
      shakeY = (Math.random() - 0.5) * strength;
    }

    if (vehicle) {
      // A convoy camera follows from behind the car's heading.
      const radians = (vehicle.heading * Math.PI) / 180;
      camera.position.set(
        worldX - Math.cos(radians) * 18 + shakeX,
        9 + bob + shakeY,
        worldZ + Math.sin(radians) * 18,
      );
    } else {
      // The siege camera holds a fixed bearing from behind and above the player,
      // so screen right is east and screen up is north and the pointer maps
      // straight onto the aim the server is told about.
      camera.position.set(worldX + shakeX, 13 + bob + shakeY, worldZ + 13);
    }
    camera.lookAt(worldX, 1, worldZ);
    this.drawEntities();
  }

  /** moving reports whether this player's own figure is on the move, which is
   *  what the camera bob follows. */
  private moving(): boolean {
    const self = this.state?.players.find((p) => p.id === this.selfID);
    if (!self || self.status !== 'up') return false;
    const moved = this.lastSelfAt && (self.x !== this.lastSelfAt.x || self.z !== this.lastSelfAt.z);
    this.lastSelfAt = { x: self.x, z: self.z };
    return Boolean(moved);
  }

  private lastSelfAt: { x: number; z: number } | null = null;

  /** entityPool hands out reusable meshes of one kind. Geometries and materials
   *  are made once: rebuilding them every frame would leak GPU resources and
   *  stall the renderer during a long match. */
  private pool(kind: string, build: () => THREE.Mesh): THREE.Mesh {
    let pooled = this.pools.get(kind);
    if (!pooled) {
      pooled = { meshes: [], used: 0 };
      this.pools.set(kind, pooled);
    }
    if (pooled.used === pooled.meshes.length) {
      const mesh = build();
      pooled.meshes.push(mesh);
      this.entityGroup?.add(mesh);
    }
    const mesh = pooled.meshes[pooled.used];
    pooled.used += 1;
    mesh.visible = true;
    return mesh;
  }

  private pools = new Map<string, { meshes: THREE.Mesh[]; used: number }>();
  private shared: {
    geometry: Map<string, THREE.BufferGeometry>;
    material: Map<string, THREE.MeshLambertMaterial>;
  } = { geometry: new Map(), material: new Map() };

  private geometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let found = this.shared.geometry.get(key);
    if (!found) {
      found = build();
      this.shared.geometry.set(key, found);
    }
    return found;
  }

  private edges: THREE.LineBasicMaterial | null = null;

  private edgeMaterial(): THREE.LineBasicMaterial {
    if (!this.edges) {
      this.edges = new THREE.LineBasicMaterial({ color: colours.blockEdge, transparent: true, opacity: 0.6 });
    }
    return this.edges;
  }

  private material(key: string, colour: number, opacity: number): THREE.MeshLambertMaterial {
    const id = `${key}:${opacity}`;
    let found = this.shared.material.get(id);
    if (!found) {
      found = new THREE.MeshLambertMaterial({
        color: colour,
        flatShading: true,
        transparent: opacity < 1,
        opacity,
      });
      this.shared.material.set(id, found);
    }
    return found;
  }

  private drawEntities(): void {
    const group = this.entityGroup;
    if (!group) return;
    for (const pooled of this.pools.values()) pooled.used = 0;

    const state = this.state;
    if (state) {
      const place = (mesh: THREE.Mesh, x: number, z: number, y: number) => {
        mesh.position.set(x - this.shape.width / 2, y, -(z - this.shape.depth / 2));
      };

      for (const player of state.players) {
        if (player.connection === 'left') continue;
        const up = player.status === 'up';
        const mesh = this.pool(`player:${up}`, () =>
          new THREE.Mesh(
            this.geometry('player', () => new THREE.BoxGeometry(0.8, 1.7, 0.8)),
            this.material('player', colours.player, up ? 1 : 0.4),
          ),
        );
        mesh.rotation.y = -(player.aim * Math.PI) / 180;
        place(mesh, player.x, player.z, 0.85);
      }
      for (const enemy of state.enemies) {
        if (enemy.state === 'dead') continue;
        const size = enemy.kind === 'boss' ? 2 : enemy.kind === 'brute' ? 1.4 : 1;
        const mesh = this.pool(`enemy:${enemy.kind}`, () =>
          new THREE.Mesh(
            this.geometry(`enemy:${enemy.kind}`, () =>
              new THREE.BoxGeometry(size * 0.8, size * 1.7, size * 0.8),
            ),
            this.material('enemy', colours.enemy, 1),
          ),
        );
        place(mesh, enemy.x, enemy.z, (size * 1.7) / 2);
      }
      for (const barrel of state.barrels) {
        if (barrel.destroyed) continue;
        const mesh = this.pool('barrel', () =>
          new THREE.Mesh(
            this.geometry('barrel', () => new THREE.CylinderGeometry(0.4, 0.4, 1.1, 7)),
            this.material('barrel', colours.barrel, 1),
          ),
        );
        place(mesh, barrel.x, barrel.z, 0.55);
      }
      for (const grenade of state.grenades) {
        const mesh = this.pool('grenade', () =>
          new THREE.Mesh(
            this.geometry('grenade', () => new THREE.IcosahedronGeometry(0.3, 0)),
            this.material('grenade', colours.grenade, 1),
          ),
        );
        place(mesh, grenade.x, grenade.z, 0.3);
      }
      for (const vehicle of state.vehicles) {
        const running = vehicle.state === 'running';
        const mesh = this.pool(`vehicle:${running}`, () =>
          new THREE.Mesh(
            this.geometry('vehicle', () => new THREE.BoxGeometry(4.2, 1.4, 2.2)),
            this.material('vehicle', colours.vehicle, running ? 1 : 0.45),
          ),
        );
        mesh.rotation.y = -(vehicle.heading * Math.PI) / 180;
        place(mesh, vehicle.x, vehicle.z, 0.7);
      }
    }

    // Whatever this frame did not need is simply hidden, ready for the next one.
    for (const pooled of this.pools.values()) {
      for (let i = pooled.used; i < pooled.meshes.length; i += 1) pooled.meshes[i].visible = false;
    }
  }

  // ---------- 2D fallback ----------

  private initFallback(): void {
    this.fallback = el('canvas', { style: 'position:absolute;inset:0;display:block;' });
    this.root.appendChild(this.fallback);
    this.resize();
  }

  /** drawFallback paints a still top-down picture of the same blocks and
   *  entities, redrawn on each snapshot. */
  private drawFallback(): void {
    const canvas = this.fallback;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.fillStyle = '#03090b';
    ctx.fillRect(0, 0, width, height);

    const scale = Math.min(width / this.shape.width, height / this.shape.depth) * 0.92;
    const offsetX = (width - this.shape.width * scale) / 2;
    const offsetY = (height - this.shape.depth * scale) / 2;
    const toX = (x: number) => offsetX + x * scale;
    const toY = (z: number) => offsetY + (this.shape.depth - z) * scale;

    ctx.strokeStyle = '#10312f';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.shape.width; i += 4) {
      ctx.beginPath();
      ctx.moveTo(toX(i), toY(0));
      ctx.lineTo(toX(i), toY(this.shape.depth));
      ctx.stroke();
    }
    for (let i = 0; i <= this.shape.depth; i += 4) {
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(i));
      ctx.lineTo(toX(this.shape.width), toY(i));
      ctx.stroke();
    }

    ctx.fillStyle = '#1d4f4a';
    ctx.strokeStyle = '#2f7d6c';
    for (const block of this.shape.blocks) {
      const x = toX(block.x);
      const y = toY(block.z + block.d);
      ctx.fillRect(x, y, block.w * scale, block.d * scale);
      ctx.strokeRect(x, y, block.w * scale, block.d * scale);
    }

    const state = this.state;
    if (!state) return;
    const dot = (x: number, z: number, radius: number, colour: string) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(toX(x), toY(z), Math.max(3, radius * scale), 0, Math.PI * 2);
      ctx.fill();
    };
    for (const barrel of state.barrels) if (!barrel.destroyed) dot(barrel.x, barrel.z, 0.4, '#d1a84c');
    for (const grenade of state.grenades) dot(grenade.x, grenade.z, 0.3, '#eae2a8');
    for (const enemy of state.enemies) {
      if (enemy.state === 'dead') continue;
      dot(enemy.x, enemy.z, enemy.kind === 'boss' ? 1 : enemy.kind === 'brute' ? 0.7 : 0.5, '#c8705f');
    }
    for (const player of state.players) {
      if (player.connection === 'left') continue;
      dot(player.x, player.z, 0.5, player.status === 'up' ? '#9ff2d0' : '#51776c');
    }
    for (const vehicle of state.vehicles) {
      dot(vehicle.x, vehicle.z, 1.4, vehicle.state === 'running' ? '#9ff2d0' : '#51776c');
    }
  }
}
