// The product viewer: the selected fitting turning slowly, a cone of light below it sized by the beam and coloured
// by the colour temperature, and its pool on a dark floor. Drag turns it; idle turning resumes 3 s after release.
import * as THREE from "three";
import type { LightState } from "../../shared/dial";
import { lightColour, type FittingKind } from "../lib/format";
import { AMBIENCE } from "./ambience";
import { buildFitting, lightCone, lightPool, poolRadiusM, type FittingModel } from "./fittings";

const DEGREES_PER_SECOND = 360 / 36; // one turn every 36 s
const IDLE_RESUME_MS = 3000;
const RELIGHT_MS = 330;
const DROP_M = 0.62;

export interface ViewerOptions {
  /** Null while the product is still loading: the stage shows its floor and ambience until the model arrives. */
  kind: FittingKind | null;
  finish: string;
  beam: number;
  cct: number;
  light: LightState;
  reducedMotion: boolean;
  interactive: boolean;
}

export class FittingViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
  private readonly ambient = new THREE.AmbientLight("#ffffff", 0.3);
  private readonly key = new THREE.DirectionalLight("#fff4e6", 1.4);
  private readonly fill = new THREE.PointLight("#ffffff", 0.6, 3);
  private readonly turntable = new THREE.Group();
  private readonly cone = lightCone(3000, 0.32);
  private readonly pool = lightPool(3000, 0.6);
  private readonly floor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private model: FittingModel | null = null;
  private kind: FittingKind | null;
  private yaw = 24;
  private dragging: { x: number; yaw: number } | null = null;
  private releasedAt = -Infinity;
  private lastFrame = 0;
  private frame = 0;
  private visible = true;
  private relight: { from: { radius: number; colour: THREE.Color }; started: number } | null = null;
  private target = { radius: 0, colour: new THREE.Color() };
  private readonly observer: IntersectionObserver;
  private readonly resizer: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    context: WebGL2RenderingContext,
    private options: ViewerOptions,
  ) {
    this.kind = options.kind;
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.key.position.set(1.2, 1.6, 2);
    this.fill.position.set(-0.6, 0.1, 0.8);
    this.scene.add(this.ambient, this.key, this.fill, this.turntable);

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ roughness: 0.95 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -DROP_M - 0.001;
    this.pool.position.y = -DROP_M;
    this.scene.add(this.floor, this.cone, this.pool);

    this.setModel(options.finish, options.cct);
    this.setLight(options.light);
    this.target = { radius: poolRadiusM(DROP_M, options.beam), colour: new THREE.Color(lightColour(options.cct)) };
    this.applyLight(this.target.radius, this.target.colour);
    this.frameCamera();

    if (options.interactive) {
      canvas.addEventListener("pointerdown", this.onDown);
      canvas.addEventListener("pointermove", this.onMove);
      canvas.addEventListener("pointerup", this.onUp);
      canvas.addEventListener("pointercancel", this.onUp);
    }
    this.observer = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? true;
      if (this.visible && !this.frame) this.frame = requestAnimationFrame(this.tick);
    });
    this.observer.observe(canvas);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(canvas);
    this.resize();
    this.canvas.dataset.idle = this.idleTurning(performance.now()) ? "on" : "off";
    this.canvas.dataset.yaw = String(Math.round(this.yaw));
    // Draw the first frame now rather than on the next animation frame.
    this.turntable.rotation.y = THREE.MathUtils.degToRad(this.yaw);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  }

  private setModel(finish: string, cct: number): void {
    if (this.model) this.turntable.remove(this.model.group);
    this.model = this.kind ? buildFitting(this.kind, finish, cct) : null;
    if (this.model) this.turntable.add(this.model.group);
    this.cone.visible = this.model !== null;
    this.pool.visible = this.model !== null;
  }

  /** Camera fits the fitting and its cone in the canvas, uncropped, at any aspect ratio. */
  private frameCamera(): void {
    const box = new THREE.Box3().setFromObject(this.turntable).union(
      new THREE.Box3(new THREE.Vector3(-0.3, -DROP_M, -0.3), new THREE.Vector3(0.3, 0, 0.3)),
    );
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const height = size.y * 1.12;
    const width = Math.max(size.x, size.z) * 1.15;
    const distance = Math.max(height / 2 / Math.tan(vertical / 2), width / 2 / Math.tan(vertical / 2) / this.camera.aspect);
    this.camera.position.set(centre.x, centre.y + distance * 0.22, centre.z + distance);
    this.camera.lookAt(centre);
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.frameCamera();
  }

  private idleTurning(now: number): boolean {
    return !this.options.reducedMotion && !this.dragging && now - this.releasedAt >= IDLE_RESUME_MS;
  }

  private readonly onDown = (event: PointerEvent) => {
    this.canvas.setPointerCapture(event.pointerId);
    this.dragging = { x: event.clientX, yaw: this.yaw };
  };

  private readonly onMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    // Dragging across the full canvas width turns the model half a turn.
    this.yaw = this.dragging.yaw + ((event.clientX - this.dragging.x) / this.canvas.clientWidth) * 180;
  };

  private readonly onUp = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.onMove(event);
    this.dragging = null;
    this.releasedAt = performance.now();
  };

  private applyLight(radius: number, colour: THREE.Color): void {
    this.cone.scale.set(radius, DROP_M, radius);
    this.pool.scale.set(radius, 1, radius);
    this.cone.material.uniforms.colour!.value.copy(colour);
    this.pool.material.uniforms.colour!.value.copy(colour);
    this.model?.lens.color.copy(colour);
  }

  private readonly tick = (now: number) => {
    this.frame = 0;
    if (!this.visible) return;
    const elapsed = this.lastFrame ? Math.min(now - this.lastFrame, 100) : 0;
    this.lastFrame = now;
    const idle = this.idleTurning(now);
    if (idle) this.yaw += (DEGREES_PER_SECOND * elapsed) / 1000;
    this.yaw = ((this.yaw % 360) + 360) % 360;
    this.canvas.dataset.yaw = String(Math.round(this.yaw) % 360);
    this.canvas.dataset.idle = idle ? "on" : "off";
    this.turntable.rotation.y = THREE.MathUtils.degToRad(this.yaw);
    if (this.relight) {
      const t = Math.min(1, (now - this.relight.started) / RELIGHT_MS);
      const eased = 1 - (1 - t) ** 3;
      this.applyLight(
        THREE.MathUtils.lerp(this.relight.from.radius, this.target.radius, eased),
        this.relight.from.colour.clone().lerp(this.target.colour, eased),
      );
      if (t >= 1) this.relight = null;
    }
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Re-lights the model for a new finish, beam or colour temperature: the cone eases over a third of a second. */
  update(options: ViewerOptions): void {
    const previous = this.options;
    this.options = options;
    if (options.kind !== previous.kind || options.finish !== previous.finish) {
      this.kind = options.kind;
      this.setModel(options.finish, options.cct);
      this.frameCamera();
    }
    if (options.light !== previous.light) this.setLight(options.light);
    if (options.beam !== previous.beam || options.cct !== previous.cct) {
      const from = { radius: this.cone.scale.x, colour: this.cone.material.uniforms.colour!.value.clone() as THREE.Color };
      this.target = { radius: poolRadiusM(DROP_M, options.beam), colour: new THREE.Color(lightColour(options.cct)) };
      if (options.reducedMotion) {
        this.relight = null;
        this.applyLight(this.target.radius, this.target.colour);
      } else {
        this.relight = { from, started: performance.now() };
      }
    }
    this.model?.lens.color.copy(this.cone.material.uniforms.colour!.value as THREE.Color);
    this.renderer.render(this.scene, this.camera);
    if (!this.frame && this.visible) this.frame = requestAnimationFrame(this.tick);
  }

  setLight(light: LightState): void {
    const ambience = AMBIENCE[light];
    this.scene.background = new THREE.Color(ambience.background);
    this.ambient.color.set(ambience.ambient);
    this.ambient.intensity = 0.35 + ambience.intensity;
    this.floor.material.color.set(ambience.floor);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.resizer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.renderer.dispose();
  }
}
