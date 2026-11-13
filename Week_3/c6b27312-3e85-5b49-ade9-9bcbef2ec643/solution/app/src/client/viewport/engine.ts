// The WebGL scene: a lit solid in front of one cyan lamp, an orbit camera and its glide, and stored-solid cross-fades.
import * as THREE from "three";
import { roundHalfEven } from "../../shared/numbers";
import type { Pose, Solid, Vec3 } from "../../shared/tine";
import { buildPart, buildShape, disposeObject, opKey, type LitShape } from "./geometry";

export interface Scene {
  /** Rebuild and cross-fade when this changes. */
  key: string;
  solid: Solid | null;
  /** Every face is drawn grey (a finding is selected) except the shapes in `involved`. */
  grey?: boolean;
  lit?: LitShape[];
  ghost?: LitShape[];
  involved?: { shapes: LitShape[]; color: string };
  /** Compare swipe: the base solid shows left of the divider (0 to 1 of the width), `solid` right of it. */
  swipe?: { base: Solid; divider: number };
}

const GLIDE_MS = 480;
const FADE_MS = 150;

const CYAN = 0x22d3ee;
const CAMERA_RADIUS_MIN = 8;

function poseText(pose: Pose): string {
  return [...pose.position, ...pose.target, pose.fov].map((n) => String(roundHalfEven(n, 3))).join(",");
}

function ghostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uFade: { value: 1 } },
    vertexShader: "void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader:
      "uniform float uFade;void main(){float stripe=step(mod(gl_FragCoord.x+gl_FragCoord.y,7.0),3.0);" +
      "vec3 c=mix(vec3(0.42,0.5,0.61),vec3(0.62,0.7,0.82),stripe);gl_FragColor=vec4(c,(0.26+0.45*stripe)*uFade);}",
  });
}

interface Built {
  group: THREE.Group;
  materials: THREE.Material[];
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly persp = new THREE.PerspectiveCamera(35, 1, 0.5, 200000);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 200000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.persp;
  private readonly target = new THREE.Vector3(0, 0, 4);
  private current: Built | null = null;
  private sceneKey = "";
  private currentScene: Scene | null = null;
  private baseGroup: Built | null = null;
  private divider = 0.5;
  private fading: { old: Built | null; next: Built; start: number; done: () => void } | null = null;
  private glide: { frame: number } | null = null;
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  reduced = false;
  onFrame: () => void = () => {};

  constructor(private readonly host: HTMLElement, canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.add(new THREE.AmbientLight(0x7d93b0, 0.85));
    const key = new THREE.DirectionalLight(0xe6f1ff, 1.35);
    key.position.set(60, -80, 120);
    this.scene.add(key);
    const lamp = new THREE.PointLight(CYAN, 650, 0, 1.35);
    lamp.position.set(-90, 120, 70);
    this.scene.add(lamp);
    this.persp.up.set(0, 0, 1);
    this.ortho.up.set(0, 0, 1);
    this.persp.position.set(60, -60, 60);
    this.resize();
  }

  // ------------------------------------------------------------------------------------------ scene

  setScene(scene: Scene, fade: boolean, onFadeEnd: () => void): void {
    this.currentScene = scene;
    this.divider = scene.swipe?.divider ?? this.divider;
    if (scene.key === this.sceneKey) {
      this.invalidate();
      return;
    }
    this.sceneKey = scene.key;
    this.finishFade();
    const next = this.build(scene);
    const baseBuilt = scene.swipe ? this.build({ key: `${scene.key}:base`, solid: scene.swipe.base }) : null;
    if (this.baseGroup) this.drop(this.baseGroup);
    this.baseGroup = baseBuilt;
    if (baseBuilt) this.scene.add(baseBuilt.group);
    this.scene.add(next.group);
    const old = this.current;
    this.current = next;
    if (!fade || this.reduced || !old) {
      if (old) this.drop(old);
      this.settle(next);
      this.invalidate();
      onFadeEnd();
      return;
    }
    this.setOpacity(next, 0);
    this.fading = { old, next, start: performance.now(), done: onFadeEnd };
    this.invalidate();
    this.schedule();
  }

