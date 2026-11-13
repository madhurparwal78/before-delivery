import * as THREE from "three";
import { CHAPTERS, KEY_ON_AT, type ChapterId, type FinishId, type ModelId } from "../shared/catalogue.js";
import { needleAngle, tankRgb, paintOf, displayText, lockedLock } from "../shared/derive.js";
import { fogOf, remaining, TRAVEL, blendPose, cameraAt, type Pose, type Vec3 } from "../shared/stage.js";
import type { Reading } from "../shared/types.js";
import { buildBike, GROUND_RGB, type Bike } from "./bike.js";
import { cancelAllSteps, runStep, stepLog, type StepHandle, type Step } from "./steps.js";

/** The 3D showroom: one canvas, the machine, and every step the brief publishes. */

type SceneInputs = {
  progress: number;
  model: ModelId;
  finish: FinishId;
  part: string | null;
  reading: Reading | null;
  reduced: boolean;
};

export type SceneSnapshot = {
  camera: { x: number; y: number; z: number };
  keyedOn: boolean;
  needleDeg: number;
  lamp: boolean;
  probes: { tank: { x: number; y: number }; lamp: { x: number; y: number }; needleTip: { x: number; y: number }; display: { x: number; y: number; w: number; h: number } };
  steps: Step[];
  geometry: Record<string, string | number>;
  paused: boolean;
};

const PART_VIEW: Record<string, { dir: Vec3; distance: number }> = {
  "steering-head": { dir: [0.7, 0.25, -0.75], distance: 1.88 },
  swingarm: { dir: [-0.15, 0.2, -1], distance: 1.80 },
  "side-stand": { dir: [0.1, 0.35, -1], distance: 1.42 },
  cylinder: { dir: [0.45, 0.35, 0.9], distance: 1.50 },
  "primary-cover": { dir: [0.1, 0.1, -1], distance: 1.42 },
  "filler-cap": { dir: [-0.5, 1, 0.4], distance: 1.27 },
  "knee-recess": { dir: [0.0, 0.4, -1], distance: 1.42 },
  "front-rim": { dir: [0.2, 0.1, -1], distance: 2.03 },
  "rear-rim": { dir: [-0.2, 0.1, -1], distance: 2.03 },
  chain: { dir: [-0.1, 0.15, -1], distance: 1.50 },
  header: { dir: [0.3, 0.1, 1], distance: 1.58 },
  silencer: { dir: [-0.3, 0.15, 1], distance: 1.72 },
  "rider-seat": { dir: [-0.6, 0.8, 0.5], distance: 1.65 },
  "pillion-seat": { dir: [-0.8, 0.7, 0.5], distance: 1.65 },
};

const GROUND = new THREE.Color(GROUND_RGB[0] / 255, GROUND_RGB[1] / 255, GROUND_RGB[2] / 255);
const LAMP_DARK = [46, 36, 34];
const ACCENT = [255, 74, 31];
const CLUSTER_PARTS = new Set(["needle", "tell-tale", "display"]);
/** Scroll positions are whole pixels, so a position meant for 0.86 can read a hair under it. */
const KEY_ON_SLACK = 0.0005;
const LIFT = 0.06;
const CLUSTER_LIFT = 0.02;

const mixRgb = (a: readonly number[], b: readonly number[], t: number): number[] => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];

