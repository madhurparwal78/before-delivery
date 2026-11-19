import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { GRID, HEADING_ANGLE, tileKind, type Heading } from '../shared/islands.js';
import { creatureById } from '../shared/creatures.js';

export type Preset = 'full' | 'balanced' | 'light';
export type SceneCreature = { id: string; x: number; y: number; heading: Heading };

const LAND = new THREE.Color('#9fb783');
const ROCK = new THREE.Color('#7d7a73');
const SAND = new THREE.Color('#d8cfa8');

function creatureColour(id: string): THREE.Color {
  let hash = 0;
  for (const letter of id) hash = (hash * 31 + letter.charCodeAt(0)) % 360;
  return new THREE.Color().setHSL(hash / 360, 0.45, 0.45);
}

const GRASS_VERTEX = `
uniform float uTime;
uniform vec2 uExplorer;
uniform float uSway;
varying float vShade;
void main() {
  vec4 world = instanceMatrix * vec4(position, 1.0);
  float height = max(position.y, 0.0);
  vec2 away = world.xz - uExplorer;
  float part = clamp(1.0 - length(away) / 2.2, 0.0, 1.0);
  vec2 push = normalize(away + vec2(0.0001)) * part * 0.45;
  float sway = sin(uTime * 2.2 + world.x * 1.7 + world.z * 1.1) * 0.16 * uSway;
  world.x += (sway + push.x) * height;
  world.z += (push.y) * height;
  vShade = 0.55 + height * 0.6;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * world;
}`;

const GRASS_FRAGMENT = `
uniform vec3 uColour;
varying float vShade;
void main() { gl_FragColor = vec4(uColour * vShade, 1.0); }`;

const SKY_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = `
uniform vec3 uTop;
uniform vec3 uBottom;
varying vec3 vDirection;
void main() {
  float height = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(uBottom, uTop, height), 1.0);
}`;

