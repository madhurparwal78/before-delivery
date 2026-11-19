import { treeOrder } from "../../shared/layers.ts";
import type { LayerDoc, Vec3 } from "../../shared/types.ts";
import { evaluateFrame, worldMatrices } from "./evaluate.ts";
import type { EffectiveLayer } from "./evaluate.ts";
import { add, cross, length, lookAt, normalize, perspective, scaleVec, subtract, transformDirection, transformPoint } from "./math.ts";
import type { Mat4 } from "./math.ts";
import { StageRenderer } from "./renderer.ts";
import type { AssetSource, CompileResult, GizmoAxis, GizmoShape } from "./renderer.ts";
import type { StageSource } from "./stage-source.ts";

const GRIP_REACH = 8;
const COAST_MS = 450;

interface Orbit {
  yaw: number;
  pitch: number;
  zoom: number;
}

interface GizmoDrag {
  axis: GizmoAxis;
  layerId: string;
  path: string;
  start: number;
  originX: number;
  originY: number;
  direction: [number, number];
  last: number;
}

function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const k = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(k, v);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [v[0] * c + kv[0] * s + k[0] * d * (1 - c), v[1] * c + kv[1] * s + k[1] * d * (1 - c), v[2] * c + kv[2] * s + k[2] * d * (1 - c)];
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export class StageController {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: StageRenderer | null;
  private readonly source: StageSource;
  private readonly orbit: Orbit = { yaw: 0, pitch: 0, zoom: 1 };
  private frames = 0;
  private scheduled = false;
  private lastGizmo: GizmoShape | null = null;
  private lastBeat = -1;
  private lastSize = "";
  private orbiting: { x: number; y: number; velocityYaw: number; velocityPitch: number; stamp: number } | null = null;
  private coast: { yaw: number; pitch: number; from: number; clock: number } | null = null;
  private gizmoDrag: GizmoDrag | null = null;
  private activeCamera: string | null = null;
  private readonly compiled = new Map<string, number>();
  private readonly cleanups: (() => void)[] = [];
  private readonly resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, source: StageSource, assets: AssetSource) {
    this.canvas = canvas;
    this.source = source;
    this.renderer = StageRenderer.create(canvas, assets, () => this.requestDraw());
    this.resizeObserver = new ResizeObserver(() => {
      if (this.sizeKey() !== this.lastSize) this.requestDraw();
    });
    this.resizeObserver.observe(canvas);
    this.cleanups.push(source.onDraw(() => this.requestDraw()));
    this.cleanups.push(source.transport.subscribe(() => this.onTransport()));
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.dataset["frame"] = "0";
    this.requestDraw();
  }

  compile(source: string): CompileResult | null {
    return this.renderer ? this.renderer.compileShaderText(source) : null;
  }

  get available(): boolean {
    return this.renderer !== null;
  }

  private sizeKey(): string {
    return `${this.canvas.clientWidth}x${this.canvas.clientHeight}x${window.devicePixelRatio}`;
  }

  private onTransport(): void {
    this.lastBeat = Math.floor(this.source.transport.beat()) - 1;
    this.requestDraw();
  }

  requestDraw(): void {
    if (this.scheduled || !this.renderer) return;
    this.scheduled = true;
    requestAnimationFrame(this.tick);
  }

  private continuous(): boolean {
    const reduced = prefersReducedMotion();
    return this.source.transport.isPlaying()
      || this.orbiting !== null
      || this.gizmoDrag !== null
      || this.coast !== null
      || (this.source.scrubbing !== null && !reduced);
  }

  private readonly tick = (now: number): void => {
    this.scheduled = false;
    this.advanceCoast(now);
    this.drawFrame();
    if (this.continuous()) this.requestDraw();
  };

  private advanceCoast(now: number): void {
    const coast = this.coast;
    if (!coast) return;
    const spent = now - coast.from;
    const dt = Math.min(50, Math.max(0, now - coast.clock));
    coast.clock = now;
    if (spent >= COAST_MS) {
      this.coast = null;
      return;
    }
    const decay = (1 - spent / COAST_MS) ** 2;
    this.orbit.yaw += coast.yaw * decay * dt;
    this.orbit.pitch = Math.max(-1.45, Math.min(1.45, this.orbit.pitch + coast.pitch * decay * dt));
  }

  private compileShaders(layers: readonly LayerDoc[]): void {
    const { renderer } = this;
    if (!renderer) return;
    for (const layer of layers) {
      if (layer.kind !== "shader" || layer.shader_version === null) continue;
      if (this.compiled.get(layer.id) === layer.shader_version) continue;
      const text = this.source.shaderText(layer.id, layer.shader_version);
      if (text === undefined) continue;
      this.compiled.set(layer.id, layer.shader_version);
      renderer.setShader(layer.id, text);
    }
  }

  private view(layers: readonly LayerDoc[], effective: Map<string, EffectiveLayer>, world: Map<string, Mat4>, aspect: number): { view: Mat4; proj: Mat4; eye: Vec3 } {
    const { doc } = this.source;
    const camera = layers.find((layer) => layer.id === doc.set.active_camera_id && layer.kind === "camera");
    if (this.activeCamera !== (camera?.id ?? null)) {
      this.activeCamera = camera?.id ?? null;
      Object.assign(this.orbit, { yaw: 0, pitch: 0, zoom: 1 });
    }
    const matrix = camera ? world.get(camera.id) : undefined;
    const props = camera ? effective.get(camera.id)?.props : undefined;
    let eye: Vec3 = [6, 5, 9];
    let forward: Vec3 = normalize(subtract([0, 0, 0], eye));
    let up: Vec3 = [0, 1, 0];
    if (matrix) {
      eye = transformPoint(matrix, [0, 0, 0]);
      forward = normalize(transformDirection(matrix, [0, 0, -1]));
      up = normalize(transformDirection(matrix, [0, 1, 0]));
    }
    const distance = length(eye) > 1 ? length(eye) : 8;
    const pivot = add(eye, scaleVec(forward, distance));
    let offset = subtract(eye, pivot);
    const right = normalize(cross(forward, up));
    offset = rotateAround(offset, [0, 1, 0], this.orbit.yaw);
    const rightYawed = rotateAround(right, [0, 1, 0], this.orbit.yaw);
    offset = rotateAround(offset, rightYawed, this.orbit.pitch);
    up = rotateAround(rotateAround(up, [0, 1, 0], this.orbit.yaw), rightYawed, this.orbit.pitch);
    const orbited = add(pivot, scaleVec(offset, this.orbit.zoom));
    const view = lookAt(orbited, pivot, up);
    const proj = perspective(props?.["fov"] ?? 50, aspect, props?.["near"] ?? 0.1, props?.["far"] ?? 500);
    return { view, proj, eye: orbited };
  }

  private fireBeats(beat: number): void {
    const whole = Math.floor(beat);
    if (!this.source.transport.isPlaying()) return;
    for (let b = Math.max(this.lastBeat + 1, whole - 1); b <= whole; b += 1) {
      this.source.scripts.fireBeat(b, this.source.transport.bpm);
    }
    this.lastBeat = whole;
  }

  private drawFrame(): void {
    const { renderer } = this;
    if (!renderer) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2) return;
    this.lastSize = this.sizeKey();
    renderer.resize(width, height, window.devicePixelRatio || 1);
    const { doc, transport } = this.source;
    const tick = transport.tick();
    const beat = transport.beat();
    this.fireBeats(beat);
    const layers = treeOrder(doc.layers);
    this.compileShaders(layers);
    const effective = evaluateFrame({
      doc, tick, beat, plugins: this.source.scripts, scrubbing: this.source.scrubbing, animate: this.source.animate,
    });
    const world = worldMatrices(layers, effective);
    const { view, proj, eye } = this.view(layers, effective, world, width / height);
    this.lastGizmo = renderer.draw({
      cssWidth: width, cssHeight: height, layers, effective, world, view, proj, eye, beat,
      seconds: transport.seconds(), selectedId: this.source.selection, activeCameraId: this.activeCamera, editorChrome: this.source.editorChrome, bus: this.source.bus,
    });
    this.frames += 1;
    this.canvas.dataset["frame"] = String(this.frames);
    for (const axis of ["x", "y", "z"] as const) {
      const grip = this.lastGizmo?.grips[axis];
      if (grip) this.canvas.dataset[`gizmo${axis.toUpperCase()}`] = `${grip[0]},${grip[1]}`;
      else delete this.canvas.dataset[`gizmo${axis.toUpperCase()}`];
    }
    this.source.frameDone();
  }

  // ---- pointer input -------------------------------------------------------------------------------

  private local(event: PointerEvent): [number, number] {
    const box = this.canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.source.editorChrome || event.button !== 0) return;
    this.canvas.setPointerCapture(event.pointerId);
    const [x, y] = this.local(event);
    const shape = this.lastGizmo;
    const id = this.source.selection;
    if (shape && id) {
      const axis = (["x", "y", "z"] as const).find((candidate) => Math.hypot(shape.grips[candidate][0] - x, shape.grips[candidate][1] - y) <= GRIP_REACH);
      if (axis) {
        const mode = this.source.gizmoMode;
        const base = mode === "move" ? "position" : mode === "rotate" ? "rotation" : "scale";
        const path = `${base}.${axis}`;
        const layer = this.source.doc.layers.find((candidate) => candidate.id === id);
        const value = layer ? layer[base][axis === "x" ? 0 : axis === "y" ? 1 : 2] : 0;
        this.gizmoDrag = { axis, layerId: id, path, start: value, originX: x, originY: y, direction: shape.directions[axis], last: value };
        this.requestDraw();
        return;
      }
    }
    this.coast = null;
    this.orbiting = { x, y, velocityYaw: 0, velocityPitch: 0, stamp: performance.now() };
    this.requestDraw();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const [x, y] = this.local(event);
    const drag = this.gizmoDrag;
    if (drag) {
      const along = (x - drag.originX) * drag.direction[0] + (y - drag.originY) * drag.direction[1];
      const mode = this.source.gizmoMode;
      let value = drag.start + along * (mode === "rotate" ? 1 : 0.01);
      if (mode === "move" && this.source.gridSnap) value = Math.round(value / 0.5) * 0.5;
      if (mode === "rotate" && this.source.angleSnap) value = Math.round(value / 15) * 15;
      value = Math.round(value * 10_000) / 10_000;
      drag.last = value;
      this.source.preview(drag.layerId, drag.path, value);
      this.requestDraw();
      return;
    }
    const orbiting = this.orbiting;
    if (!orbiting) return;
    const dx = x - orbiting.x;
    const dy = y - orbiting.y;
    const now = performance.now();
    const elapsed = Math.max(1, now - orbiting.stamp);
    this.orbit.yaw -= dx * 0.006;
    this.orbit.pitch = Math.max(-1.45, Math.min(1.45, this.orbit.pitch + dy * 0.006));
    this.orbiting = { x, y, velocityYaw: (-dx * 0.006) / elapsed, velocityPitch: (dy * 0.006) / elapsed, stamp: now };
    this.requestDraw();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    const drag = this.gizmoDrag;
    if (drag) {
      this.gizmoDrag = null;
      if (drag.last !== drag.start) this.source.setLayerValue(drag.layerId, drag.path, drag.last);
      else this.source.preview(drag.layerId, drag.path, drag.start);
      this.requestDraw();
      return;
    }
    const orbiting = this.orbiting;
    this.orbiting = null;
    if (orbiting && !prefersReducedMotion() && (Math.abs(orbiting.velocityYaw) > 1e-5 || Math.abs(orbiting.velocityPitch) > 1e-5)) {
      const now = performance.now();
      this.coast = { yaw: orbiting.velocityYaw, pitch: orbiting.velocityPitch, from: now, clock: now };
    }
    this.requestDraw();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.orbit.zoom = Math.max(0.15, Math.min(6, this.orbit.zoom * Math.exp(event.deltaY * 0.0012)));
    this.requestDraw();
  };

  dispose(): void {
    this.resizeObserver.disconnect();
    for (const cleanup of this.cleanups) cleanup();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }
}

