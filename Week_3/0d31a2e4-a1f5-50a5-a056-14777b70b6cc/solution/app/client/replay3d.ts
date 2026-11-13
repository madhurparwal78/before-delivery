// The photo-finish canvas: beans glide to each tick's recorded positions and the replay camera flies to the leader on jumps.
import * as THREE from "three";
import { buildWorld, createRenderer, fitCanvas, makeBean, makeRing, PALETTE, type World } from "./scene3d.js";
import { generateCourse } from "../shared/course.js";
import type { FrameView } from "../shared/api.js";
import type { RoundKind } from "../shared/rules.js";

const GLIDE_MS = 150;
const FLIGHT_MS = 500;

export type Motion = "moving" | "still";

interface Tween {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  duration: number;
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function step(tween: Tween, now: number, out: THREE.Vector3): boolean {
  const t = tween.duration <= 0 ? 1 : Math.min(1, (now - tween.start) / tween.duration);
  out.lerpVectors(tween.from, tween.to, easeOut(t));
  return t >= 1;
}

export class ReplayScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 400);
  private readonly world: World;
  private readonly beans = new Map<number, { mesh: THREE.Group; tween: Tween | null }>();
  // Different sizes, so both rings stay in sight when the two beans finish side by side.
  private readonly rings = { lastSlot: makeRing(PALETTE.teal, 0.7), firstOut: makeRing(PALETTE.red, 0.95) };
  private readonly eye = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private eyeTween: Tween | null = null;
  private focusTween: Tween | null = null;
  private flying = false;
  private frameRequest: number | null = null;
  private readonly stopFitting: () => void;
  private readonly onMotion: (camera: Motion, beans: Motion) => void;
  private readonly reduced: boolean;

  static create(canvas: HTMLCanvasElement, kind: RoundKind, seed: number, reduced: boolean,
    onMotion: (camera: Motion, beans: Motion) => void): ReplayScene | null {
    const renderer = createRenderer(canvas);
    return renderer === null ? null : new ReplayScene(renderer, canvas, kind, seed, reduced, onMotion);
  }

  private constructor(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, kind: RoundKind, seed: number, reduced: boolean,
    onMotion: (camera: Motion, beans: Motion) => void) {
    this.renderer = renderer;
    this.world = buildWorld(generateCourse(kind, seed));
    this.reduced = reduced;
    this.onMotion = onMotion;
    this.stopFitting = fitCanvas(renderer, this.camera, canvas, () => this.draw());
  }

  // Frames the rank-1 bean with the finish line (the arena, in survival), plus the marked beans on the deciding tick.
  private framing(frame: FrameView): { position: THREE.Vector3; target: THREE.Vector3 } {
    const leader = frame.beans[0];
    const subjects = frame.beans.filter((bean, index) => index === 0 || bean.marker !== null);
    if (this.world.course.kind === "survival") {
      const centre = new THREE.Vector3();
      for (const bean of subjects) centre.add(new THREE.Vector3(bean.x, 0, bean.z));
      centre.divideScalar(Math.max(1, subjects.length));
      const outward = new THREE.Vector3(leader?.x ?? 0, 0, leader?.z ?? 0);
      if (outward.lengthSq() < 0.01) outward.set(0, 0, -1);
      outward.normalize();
      const spread = Math.max(...subjects.map((bean) => Math.hypot(bean.x - centre.x, bean.z - centre.z)), 4);
      return { position: centre.clone().addScaledVector(outward, 8 + spread * 1.4).add(new THREE.Vector3(0, 7 + spread * 0.6, 0)), target: centre };
    }
    // A three-quarter view from the runners' right side: the course runs left to right on screen, so the order and the line read at a glance.
    // The finish line is always in frame, however far ahead of the leader it is.
    const zs = [...subjects.map((bean) => bean.z), this.world.course.finishZ];
    const near = Math.min(...zs);
    const far = Math.max(...zs);
    const span = Math.max(far - near, 6);
    const focusZ = (near + far) / 2;
    const distance = 7 + span * 0.75;
    return {
      position: new THREE.Vector3(-distance * 0.6, 3 + distance * 0.75, focusZ - distance * 0.3),
      target: new THREE.Vector3(0, 0.6, focusZ),
    };
  }

  show(frame: FrameView, jump: boolean): void {
    const now = performance.now();
    this.world.setTick(frame.tick);
    const glide = this.reduced ? 0 : GLIDE_MS;
    for (const bean of frame.beans) {
      let entry = this.beans.get(bean.userId);
      const to = new THREE.Vector3(bean.x, bean.y, bean.z);
      if (entry === undefined) {
        entry = { mesh: makeBean(bean.userId), tween: null };
        entry.mesh.position.copy(to);
        this.beans.set(bean.userId, entry);
        this.world.scene.add(entry.mesh);
      } else {
        entry.tween = { from: entry.mesh.position.clone(), to, start: now, duration: glide };
      }
      if (bean.marker === "last_slot") entry.mesh.add(this.rings.lastSlot);
      if (bean.marker === "first_out") entry.mesh.add(this.rings.firstOut);
    }
    if (!frame.beans.some((bean) => bean.marker === "last_slot")) this.rings.lastSlot.removeFromParent();
    if (!frame.beans.some((bean) => bean.marker === "first_out")) this.rings.firstOut.removeFromParent();
    const target = this.framing(frame);
    const first = this.eyeTween === null && this.focusTween === null && this.eye.lengthSq() === 0;
    const duration = this.reduced || first ? 0 : jump ? FLIGHT_MS : glide;
    this.flying = jump && duration > 0;
    this.eyeTween = { from: first ? target.position : this.eye.clone(), to: target.position, start: now, duration };
    this.focusTween = { from: first ? target.target : this.focus.clone(), to: target.target, start: now, duration };
    this.animate();
  }

  private animate(): void {
    const now = performance.now();
    let beansMoving = false;
    for (const entry of this.beans.values()) {
      if (entry.tween === null) continue;
      if (step(entry.tween, now, entry.mesh.position)) entry.tween = null;
      else beansMoving = true;
    }
    let cameraMoving = false;
    if (this.eyeTween !== null && this.focusTween !== null) {
      const eyeDone = step(this.eyeTween, now, this.eye);
      const focusDone = step(this.focusTween, now, this.focus);
      cameraMoving = !(eyeDone && focusDone);
      if (!cameraMoving) {
        this.eyeTween = null;
        this.focusTween = null;
        this.flying = false;
      }
    }
    this.onMotion(cameraMoving && this.flying ? "moving" : "still", beansMoving ? "moving" : "still");
    this.draw();
    if ((beansMoving || cameraMoving) && this.frameRequest === null) {
      this.frameRequest = requestAnimationFrame(() => {
        this.frameRequest = null;
        this.animate();
      });
    }
  }

  private draw(): void {
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.focus);
    this.renderer.render(this.world.scene, this.camera);
  }

  dispose(): void {
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.stopFitting();
    this.renderer.dispose();
  }
}
