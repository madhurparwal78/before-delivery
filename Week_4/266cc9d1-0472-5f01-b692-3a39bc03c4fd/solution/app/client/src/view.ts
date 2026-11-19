// The corridor view: playhead, drone, selection, camera chase and the URL. It is the one place that
// decides which flight answer is current: only the answer to the latest scrub input is applied.
import { api, ApiFailure, type Finding, type FlightAnswer } from "./api";
import { CHASE_MS, CHASE_UP_COVERED_M, CHASE_UP_GROUND_M, easeOutCubic, easeOutQuart, FLY_MS, formatCam, lookingAt, parseCam, type CameraRig, type Pose } from "./camera";
import { clampChainage, type CorridorShape } from "./corridorMath";
import { inverse, pointAt } from "../../shared/geodesy";

type Covered = Extract<FlightAnswer, { covered: true }>;
export type Drone = { kind: "locating" } | { kind: "placed"; answer: Covered } | { kind: "uncovered" };

interface ViewSnapshot {
  chainageM: number;
  glide: boolean;
  drone: Drone;
  selectedId: string | null;
}

/** How a scrub input arrived: a drag (pointer follows), a press/step (glide), or a jump to a finding. */
export type InputKind = "drag" | "press" | "step" | "select" | "fly";

type Query = { chainageM: number } | { time: string };

const FAR_M = 600;
const CAM_STILL_MS = 500;

interface ViewOptions {
  shape: CorridorShape;
  rig: CameraRig;
  flightPath: string;
  findings: () => Finding[];
  onAnnounce: (text: string) => void;
  onFailure: (failure: ApiFailure) => void;
}

interface UrlView {
  ch: number | null;
  t: string | null;
  f: string | null;
  cam: Pose | null;
}

export function readUrl(): UrlView {
  const q = new URLSearchParams(location.search);
  const ch = q.get("ch");
  const parsed = ch === null || ch.trim() === "" ? Number.NaN : Number(ch);
  return { ch: Number.isFinite(parsed) ? parsed : null, t: q.get("t"), f: q.get("f"), cam: parseCam(q.get("cam")) };
}

function selectionAnnouncement(finding: Finding): string {
  return `Selected ${finding.label}, ${finding.span.label}, chainage ${finding.chainage_m.toFixed(1)} m.`;
}

export class CorridorView {
  private state: ViewSnapshot;
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  private inFlight = false;
  private queuedDrag: { seq: number; query: Query } | null = null;
  private committedSeq = -1;
  private keepCameraFor = -1;
  private nextDuration = CHASE_MS;
  private camTimer = 0;
  private readonly unsubscribeRig: () => void;

  constructor(private readonly options: ViewOptions) {
    this.state = { chainageM: 0, glide: false, drone: { kind: "locating" }, selectedId: null };
    this.unsubscribeRig = options.rig.subscribe(() => this.scheduleCamWrite());
  }

