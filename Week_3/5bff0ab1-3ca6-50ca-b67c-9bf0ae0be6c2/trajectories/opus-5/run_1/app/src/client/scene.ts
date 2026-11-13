import * as THREE from 'three';
import {
  CHAPTERS,
  COLOURS,
  KEY_ON_PROGRESS,
  NEEDLE_MAX_HOURS,
  STEP_DURATIONS,
  chapter as chapterDef,
  finish as finishDef,
  model as modelDef,
  type ChapterId,
  type FinishId,
  type ModelId,
  type StepName,
} from '../shared/catalogue.js';
import { EASING, ease } from '../shared/easing.js';

export interface Reading {
  seq: number;
  unitsLeft: number | null;
  onRoadPaise: number | null;
  lockExpiresAt: string | null;
  nextSlot: string | null;
  finish: FinishId;
  display: string;
  hoursLeft: number;
  lamp: boolean;
  soldOutPrimer: boolean;
}

export interface StepEntry {
  name: StepName;
  ms: number;
  easing: string;
  startedAt: number;
  endedAt: number | null;
}

type Mode = 'webgl' | 'fallback' | 'reduced';

const rgb = (channels: readonly number[]): number =>
  (channels[0] as number) * 65536 + (channels[1] as number) * 256 + (channels[2] as number);

const GROUND = rgb(COLOURS.ground);
const SURFACE = rgb(COLOURS.surface);
const INK = rgb(COLOURS.ink);
const MUTED = rgb(COLOURS.muted);
const ACCENT = rgb(COLOURS.accent);

const SEAT_DIRECTIONS: Record<ChapterId, [number, number, number]> = {
  frame: [0, 1.6, 0],
  engine: [0, 1.2, 0.6],
  tank: [0, 1.4, 0],
  wheels: [0.9, 0.9, 0],
  exhaust: [-0.6, 0.8, 0.8],
  seat: [-0.8, 1.1, 0],
  cluster: [0.5, 1.2, 0],
};

const CAMERA_PATH: { at: number; position: [number, number, number]; target: [number, number, number] }[] =
  [
    { at: 0, position: [0.6, 1.5, -3.4], target: [0, 0.75, 0] },
    { at: 0.21, position: [0.5, 1.1, -2.4], target: [0, 0.6, 0] },
    { at: 0.35, position: [0.9, 1.35, -2.1], target: [0.25, 0.85, 0] },
    { at: 0.49, position: [0, 0.85, -2.9], target: [0, 0.65, 0] },
    { at: 0.63, position: [0, 0.85, 2.9], target: [0, 0.65, 0] },
    { at: 0.77, position: [-1.1, 1.4, 2.1], target: [-0.3, 0.85, 0] },
    { at: 0.86, position: [-1.45, 1.78, 0.85], target: [0.5, 1.28, 0] },
    { at: 1, position: [-1.3, 1.74, 0.7], target: [0.52, 1.28, 0] },
  ];

interface PartNode {
  group: THREE.Object3D;
  restY: number;
  focus: THREE.Vector3;
  distance: number;
}

export class Showroom {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly machine = new THREE.Group();
  private readonly groups = new Map<ChapterId, THREE.Group>();
  private readonly parts = new Map<string, PartNode>();
  private readonly offsets = new Map<ChapterId, number>();
  private readonly steps: StepEntry[] = [];
  private readonly running = new Map<StepName, { entry: StepEntry; cancel(): void }>();

  private tankMaterials: THREE.MeshBasicMaterial[] = [];
  private lampMaterial = new THREE.MeshBasicMaterial({ color: GROUND });
  private needle = new THREE.Group();
  private needleTip = new THREE.Object3D();
  private displayCanvas = document.createElement('canvas');
  private displayTexture: THREE.CanvasTexture | null = null;
  private displayPlane: THREE.Mesh | null = null;
  private tankProbe = new THREE.Object3D();
  private lampProbe = new THREE.Object3D();

