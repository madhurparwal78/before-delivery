// The live match canvas: bean meshes placed at the server's broadcast positions, and the spectator camera.
import * as THREE from "three";
import { buildWorld, createRenderer, fitCanvas, makeBean, overviewFraming, type World } from "./scene3d.js";
import { generateCourse } from "../shared/course.js";
import type { TickBean } from "../shared/sim.js";
import type { RoundKind } from "../shared/rules.js";

const FOLLOW_EASE = 0.35;

export class MatchScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(55, 1.5, 0.1, 400);
  private readonly world: World;
  private readonly beans = new Map<number, THREE.Group>();
  private readonly stopFitting: () => void;
  private readonly eye = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private following: number | null = null;
  private tickBeans: TickBean[] = [];
  private tick = 0;
  private frameRequest: number | null = null;

  static create(canvas: HTMLCanvasElement, kind: RoundKind, seed: number): MatchScene | null {
    const renderer = createRenderer(canvas);
    return renderer === null ? null : new MatchScene(renderer, canvas, kind, seed);
  }

  private constructor(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, kind: RoundKind, seed: number) {
    this.renderer = renderer;
    this.world = buildWorld(generateCourse(kind, seed));
    const overview = overviewFraming(this.world.course);
    this.eye.copy(overview.position);
    this.focus.copy(overview.target);
    this.stopFitting = fitCanvas(renderer, this.camera, canvas, () => this.requestDraw());
  }

  private framingFor(bean: TickBean | undefined): { position: THREE.Vector3; target: THREE.Vector3 } {
    if (bean === undefined) return overviewFraming(this.world.course);
    const at = new THREE.Vector3(bean.x, Math.max(bean.y, -2), bean.z);
    if (this.world.course.kind === "survival") {
      const outward = new THREE.Vector3(bean.x, 0, bean.z);
      if (outward.lengthSq() < 0.01) outward.set(0, 0, -1);
      outward.normalize();
      return { position: at.clone().addScaledVector(outward, 8).add(new THREE.Vector3(0, 6, 0)), target: at.clone().add(new THREE.Vector3(0, 0.8, 0)) };
    }
    return { position: at.clone().add(new THREE.Vector3(0, 5.5, -9)), target: at.clone().add(new THREE.Vector3(0, 1, 5)) };
  }

  // Each broadcast tick moves the beans to their recorded positions and eases the camera toward its subject;
  // the canvas is drawn on the next animation frame, at most once however many ticks arrived meanwhile.
  update(tick: number, tickBeans: TickBean[], following: number | null): void {
    this.tickBeans = tickBeans;
    this.tick = tick;
    this.world.setTick(tick);
    for (const tickBean of tickBeans) {
      let mesh = this.beans.get(tickBean.userId);
      if (mesh === undefined) {
        mesh = makeBean(tickBean.userId);
        this.beans.set(tickBean.userId, mesh);
        this.world.scene.add(mesh);
      }
      const dx = tickBean.x - mesh.position.x;
      const dz = tickBean.z - mesh.position.z;
      if (dx * dx + dz * dz > 0.0004) mesh.rotation.y = Math.atan2(dx, dz);
      mesh.position.set(tickBean.x, tickBean.y, tickBean.z);
      mesh.visible = tickBean.y > -12;
    }
    const subjectChanged = following !== this.following;
    this.following = following;
    const framing = this.framingFor(tickBeans.find((bean) => bean.userId === following));
    const ease = subjectChanged && following === null ? 1 : FOLLOW_EASE;
    this.eye.lerp(framing.position, ease);
    this.focus.lerp(framing.target, ease);
    this.requestDraw();
  }

  private requestDraw(): void {
    this.frameRequest ??= requestAnimationFrame(() => {
      this.frameRequest = null;
      this.camera.position.copy(this.eye);
      this.camera.lookAt(this.focus);
      this.renderer.render(this.world.scene, this.camera);
    });
  }

  refollow(following: number | null): void {
    this.update(this.tick, this.tickBeans, following);
  }

  dispose(): void {
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.stopFitting();
    this.renderer.dispose();
  }
}
