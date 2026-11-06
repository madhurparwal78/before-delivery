// The Horizon thread: one timeline that both the visible page and hidden-page resumption read.
// Every phase is a function of the page clock, so a page shown again lands in the phase the
// elapsed time implies. Under reduced motion the camera never moves and the ribbon is whole at
// once, shortening in tenths.
import { Vector3 } from "three";
import { arcMetres, bearingDegrees, unitVector, type LatLon } from "../../shared/geo";
import { clamp01, easeInOut, easePrint } from "../lib/motion";
import { blendArc, orbitPose, RADIUS, type Pose } from "./world";

const PULLBACK_MS = 450;
const UNSPOOL_MS = 625;
const RETURN_MS = 375;
const SEQUENCE_MS = PULLBACK_MS + UNSPOOL_MS + RETURN_MS;
const DELIVERED_FADE_MS = 250;
const REWIND_MS = 320;
const ARRIVED_M = 4;

export type ThreadPhase =
  | "idle"
  | "pullback"
  | "unspool"
  | "return"
  | "walking"
  | "arrived"
  | "handing"
  | "delivered"
  | "rewind";

export type Notch = "idle" | "bearing" | "stamp";

export interface Route {
  routeId: string;
  door: LatLon;
  doorUnit: Vector3;
  totalArc: number;
  home: string;
}

export function routeFrom(parcel: {
  route: { route_id: string; door: LatLon; total_arc_m: number };
  resident: { home: string };
}): Route {
  return {
    routeId: parcel.route.route_id,
    door: parcel.route.door,
    doorUnit: new Vector3(...unitVector(parcel.route.door)),
    totalArc: parcel.route.total_arc_m,
    home: parcel.resident.home,
  };
}

type Mode = "idle" | "waiting" | "sequence" | "route" | "delivered" | "rewind";

/** The part of the great circle from `a` to `b` that is drawn, as two unit vectors. */
export interface RibbonSpan {
  from: Vector3;
  to: Vector3;
  /** True when `to` is the door, so the thread rises to tie on at the door plate. */
  tiedToDoor: boolean;
}

export interface ThreadFrame {
  phase: ThreadPhase;
  notch: Notch;
  route: Route | null;
  arc: number;
  bearing: number;
  fraction: number;
  visible: number;
  ribbon: RibbonSpan | null;
  camera: Pose | null;
}

function slerpUnit(a: Vector3, b: Vector3, t: number): Vector3 {
  const angle = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
  if (angle < 1e-6) return a.clone();
  const s = Math.sin(angle);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * angle) / s)
    .addScaledVector(b, Math.sin(t * angle) / s)
    .normalize();
}

const tenthsUp = (f: number): number => Math.min(1, Math.ceil(f * 10 - 1e-9) / 10);

export class Thread {
  private mode: Mode = "idle";
  route: Route | null = null;
  private startAt = 0;
  private startUnit = new Vector3(0, 0, 1);
  private startPose: Pose | null = null;
  private orbit: Pose | null = null;
  private endedAt = 0;
  private endedVisible = 0;
  private endedSpan: RibbonSpan | null = null;
  handing = false;
  private lastVisible = 0;
  private lastSpan: RibbonSpan | null = null;
  private stamped = false;

  /** A parcel answer arrived: the sequence (or, under reduced motion, the walking route) begins at `at`. */
  begin(route: Route, at: number, reduced: boolean): void {
    this.route = route;
    this.handing = false;
    this.stamped = false;
    this.startAt = at;
    this.startPose = null;
    this.orbit = null;
    this.mode = reduced ? "route" : "waiting";
    if (reduced) this.startAt = -Infinity;
  }

  /** A parcel restored on load: no press, so no sequence. */
  resume(route: Route): void {
    this.begin(route, 0, true);
  }

  /** Reduced motion was switched on mid-sequence: straight to walking, camera over the shoulder. */
  settleForReducedMotion(): void {
    if (this.mode === "waiting" || this.mode === "sequence") this.mode = "route";
  }

  delivered(now: number): void {
    this.endedAt = now;
    this.endedVisible = this.lastVisible;
    this.endedSpan = this.lastSpan;
    this.mode = "delivered";
    this.handing = false;
    this.stamped = true;
  }

  /** A drop or a lapsed hold: the ribbon shrinks toward the door, then everything is idle. */
  rewind(now: number): void {
    if (this.mode === "idle") return;
    this.endedAt = now;
    this.endedVisible = this.lastVisible;
    this.endedSpan = this.lastSpan;
    this.mode = "rewind";
    this.handing = false;
  }

  get active(): boolean {
    return this.mode === "waiting" || this.mode === "sequence" || this.mode === "route";
  }

  /** True while the camera belongs to the thread (pull-back, unspool, return). */
  inSequence(now: number): boolean {
    return (this.mode === "waiting" || this.mode === "sequence") && now >= this.startAt && now < this.startAt + SEQUENCE_MS;
  }