  private model: ModelId;
  private finishId: FinishId;
  private progress = 0;
  private chapterId: ChapterId;
  private partId: string | null = null;
  private needleDeg = -135;
  private keyedOn = false;
  private lampOn = false;
  private mode: Mode = 'webgl';
  private paused = false;
  private reading: Reading | null = null;
  private frameScale = 1;
  private cameraOffset = new THREE.Vector3();
  private cameraOffsetTarget = new THREE.Vector3();
  private frame = 0;

  constructor(canvas: HTMLCanvasElement, options: { model: ModelId; finish: FinishId; chapter: ChapterId; part: string | null; progress: number; reduced: boolean }) {
    this.canvas = canvas;
    this.model = options.model;
    this.finishId = options.finish;
    this.chapterId = options.chapter;
    this.partId = options.part;
    this.progress = options.progress;
    this.scene.background = new THREE.Color(GROUND);
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: false,
      });
    } catch {
      this.renderer = null;
    }
    if (!this.renderer || !this.renderer.getContext()) {
      this.mode = 'fallback';
      this.renderer = null;
    } else if (options.reduced) {
      this.mode = 'reduced';
    }
    this.build();
    this.scene.add(this.machine);
    if (this.renderer) {
      this.resize();
      this.applyProgress(this.progress, { immediate: true });
      this.loop();
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this.onContextLost();
      });
      canvas.addEventListener('webglcontextrestored', () => this.onContextRestored());
    }
  }

  /* ---------- geometry ---------- */

  private basic(color: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color });
  }

  private build(): void {
    this.machine.clear();
    this.groups.clear();
    this.parts.clear();
    this.tankMaterials = [];
    const def = modelDef(this.model);
    const wheelbase = def.wheelbaseMm / 1000;
    const frontX = wheelbase / 2;
    const rearX = -wheelbase / 2;
    const frontRadius = (19 * 0.0254) / 2;
    const rearRadius = (17 * 0.0254) / 2;

    for (const chapter of CHAPTERS) {
      const group = new THREE.Group();
      group.name = chapter.id;
      this.groups.set(chapter.id, group);
      this.machine.add(group);
      this.offsets.set(chapter.id, 0);
    }

    const frame = this.groups.get('frame') as THREE.Group;
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.1), this.basic(SURFACE));
    spine.position.set(0.05, 0.86, 0);
    frame.add(spine);
    const downTube = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.62, 0.09), this.basic(SURFACE));
    downTube.position.set(0.32, 0.6, 0);
    downTube.rotation.z = -0.5;
    frame.add(downTube);
    const steeringHead = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.26, 18),
      this.basic(INK),
    );
    steeringHead.position.set(frontX - 0.42, 0.97, 0);
    steeringHead.rotation.z = (26 * Math.PI) / 180;
    frame.add(steeringHead);
    this.addPart('steering-head', steeringHead, frame, 0.5);

    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.05), this.basic(MUTED));
    fork.position.set(frontX - 0.2, 0.66, -0.1);
    fork.rotation.z = (26 * Math.PI) / 180;
    frame.add(fork);
    const fork2 = fork.clone();
    fork2.position.z = 0.1;
    frame.add(fork2);

    const swingarm = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.08), this.basic(SURFACE));
    swingarm.position.set(rearX + 0.3, rearRadius, -0.12);
    frame.add(swingarm);
    this.addPart('swingarm', swingarm, frame, 0.5);

    const sideStand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.04), this.basic(MUTED));
    sideStand.position.set(-0.12, 0.16, -0.22);
    sideStand.rotation.x = 0.28;
    frame.add(sideStand);
    this.addPart('side-stand', sideStand, frame, 0.4);

    const engine = this.groups.get('engine') as THREE.Group;
    const cases = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.3, 0.34), this.basic(SURFACE));
    cases.position.set(0.02, 0.44, 0);
    engine.add(cases);
    const cylinderGroup = new THREE.Group();
    for (let i = 0; i < def.cylinders; i += 1) {
      const cylinder = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.26, 0.17),
        this.basic(0x34373c),
      );
      const spread = def.cylinders === 1 ? 0 : i === 0 ? -0.1 : 0.1;
      cylinder.position.set(0.08, 0.72, spread);
      cylinderGroup.add(cylinder);
    }
    engine.add(cylinderGroup);
    this.addPart('cylinder', cylinderGroup, engine, 0.4);
    const primaryCover = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.04, 20),
      this.basic(MUTED),
    );
    primaryCover.rotation.x = Math.PI / 2;
    primaryCover.position.set(-0.04, 0.44, -0.19);
    engine.add(primaryCover);
    this.addPart('primary-cover', primaryCover, engine, 0.4);

    const tank = this.groups.get('tank') as THREE.Group;
    const tankMaterial = this.basic(rgb(finishDef(this.finishId).paint));
    this.tankMaterials.push(tankMaterial);
    const tankBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.26, 0.34), tankMaterial);
    tankBody.position.set(0.26, 1.0, 0);
    tank.add(tankBody);
    const tankTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), tankMaterial);
    tankTop.position.set(0.26, 1.14, 0);
    tank.add(tankTop);
    this.tankProbe.position.set(0.14, 1.169, 0);
    tank.add(this.tankProbe);
    const fillerCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.03, 18),
      this.basic(MUTED),
    );
    fillerCap.position.set(0.3, 1.18, 0);
    tank.add(fillerCap);
    this.addPart('filler-cap', fillerCap, tank, 0.35);
    const kneeRecess = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.04), this.basic(0x2b2d31));
    kneeRecess.position.set(0.2, 0.98, -0.18);
    tank.add(kneeRecess);
    this.addPart('knee-recess', kneeRecess, tank, 0.35);

    const wheels = this.groups.get('wheels') as THREE.Group;
    const frontRim = this.wheel(frontRadius);
    frontRim.position.set(frontX, frontRadius, 0);
    wheels.add(frontRim);
    this.addPart('front-rim', frontRim, wheels, 0.7);
    const rearRim = this.wheel(rearRadius);
    rearRim.position.set(rearX, rearRadius, 0);
    wheels.add(rearRim);
    this.addPart('rear-rim', rearRim, wheels, 0.7);
    const chain = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.03), this.basic(MUTED));
    chain.position.set(rearX + 0.3, rearRadius, -0.19);
    wheels.add(chain);
    this.addPart('chain', chain, wheels, 0.5);

    const exhaust = this.groups.get('exhaust') as THREE.Group;
    const header = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.5, 14),
      this.basic(MUTED),
    );
    header.position.set(0.2, 0.42, 0.16);
    header.rotation.z = Math.PI / 2.4;
    exhaust.add(header);
    this.addPart('header', header, exhaust, 0.4);
    const silencers = new THREE.Group();
    for (let i = 0; i < def.silencers; i += 1) {
      const silencer = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.05, 0.46, 16),
        this.basic(0xb9bbbf),
      );
      silencer.rotation.z = Math.PI / 2;
      silencer.position.set(rearX + 0.42, 0.34 + i * 0.09, 0.16 + i * 0.06);
      silencers.add(silencer);
    }
    exhaust.add(silencers);
    this.addPart('silencer', silencers, exhaust, 0.5);

    const seat = this.groups.get('seat') as THREE.Group;
    const riderSeat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.3), this.basic(0x15161a));
    riderSeat.position.set(-0.2, 0.94, 0);
    seat.add(riderSeat);
    this.addPart('rider-seat', riderSeat, seat, 0.4);
    const pillionSeat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.26), this.basic(0x15161a));
    pillionSeat.position.set(-0.52, 0.99, 0);
    seat.add(pillionSeat);
    this.addPart('pillion-seat', pillionSeat, seat, 0.4);

    const cluster = this.groups.get('cluster') as THREE.Group;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.72), this.basic(SURFACE));
    bar.position.set(frontX - 0.22, 1.2, 0);
    cluster.add(bar);
    const dial = new THREE.Group();
    dial.position.set(frontX - 0.18, 1.36, 0);
    dial.rotation.order = 'YXZ';
    dial.rotation.set(-0.42, -Math.PI / 2, 0);
    cluster.add(dial);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.14, 36), this.basic(0x0f1012));
    dial.add(face);
    const bezel = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.155, 36), this.basic(SURFACE));
    dial.add(bezel);
    const needleBar = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.12, 0.004), this.basic(INK));
    needleBar.position.y = 0.05;
    this.needle = new THREE.Group();
    this.needle.position.set(0, 0, 0.02);
    this.needle.add(needleBar);
    this.needleTip = new THREE.Object3D();
    this.needleTip.position.set(0, 0.088, 0.004);
    this.needle.add(this.needleTip);
    dial.add(this.needle);
    this.addPart('needle', this.needle, cluster, 0.3);

    this.lampMaterial = this.basic(GROUND);
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.032, 20), this.lampMaterial);
    lamp.position.set(0, -0.085, 0.012);
    dial.add(lamp);
    this.lampProbe = new THREE.Object3D();
    this.lampProbe.position.set(0, 0, 0.004);
    lamp.add(this.lampProbe);
    this.addPart('tell-tale', lamp, cluster, 0.28);

    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 512;
    this.displayCanvas.height = 128;
    this.displayTexture = new THREE.CanvasTexture(this.displayCanvas);
    this.displayPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.07),
      new THREE.MeshBasicMaterial({ map: this.displayTexture }),
    );
    this.displayPlane.position.set(0, 0.215, 0.01);
    dial.add(this.displayPlane);
    this.addPart('display', this.displayPlane, cluster, 0.3);
    this.paintDisplay();

    this.machine.rotation.x = (-8 * Math.PI) / 180;
  }

  private wheel(radius: number): THREE.Group {
    const group = new THREE.Group();
    const tyre = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.035, 10, 32),
      this.basic(0x15161a),
    );
    tyre.rotation.y = Math.PI / 2;
    group.add(tyre);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius - 0.045, 0.012, 8, 32),
      this.basic(MUTED),
    );
    rim.rotation.y = Math.PI / 2;
    group.add(rim);
    for (let i = 0; i < 12; i += 1) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, radius - 0.05, 0.008),
        this.basic(0x6f7176),
      );
      spoke.rotation.z = (i / 12) * Math.PI * 2;
      spoke.position.set(
        Math.sin((i / 12) * Math.PI * 2) * (radius / 2 - 0.02),
        Math.cos((i / 12) * Math.PI * 2) * (radius / 2 - 0.02),
        0,
      );
      group.add(spoke);
    }
    return group;
  }

  private addPart(
    id: string,
    object: THREE.Object3D,
    parent: THREE.Object3D,
    distance: number,
  ): void {
    void parent;
    this.parts.set(id, {
      group: object,
      restY: object.position.y,
      focus: new THREE.Vector3(),
      distance,
    });
  }

  /* ---------- steps ---------- */

  private logStep(name: StepName): StepEntry {
    const entry: StepEntry = {
      name,
      ms: STEP_DURATIONS[name],
      easing: EASING,
      startedAt: performance.now(),
      endedAt: null,
    };
    this.steps.push(entry);
    while (this.steps.length > 48) this.steps.shift();
    return entry;
  }

  /** Page-side steps are timed by the same runner, so the probe reports them too. */
  animate(name: StepName, apply: (eased: number, raw: number) => void, done?: () => void): void {
    this.runStep(name, apply, done);
  }

  private runStep(
    name: StepName,
    apply: (eased: number, raw: number) => void,
    done?: () => void,
  ): void {
    const existing = this.running.get(name);
    if (existing) existing.cancel();
    const duration = STEP_DURATIONS[name];
    const entry = this.logStep(name);
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      const elapsed = performance.now() - entry.startedAt;
      const raw = Math.min(1, elapsed / duration);
      apply(ease(raw), raw);
      if (raw < 1) {
        requestAnimationFrame(tick);
      } else {
        entry.endedAt = performance.now();
        this.running.delete(name);
        done?.();
      }
    };
    this.running.set(name, {
      entry,
      cancel: () => {
        cancelled = true;
        entry.endedAt = performance.now();
        this.running.delete(name);
      },
    });
    requestAnimationFrame(tick);
  }

  /* ---------- drawing ---------- */

  private paintDisplay(): void {
    const context = this.displayCanvas.getContext('2d');
    if (!context) return;
    const ground = `rgb(${COLOURS.ground.join(',')})`;
    context.fillStyle = ground;
    context.fillRect(0, 0, 512, 128);
    if (this.keyedOn && this.reading) {
      context.fillStyle = `rgb(${COLOURS.ink.join(',')})`;
      context.font = '600 62px monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(this.reading.display, 256, 70);
    }
    if (this.displayTexture) this.displayTexture.needsUpdate = true;
  }

  private paintTank(animated: boolean): void {
    const soldOut = this.reading?.soldOutPrimer === true && this.keyedOn;
    const target = soldOut ? MUTED : rgb(finishDef(this.finishId).paint);
    const from = this.tankMaterials[0]?.color.getHex() ?? target;
    if (from === target) {
      for (const material of this.tankMaterials) material.color.setHex(target);
      return;
    }
    if (!animated || this.mode === 'fallback') {
      for (const material of this.tankMaterials) material.color.setHex(target);
      return;
    }
    const start = new THREE.Color(from);
    const end = new THREE.Color(target);
    this.runStep('paint', (eased) => {
      const mixed = start.clone().lerp(end, eased);
      for (const material of this.tankMaterials) material.color.copy(mixed);
    });
  }

  private paintLamp(next: boolean): void {
    if (next === this.lampOn) return;
    this.lampOn = next;
    const target = next && this.keyedOn ? ACCENT : GROUND;
    const start = this.lampMaterial.color.clone();
    const end = new THREE.Color(target);
    this.runStep('lamp', (eased) => {
      this.lampMaterial.color.copy(start.clone().lerp(end, eased));
    });
  }

  private targetNeedleDeg(): number {
    if (!this.keyedOn || !this.reading) return -135;
    const hours = Math.min(this.reading.hoursLeft, NEEDLE_MAX_HOURS);
    return -135 + (270 * hours) / NEEDLE_MAX_HOURS;
  }

  private keyOn(fromSequence: boolean): void {
    this.keyedOn = true;
    this.paintDisplay();
    this.paintTank(fromSequence);
    this.paintLamp(this.reading?.lamp === true);
    const target = this.targetNeedleDeg();
    if (this.mode === 'reduced') {
      const start = this.needleDeg;
      this.runStep('dissolve', (eased) => {
        this.needleDeg = start + (target - start) * eased;
        this.applyNeedle();
      });
      return;
    }
    const start = this.needleDeg;
    this.runStep(
      'needle-sweep',
      (eased) => {
        this.needleDeg = start + (135 - start) * eased;
        this.applyNeedle();
      },
      () => {
        const settleStart = this.needleDeg;
        this.runStep('needle-settle', (eased) => {
          this.needleDeg = settleStart + (target - settleStart) * eased;
          this.applyNeedle();
        });
      },
    );
  }

  private keyOff(): void {
    this.keyedOn = false;
    this.needleDeg = -135;
    this.applyNeedle();
    this.paintDisplay();
    this.lampMaterial.color.setHex(GROUND);
    this.lampOn = false;
    this.paintTank(false);
  }

  private applyNeedle(): void {
    this.needle.rotation.z = (-this.needleDeg * Math.PI) / 180;
  }

  /* ---------- progress ---------- */

  applyProgress(progress: number, options: { immediate?: boolean } = {}): void {
    const clamped = Math.max(0, Math.min(1, progress));
    const wasKeyed = this.keyedOn;
    this.progress = clamped;
    this.chapterId = chapterForProgress(clamped);
    for (const chapter of CHAPTERS) {
      const group = this.groups.get(chapter.id) as THREE.Group;
      const span = chapter.seatAt - chapter.startsAt;
      const travelled = span <= 0 ? 1 : (clamped - chapter.startsAt) / span;
      const amount = 1 - Math.max(0, Math.min(1, travelled));
      const direction = SEAT_DIRECTIONS[chapter.id];
      group.position.set(
        direction[0] * amount,
        direction[1] * amount,
        direction[2] * amount,
      );
      group.visible = amount < 1 || clamped >= chapter.startsAt;
      this.offsets.set(chapter.id, Number(amount.toFixed(4)));
    }
    this.placeCamera();
    if (clamped >= KEY_ON_PROGRESS && !wasKeyed) this.keyOn(!options.immediate);
    else if (clamped < KEY_ON_PROGRESS && wasKeyed) this.keyOff();
  }

  private pathAt(progress: number): { position: THREE.Vector3; target: THREE.Vector3 } {
    let lower = CAMERA_PATH[0] as (typeof CAMERA_PATH)[number];
    let upper = CAMERA_PATH[CAMERA_PATH.length - 1] as (typeof CAMERA_PATH)[number];
    for (let i = 0; i < CAMERA_PATH.length - 1; i += 1) {
      const a = CAMERA_PATH[i] as (typeof CAMERA_PATH)[number];
      const b = CAMERA_PATH[i + 1] as (typeof CAMERA_PATH)[number];
      if (progress >= a.at && progress <= b.at) {
        lower = a;
        upper = b;
        break;
      }
    }
    const span = upper.at - lower.at;
    const t = span <= 0 ? 0 : (progress - lower.at) / span;
    const position = new THREE.Vector3(...lower.position).lerp(
      new THREE.Vector3(...upper.position),
      t,
    );
    const target = new THREE.Vector3(...lower.target).lerp(new THREE.Vector3(...upper.target), t);
    return { position, target };
  }

  /** The same framing on every viewport: the camera stands back when the view is narrow. */
  private placeCamera(): void {
    const { position, target } = this.pathAt(this.progress);
    const framed = target
      .clone()
      .add(position.clone().sub(target).multiplyScalar(this.frameScale));
    this.camera.position.copy(framed.add(this.cameraOffset));
    this.camera.lookAt(target);
  }

  /* ---------- selection ---------- */

  setModel(model: ModelId): void {
    if (model === this.model) return;
    this.model = model;
    this.build();
    this.applyProgress(this.progress, { immediate: true });
    if (this.keyedOn) {
      this.paintDisplay();
      this.applyNeedle();
      this.lampMaterial.color.setHex(this.lampOn ? ACCENT : GROUND);
    }
  }

  setFinish(finish: FinishId): void {
    if (finish === this.finishId) return;
    this.finishId = finish;
    this.paintTank(true);
  }

  setPart(part: string | null): void {
    if (part === this.partId) return;
    const previous = (this.partId ? this.parts.get(this.partId) : null) ?? null;
    this.partId = part;
    if (previous) {
      const node = previous;
      const from = node.group.position.y;
      this.runStep('part-lift', (eased) => {
        node.group.position.y = from + (node.restY - from) * eased;
      });
    }
    const node = (part ? this.parts.get(part) : null) ?? null;
    if (node) {
      const lift = 0.09;
      const from = node.group.position.y;
      this.runStep('part-lift', (eased) => {
        node.group.position.y = from + (node.restY + lift - from) * eased;
      });
    }
    this.moveCameraToPart(node);
  }

  private moveCameraToPart(node: PartNode | null): void {
    const from = this.cameraOffset.clone();
    const to = new THREE.Vector3();
    if (node) {
      const world = new THREE.Vector3();
      node.group.getWorldPosition(world);
      const { position, target } = this.pathAt(this.progress);
      const view = world.clone().sub(target);
      to.copy(view.multiplyScalar(0.35));
      void position;
    }
    this.cameraOffsetTarget.copy(to);
    this.runStep('camera-to-part', (eased) => {
      this.cameraOffset.copy(from.clone().lerp(this.cameraOffsetTarget, eased));
      this.placeCamera();
    });
  }

  jumpToChapter(chapter: ChapterId): void {
    const target = chapterDef(chapter).jump;
    this.applyProgress(target, { immediate: this.mode === 'reduced' });
    if (this.mode === 'reduced') {
      this.runStep('dissolve', () => {
        this.placeCamera();
      });
    } else {
      this.runStep('camera-to-part', () => {
        this.placeCamera();
      });
    }
  }

  setReduced(reduced: boolean): void {
    if (this.mode === 'fallback') return;
    this.mode = reduced ? 'reduced' : 'webgl';
  }

  /* ---------- readings ---------- */

  draw(reading: Reading): void {
    const previousDisplay = this.reading?.display;
    const previousLamp = this.reading?.lamp;
    const previousHours = this.reading?.hoursLeft;
    const previousPrimer = this.reading?.soldOutPrimer;
    this.reading = reading;
    if (!this.keyedOn) {
      this.paintDisplay();
      this.paintTank(false);
      return;
    }
    if (previousDisplay !== reading.display) this.paintDisplay();
    if (previousPrimer !== reading.soldOutPrimer) this.paintTank(true);
    if (previousLamp !== reading.lamp) this.paintLamp(reading.lamp);
    if (previousHours !== reading.hoursLeft) {
      if (this.mode === 'reduced') {
        const start = this.needleDeg;
        const target = this.targetNeedleDeg();
        this.runStep('dissolve', (eased) => {
          this.needleDeg = start + (target - start) * eased;
          this.applyNeedle();
        });
      } else {
        const start = this.needleDeg;
        const target = this.targetNeedleDeg();
        this.runStep(
          'needle-sweep',
          (eased) => {
            this.needleDeg = start + (135 - start) * eased;
            this.applyNeedle();
          },
          () => {
            const settleStart = this.needleDeg;
            this.runStep('needle-settle', (eased) => {
              this.needleDeg = settleStart + (target - settleStart) * eased;
              this.applyNeedle();
            });
          },
        );
      }
    }
  }

  /* ---------- context ---------- */

  private onContextLost(): void {
    this.paused = true;
    for (const [, step] of this.running) step.cancel();
    this.running.clear();
  }

  private onContextRestored(): void {
    this.paused = false;
    this.build();
    this.applyProgress(this.progress, { immediate: true });
    if (this.reading) {
      if (this.progress >= KEY_ON_PROGRESS) {
        this.keyedOn = true;
        this.needleDeg = this.targetNeedleDeg();
        this.applyNeedle();
        this.lampOn = this.reading.lamp;
        this.lampMaterial.color.setHex(this.lampOn ? ACCENT : GROUND);
      }
      this.paintDisplay();
      this.paintTank(false);
    }
    if (this.partId) this.setPart(this.partId);
    this.resize();
  }

  pausedState(): boolean {
    return this.paused;
  }

  /* ---------- loop ---------- */

  resize(): void {
    if (!this.renderer) return;
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov = this.camera.aspect >= 1 ? 38 : 56;
    this.camera.updateProjectionMatrix();
    const halfWidth =
      Math.tan(((this.camera.fov * Math.PI) / 180) / 2) * this.camera.aspect;
    const designHalfWidth = Math.tan(((38 * Math.PI) / 180) / 2) * 1.6;
    this.frameScale = Math.max(1, designHalfWidth / halfWidth);
    this.placeCamera();
  }

  private loop(): void {
    const render = (): void => {
      this.frame = requestAnimationFrame(render);
      if (this.paused || !this.renderer) return;
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(render);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  /* ---------- probe ---------- */

  private project(object: THREE.Object3D): { x: number; y: number } {
    const world = new THREE.Vector3();
    object.getWorldPosition(world);
    const ndc = world.project(this.camera);
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    return {
      x: Number((((ndc.x + 1) / 2) * width).toFixed(2)),
      y: Number((((1 - ndc.y) / 2) * height).toFixed(2)),
    };
  }

  private displayRect(): { x: number; y: number; w: number; h: number } {
    if (!this.displayPlane) return { x: 0, y: 0, w: 0, h: 0 };
    const corners = [
      new THREE.Vector3(-0.14, -0.04, 0),
      new THREE.Vector3(0.14, -0.04, 0),
      new THREE.Vector3(-0.14, 0.04, 0),
      new THREE.Vector3(0.14, 0.04, 0),
    ].map((corner) => {
      const marker = new THREE.Object3D();
      marker.position.copy(corner);
      this.displayPlane?.add(marker);
      marker.updateMatrixWorld(true);
      const point = this.project(marker);
      this.displayPlane?.remove(marker);
      return point;
    });
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
      x: Number((left + 2).toFixed(2)),
      y: Number((top + 2).toFixed(2)),
      w: Number((Math.max(...xs) - left - 4).toFixed(2)),
      h: Number((Math.max(...ys) - top - 4).toFixed(2)),
    };
  }

  snapshot(): Record<string, unknown> {
    const def = modelDef(this.model);
    const seatOffsets: Record<string, number> = {};
    for (const chapter of CHAPTERS) seatOffsets[chapter.id] = this.offsets.get(chapter.id) ?? 0;
    return {
      mode: this.mode,
      paused: this.paused,
      progress: Number(this.progress.toFixed(3)),
      chapter: this.chapterId,
      part: this.partId,
      camera: {
        x: Number(this.camera.position.x.toFixed(3)),
        y: Number(this.camera.position.y.toFixed(3)),
        z: Number(this.camera.position.z.toFixed(3)),
      },
      seatOffsets,
      keyedOn: this.keyedOn,
      needleDeg: Number(this.needleDeg.toFixed(2)),
      lamp: this.keyedOn && this.lampOn,
      drawn: {
        seq: this.reading?.seq ?? null,
        unitsLeft: this.reading?.unitsLeft ?? null,
        onRoadPaise: this.reading?.onRoadPaise ?? null,
        lockExpiresAt: this.reading?.lockExpiresAt ?? null,
        nextSlot: this.reading?.nextSlot ?? null,
        finish: this.finishId,
        display: this.reading?.display ?? '',
      },
      probes: {
        tank: this.project(this.tankProbe),
        lamp: this.project(this.lampProbe),
        needleTip: this.project(this.needleTip),
        display: this.displayRect(),
      },
      geometry: {
        wheelbaseMm: def.wheelbaseMm,
        cylinders: def.cylinders,
        silencers: def.silencers,
        rakeDeg: 26,
        frontRimIn: 19,
        rearRimIn: 17,
        sideStandSide: 'left',
        chainSide: 'left',
        exhaustSide: 'right',
        leanDeg: 8,
        leanSide: 'left',
      },
      steps: this.steps.slice(-32).map((step) => ({ ...step })),
    };
  }
}

function chapterForProgress(progress: number): ChapterId {
  let current = CHAPTERS[0] as { id: ChapterId; from: number };
  for (const chapter of CHAPTERS) if (progress >= chapter.from) current = chapter;
  return current.id;
}
