import type { Route } from "../../shared/routes";
import {
  activeWorldAt, DESCENT_MS, DRAG_DEG_PER_PX, DRAG_SELECT_PX, EMBLEM_DEG_PER_SECOND, FLIGHT_MS, formatDegrees, isHorizontalSwipe, isWorld,
  MAX_YAW, scrollPositionOf, TURN_MS, WORLD_STEP_DEG, worldAnnouncement, yawOf,
} from "../../shared/stage-rules";
import { catalog, worldAt } from "../boot";
import { prefersReducedMotion } from "../motion";
import { StageScene } from "./scene";

type Mode = "loading" | "3d" | "still";
type StillReason = "no-webgl" | "model-failure";
type CameraState = "ring" | "descending" | "entering" | "inside" | "leaving";

export interface StageSnapshot {
  mode: Mode;
  reason: StillReason | null;
  active: number;
  announcement: string;
}

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

type Flight = { kind: "enter" | "leave" | "hop"; start: number };

interface Drag {
  pointerId: number;
  pressX: number;
  startYaw: number;
}

const EMBLEM_DEG_PER_MS = EMBLEM_DEG_PER_SECOND / 1000;
const HOP_DIP = 0.45;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const progress = (tween: Tween, now: number) => Math.min(1, Math.max(0, (now - tween.start) / tween.duration));

/**
 * The stage's state machine. It owns every published data attribute and writes each one in the task that changes it;
 * only the drawn motion follows over the page's frame clock.
 */
class Stage {
  private mode: Mode = "loading";
  private reason: StillReason | null = null;
  private active = 1;
  private yaw = 0;
  private targetYaw = 0;
  private camera: CameraState = "ring";
  private inside = 0;
  private descent = 0;
  private emblem = 0;
  private announcement = "";
  private yawTween: Tween | null = null;
  private descentTween: Tween | null = null;
  private flight: Flight | null = null;
  private drag: Drag | null = null;
  private swipeStart: { x: number; y: number } | null = null;
  private returning: number | null = null;
  private lastFrame = 0;
  private lastDrawn = "";
  private host: HTMLElement | null = null;
  private section: HTMLElement | null = null;
  private scene: StageScene | null = null;
  private snapshot: StageSnapshot = { mode: "loading", reason: null, active: 1, announcement: "" };
  private readonly listeners = new Set<() => void>();
  private readonly written = new Map<string, string>();

