// The view director: every view change, its timing and the scene state the region reports
// (brief: Motion and effects, Scene state for every view change). Rendering is delegated to the
// WebGL scene or the flat drawing; both read the same frame.
import type { View } from "../types";
import { FACING_YAW, normaliseYaw, yawDelta, type WallSpec, type WorkSpec } from "./room";

const DROP_MS = 760;
const HANG_MS = 200;
const LUX_MS = 500;
const SETTLE_MS = 250;
const SELECT_MS = 200;
export const EYE_CM = 145;
const PLAN_CM = 1800;
const ORBIT_LIMIT = 30;
const SETTLE_LIFT_MM = 100;

export interface CameraState {
  heightCm: number;
  yaw: number;
  /** 0 at plan height looking down, 1 at eye height facing the wall */
  eye: number;
  facingWallId: string;
  /** Where along the faced wall the eye-line camera stands (mm), fixed when the change starts */
  standMm: number | null;
  zoom: number;
}

export interface FrameWork extends WorkSpec {
  liftMm: number;
}

export interface Frame {
  view: View;
  camera: CameraState;
  luxMix: number;
  hangOpacity: number;
  /** grain dissolve progress while the eye-line drop plays, else null */
  dissolve: number | null;
  selectedId: string | null;
  selectAlpha: number;
  works: FrameWork[];
  walls: WallSpec[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a wall's name sits in the plan: just outside the wall's middle, turned along the wall. */
export interface WallLabelSpot {
  x: number;
  y: number;
  angleDeg: number;
}

export interface SceneRenderer {
  readonly kind: "webgl" | "flat";
  readonly element: Element;
  draw(frame: Frame): void;
  /** Holds the current picture so the grain can break it up while the camera moves. */
  captureForDissolve(frame: Frame): void;
  workRect(id: string): Rect | null;
  wallLabelSpot(wallId: string): WallLabelSpot | null;
  /** Millimetres along a wall under a point in the scene box, or null. */
  pointerOffset(wallId: string, x: number, y: number): number | null;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface DirectorHooks {
  onSettled?: (view: View) => void;
  onSelect?: (id: string) => void;
  canMove?: (id: string) => boolean;
  onNotMovable?: (id: string) => void;
  onDrag?: (id: string, offsetMm: number) => void;
  onDragEnd?: (id: string) => void;
}

interface Transition {
  start: number;
  total: number;
  step: (elapsed: number) => void;
  done: () => void;
}

const easeOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class SceneDirector {
  view: View = "plan";
  /** The camera is at (or heading to) eye height. */
  eyeLevel = false;
  private cam: CameraState = { heightCm: PLAN_CM, yaw: 0, eye: 0, facingWallId: "wall-north", standMm: null, zoom: 1 };
  private luxMix = 0;
  private hangOpacity = 0;
  private dissolve: number | null = null;
  private transition: Transition | null = null;
  private settling = new Map<string, number>();
  private known = new Set<string>();
  private hasData = false;
  private selectedId: string | null = null;
  private defaultFacing: string | null = null;
  private selectStart = -Infinity;
  private works: WorkSpec[] = [];
  private walls: WallSpec[] = [];
  private liveOffsets = new Map<string, number>();
  private markers = new Map<string, HTMLElement>();
  private wallLabels = new Map<string, HTMLElement>();
  private readonly facingName: HTMLElement;
  private frameRequested = false;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly region: HTMLElement,
    private readonly layer: HTMLElement,
    private readonly readout: HTMLElement,
    private readonly renderer: SceneRenderer,
    private readonly reduced: boolean,
    private readonly hooks: DirectorHooks,
  ) {
    this.facingName = document.createElement("p");
    this.facingName.className = "scene-facing";
    this.facingName.setAttribute("aria-hidden", "true");
    readout.after(this.facingName);
    this.writeState(false);
    this.attachInput();
    this.requestFrame();
  }

  get instant(): boolean {
    return this.reduced || this.renderer.kind === "flat";
  }

  setData(walls: WallSpec[], works: WorkSpec[], selectedId: string | null, facingWallId: string | null = null): void {
    this.walls = walls;
    this.defaultFacing = facingWallId;
    const now = performance.now();
    if (this.hasData && !this.reduced) {
      for (const w of works) if (!this.known.has(w.id)) this.settling.set(w.id, now);
    }
    this.known = new Set(works.map((w) => w.id));
    if (works.length || walls.length) this.hasData = true;
    this.works = works;
    if (selectedId !== this.selectedId) {
      this.selectedId = selectedId;
      this.selectStart = this.reduced ? -Infinity : now;
    }
    if (!this.transition) this.writeReadout(this.eyeLevel);
    this.syncMarkers();
    this.renderNow();
  }

  /** Lands on a view's final state as an instant cut (workspace URL restore). */
  restore(view: View, eye: boolean): void {
    this.finishTransition();
    const facing = this.facingWall();
    this.view = view;
    this.eyeLevel = view === "wall" || (view === "light" && eye);
    this.cam = {
      ...this.cam,
      heightCm: this.eyeLevel ? EYE_CM : PLAN_CM,
      yaw: this.eyeLevel ? FACING_YAW[facing] ?? 0 : 0,
      eye: this.eyeLevel ? 1 : 0,
      facingWallId: facing,
      standMm: this.standFor(facing),
    };
    this.luxMix = view === "light" ? 1 : 0;
    this.hangOpacity = this.eyeLevel ? 1 : 0;
    this.writeState(false);
    this.renderNow();
  }

  setView(next: View): void {
    if (next === this.view) return;
    this.finishTransition();
    const from = this.view;
    const fromEye = this.eyeLevel;
    const facing = this.facingWall();
    this.view = next;
    const toEye = next === "wall" ? true : next === "plan" ? false : fromEye;
    const lux0 = from === "light" ? 1 : 0;
    const lux1 = next === "light" ? 1 : 0;
    const finalCam: CameraState = toEye === fromEye
      ? { ...this.cam }
      : {
          ...this.cam,
          heightCm: toEye ? EYE_CM : PLAN_CM,
          yaw: toEye ? FACING_YAW[facing] ?? 0 : 0,
          eye: toEye ? 1 : 0,
          facingWallId: toEye ? facing : this.cam.facingWallId,
          standMm: toEye ? this.standFor(facing) : this.cam.standMm,
        };
    this.eyeLevel = toEye;
    const land = () => {
      this.cam = finalCam;
      this.luxMix = lux1;
      this.hangOpacity = toEye ? 1 : 0;
      this.dissolve = null;
      this.transition = null;
      this.writeState(false);
      this.renderNow();
      this.hooks.onSettled?.(next);
    };
    if (this.instant) {
      land();
      return;
    }
    const start = performance.now();
    const startCam = { ...this.cam };
    const luxStep = (elapsed: number) => {
      this.luxMix = lerp(lux0, lux1, easeInOut(clamp01(elapsed / LUX_MS)));
    };
    if (toEye === fromEye) {
      this.transition = { start, total: LUX_MS, step: luxStep, done: land };
    } else if (toEye) {
      this.renderer.captureForDissolve(this.frame());
      let hangShown = false;
      this.transition = {
        start,
        total: DROP_MS + HANG_MS,
        step: (elapsed) => {
          luxStep(elapsed);
          const u = clamp01(elapsed / DROP_MS);
          this.moveCamera(startCam, finalCam, easeOut(u));
          this.dissolve = u < 1 ? u : null;
          if (elapsed >= DROP_MS) {
            if (!hangShown) {
              hangShown = true;
              this.setAttr("data-hang-line", "visible");
              this.writeReadout(true);
            }
            this.hangOpacity = clamp01((elapsed - DROP_MS) / HANG_MS);
          }
        },
        done: land,
      };
    } else {
      this.setAttr("data-hang-line", "hidden");
      let rising = false;
      this.transition = {
        start,
        total: HANG_MS + DROP_MS,
        step: (elapsed) => {
          luxStep(elapsed);
          this.hangOpacity = 1 - clamp01(elapsed / HANG_MS);
          if (elapsed >= HANG_MS) {
            if (!rising) {
              rising = true;
              this.renderer.captureForDissolve(this.frame());
            }
            const u = clamp01((elapsed - HANG_MS) / DROP_MS);
            this.moveCamera(startCam, finalCam, easeOut(u));
            this.dissolve = u < 1 ? u : null;
          }
        },
        done: land,
      };
    }
    this.setAttr("data-view", next);
    this.setAttr("data-transitioning", "true");
    this.syncMarkers();
    this.requestFrame();
  }

  orbitBy(degrees: number): void {
    if (this.transition) return;
    if (this.eyeLevel) {
      const facing = FACING_YAW[this.cam.facingWallId] ?? 0;
      const offset = Math.max(-ORBIT_LIMIT, Math.min(ORBIT_LIMIT, yawDelta(facing, this.cam.yaw) + degrees));
      this.cam = { ...this.cam, yaw: facing + offset };
    } else {
      this.cam = { ...this.cam, yaw: this.cam.yaw + degrees };
    }
    this.setAttr("data-camera-yaw-deg", String(normaliseYaw(this.cam.yaw)));
    this.requestFrame();
  }

  zoomBy(factor: number): void {
    this.cam = { ...this.cam, zoom: Math.min(2, Math.max(0.5, this.cam.zoom * factor)) };
    this.requestFrame();
  }

  resize(width: number, height: number): void {
    this.renderer.resize(width, height);
    this.requestFrame();
  }

  dispose(): void {
    this.disposed = true;
    this.cleanups.forEach((c) => c());
    this.markers.forEach((m) => m.remove());
    this.wallLabels.forEach((l) => l.remove());
    this.facingName.remove();
    this.renderer.dispose();
  }

  /** The selected work's offset when it hangs on the faced wall: the camera stands in front of it. */
  private standFor(wallId: string): number | null {
    const selected = this.works.find((w) => w.id === this.selectedId);
    return selected && selected.wallId === wallId ? selected.offsetMm : null;
  }

  private facingWall(): string {
    const selected = this.works.find((w) => w.id === this.selectedId);
    return selected?.wallId ?? this.defaultFacing ?? "wall-north";
  }

  private moveCamera(from: CameraState, to: CameraState, t: number): void {
    this.cam = {
      ...this.cam,
      heightCm: lerp(from.heightCm, to.heightCm, t),
      yaw: from.yaw + yawDelta(from.yaw, to.yaw) * t,
      eye: lerp(from.eye, to.eye, t),
      facingWallId: to.eye > from.eye ? to.facingWallId : from.facingWallId,
      standMm: to.eye > from.eye ? to.standMm : from.standMm,
    };
    this.setAttr("data-camera-height-cm", String(Math.round(this.cam.heightCm)));
    this.setAttr("data-camera-yaw-deg", String(normaliseYaw(this.cam.yaw)));
  }

  private finishTransition(): void {
    if (this.transition) this.transition.done();
  }

  private setAttr(name: string, value: string): void {
    if (this.region.getAttribute(name) !== value) this.region.setAttribute(name, value);
  }

  private writeState(transitioning: boolean): void {
    this.setAttr("data-view", this.view);
    this.setAttr("data-transitioning", String(transitioning));
    this.setAttr("data-camera-height-cm", String(Math.round(this.cam.heightCm)));
    this.setAttr("data-camera-yaw-deg", String(normaliseYaw(this.cam.yaw)));
    this.setAttr("data-hang-line", this.eyeLevel ? "visible" : "hidden");
    this.writeReadout(this.eyeLevel);
    this.syncMarkers();
  }

  /** The published readout, with the faced wall's name beside it at eye height. */
  private writeReadout(eye: boolean): void {
    this.readout.textContent = eye ? `Eye height ${EYE_CM} cm` : "Plan view";
    const name = eye ? this.walls.find((w) => w.id === this.cam.facingWallId)?.name ?? "" : "";
    this.facingName.textContent = name ? `Facing ${name}` : "";
    this.facingName.hidden = !name;
  }

  private frame(): Frame {
    const now = performance.now();
    return {
      view: this.view,
      camera: this.cam,
      luxMix: this.luxMix,
      hangOpacity: this.hangOpacity,
      dissolve: this.dissolve,
      selectedId: this.selectedId,
      selectAlpha: this.reduced ? 1 : clamp01((now - this.selectStart) / SELECT_MS),
      works: this.works.map((w) => {
        const started = this.settling.get(w.id);
        const t = started === undefined ? 1 : clamp01((now - started) / SETTLE_MS);
        return { ...w, offsetMm: this.liveOffsets.get(w.id) ?? w.offsetMm, liftMm: SETTLE_LIFT_MM * (1 - easeOut(t)) };
      }),
      walls: this.walls,
    };
  }

  /** Draws the current state at once, so the picture and markers never lag a cut or a data change. */
  private renderNow(): void {
    if (this.disposed) return;
    this.renderer.draw(this.frame());
    this.placeMarkers();
    if (this.transition || this.settling.size || performance.now() - this.selectStart < SELECT_MS) this.requestFrame();
  }

  private requestFrame(): void {
    if (this.frameRequested || this.disposed) return;
    this.frameRequested = true;
    requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.frameRequested = false;
    if (this.disposed) return;
    const now = performance.now();
    let animating = false;
    if (this.transition) {
      const elapsed = now - this.transition.start;
      if (elapsed >= this.transition.total) this.transition.done();
      else {
        this.transition.step(elapsed);
        animating = true;
      }
    }
    for (const [id, started] of this.settling) {
      if (now - started >= SETTLE_MS) {
        this.settling.delete(id);
        this.markers.get(id)?.setAttribute("data-settling", "false");
      } else animating = true;
    }
    if (!this.reduced && now - this.selectStart < SELECT_MS) animating = true;
    this.renderer.draw(this.frame());
    this.placeMarkers();
    if (animating) this.requestFrame();
  }

  private syncMarkers(): void {
    const ids = new Set(this.works.map((w) => w.id));
    for (const [id, el] of this.markers) {
      if (!ids.has(id)) {
        el.remove();
        this.markers.delete(id);
      }
    }
    for (const w of this.works) {
      let el = this.markers.get(w.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "work-marker";
        el.setAttribute("aria-hidden", "true");
        el.dataset.placementId = w.id;
        el.dataset.settling = this.settling.has(w.id) ? "true" : "false";
        this.layer.appendChild(el);
        this.markers.set(w.id, el);
      }
      const set = (name: string, value: string) => {
        if (el!.getAttribute(name) !== value) el!.setAttribute(name, value);
      };
      set("data-lux-status", w.luxStatus);
      set("data-overlay", this.view === "light" ? (w.luxStatus === "over" ? "red-hatch" : "ink-outline") : "none");
      set("data-selected", String(w.id === this.selectedId));
    }
  }

  private placeMarkers(): void {
    this.placeWallLabels();
    for (const [id, el] of this.markers) {
      const rect = this.renderer.workRect(id);
      if (!rect) {
        el.style.display = "none";
        continue;
      }
      const min = 12;
      const width = Math.max(rect.width, min);
      const height = Math.max(rect.height, min);
      el.style.display = "block";
      el.style.left = `${rect.x + rect.width / 2 - width / 2}px`;
      el.style.top = `${rect.y + rect.height / 2 - height / 2}px`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    }
  }

  /** Wall names around the plan, shown only while the camera looks straight down. */
  private placeWallLabels(): void {
    const plan = this.cam.eye === 0 && this.dissolve === null;
    for (const w of this.walls) {
      let label = this.wallLabels.get(w.id);
      if (!label) {
        label = document.createElement("span");
        label.className = "wall-label";
        label.setAttribute("aria-hidden", "true");
        this.layer.appendChild(label);
        this.wallLabels.set(w.id, label);
      }
      label.textContent = w.name;
      const spot = plan ? this.renderer.wallLabelSpot(w.id) : null;
      label.hidden = !spot;
      if (spot) {
        // A label never sits on the scene's edge, where the phone's edge-to-edge scene meets the screen.
        const inset = 14;
        label.style.left = `${Math.min(Math.max(spot.x, inset), this.layer.clientWidth - inset)}px`;
        label.style.top = `${Math.min(Math.max(spot.y, inset), this.layer.clientHeight - inset)}px`;
        label.style.transform = `translate(-50%, -50%) rotate(${spot.angleDeg}deg)`;
      }
    }
  }

  /** The work under a point: the marker hit, or the smallest marker box containing the point. */
  private workAt(x: number, y: number, target: Element): string | null {
    const hit = target.closest?.("[data-placement-id]")?.getAttribute("data-placement-id");
    if (hit) return hit;
    let best: { id: string; area: number } | null = null;
    for (const [id, el] of this.markers) {
      const r = el.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && (!best || r.width * r.height < best.area)) {
        best = { id, area: r.width * r.height };
      }
    }
    return best?.id ?? null;
  }

  private attachInput(): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { id: string; wallId: string; startMm: number; baseMm: number; moved: boolean; blocked: boolean } | null = null;
    let gesture: { cx: number; dist: number } | null = null;
    const box = () => this.region.getBoundingClientRect();
    const local = (e: PointerEvent) => {
      const b = box();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const twoFinger = () => {
      const [a, b] = [...pointers.values()];
      return { cx: (a.x + b.x) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const cancelDrag = () => {
      if (drag) this.liveOffsets.delete(drag.id);
      drag = null;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 2) {
        if (drag?.moved) this.hooks.onDrag?.(drag.id, drag.baseMm);
        cancelDrag();
        gesture = twoFinger();
        return;
      }
      const id = this.workAt(e.clientX, e.clientY, e.target as Element);
      const work = id ? this.works.find((w) => w.id === id) : undefined;
      if (work) {
        this.hooks.onSelect?.(work.id);
        const p = local(e);
        const at = this.renderer.pointerOffset(work.wallId, p.x, p.y);
        drag = {
          id: work.id,
          wallId: work.wallId,
          startMm: at ?? 0,
          baseMm: work.offsetMm,
          moved: false,
          blocked: at === null || this.view === "light" || !this.hooks.onDrag,
        };
        this.region.setPointerCapture?.(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size >= 2 && gesture) {
        const next = twoFinger();
        this.orbitBy((next.cx - gesture.cx) * 0.35);
        if (gesture.dist > 0 && next.dist > 0) this.zoomBy(next.dist / gesture.dist);
        gesture = next;
        return;
      }
      if (drag) {
        if (drag.blocked) return;
        const at = this.renderer.pointerOffset(drag.wallId, p.x, p.y);
        if (at === null) return;
        const deltaMm = Math.round((at - drag.startMm) / 10) * 10;
        if (!drag.moved && deltaMm === 0) return;
        if (!drag.moved && !(this.hooks.canMove?.(drag.id) ?? false)) {
          drag.blocked = true;
          this.hooks.onNotMovable?.(drag.id);
          return;
        }
        drag.moved = true;
        const offset = drag.baseMm + deltaMm;
        this.liveOffsets.set(drag.id, offset);
        this.hooks.onDrag?.(drag.id, offset);
        this.requestFrame();
        return;
      }
      if (pointers.size === 1 && e.buttons !== 0) this.orbitBy((p.x - prev.x) * 0.3);
    };
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) gesture = null;
      if (drag && pointers.size === 0) {
        const finished = drag;
        this.liveOffsets.delete(finished.id);
        drag = null;
        if (finished.moved && e.type === "pointerup") this.hooks.onDragEnd?.(finished.id);
        else if (finished.moved) this.hooks.onDrag?.(finished.id, finished.baseMm);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.001));
    };
    const observer = new ResizeObserver(() => {
      const b = box();
      this.resize(b.width, b.height);
    });
    observer.observe(this.region);
    this.region.addEventListener("pointerdown", down);
    this.region.addEventListener("pointermove", move);
    this.region.addEventListener("pointerup", up);
    this.region.addEventListener("pointercancel", up);
    this.region.addEventListener("wheel", wheel, { passive: false });
    this.cleanups.push(() => {
      observer.disconnect();
      this.region.removeEventListener("pointerdown", down);
      this.region.removeEventListener("pointermove", move);
      this.region.removeEventListener("pointerup", up);
      this.region.removeEventListener("pointercancel", up);
      this.region.removeEventListener("wheel", wheel);
    });
  }
}