export class Scene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.05, 40);
  private bike: Bike;
  private inputs: SceneInputs;
  private dirty = true;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  paused = false;
  private disposed = false;

  private keyedOn = false;
  private needsKeyOn = false;
  private needleDeg = -135;
  private needleSteps: StepHandle | null = null;
  private lampTarget = false;
  private lampLevel = 0;
  private lampStep: StepHandle | null = null;
  private tank: number[];
  private tankStep: StepHandle | null = null;
  private lastSeq: number | null = null;
  private shownText = "";
  private partFocus = 0;
  private partLift = 0;
  private focusStep: StepHandle | null = null;
  private liftStep: StepHandle | null = null;
  private labelStep: StepHandle | null = null;
  private activePart: string | null = null;
  private dissolveStep: StepHandle | null = null;
  private partPoses = new Map<string, Pose>();

  constructor(
    private canvas: HTMLCanvasElement,
    private label: HTMLElement | null,
    private cover: HTMLElement | null,
    private onPause: (paused: boolean) => void,
    inputs: SceneInputs,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(GROUND, 1);
    this.inputs = inputs;
    this.tank = [...paintOf(inputs.finish)];
    this.tankTargetKey = this.tank.join();
    this.bike = buildBike(inputs.model);
    this.mount();
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.apply(inputs, true);
    this.raf = requestAnimationFrame(this.frame);
  }

  // --- scene graph

  private mount(): void {
    this.scene.clear();
    const gradient = document.createElement("canvas");
    gradient.width = gradient.height = 256;
    const g = gradient.getContext("2d") as CanvasRenderingContext2D;
    const radial = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    radial.addColorStop(0, "rgb(46,48,53)");
    radial.addColorStop(0.5, "rgb(34,36,40)");
    radial.addColorStop(1, `rgb(${GROUND_RGB.join(",")})`);
    g.fillStyle = radial;
    g.fillRect(0, 0, 256, 256);
    const floorTexture = new THREE.CanvasTexture(gradient);
    floorTexture.colorSpace = THREE.NoColorSpace;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshBasicMaterial({ map: floorTexture }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const blob = document.createElement("canvas");
    blob.width = 256;
    blob.height = 128;
    const b = blob.getContext("2d") as CanvasRenderingContext2D;
    const shade = b.createRadialGradient(128, 64, 8, 128, 64, 126);
    shade.addColorStop(0, "rgba(0,0,0,0.62)");
    shade.addColorStop(1, "rgba(0,0,0,0)");
    b.fillStyle = shade;
    b.fillRect(0, 0, 256, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blob), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.003;
    this.scene.add(shadow);
    this.scene.add(this.bike.root);
  }

  private swapModel(model: ModelId): void {
    this.scene.remove(this.bike.root);
    this.bike.dispose();
    this.bike = buildBike(model);
    this.scene.add(this.bike.root);
    this.partPoses.clear();
    this.shownText = "";
    this.activePart = null;
    this.partFocus = 0;
    this.partLift = 0;
    this.bike.cluster.displayTexture.needsUpdate = true;
  }

  // --- inputs

  setInputs(next: SceneInputs): void {
    this.apply(next, false);
  }

  private apply(next: SceneInputs, first: boolean): void {
    const prev = this.inputs;
    this.inputs = next;
    if (!first && next.model !== prev.model) this.swapModel(next.model);
    if (next.reduced !== prev.reduced) this.cancelDynamic();

    const wasKeyed = this.keyedOn;
    this.keyedOn = next.progress >= KEY_ON_AT - KEY_ON_SLACK;
    if (this.keyedOn && !wasKeyed) this.needsKeyOn = true;
    if (!this.keyedOn && (wasKeyed || first)) this.darken();

    const reading = next.reading;
    const newReading = reading !== null && reading.seq !== this.lastSeq;
    const hadReading = this.lastSeq !== null;
    if (newReading) this.lastSeq = reading.seq;
    if (reading === null) this.lastSeq = null;

    const poseChanged = !first && (Math.abs(next.progress - prev.progress) > 1e-9 || next.part !== prev.part);
    this.setPart(next.part, !first);

    // paint
    const wantTank = this.keyedOn && reading ? tankRgb(reading, next.finish) : paintOf(next.finish);
    if (wantTank.join() !== this.tankTargetKey) this.paintTank(wantTank, first);

    // display and lamp
    const text = this.keyedOn && reading ? displayText(reading) : "";
    if (text !== this.shownText) this.drawDisplay(text);
    const lamp = this.keyedOn && reading !== null && reading.stale;
    if (lamp !== this.lampTarget) this.setLamp(lamp, first);

    // needle
    const target = reading ? needleAngle(lockedLock(reading)?.hoursLeft ?? 0) : -135;
    this.needleTarget = target;
    if (this.keyedOn && reading) {
      if (this.needsKeyOn) {
        this.needsKeyOn = false;
        this.sweepNeedle();
      } else if (newReading && hadReading) {
        this.sweepNeedle();
      } else if (newReading && !this.needleSteps) {
        this.sweepNeedle();
      }
    } else if (!this.keyedOn) {
      this.needsKeyOn = false;
    }

    if (next.reduced && (newReading || poseChanged) && !first) this.dissolve();
    this.dirty = true;
  }

  private tankTargetKey = "";
  private needleTarget = -135;

  private cancelDynamic(): void {
    for (const s of [this.needleSteps, this.lampStep, this.tankStep, this.focusStep, this.liftStep, this.labelStep, this.dissolveStep]) s?.cancel();
    this.needleSteps = this.lampStep = this.tankStep = this.focusStep = this.liftStep = this.labelStep = this.dissolveStep = null;
    if (this.cover) this.cover.style.opacity = "0";
  }

  /** Below the key-on point the cluster is dark and the needle rests. */
  private darken(): void {
    this.needleSteps?.cancel();
    this.needleSteps = null;
    this.lampStep?.cancel();
    this.lampStep = null;
    this.needleDeg = -135;
    this.lampTarget = false;
    this.lampLevel = 0;
    this.drawDisplay("");
  }

  private setNeedle(deg: number): void {
    this.needleDeg = deg;
    this.dirty = true;
  }

  /** The needle sweeps to full scale and settles on the newest value; a newer sequence restarts it. */
  private sweepNeedle(): void {
    this.needleSteps?.cancel();
    if (this.inputs.reduced) {
      this.setNeedle(this.needleTarget);
      this.needleSteps = null;
      return;
    }
    const from = this.needleDeg;
    this.needleSteps = runStep(
      "needle-sweep",
      (e) => this.setNeedle(from + (135 - from) * e),
      () => {
        const start = this.needleDeg;
        this.needleSteps = runStep(
          "needle-settle",
          (e) => this.setNeedle(start + (this.needleTarget - start) * e),
          () => {
            this.needleSteps = null;
          },
        );
      },
    );
  }

  private setLamp(on: boolean, instant: boolean): void {
    this.lampTarget = on;
    this.lampStep?.cancel();
    const from = this.lampLevel;
    const to = on ? 1 : 0;
    if (instant || this.inputs.reduced || from === to) {
      this.lampLevel = to;
      this.lampStep = null;
      return;
    }
    this.lampStep = runStep(
      "lamp",
      (e) => {
        this.lampLevel = from + (to - from) * e;
        this.dirty = true;
      },
      () => {
        this.lampStep = null;
      },
    );
  }

  private paintTank(to: readonly number[], instant: boolean): void {
    this.tankStep?.cancel();
    this.tankTargetKey = to.join();
    const from = [...this.tank];
    if (instant || this.inputs.reduced) {
      this.tank = [...to];
      this.tankStep = null;
      this.dirty = true;
      return;
    }
    this.tankStep = runStep(
      "paint",
      (e) => {
        this.tank = mixRgb(from, to, e);
        this.dirty = true;
      },
      () => {
        this.tank = [...to];
        this.tankStep = null;
        this.dirty = true;
      },
    );
  }

  private dissolve(): void {
    if (!this.cover || this.dissolveStep) return;
    this.cover.style.opacity = "1";
    this.dissolveStep = runStep(
      "dissolve",
      (e) => {
        if (this.cover) this.cover.style.opacity = String(1 - e);
      },
      () => {
        this.dissolveStep = null;
      },
    );
  }

  private drawDisplay(text: string): void {
    this.shownText = text;
    const c = this.bike.cluster.displayCanvas;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.fillStyle = "rgb(8,9,10)";
    g.fillRect(0, 0, c.width, c.height);
    if (text) {
      const [units, ride] = [text.slice(0, text.indexOf(" RIDE")), text.slice(text.indexOf("RIDE"))];
      g.fillStyle = "rgb(239,240,241)";
      g.font = "700 38px 'Rethink Sans', monospace";
      g.textBaseline = "middle";
      g.fillText(units, 14, 28);
      g.fillStyle = "rgb(156,158,163)";
      g.fillText(ride, 14, 70);
      g.strokeStyle = "rgb(60,62,68)";
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
    }
    this.bike.cluster.displayTexture.needsUpdate = true;
    this.dirty = true;
  }

  // --- part selection

  private setPart(part: string | null, animate: boolean): void {
    if (part === this.activePart) return;
    const had = this.activePart;
    this.activePart = part;
    const reduced = this.inputs.reduced;
    this.focusStep?.cancel();
    this.liftStep?.cancel();
    this.labelStep?.cancel();
    this.focusStep = this.liftStep = this.labelStep = null;
    const focusFrom = this.partFocus;
    const liftFrom = this.partLift;
    const focusTo = part ? 1 : 0;
    if (!animate || reduced) {
      this.partFocus = focusTo;
      this.partLift = part ? 1 : 0;
      this.showLabel(part, 1);
      this.dirty = true;
      return;
    }
    if (part && had && had !== part) {
      this.partLift = 0;
    }
    const liftStart = part && had && had !== part ? 0 : liftFrom;
    this.focusStep = runStep(
      "camera-to-part",
      (e) => {
        this.partFocus = focusFrom + (focusTo - focusFrom) * e;
        this.dirty = true;
      },
      () => {
        this.focusStep = null;
      },
    );
    this.liftStep = runStep(
      "part-lift",
      (e) => {
        this.partLift = liftStart + ((part ? 1 : 0) - liftStart) * e;
        this.dirty = true;
      },
      () => {
        this.liftStep = null;
      },
    );
    if (part) {
      this.showLabel(part, 0);
      this.labelStep = runStep(
        "label-mask",
        (e) => this.showLabel(part, e),
        () => {
          this.labelStep = null;
        },
      );
    } else this.showLabel(null, 0);
  }

  private showLabel(part: string | null, reveal: number): void {
    const el = this.label;
    if (!el) return;
    if (!part) {
      el.style.visibility = "hidden";
      return;
    }
    el.style.visibility = "visible";
    el.style.clipPath = reveal >= 1 ? "none" : `inset(0 ${(1 - reveal) * 100}% 0 0)`;
  }

  private poseFor(part: string): Pose {
    const cached = this.partPoses.get(part);
    if (cached) return cached;
    const node = this.bike.parts[part] as THREE.Group;
    const group = this.bike.root;
    group.updateMatrixWorld(true);
    const lift = node.position.y;
    node.position.y = 0;
    const saved = this.saveOffsets();
    this.zeroOffsets();
    group.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
    this.restoreOffsets(saved);
    node.position.y = lift;
    let pose: Pose;
    if (CLUSTER_PARTS.has(part)) {
      const rest = cameraAt(1);
      const closer = new THREE.Vector3(...rest.target).sub(new THREE.Vector3(...rest.position)).multiplyScalar(0.14);
      pose = blendPose(rest, { position: [rest.position[0] + closer.x, rest.position[1] + closer.y, rest.position[2] + closer.z], target: [center.x, center.y, center.z] }, 0.5);
    } else {
      const view = PART_VIEW[part] as { dir: Vec3; distance: number };
      const dir = new THREE.Vector3(...view.dir).normalize().multiplyScalar(view.distance);
      pose = { position: [center.x + dir.x, center.y + dir.y, center.z + dir.z], target: [center.x, center.y, center.z] };
    }
    this.partPoses.set(part, pose);
    return pose;
  }

  private saveOffsets(): Map<THREE.Object3D, THREE.Vector3> {
    const map = new Map<THREE.Object3D, THREE.Vector3>();
    for (const o of [...Object.values(this.bike.groups), this.bike.parts["front-rim"], this.bike.parts["rear-rim"], this.bike.parts.chain]) if (o) map.set(o, o.position.clone());
    return map;
  }
  private zeroOffsets(): void {
    for (const o of [...Object.values(this.bike.groups), this.bike.parts["front-rim"], this.bike.parts["rear-rim"], this.bike.parts.chain]) o?.position.set(0, 0, 0);
  }
  private restoreOffsets(map: Map<THREE.Object3D, THREE.Vector3>): void {
    for (const [o, p] of map) o.position.copy(p);
  }

  // --- frame

  private placeGroups(progress: number): void {
    const b = this.bike;
    const dirs: Record<ChapterId, [number, number, number]> = { frame: [0, 1, 0], engine: [0, 0, -1], tank: [0, 1, 0], wheels: [0, 0, 0], exhaust: [0, 0, 1], seat: [-0.4, 1, 0], cluster: [0, 1, 0] };
    for (const c of CHAPTERS) {
      const g = b.groups[c.id];
      const d = dirs[c.id];
      const off = remaining(c.id, progress) * TRAVEL[c.id];
      g.position.set(d[0] * off, d[1] * off, d[2] * off);
      const fog = fogOf(c.id, progress);
      b.fades[c.id].value = fog;
      g.visible = fog < 0.999;
    }
    const wheelOff = remaining("wheels", progress) * TRAVEL.wheels;
    (b.parts["front-rim"] as THREE.Group).position.x = wheelOff;
    (b.parts["rear-rim"] as THREE.Group).position.x = -wheelOff;
    (b.parts.chain as THREE.Group).position.z = -wheelOff * 0.6;
    for (const [id, node] of Object.entries(b.parts)) {
      const lifted = id === this.activePart ? this.partLift : id === this.liftedLast ? this.partLift : 0;
      if (CLUSTER_PARTS.has(id)) node.position.z = lifted * CLUSTER_LIFT;
      else node.position.y = lifted * LIFT;
    }
    if (this.activePart) this.liftedLast = this.activePart;
  }
  private liftedLast: string | null = null;

  private colours(): void {
    const b = this.bike;
    (b.tank.material.uniforms.uColor!.value as THREE.Color).setRGB(this.tank[0]! / 255, this.tank[1]! / 255, this.tank[2]! / 255);
    (b.tank.recess.uniforms.uColor!.value as THREE.Color).setRGB((this.tank[0]! * 0.6) / 255, (this.tank[1]! * 0.6) / 255, (this.tank[2]! * 0.6) / 255);
    const fog = b.fades.cluster.value;
    for (const m of b.cluster.pieces) {
      const base = m.userData.rgb as number[] | undefined;
      if (base && m !== b.cluster.lampMaterial) {
        const c = mixRgb(base, GROUND_RGB, fog);
        m.color.setRGB(c[0]! / 255, c[1]! / 255, c[2]! / 255);
      }
    }
    const lamp = mixRgb(mixRgb(LAMP_DARK, ACCENT, this.lampLevel), GROUND_RGB, fog);
    b.cluster.lampMaterial.color.setRGB(lamp[0]! / 255, lamp[1]! / 255, lamp[2]! / 255);
    const dim = 1 - fog;
    b.cluster.displayMaterial.color.setRGB(dim, dim, dim);
    b.cluster.needle.rotation.z = -THREE.MathUtils.degToRad(this.needleDeg);
  }

  private cameraPose(): Pose {
    const base = cameraAt(this.inputs.progress);
    if (!this.activePart || this.partFocus <= 0) {
      if (this.partFocus > 0 && this.liftedLast) return blendPose(base, this.poseFor(this.liftedLast), this.partFocus);
      return base;
    }
    return blendPose(base, this.poseFor(this.activePart), this.partFocus);
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect >= 1.2 ? 36 : (2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(18)) * 1.2) / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private frame = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.paused || !this.dirty) return;
    this.dirty = false;
    this.render();
  };

  private render(): void {
    this.placeGroups(this.inputs.progress);
    this.colours();
    const pose = this.cameraPose();
    this.camera.position.set(...pose.position);
    this.camera.lookAt(new THREE.Vector3(...pose.target));
    this.camera.updateMatrixWorld(true);
    this.bike.root.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
    this.trackLabel();
  }

  private project(point: THREE.Vector3): { x: number; y: number } {
    const p = point.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - p.y) / 2) * this.canvas.clientHeight };
  }

  private trackLabel(): void {
    const el = this.label;
    if (!el || !this.activePart) return;
    const node = this.bike.parts[this.activePart] as THREE.Group;
    const center = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
    const at = this.project(center);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const x = Math.min(Math.max(at.x + 28, 12), w - el.offsetWidth - 12);
    const y = w < 768 ? h - el.offsetHeight - 120 : Math.min(Math.max(at.y - 56, 96), h - el.offsetHeight - 70);
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  // --- context loss

  private onLost = (event: Event): void => {
    event.preventDefault();
    this.paused = true;
    cancelAllSteps();
    this.needleSteps = this.lampStep = this.tankStep = this.focusStep = this.liftStep = this.labelStep = this.dissolveStep = null;
    cancelAnimationFrame(this.raf);
    this.onPause(true);
  };

  private onRestored = (): void => {
    this.paused = false;
    this.bike.cluster.displayTexture.needsUpdate = true;
    this.shownText = "";
    this.partFocus = this.activePart ? 1 : 0;
    this.partLift = this.activePart ? 1 : 0;
    this.lastSeq = null;
    this.tank = [...(this.keyedOn && this.inputs.reading ? tankRgb(this.inputs.reading, this.inputs.finish) : paintOf(this.inputs.finish))];
    this.tankTargetKey = this.tank.join();
    this.needleDeg = -135;
    this.apply({ ...this.inputs }, true);
    this.activePart = null;
    this.setPart(this.inputs.part, false);
    this.resize();
    this.dirty = true;
    this.raf = requestAnimationFrame(this.frame);
    this.onPause(false);
  };

  // --- the probe

  snapshot(): SceneSnapshot {
    const b = this.bike;
    b.root.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const tank = this.project(b.tank.probe.getWorldPosition(new THREE.Vector3()));
    const lamp = this.project(b.cluster.lamp.getWorldPosition(new THREE.Vector3()));
    const tip = this.project(b.cluster.tip.getWorldPosition(new THREE.Vector3()));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => this.project(b.cluster.display.localToWorld(new THREE.Vector3(sx! * 0.05 * 0.82, sy! * 0.01875 * 0.7, 0))));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const position = this.camera.position;
    return {
      camera: { x: position.x, y: position.y, z: position.z },
      keyedOn: this.keyedOn,
      needleDeg: this.needleDeg,
      lamp: this.lampTarget,
      probes: {
        tank,
        lamp,
        needleTip: tip,
        display: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      },
      steps: stepLog(),
      geometry: {
        ...b.geometry,
        rakeDeg: 26,
        frontRimIn: 19,
        rearRimIn: 17,
        sideStandSide: "left",
        chainSide: "left",
        exhaustSide: "right",
        leanDeg: 8,
        leanSide: "left",
      },
      paused: this.paused,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    cancelAllSteps();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.bike.dispose();
    this.renderer.dispose();
  }
}

