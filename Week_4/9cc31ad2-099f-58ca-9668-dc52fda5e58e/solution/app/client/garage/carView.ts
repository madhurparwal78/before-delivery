import * as THREE from "three";
import { h, prefersReducedMotion } from "../dom";
import { carDrawing } from "../drawing";
import { frames } from "../motion";
import { PALETTE, buildCar, lights, webgl2Renderer } from "../scene";

const TURN_MS = 30000;
const RESUME_MS = 2000;
const WEBGL_NOTICE = "3D view needs WebGL 2. Showing a drawing instead.";

// The selected car as a live 3D view on a ruled floor: turns slowly on its own, orbits when
// dragged, holds still under reduced motion, and becomes a side-profile drawing without WebGL 2.
export class CarView {
  readonly element: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly canvas = h("canvas", { role: "img" });
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.1, 100);
  private car: THREE.Group | null = null;
  private yaw = 2.35;
  private azimuth = 0.5;
  private resumeAt = 0;
  private dragX: number | null = null;
  private stop: (() => void) | null = null;
  private readonly resize: ResizeObserver;

  constructor() {
    this.stage = h("div", { class: "car-stage" });
    this.notice = h("p", { class: "notice" });
    this.element = h("div", null, this.stage, this.notice);
    this.renderer = webgl2Renderer(this.canvas);
    this.resize = new ResizeObserver(() => this.fit());
    if (!this.renderer) {
      this.notice.textContent = WEBGL_NOTICE;
      return;
    }
    lights(this.scene);
    const floor = new THREE.GridHelper(16, 16, PALETTE.ink, 0x9c907a);
    this.scene.add(floor);
    this.stage.append(this.canvas);
    this.resize.observe(this.stage);
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragX = event.clientX;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.dragX === null) return;
      this.azimuth += (event.clientX - this.dragX) * 0.012;
      this.dragX = event.clientX;
      this.render();
    });
    const release = () => {
      this.dragX = null;
      this.resumeAt = performance.now() + RESUME_MS;
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    if (!prefersReducedMotion()) {
      let last = performance.now();
      this.stop = frames((now) => {
        if (this.dragX === null && now >= this.resumeAt) this.yaw += ((now - last) / TURN_MS) * Math.PI * 2;
        last = now;
        this.render();
        return true;
      });
    }
  }

  setCar(carId: string, name: string): void {
    if (!this.renderer) {
      this.stage.replaceChildren(carDrawing(carId, `${name}, drawing`));
      return;
    }
    this.canvas.setAttribute("aria-label", `${name}, 3D view`);
    if (this.car) this.scene.remove(this.car);
    this.car = buildCar(carId, PALETTE.accent);
    this.scene.add(this.car);
    this.fit();
  }

  private fit(): void {
    if (!this.renderer) return;
    const { width, height } = this.stage.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    if (!this.renderer || !this.car) return;
    this.car.rotation.y = this.yaw;
    this.camera.position.set(Math.sin(this.azimuth) * 7, 8.8, Math.cos(this.azimuth) * 7);
    this.camera.lookAt(0, 0.5, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stop?.();
    this.resize.disconnect();
    this.renderer?.dispose();
  }
}