  private build(scene: Scene): Built {
    const group = new THREE.Group();
    const materials: THREE.Material[] = [];
    const body = new THREE.MeshStandardMaterial({
      color: scene.grey ? 0x7a8696 : 0xa9bdd6,
      roughness: 0.62,
      metalness: 0.08,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 2,
    });
    const lit = new THREE.MeshStandardMaterial({ color: CYAN, emissive: 0x0b8aa0, emissiveIntensity: 0.45, roughness: 0.5, side: THREE.DoubleSide });
    lit.polygonOffset = true;
    lit.polygonOffsetFactor = -2;
    const ghost = ghostMaterial();
    const edge = new THREE.LineBasicMaterial({ color: scene.grey ? 0x8791a0 : CYAN, transparent: true, opacity: scene.grey ? 0.5 : 0.42 });
    const litEdge = new THREE.LineBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.8 });
    edge.userData.base = edge.opacity;
    litEdge.userData.base = litEdge.opacity;
    materials.push(body, lit, ghost, edge, litEdge);
    const litShapes = scene.lit ?? [];
    const bodyLit = litShapes.some((s) => s.kind === "op" && (s.op.op === "box" || s.op.op === "cylinder"));
    const skip = new Set(litShapes.flatMap((s) => (s.kind === "op" && s.op.op === "boss" ? [opKey(s.op)] : [])));
    if (scene.solid) group.add(buildPart(scene.solid, bodyLit ? lit : body, bodyLit ? litEdge : edge, skip));
    for (const shape of litShapes) {
      if (shape.kind === "op" && (shape.op.op === "box" || shape.op.op === "cylinder")) continue;
      group.add(...buildShape(shape, lit, litEdge));
    }
    for (const shape of scene.ghost ?? []) group.add(...buildShape(shape, ghost, null));
    if (scene.involved) {
      const color = new THREE.Color(scene.involved.color);
      const mark = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
      materials.push(mark);
      for (const shape of scene.involved.shapes) group.add(...buildShape(shape, mark, null));
    }
    return { group, materials };
  }

  /** Fades every material of a built group; lines keep their own base opacity. Faded-out groups stop writing depth. */
  private setOpacity(built: Built, value: number): void {
    for (const material of built.materials) {
      if (material instanceof THREE.ShaderMaterial) material.uniforms.uFade.value = value;
      else {
        material.transparent = true;
        material.opacity = (material.userData.base as number | undefined ?? 1) * value;
      }
      material.depthWrite = value >= 1 && !(material instanceof THREE.ShaderMaterial);
    }
  }

  private settle(built: Built): void {
    for (const material of built.materials) {
      if (material instanceof THREE.ShaderMaterial) material.uniforms.uFade.value = 1;
      else {
        material.transparent = material instanceof THREE.LineBasicMaterial;
        material.opacity = (material.userData.base as number | undefined) ?? 1;
        material.depthWrite = true;
      }
    }
  }

  private drop(built: Built): void {
    this.scene.remove(built.group);
    disposeObject(built.group);
    built.materials.forEach((m) => m.dispose());
  }

  private finishFade(): void {
    const fading = this.fading;
    if (!fading) return;
    this.fading = null;
    if (fading.old) this.drop(fading.old);
    this.settle(fading.next);
    this.invalidate();
    fading.done();
  }

  // ------------------------------------------------------------------------------------------ camera

  getPose(): Pose {
    const p = this.camera.position;
    return { position: [p.x, p.y, p.z], target: [this.target.x, this.target.y, this.target.z], up: [0, 0, 1], fov: 35 };
  }

  setPose(pose: Pose): void {
    this.cancelGlide();
    this.apply(pose);
  }

  private apply(pose: Pose): void {
    this.target.set(...pose.target);
    this.persp.position.set(...pose.position);
    this.persp.fov = pose.fov;
    this.sync();
    this.invalidate();
    this.publish();
  }

  get orthographic(): boolean {
    return this.camera === this.ortho;
  }

  setOrthographic(on: boolean): void {
    this.camera = on ? this.ortho : this.persp;
    this.sync();
    this.invalidate();
    this.publish();
  }

  private sync(): void {
    const aspect = this.width / this.height;
    this.persp.aspect = aspect;
    this.persp.lookAt(this.target);
    this.persp.updateProjectionMatrix();
    const distance = this.persp.position.distanceTo(this.target);
    const half = distance * Math.tan((this.persp.fov * Math.PI) / 360);
    this.ortho.left = -half * aspect;
    this.ortho.right = half * aspect;
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.position.copy(this.persp.position);
    this.ortho.lookAt(this.target);
    this.ortho.updateProjectionMatrix();
  }

  /** Animates to a stored pose; under reduced motion the pose applies in one frame and the camera is never "moving". */
  glideTo(pose: Pose, duration = GLIDE_MS): void {
    this.cancelGlide();
    if (this.reduced) {
      this.apply(pose);
      return;
    }
    const from = this.getPose();
    const start = performance.now();
    this.host.setAttribute("data-camera-moving", "true");
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      if (t >= 1) {
        this.glide = null;
        this.apply(pose);
        this.host.setAttribute("data-camera-moving", "false");
        return;
      }
      const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * eased, a[1] + (b[1] - a[1]) * eased, a[2] + (b[2] - a[2]) * eased];
      this.apply({ position: mix(from.position, pose.position), target: mix(from.target, pose.target), up: [0, 0, 1], fov: pose.fov });
      this.glide = { frame: requestAnimationFrame(step) };
    };
    this.glide = { frame: requestAnimationFrame(step) };
  }

  private cancelGlide(): void {
    if (!this.glide) return;
    cancelAnimationFrame(this.glide.frame);
    this.glide = null;
    this.host.setAttribute("data-camera-moving", "false");
  }

  orbit(dx: number, dy: number): void {
    this.cancelGlide();
    const offset = this.persp.position.clone().sub(this.target);
    const radius = offset.length();
    let azimuth = Math.atan2(offset.y, offset.x);
    let polar = Math.acos(THREE.MathUtils.clamp(offset.z / radius, -1, 1));
    azimuth -= dx * 0.008;
    polar = THREE.MathUtils.clamp(polar - dy * 0.008, 0.05, Math.PI - 0.05);
    offset.set(radius * Math.sin(polar) * Math.cos(azimuth), radius * Math.sin(polar) * Math.sin(azimuth), radius * Math.cos(polar));
    this.persp.position.copy(this.target).add(offset);
    this.sync();
    this.invalidate();
    this.publish();
  }

  zoom(factor: number): void {
    this.cancelGlide();
    const offset = this.persp.position.clone().sub(this.target);
    const radius = THREE.MathUtils.clamp(offset.length() * factor, CAMERA_RADIUS_MIN, 40000);
    this.persp.position.copy(this.target).add(offset.setLength(radius));
    this.sync();
    this.invalidate();
    this.publish();
  }

  // ------------------------------------------------------------------------------------------ output

  project(point: Vec3): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(...point).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, visible: v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 };
  }

  /** Where the pointer ray meets the drawn solid, or null. */
  pick(clientX: number, clientY: number): Vec3 | null {
    const box = this.host.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    const caster = new THREE.Raycaster();
    caster.setFromCamera(ndc, this.camera);
    const hit = this.current ? caster.intersectObject(this.current.group, true).find((h) => h.object instanceof THREE.Mesh) : undefined;
    return hit ? [roundHalfEven(hit.point.x, 3), roundHalfEven(hit.point.y, 3), roundHalfEven(hit.point.z, 3)] : null;
  }

  resize(): void {
    const box = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(box.width));
    this.height = Math.max(1, Math.round(box.height));
    this.renderer.setSize(this.width, this.height, false);
    this.sync();
    this.invalidate();
    this.publish();
  }

  private publish(): void {
    this.host.setAttribute("data-camera", poseText(this.getPose()));
    this.host.setAttribute("data-projection", this.orthographic ? "orthographic" : "perspective");
    this.onFrame();
  }

  invalidate(): void {
    if (this.disposed) return;
    const swipe = this.currentScene?.swipe && this.baseGroup;
    if (swipe) {
      const split = Math.round(this.width * this.divider);
      this.renderer.setScissorTest(true);
      this.current && (this.current.group.visible = false);
      this.baseGroup && (this.baseGroup.group.visible = true);
      this.renderer.setScissor(0, 0, split, this.height);
      this.renderer.render(this.scene, this.camera);
      this.current && (this.current.group.visible = true);
      this.baseGroup && (this.baseGroup.group.visible = false);
      this.renderer.setScissor(split, 0, this.width - split, this.height);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setScissorTest(false);
      return;
    }
    if (this.baseGroup) this.baseGroup.group.visible = false;
    this.renderer.render(this.scene, this.camera);
  }

  private schedule(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0;
      const fading = this.fading;
      if (!fading) return;
      const t = Math.min(1, (now - fading.start) / FADE_MS);
      this.setOpacity(fading.next, t);
      if (fading.old) this.setOpacity(fading.old, 1 - t);
      this.invalidate();
      if (t >= 1) this.finishFade();
      else this.schedule();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelGlide();
    cancelAnimationFrame(this.raf);
    if (this.current) this.drop(this.current);
    if (this.baseGroup) this.drop(this.baseGroup);
    this.renderer.dispose();
  }
}