  dispose(): void {
    this.unsubscribeRig();
    clearTimeout(this.camTimer);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ViewSnapshot => this.state;

  private set(patch: Partial<ViewSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** One scrub input: the playhead moves at once, the drone goes to locating, and the flight endpoint is asked. */
  scrub(chainageM: number, kind: InputKind): void {
    const chainage = clampChainage(this.options.shape, chainageM);
    const target = pointAt(this.options.shape.line, chainage, 0);
    const camera = this.options.rig.pose;
    const far = inverse({ lonDeg: camera.lonDeg, latDeg: camera.latDeg }, target).distanceM > FAR_M;
    this.nextDuration = kind === "fly" || (kind === "select" && far) ? FLY_MS : CHASE_MS;
    this.seq += 1;
    this.set({ chainageM: chainage, glide: kind !== "drag", drone: { kind: "locating" } });
    this.ask(this.seq, { chainageM: chainage }, kind === "drag");
    if (kind === "step" || kind === "fly" || kind === "press") this.commit("replace");
  }

  /** Pointer release ends a drag: the URL takes the playhead. */
  release(): void {
    this.commit("replace");
  }

  /** A user selection: playhead to the finding, the scrub sequence, a new history entry and the announcement. */
  select(id: string): void {
    const finding = this.options.findings().find((f) => f.id === id);
    if (finding === undefined) return;
    this.state = { ...this.state, selectedId: id };
    this.scrub(finding.chainage_m, "select");
    this.commit("push");
    this.options.onAnnounce(selectionAnnouncement(finding));
  }

  /** Opening a URL (or going back or forward): that exact playhead, drone time, selection and camera. */
  open(url: UrlView): void {
    const exists = url.f !== null && this.options.findings().some((f) => f.id === url.f);
    const chainage = clampChainage(this.options.shape, url.ch ?? 0);
    this.seq += 1;
    this.nextDuration = CHASE_MS;
    this.committedSeq = this.seq;
    if (url.cam !== null) {
      this.keepCameraFor = this.seq;
      this.options.rig.jumpTo(url.cam);
    }
    this.set({ chainageM: chainage, glide: true, drone: { kind: "locating" }, selectedId: exists ? url.f : null });
    this.ask(this.seq, url.t !== null ? { time: url.t } : { chainageM: chainage }, false);
  }

  private ask(seq: number, query: Query, dragging: boolean): void {
    if (dragging && this.inFlight) {
      this.queuedDrag = { seq, query };
      return;
    }
    this.inFlight = true;
    const search = "chainageM" in query ? `chainage_m=${query.chainageM.toFixed(1)}` : `time=${encodeURIComponent(query.time)}`;
    api<FlightAnswer>("GET", `${this.options.flightPath}?${search}`)
      .then((answer) => {
        if (seq === this.seq) this.apply(seq, answer);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) this.options.onFailure(error);
      })
      .finally(() => {
        this.inFlight = false;
        const queued = this.queuedDrag;
        this.queuedDrag = null;
        if (queued !== null && queued.seq === this.seq) this.ask(queued.seq, queued.query, false);
      });
  }

  private apply(seq: number, answer: FlightAnswer): void {
    this.set({ drone: answer.covered ? { kind: "placed", answer } : { kind: "uncovered" } });
    if (this.keepCameraFor !== seq) {
      const pose = this.chasePose(answer);
      const fly = this.nextDuration === FLY_MS;
      this.options.rig.easeTo(pose, this.nextDuration, fly ? easeOutQuart : easeOutCubic, fly);
    }
    if (this.committedSeq === seq) this.commit("replace");
  }

  /** Covered: 150 m behind the marker along the centreline, 80 m above it. Not covered: 150 m behind the ground at the playhead, 60 m above it. */
  private chasePose(answer: FlightAnswer): Pose {
    const { shape, rig } = this.options;
    const playhead = this.state.chainageM;
    if (answer.covered) {
      const markerChainage = answer.chainage_m ?? playhead;
      const marker = { lonDeg: answer.position.lon_deg, latDeg: answer.position.lat_deg, heightM: answer.position.height_m };
      return rig.clampAboveGround(lookingAt(shape, markerChainage, marker, CHASE_UP_COVERED_M), markerChainage);
    }
    const foot = pointAt(shape.line, playhead, 0);
    const ground = rig.groundAt(foot.lonDeg, foot.latDeg, playhead);
    return rig.clampAboveGround(lookingAt(shape, playhead, { ...foot, heightM: ground }, CHASE_UP_GROUND_M), playhead);
  }

  private params(): URLSearchParams {
    const q = new URLSearchParams();
    q.set("ch", this.state.chainageM.toFixed(1));
    if (this.state.drone.kind === "placed") q.set("t", this.state.drone.answer.time);
    if (this.state.selectedId !== null) q.set("f", this.state.selectedId);
    q.set("cam", formatCam(this.options.rig.pose));
    return q;
  }

  private commit(mode: "push" | "replace"): void {
    this.committedSeq = this.seq;
    const url = `${location.pathname}?${this.params().toString()}`;
    if (mode === "push") history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }

  /** The camera is written into the URL once it has been still for half a second; always a replace. */
  private scheduleCamWrite(): void {
    clearTimeout(this.camTimer);
    this.camTimer = window.setTimeout(() => {
      const q = new URLSearchParams(location.search);
      q.set("cam", formatCam(this.options.rig.pose));
      history.replaceState(null, "", `${location.pathname}?${q.toString()}`);
    }, CAM_STILL_MS);
  }
}