  frame(now: number, courierUnit: Vector3, reduced: boolean, aspect: number, follow: () => Pose): ThreadFrame {
    const empty = (phase: ThreadPhase, notch: Notch): ThreadFrame => ({
      phase,
      notch,
      route: null,
      arc: 0,
      bearing: 0,
      fraction: 0,
      visible: 0,
      ribbon: null,
      camera: null,
    });
    if (this.mode === "waiting" && now >= this.startAt) {
      this.mode = "sequence";
      this.startUnit = courierUnit.clone();
    }
    if (this.mode === "sequence" && now >= this.startAt + SEQUENCE_MS) this.mode = "route";
    if (this.mode === "rewind" && (reduced || now >= this.endedAt + REWIND_MS)) {
      this.mode = "idle";
      this.route = null;
    }
    if (this.mode === "idle") return this.track(empty("idle", "idle"), null, 0);
    if (this.mode === "waiting") return this.track(empty("idle", "idle"), null, 0);

    const route = this.route!;
    const here = { lat: Math.asin(courierUnit.y) * (180 / Math.PI), lon: Math.atan2(courierUnit.x, courierUnit.z) * (180 / Math.PI) };
    const arc = arcMetres(RADIUS, here, route.door);
    const bearing = bearingDegrees(here, route.door);
    const exact = Math.min(1, arc / route.totalArc || 0);
    const fraction = reduced ? tenthsUp(exact) : exact;

    if (this.mode === "delivered") {
      const t = reduced ? 1 : clamp01((now - this.endedAt) / DELIVERED_FADE_MS);
      const visible = this.endedVisible * (1 - t);
      const span = t < 1 && this.endedSpan ? this.shrunk(this.endedSpan, 1 - t) : null;
      return this.track({ ...empty("delivered", "stamp"), route, visible, ribbon: span }, span, visible);
    }
    if (this.mode === "rewind") {
      const t = clamp01((now - this.endedAt) / REWIND_MS);
      const visible = this.endedVisible * (1 - t);
      const span = t < 1 && this.endedSpan ? this.shrunk(this.endedSpan, 1 - t) : null;
      return this.track({ ...empty("rewind", "idle"), route, arc, bearing, fraction, visible, ribbon: span }, span, visible);
    }
    const base = { route, arc, bearing, fraction, notch: "bearing" as Notch, camera: null as Pose | null };
    if (this.mode === "sequence") {
      const t = now - this.startAt;
      this.startPose ??= follow();
      this.orbit ??= orbitPose(this.startUnit, route.doorUnit, aspect);
      if (t < PULLBACK_MS) {
        const camera = blendArc(this.startPose, this.orbit, easeInOut(t / PULLBACK_MS));
        return this.track({ ...base, phase: "pullback", visible: 0, ribbon: null, camera }, null, 0);
      }
      if (t < PULLBACK_MS + UNSPOOL_MS) {
        const u = easePrint((t - PULLBACK_MS) / UNSPOOL_MS);
        const span = { from: this.startUnit.clone(), to: slerpUnit(this.startUnit, route.doorUnit, u), tiedToDoor: u >= 1 };
        return this.track({ ...base, phase: "unspool", visible: u, ribbon: span, camera: this.orbit }, span, u);
      }
      const r = (t - PULLBACK_MS - UNSPOOL_MS) / RETURN_MS;
      const camera = blendArc(this.orbit, follow(), easeInOut(r));
      const span = { from: courierUnit.clone(), to: route.doorUnit.clone(), tiedToDoor: true };
      return this.track({ ...base, phase: "return", visible: fraction, ribbon: span, camera }, span, fraction);
    }
    const phase: ThreadPhase = this.handing ? "handing" : arc <= ARRIVED_M ? "arrived" : "walking";
    const from = reduced ? this.alongFromDoor(courierUnit, fraction * route.totalArc) : courierUnit.clone();
    const span = { from, to: route.doorUnit.clone(), tiedToDoor: true };
    return this.track({ ...base, phase, visible: fraction, ribbon: span }, span, fraction);
  }

  get stampShown(): boolean {
    return this.stamped;
  }

  /** The thread's phase is idle again (after a rewind), or nothing was ever taken. */
  get idle(): boolean {
    return this.mode === "idle";
  }

  private track(frame: ThreadFrame, span: RibbonSpan | null, visible: number): ThreadFrame {
    if (frame.phase !== "delivered" && frame.phase !== "rewind") {
      this.lastSpan = span;
      this.lastVisible = visible;
    }
    if (frame.phase === "idle" && this.stamped) frame.notch = "stamp";
    return frame;
  }

  /** The span with only the part next to the door kept. */
  private shrunk(span: RibbonSpan, keep: number): RibbonSpan {
    return { from: slerpUnit(span.to, span.from, keep), to: span.to.clone(), tiedToDoor: span.tiedToDoor };
  }

  /** The point `metres` back from the door toward the courier along the great circle. */
  private alongFromDoor(courierUnit: Vector3, metres: number): Vector3 {
    const door = this.route!.doorUnit;
    const total = Math.acos(Math.max(-1, Math.min(1, door.dot(courierUnit)))) * RADIUS;
    if (total < 1e-3) return door.clone();
    return slerpUnit(door, courierUnit, metres / total);
  }
}