export type CameraTuple = [number, number, number, number, number, number];

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  private readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bokeh: BokehPass | null = null;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private readonly hemisphere = new THREE.HemisphereLight(0xdfefff, 0x6a7a55, 0.7);
  private readonly sunDisc: THREE.Mesh;
  private readonly sky: THREE.Mesh;
  private readonly ground = new THREE.Group();
  private readonly water: THREE.Mesh;
  private readonly explorer = new THREE.Group();
  private readonly explorerMirror = new THREE.Group();
  private readonly creatureGroup = new THREE.Group();
  private readonly creatureMeshes = new Map<string, THREE.Object3D>();
  private grassMaterial: THREE.ShaderMaterial | null = null;
  private fireflies: THREE.Points | null = null;
  private rain: THREE.InstancedMesh | null = null;
  private lighthouseLight: THREE.Mesh | null = null;
  private island = 1;
  private preset: Preset;
  private reduced: boolean;
  private tile = { x: 3, y: 12 };
  private mode: 'explore' | 'photo' = 'explore';
  private yaw = 90;
  private zoom = 2;
  private focus = 4;
  private eyeBlend = 0;
  private eyeTarget = 0;
  private lastFrame = performance.now();
  private readonly cameraTuple: CameraTuple = [0, 0, 0, 0, 0, 0];
  private lastPose = '';

  constructor(canvas: HTMLCanvasElement, preset: Preset, reduced: boolean) {
    this.preset = preset;
    this.reduced = reduced;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: preset === 'full' });
    this.renderer.setPixelRatio(preset === 'full' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.shadowMap.enabled = preset !== 'light';
    this.renderer.shadowMap.type = preset === 'full' ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(200, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color('#5aa6e0') }, uBottom: { value: new THREE.Color('#dfeaf2') } },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.scene.add(this.sky);

    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(4, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#fff6d8' }),
    );
    this.scene.add(this.sunDisc);

    this.sun.castShadow = preset !== 'light';
    this.sun.shadow.mapSize.setScalar(preset === 'full' ? 1024 : 512);
    this.sun.shadow.camera.left = -22;
    this.sun.shadow.camera.right = 22;
    this.sun.shadow.camera.top = 22;
    this.sun.shadow.camera.bottom = -22;
    this.sun.shadow.camera.far = 120;
    this.scene.add(this.sun, this.hemisphere);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.MeshStandardMaterial({
        color: '#4c7c96',
        transparent: true,
        opacity: preset === 'light' ? 1 : 0.82,
        roughness: preset === 'light' ? 0.9 : 0.15,
        metalness: preset === 'light' ? 0 : 0.5,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -0.22;
    this.water.receiveShadow = false;
    this.scene.add(this.water);

    this.scene.add(this.ground, this.creatureGroup, this.explorer, this.explorerMirror);
    this.buildExplorer();
    this.buildIsland(1);
  }

  private buildExplorer(): void {
    const build = (): THREE.Group => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.22, 0.5, 6, 10),
        new THREE.MeshStandardMaterial({ color: '#2f3a46', roughness: 0.7 }),
      );
      body.position.y = 0.55;
      body.castShadow = true;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 14, 10),
        new THREE.MeshStandardMaterial({ color: '#e4c7a6', roughness: 0.8 }),
      );
      head.position.y = 1.02;
      head.castShadow = true;
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.18, 10),
        new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.4 }),
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 0.95, 0.2);
      group.add(body, head, lens);
      return group;
    };
    this.explorer.add(build());
    const mirror = build();
    mirror.scale.y = -1;
    this.explorerMirror.add(mirror);
  }

  private buildIsland(island: number): void {
    this.island = island;
    this.ground.clear();
    const landTiles: Array<[number, number]> = [];
    const rockTiles: Array<[number, number]> = [];
    for (let y = 0; y < GRID; y += 1)
      for (let x = 0; x < GRID; x += 1) {
        const kind = tileKind(island, x, y);
        if (kind === 'land') landTiles.push([x, y]);
        else if (kind === 'rock') rockTiles.push([x, y]);
      }

    const tileGeometry = new THREE.BoxGeometry(1, 0.4, 1);
    const landMesh = new THREE.InstancedMesh(
      tileGeometry,
      new THREE.MeshStandardMaterial({ roughness: 0.95 }),
      landTiles.length,
    );
    landMesh.receiveShadow = this.preset !== 'light';
    const matrix = new THREE.Matrix4();
    landTiles.forEach(([x, y], index) => {
      matrix.makeTranslation(x + 0.5, -0.2, y + 0.5);
      landMesh.setMatrixAt(index, matrix);
      const edge = x <= 1 || y <= 1 || x >= GRID - 2 || y >= GRID - 2;
      landMesh.setColorAt(index, edge ? SAND : LAND);
    });
    landMesh.instanceMatrix.needsUpdate = true;
    this.ground.add(landMesh);

    if (rockTiles.length > 0) {
      const rockMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.9),
        new THREE.MeshStandardMaterial({ color: ROCK, roughness: 0.9 }),
        rockTiles.length,
      );
      rockMesh.castShadow = this.preset !== 'light';
      rockMesh.receiveShadow = this.preset !== 'light';
      rockTiles.forEach(([x, y], index) => {
        matrix.makeTranslation(x + 0.5, 0.35, y + 0.5);
        rockMesh.setMatrixAt(index, matrix);
      });
      rockMesh.instanceMatrix.needsUpdate = true;
      this.ground.add(rockMesh);
    }

    if (island === 5) this.buildLighthouse();
    this.buildGrass(landTiles);
    this.buildRain();
    this.buildFireflies();
  }

  private buildLighthouse(): void {
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.55, 4, 14),
      new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 }),
    );
    tower.position.set(20.5, 2, 4.5);
    tower.castShadow = this.preset !== 'light';
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 12, 10),
      new THREE.MeshBasicMaterial({ color: '#555555' }),
    );
    lamp.position.set(20.5, 4.2, 4.5);
    this.lighthouseLight = lamp;
    this.ground.add(tower, lamp);
  }

  private buildGrass(landTiles: Array<[number, number]>): void {
    this.grassMaterial = null;
    if (this.preset === 'light') return;
    const blades = Math.min(1400, landTiles.length * 3);
    const geometry = new THREE.ConeGeometry(0.06, 0.5, 3);
    geometry.translate(0, 0.25, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uExplorer: { value: new THREE.Vector2(0, 0) },
        uColour: { value: new THREE.Color('#7f9a5c') },
        uSway: { value: this.reduced ? 0 : 1 },
      },
      vertexShader: GRASS_VERTEX,
      fragmentShader: GRASS_FRAGMENT,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, blades);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < blades; index += 1) {
      const [x, y] = landTiles[(index * 7) % landTiles.length];
      matrix.makeTranslation(x + ((index * 0.37) % 1), 0, y + ((index * 0.61) % 1));
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.grassMaterial = material;
    this.ground.add(mesh);
  }

  private buildRain(): void {
    this.rain = null;
    if (this.preset === 'light') return;
    const rings = 80;
    const geometry = new THREE.RingGeometry(0.1, 0.3, 10);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.5 }),
      rings,
    );
    mesh.visible = false;
    this.rain = mesh;
    this.scene.add(mesh);
  }

  private buildFireflies(): void {
    this.fireflies = null;
    if (this.preset === 'light') return;
    const count = 120;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = 2 + Math.random() * 20;
      positions[index * 3 + 1] = 0.4 + Math.random() * 2;
      positions[index * 3 + 2] = 2 + Math.random() * 20;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: '#ffe9a8', size: 0.16, transparent: true, opacity: 0.9 }),
    );
    points.visible = false;
    this.fireflies = points;
    this.scene.add(points);
  }

  setIsland(island: number): void {
    if (island === this.island) return;
    this.lastPose = '';
    this.buildIsland(island);
  }

  setPreset(preset: Preset): void {
    this.preset = preset;
    this.renderer.shadowMap.enabled = preset !== 'light';
    this.explorerMirror.visible = preset !== 'light';
    this.buildIsland(this.island);
    this.composer = null;
    this.bokeh = null;
  }

  setExplorer(tile: { x: number; y: number }, heading: Heading): void {
    this.tile = tile;
    this.explorer.position.set(tile.x + 0.5, 0, tile.y + 0.5);
    this.explorer.rotation.y = THREE.MathUtils.degToRad(180 - HEADING_ANGLE[heading]);
    this.explorerMirror.position.set(tile.x + 0.5, -0.44, tile.y + 0.5);
    this.explorerMirror.rotation.y = this.explorer.rotation.y;
  }

  setCreatures(creatures: ReadonlyArray<SceneCreature>): void {
    this.lastPose = '';
    const present = new Set(creatures.map((creature) => creature.id));
    for (const [id, mesh] of this.creatureMeshes)
      if (!present.has(id)) {
        this.creatureGroup.remove(mesh);
        this.creatureMeshes.delete(id);
      }
    for (const creature of creatures) {
      let mesh = this.creatureMeshes.get(creature.id);
      if (!mesh) {
        const definition = creatureById(creature.id);
        const size = definition ? definition.size : 1;
        const group = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.SphereGeometry(0.18 + size * 0.1, 14, 10),
          new THREE.MeshStandardMaterial({ color: creatureColour(creature.id), roughness: 0.6 }),
        );
        body.position.y = 0.2 + size * 0.1;
        body.castShadow = this.preset !== 'light';
        const snout = new THREE.Mesh(
          new THREE.ConeGeometry(0.1, 0.26, 8),
          new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.7 }),
        );
        snout.rotation.x = Math.PI / 2;
        snout.position.set(0, 0.24 + size * 0.1, 0.22 + size * 0.08);
        group.add(body, snout);
        mesh = group;
        this.creatureMeshes.set(creature.id, group);
        this.creatureGroup.add(group);
      }
      mesh.position.set(creature.x + 0.5, 0, creature.y + 0.5);
      mesh.rotation.y = THREE.MathUtils.degToRad(180 - HEADING_ANGLE[creature.heading]);
    }
  }

  setWorld(hour: number, weather: 'clear' | 'rain', dusk: boolean): void {
    this.lastPose = '';
    const share = Math.cos(((hour - 12) / 24) * Math.PI * 2) * 0.5 + 0.5;
    const elevation = Math.max(0.08, share);
    const angle = ((hour - 6) / 24) * Math.PI * 2;
    this.sun.position.set(Math.cos(angle) * 60, 12 + elevation * 60, Math.sin(angle) * 60);
    this.sunDisc.position.copy(this.sun.position).multiplyScalar(1.4);
    this.sun.intensity = weather === 'rain' ? 0.5 : 0.6 + elevation * 1.4;
    this.hemisphere.intensity = weather === 'rain' ? 0.5 : 0.4 + elevation * 0.5;
    const material = this.sky.material as THREE.ShaderMaterial;
    const top = dusk ? new THREE.Color('#2d3f6b') : weather === 'rain' ? new THREE.Color('#7d8a94') : new THREE.Color('#4f9fdc');
    const bottom = dusk
      ? new THREE.Color('#e08a52')
      : weather === 'rain'
        ? new THREE.Color('#c6ced4')
        : new THREE.Color('#e4eef5');
    (material.uniforms.uTop.value as THREE.Color).copy(top);
    (material.uniforms.uBottom.value as THREE.Color).copy(bottom);
    if (this.fireflies) this.fireflies.visible = dusk;
    if (this.rain) this.rain.visible = weather === 'rain';
  }

  setLighthouse(open: boolean): void {
    if (!this.lighthouseLight) return;
    (this.lighthouseLight.material as THREE.MeshBasicMaterial).color.set(open ? '#ffdf7a' : '#555555');
  }

  setCamera(mode: 'explore' | 'photo', yaw: number, zoom: number, focus: number): void {
    this.mode = mode;
    this.yaw = yaw;
    this.zoom = zoom;
    this.focus = focus;
    this.eyeTarget = mode === 'photo' ? 1 : 0;
    if (this.reduced) this.eyeBlend = this.eyeTarget;
  }

  cutCamera(): void {
    this.eyeBlend = this.eyeTarget;
  }

  resize(width: number, height: number): void {
    this.lastPose = '';
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(width, height);
  }

  private depthOfField(): EffectComposer | null {
    if (this.preset === 'light' || this.mode !== 'photo') return null;
    if (!this.composer) {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bokeh = new BokehPass(this.scene, this.camera, { focus: this.focus, aperture: 0.0006, maxblur: 0.012 });
      composer.addPass(bokeh);
      this.composer = composer;
      this.bokeh = bokeh;
      const size = this.renderer.getSize(new THREE.Vector2());
      composer.setSize(size.x, size.y);
    }
    const uniforms = (this.bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
    if (uniforms?.focus) uniforms.focus.value = this.focus;
    return this.composer;
  }

  render(now: number): CameraTuple {
    const elapsed = this.reduced ? 0 : (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!this.reduced && this.eyeBlend !== this.eyeTarget) {
      const direction = this.eyeTarget > this.eyeBlend ? 1 : -1;
      const moved = this.eyeBlend + (direction * elapsed * 1000) / 320;
      this.eyeBlend = direction > 0 ? Math.min(this.eyeTarget, moved) : Math.max(this.eyeTarget, moved);
    }

    const centre = new THREE.Vector3(this.tile.x + 0.5, 1, this.tile.y + 0.5);
    const yawRadians = THREE.MathUtils.degToRad(this.yaw);
    const distance = this.mode === 'photo' ? 0 : 5 + (4 - this.zoom) * 2.5;
    const orbit = new THREE.Vector3(
      centre.x - Math.sin(yawRadians) * distance,
      centre.y + 3 + (4 - this.zoom) * 0.8,
      centre.z + Math.cos(yawRadians) * distance,
    );
    const eye = new THREE.Vector3(centre.x, centre.y, centre.z);
    const look = new THREE.Vector3(
      centre.x + Math.sin(yawRadians) * 8,
      centre.y - 0.4,
      centre.z - Math.cos(yawRadians) * 8,
    );
    const position = orbit.clone().lerp(eye, this.eyeBlend);
    const target = centre.clone().lerp(look, this.eyeBlend);
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    const throughTheLens = this.eyeBlend > 0.5;
    this.explorer.visible = !throughTheLens;
    this.explorerMirror.visible = this.preset !== 'light' && !throughTheLens;

    if (this.grassMaterial) {
      this.grassMaterial.uniforms.uTime.value = this.reduced ? 0 : now / 1000;
      (this.grassMaterial.uniforms.uExplorer.value as THREE.Vector2).set(centre.x, centre.z);
      this.grassMaterial.uniforms.uSway.value = this.reduced ? 0 : 1;
    }
    if (this.fireflies && this.fireflies.visible && !this.reduced) {
      this.fireflies.rotation.y = now / 9000;
      this.fireflies.position.y = Math.sin(now / 1400) * 0.18;
    }
    if (this.rain && this.rain.visible) {
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < 80; index += 1) {
        const phase = this.reduced ? 0.4 : ((now / 900 + index * 0.37) % 1);
        const x = 1 + ((index * 5.7) % 22);
        const z = 1 + ((index * 8.3) % 22);
        matrix.makeScale(0.4 + phase * 1.6, 1, 0.4 + phase * 1.6);
        matrix.setPosition(x, -0.2, z);
        this.rain.setMatrixAt(index, matrix);
      }
      this.rain.instanceMatrix.needsUpdate = true;
    }

    const pose = `${this.tile.x},${this.tile.y},${this.mode},${this.yaw},${this.zoom},${this.focus},${this.eyeBlend}`;
    const still = this.reduced && pose === this.lastPose;
    this.lastPose = pose;
    if (!still) {
      const composer = this.depthOfField();
      if (composer) composer.render();
      else this.renderer.render(this.scene, this.camera);
    }

    this.cameraTuple[0] = round(position.x);
    this.cameraTuple[1] = round(position.y);
    this.cameraTuple[2] = round(position.z);
    this.cameraTuple[3] = round(target.x);
    this.cameraTuple[4] = round(target.y);
    this.cameraTuple[5] = round(target.z);
    return this.cameraTuple;
  }

  /** The tile under a pointer, from the ground plane the explorer stands on. */
  tileAt(ndcX: number, ndcY: number): { x: number; y: number } | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const point = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point);
    if (!hit) return null;
    const x = Math.floor(point.x);
    const y = Math.floor(point.z);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
    return { x, y };
  }

  /** One rendered frame captured for the server, never wider than the published limit. */
  capture(maxWidth: number): Promise<Blob | null> {
    const canvas = this.renderer.domElement;
    const scale = Math.min(1, maxWidth / Math.max(1, canvas.width));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const target = new THREE.WebGLRenderTarget(width, height);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(null);
    target.dispose();
    this.lastPose = '';

    const flipped = new Uint8ClampedArray(width * height * 4);
    const stride = width * 4;
    for (let row = 0; row < height; row += 1)
      flipped.set(pixels.subarray((height - 1 - row) * stride, (height - row) * stride), row * stride);
    const sheet = document.createElement('canvas');
    sheet.width = width;
    sheet.height = height;
    const context = sheet.getContext('2d');
    if (!context) return Promise.resolve(null);
    context.putImageData(new ImageData(flipped, width, height), 0, 0);
    return new Promise((resolve) => sheet.toBlob((blob) => resolve(blob), 'image/png'));
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
