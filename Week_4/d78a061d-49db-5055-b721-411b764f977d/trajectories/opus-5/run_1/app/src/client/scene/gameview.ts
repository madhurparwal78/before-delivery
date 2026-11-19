import {
  AmbientLight,
  CircleGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildHero, buildWeapon, checkpointRing, COBALT, PAPER } from './hero.js';
import { el } from '../dom.js';
import { CHECKPOINT, GATE, GROUND_LIMIT, PUDDLE } from '../../shared/constants.js';
import type { Snapshot } from '../../shared/types.js';

const FLYTHROUGH_MS = 4000;
const STILL_MS = 900;

export interface GameViewOptions {
  label: string;
}

export class GameView {
  readonly element: HTMLElement;
  readonly webglAvailable: boolean;

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer | null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 0.1, 200);
  private readonly heroes = new Group();
  private readonly ground: Mesh;
  private readonly moteMeshes = new Map<string, Mesh>();
  private snapshot: Snapshot | null = null;
  private myAccountId = '';
  private flythroughStartedAt: number | null = null;
  private flythroughMs = FLYTHROUGH_MS;
  private running = true;

  constructor(options: GameViewOptions) {
    this.canvas = el('canvas', { class: 'scene-canvas' });
    this.element = el(
      'div',
      {
        class: 'game-view',
        role: 'application',
        'aria-label': options.label,
        tabindex: '0',
        'data-renderer': 'still',
        'data-flythrough': 'still',
      },
      [this.canvas],
    );

    let renderer: WebGLRenderer | null = null;
    try {
      renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
    this.webglAvailable = renderer !== null;
    this.element.dataset.renderer = this.webglAvailable ? 'webgl' : 'still';

    this.scene.add(new AmbientLight(0xffffff, 0.95));
    const sun = new DirectionalLight(0xffffff, 0.7);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);

    this.ground = new Mesh(
      new PlaneGeometry(GROUND_LIMIT * 2, GROUND_LIMIT * 2),
      new MeshStandardMaterial({ color: PAPER, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    const puddle = new Mesh(
      new CircleGeometry(PUDDLE.radius, 32),
      new MeshStandardMaterial({ color: 0x2a2f4a }),
    );
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(PUDDLE.x, 0.01, PUDDLE.z);
    this.scene.add(puddle);

    const ring = checkpointRing();
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(CHECKPOINT.x, 0.02, CHECKPOINT.z);
    this.scene.add(ring);

    const gate = new Mesh(
      new PlaneGeometry(3, 3),
      new MeshStandardMaterial({ color: COBALT, transparent: true, opacity: 0.6 }),
    );
    gate.position.set(GATE.x, 1.5, GATE.z);
    this.scene.add(gate);

    this.scene.add(this.heroes);
    this.frame();
  }

  async playFlythrough(reducedMotion: boolean): Promise<void> {
    this.flythroughMs = reducedMotion ? STILL_MS : FLYTHROUGH_MS;
    this.element.dataset.flythrough = reducedMotion ? 'still' : 'playing';
    this.flythroughStartedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, this.flythroughMs));
    this.endFlythrough();
  }

  endFlythrough(): void {
    this.flythroughStartedAt = null;
    this.element.dataset.flythrough = 'done';
  }

  heroPosition(): { x: number; z: number } {
    const mine = this.snapshot?.members.find((member) => member.account_id === this.myAccountId);
    return mine === undefined ? { x: 0, z: 0 } : { x: mine.position.x, z: mine.position.z };
  }

  /** Turns a pointer press into a ground point in metres. */
  groundAt(event: PointerEvent): { x: number; z: number } | null {
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0) return null;
    const pointer = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hit = raycaster.intersectObject(this.ground)[0];
    if (hit === undefined) return null;
    return { x: hit.point.x, z: hit.point.z };
  }

  update(snapshot: Snapshot, myAccountId: string): void {
    this.snapshot = snapshot;
    this.myAccountId = myAccountId;

    for (const mote of snapshot.motes) {
      let mesh = this.moteMeshes.get(mote.id);
      if (mesh === undefined) {
        mesh = new Mesh(
          new SphereGeometry(0.25, 12, 10),
          new MeshStandardMaterial({ color: 0x1d1d1f }),
        );
        mesh.position.set(mote.x, 0.5, mote.z);
        this.scene.add(mesh);
        this.moteMeshes.set(mote.id, mesh);
      }
      mesh.visible = mote.collected_by === null;
    }

    this.heroes.clear();
    for (const member of snapshot.members) {
      const figure = buildHero({
        parts: member.hero.parts,
        proportions: member.hero.proportions,
        material: member.hero.material,
        accessories: member.hero.accessories,
        armRaiseRadians: member.hero.pose.right_arm_raise,
      });
      figure.group.position.set(member.position.x, 0, member.position.z);
      if (member.weapon !== null) figure.attachWeapon(buildWeapon(member.weapon.strokes));
      this.heroes.add(figure.group);
    }
  }

  destroy(): void {
    this.running = false;
    this.renderer?.dispose();
  }

  private frame(): void {
    if (!this.running) return;
    const rect = this.element.getBoundingClientRect();
    const hero = this.heroPosition();

    if (this.flythroughStartedAt !== null && this.element.dataset.flythrough === 'playing') {
      const ratio = Math.min(1, (performance.now() - this.flythroughStartedAt) / this.flythroughMs);
      const from = new Vector3(GATE.x, 9, GATE.z - 6);
      const to = new Vector3(hero.x, 7, hero.z + 9);
      this.camera.position.lerpVectors(from, to, ratio);
      this.camera.lookAt(new Vector3(hero.x, 0.9, hero.z));
    } else {
      this.camera.position.set(hero.x, 7, hero.z + 9);
      this.camera.lookAt(new Vector3(hero.x, 0.9, hero.z));
    }

    if (rect.width > 0 && rect.height > 0) {
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
      if (this.renderer !== null) {
        this.renderer.setSize(rect.width, rect.height, false);
        this.renderer.render(this.scene, this.camera);
      } else {
        this.drawTopDown(rect.width, rect.height);
      }
    }

    requestAnimationFrame(() => this.frame());
  }

  /** The flat top-down drawing used without WebGL, with heroes as labelled dots. */
  private drawTopDown(width: number, height: number): void {
    const context = this.canvas.getContext('2d');
    if (context === null) return;
    this.canvas.width = width;
    this.canvas.height = height;
    context.clearRect(0, 0, width, height);
    const scale = Math.min(width, height) / (GROUND_LIMIT * 2);
    const toScreen = (x: number, z: number): [number, number] => [
      width / 2 + x * scale,
      height / 2 + z * scale,
    ];

    context.strokeStyle = '#1d1d1f';
    context.fillStyle = '#2a2f4a';
    const [px, pz] = toScreen(PUDDLE.x, PUDDLE.z);
    context.beginPath();
    context.arc(px, pz, PUDDLE.radius * scale, 0, Math.PI * 2);
    context.fill();

    const [cx, cz] = toScreen(CHECKPOINT.x, CHECKPOINT.z);
    context.beginPath();
    context.arc(cx, cz, 1.5 * scale, 0, Math.PI * 2);
    context.stroke();

    const [gx, gz] = toScreen(GATE.x, GATE.z);
    context.strokeRect(gx - scale, gz - scale, scale * 2, scale * 2);

    for (const mote of this.snapshot?.motes ?? []) {
      if (mote.collected_by !== null) continue;
      const [mx, mz] = toScreen(mote.x, mote.z);
      context.fillStyle = '#1d1d1f';
      context.beginPath();
      context.arc(mx, mz, 0.3 * scale, 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = '#1f4fd8';
    context.font = '12px sans-serif';
    for (const member of this.snapshot?.members ?? []) {
      const [hx, hz] = toScreen(member.position.x, member.position.z);
      context.beginPath();
      context.arc(hx, hz, 0.4 * scale, 0, Math.PI * 2);
      context.fill();
      context.fillText(member.display_name, hx + 8, hz - 8);
    }
  }
}