  /** Starts for the page the browser loaded: the world's own page, or the ring. */
  start(route: Route): void {
    if (route.name === "world") this.settleInside(route.world.index);
    try {
      this.scene = new StageScene();
    } catch {
      this.goStill("no-webgl");
      return;
    }
    void this.loadModels();
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StageSnapshot => this.snapshot;

  private emit(): void {
    this.snapshot = { mode: this.mode, reason: this.reason, active: this.active, announcement: this.announcement };
    this.listeners.forEach((listener) => listener());
  }

  /** The element carrying `data-stage`; the canvas moves into it while the stage draws. */
  attach(host: HTMLElement | null): void {
    this.host = host;
    this.written.clear();
    if (!host) return;
    if (this.scene && this.mode !== "still") host.prepend(this.scene.canvas);
    this.writeAttributes();
    this.lastDrawn = "";
  }

  attachSection(section: HTMLElement | null): void {
    this.section = section;
  }

  private writeAttributes(): void {
    if (!this.host) return;
    const values: Record<string, string> = {
      "data-mode": this.mode,
      "data-active-world": worldAt(this.active).slug,
      "data-yaw": formatDegrees(this.yaw),
      "data-target-yaw": formatDegrees(this.targetYaw),
      "data-camera": this.camera,
      "data-emblem-angle": formatDegrees(Math.floor(this.emblem * 10) / 10),
    };
    for (const [name, value] of Object.entries(values)) {
      if (this.written.get(name) === value) continue;
      this.written.set(name, value);
      this.host.setAttribute(name, value);
    }
  }

  private settleInside(index: number): void {
    this.active = index;
    this.targetYaw = yawOf(index);
    this.yaw = this.targetYaw;
    this.inside = 1;
    this.camera = "inside";
    this.yawTween = null;
    this.flight = null;
    this.descentTween = null;
    this.descent = 0;
  }

  private async loadModels(): Promise<boolean> {
    try {
      await this.scene?.load(catalog.worlds.map((world) => world.slug));
    } catch {
      this.goStill("model-failure");
      return false;
    }
    this.mode = "3d";
    this.reason = null;
    this.emblem = 0;
    this.lastFrame = performance.now();
    this.host?.prepend((this.scene as StageScene).canvas);
    this.writeAttributes();
    this.emit();
    return true;
  }

  private goStill(reason: StillReason): void {
    this.mode = "still";
    this.reason = reason;
    this.yaw = this.targetYaw;
    this.yawTween = null;
    this.flight = null;
    this.descentTween = null;
    this.descent = 0;
    this.inside = this.camera === "inside" || this.camera === "entering" ? 1 : 0;
    this.camera = this.inside === 1 ? "inside" : "ring";
    this.scene?.canvas.remove();
    this.writeAttributes();
    this.emit();
  }

  /** Fetches the eight models again; the still layout stays until all of them arrive. */
  async tryAgain(): Promise<boolean> {
    if (this.mode !== "still" || this.reason !== "model-failure") return false;
    const loaded = await this.loadModels();
    if (!loaded) return false;
    this.active = 1;
    this.targetYaw = 0;
    this.yaw = 0;
    this.camera = "ring";
    this.writeAttributes();
    this.emit();
    return true;
  }

  private animates(): boolean {
    return this.mode !== "still" && !prefersReducedMotion();
  }

  /** The ring turns from the yaw drawn now to the target, straight, in one direction. */
  private turn(): void {
    if (this.animates()) {
      this.yawTween = { from: this.yaw, to: this.targetYaw, start: performance.now(), duration: TURN_MS };
    } else {
      this.yawTween = null;
      this.yaw = this.targetYaw;
    }
    this.writeAttributes();
  }

  private setActive(index: number, announce: boolean): void {
    if (index === this.active) return;
    this.active = index;
    this.targetYaw = yawOf(index);
    if (announce && this.mode !== "still") this.announcement = worldAnnouncement(worldAt(index));
    this.turn();
    this.emit();
  }

  private geometry(): { top: number; height: number } {
    const section = this.section as HTMLElement;
    return { top: section.getBoundingClientRect().top + window.scrollY, height: window.innerHeight };
  }

  /** Moves the page to the position at which the world is active. */
  jumpTo(index: number): void {
    const { top, height } = this.geometry();
    window.scrollTo({ top: scrollPositionOf(index, top, height), behavior: "instant" });
  }

  get scrollDriven(): boolean {
    return this.mode !== "still" && this.section !== null;
  }

  /** The scroll position alone decides the active world on the home page. */
  scrolled(): void {
    if (!this.scrollDriven) return;
    const { top, height } = this.geometry();
    this.setActive(activeWorldAt(window.scrollY, top, height), true);
  }

  /** Any other way of choosing a world (rail, keys, buttons, drag, swipe) moves the scroll position to match. */
  select(index: number): void {
    if (!isWorld(index)) return;
    this.jumpTo(index);
    if (index === this.active) {
      if (this.yaw !== this.targetYaw) this.turn();
      return;
    }
    this.setActive(index, true);
  }

  /** `Enter the worlds`: world 1 in, the camera descends onto the ring. Returns whether the 3D rail takes focus. */
  enterTheWorlds(): boolean {
    const { top } = this.geometry();
    if (this.mode === "still") {
      window.scrollTo({ top, behavior: "instant" });
      return false;
    }
    this.jumpTo(1);
    const line = worldAnnouncement(worldAt(1));
    this.announcement = line;
    this.active = 1;
    this.targetYaw = 0;
    if (this.yaw !== 0 || this.yawTween) this.turn();
    if (this.animates()) {
      this.descentTween = { from: 1, to: 0, start: performance.now(), duration: DESCENT_MS };
      this.descent = 1;
      this.camera = "descending";
    } else {
      this.descent = 0;
      this.camera = "ring";
    }
    this.writeAttributes();
    this.emit();
    return true;
  }

  /** The address changed: fly into a world, out of it, or between worlds, or settle for a page without a ring. */
  routeChanged(previous: Route, next: Route): void {
    this.returning = null;
    this.announcement = "";
    if (next.name === "world") {
      const index = next.world.index;
      const fromStage = previous.name === "home" || previous.name === "world";
      const hop = previous.name === "world";
      if (!fromStage || !this.animates()) {
        this.settleInside(index);
      } else {
        this.active = index;
        this.targetYaw = yawOf(index);
        this.turn();
        this.flight = { kind: hop ? "hop" : "enter", start: performance.now() };
        this.camera = "entering";
      }
    } else if (next.name === "home") {
      if (previous.name === "world") {
        this.returning = previous.world.index;
        if (this.animates()) {
          this.flight = { kind: "leave", start: performance.now() };
          this.camera = "leaving";
        } else {
          this.settleRing();
        }
      } else {
        this.active = 1;
        this.targetYaw = 0;
        this.yaw = 0;
        this.yawTween = null;
        this.settleRing();
      }
    }
    this.writeAttributes();
    this.emit();
  }

  private settleRing(): void {
    this.inside = 0;
    this.flight = null;
    this.camera = "ring";
    this.yaw = this.targetYaw;
    this.yawTween = null;
  }

  /** The world just left, once, for the home page to scroll to and focus. */
  takeReturn(): number | null {
    const index = this.returning;
    this.returning = null;
    return index;
  }

  pointerDown(pointerId: number, pointerType: string, button: number, x: number, y: number, target: EventTarget | null): boolean {
    if (this.mode === "still" || (target instanceof Element && target.closest("button, a, nav"))) return false;
    if (pointerType === "touch") {
      this.swipeStart = { x, y };
      return false;
    }
    if (button !== 0) return false;
    this.drag = { pointerId, pressX: x, startYaw: this.yaw };
    this.yawTween = null;
    return true;
  }

  pointerMove(pointerId: number, x: number): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointerId || prefersReducedMotion()) return;
    const turned = drag.startYaw + (drag.pressX - x) * DRAG_DEG_PER_PX;
    this.yaw = Math.min(MAX_YAW, drag.startYaw + WORLD_STEP_DEG, Math.max(0, drag.startYaw - WORLD_STEP_DEG, turned));
    this.writeAttributes();
  }

  pointerUp(pointerId: number, x: number, y: number): void {
    const swipe = this.swipeStart;
    this.swipeStart = null;
    if (swipe) {
      const [dx, dy] = [x - swipe.x, y - swipe.y];
      if (isHorizontalSwipe(dx, dy)) this.select(this.active + (dx < 0 ? 1 : -1));
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointerId) return;
    this.drag = null;
    const dx = x - drag.pressX;
    const target = this.active + (dx < 0 ? 1 : -1);
    if (Math.abs(dx) >= DRAG_SELECT_PX && isWorld(target)) this.select(target);
    else if (this.yaw !== this.targetYaw) this.turn();
  }

  pointerCancel(): void {
    this.swipeStart = null;
    if (this.drag) {
      this.drag = null;
      this.turn();
    }
  }

  private frame = (): void => {
    const now = performance.now();
    this.advance(now);
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private advance(now: number): void {
    if (this.yawTween && !this.drag) {
      const t = progress(this.yawTween, now);
      this.yaw = t >= 1 ? this.yawTween.to : this.yawTween.from + (this.yawTween.to - this.yawTween.from) * easeInOut(t);
      if (t >= 1) this.yawTween = null;
    }
    if (this.flight) {
      const t = progress({ from: 0, to: 1, start: this.flight.start, duration: FLIGHT_MS }, now);
      const eased = easeInOut(t);
      this.inside = this.flight.kind === "enter" ? eased : this.flight.kind === "leave" ? 1 - eased : 1 - HOP_DIP * Math.sin(Math.PI * t);
      if (t >= 1) {
        this.camera = this.flight.kind === "leave" ? "ring" : "inside";
        this.inside = this.camera === "inside" ? 1 : 0;
        this.flight = null;
      }
    }
    if (this.descentTween) {
      const t = progress(this.descentTween, now);
      this.descent = 1 - easeInOut(t);
      if (t >= 1) {
        this.descent = 0;
        this.descentTween = null;
        this.camera = "ring";
      }
    }
    if (this.mode === "3d" && !prefersReducedMotion()) this.emblem = (this.emblem + (now - this.lastFrame) * EMBLEM_DEG_PER_MS) % 360;
    this.lastFrame = now;
    this.writeAttributes();
  }

  private draw(): void {
    const host = this.host;
    if (this.mode !== "3d" || !this.scene || !host) return;
    const box = host.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= window.innerHeight || box.width === 0) return;
    const key = `${this.yaw}|${this.inside}|${this.descent}|${this.emblem}|${box.width}x${box.height}`;
    if (key === this.lastDrawn) return;
    this.lastDrawn = key;
    const band = host.classList.contains("stage--band");
    const wide = box.width > box.height;
    this.scene.layout(Math.round(box.width), Math.round(box.height), wide && !band ? 0.12 : 0, band ? 0.08 : wide ? 0.05 : 0.1);
    this.scene.render({ yaw: this.yaw, inside: this.inside, descent: this.descent, emblem: this.emblem });
  }
}

export const stage = new Stage();
