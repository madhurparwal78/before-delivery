import { CHAPTERS, chapterAt, type ChapterId, type FinishId, type HubId, type ModelId } from "../shared/catalogue.js";
import { STATUS } from "../shared/copy.js";
import { displayText, lockedLock, parseRoomUrl, partFits, roomUrl, type RoomUrl } from "../shared/derive.js";
import { EASING } from "../shared/motion.js";
import { clamp01, seatOffsets } from "../shared/stage.js";
import { follow, room } from "./live.js";
import { RANK, announce } from "./status.js";
import { runStep, stepLog, stepRunning, clearStepLog } from "./steps.js";
import { Store } from "./store.js";
import type { Scene, SceneSnapshot } from "./scene.js";

/** The long page's controller: scroll to progress, the URL, the three modes and the probe the verifier reads. */

type Mode = "webgl" | "fallback" | "reduced";
type StageState = { model: ModelId; hub: HubId; finish: FinishId; ch: ChapterId; part: string | null; progress: number; mode: Mode; paused: boolean; settled: boolean };

export const stage = new Store<StageState>({ model: "megh-349", hub: "pune", finish: "monsoon-slate", ch: "frame", part: null, progress: 0, mode: "webgl", paused: false, settled: false });

const SCROLL_TRAVEL = 7;
const URL_MS = 200;
const DAMPING = 0.12;
const STATEMENT_RATE = 0.35;

let scene: Scene | null = null;
let elements: { canvas: HTMLCanvasElement; label: HTMLElement | null; cover: HTMLElement | null; statement: HTMLElement | null } | null = null;
let ownsUrl = false;
let urlTimer: ReturnType<typeof setTimeout> | null = null;
let lastWrite = 0;
let wheelTarget: number | null = null;
let wheelFrame = 0;
let wheelLast = 0;
let wheelPos = 0;
let jumpStep: { cancel: () => void } | null = null;
let stopped = true;
let restoring = false;

export function seedStage(url: RoomUrl): void {
  stage.set({ model: url.model, hub: url.hub, finish: url.finish, ch: url.ch, part: url.part, progress: url.at });
}

const reducedQuery = (): MediaQueryList => window.matchMedia("(prefers-reduced-motion: reduce)");
const stageEl = (): HTMLElement | null => document.querySelector<HTMLElement>(".stage");
const stageTop = (): number => (stageEl()?.getBoundingClientRect().top ?? 0) + window.scrollY;
const travel = (): number => SCROLL_TRAVEL * window.innerHeight;
const scrollFor = (progress: number): number => stageTop() + progress * travel();
const progressFromScroll = (): number => clamp01((window.scrollY - stageTop()) / travel());

function setMode(mode: Mode): void {
  document.documentElement.dataset.mode = mode;
  stage.set({ mode });
}

// --- state to the scene and the URL

function push(): void {
  const s = stage.get();
  scene?.setInputs({ progress: s.progress, model: s.model, finish: s.finish, part: s.part, reading: room.get().drawn, reduced: s.mode === "reduced" });
}

function shiftStatement(): void {
  const el = elements?.statement;
  if (!el) return;
  const s = stage.get();
  if (s.mode !== "webgl") {
    el.style.transform = "";
    return;
  }
  const chapter = CHAPTERS.find((c) => c.id === s.ch) as (typeof CHAPTERS)[number];
  const from = scrollFor(chapter.from);
  el.style.transform = `translateY(${-STATEMENT_RATE * (window.scrollY - from)}px)`;
}

function scheduleUrl(): void {
  if (!ownsUrl || urlTimer) return;
  const wait = Math.max(0, URL_MS - (performance.now() - lastWrite));
  urlTimer = setTimeout(() => {
    urlTimer = null;
    lastWrite = performance.now();
    const s = stage.get();
    if (location.pathname === "/" && window.scrollY < stageTop() - 1 && !reachedStage) return;
    reachedStage = true;
    const next = roomUrl({ model: s.model, hub: s.hub, finish: s.finish, ch: s.ch, part: s.part, at: s.progress });
    if (location.pathname + location.search !== next) history.replaceState(history.state, "", next);
  }, wait);
}
let reachedStage = false;

function change(patch: Partial<StageState>): void {
  const before = stage.get();
  const next = { ...before, ...patch };
  const chapter = chapterAt(next.progress).id;
  next.ch = chapter;
  if (next.part && !partFits(next.part, next.progress)) next.part = null;
  stage.set(next);
  if (next.model !== before.model || next.hub !== before.hub || next.finish !== before.finish) follow({ hub: next.hub, model: next.model, finish: next.finish });
  push();
  shiftStatement();
  scheduleUrl();
}

// --- progress

function onScroll(): void {
  const s = stage.get();
  if (restoring || s.paused || s.mode !== "webgl") return;
  const progress = progressFromScroll();
  if (progress >= 0 && (window.scrollY >= stageTop() - 1 || reachedStage)) reachedStage = true;
  change({ progress });
}

/** Wheel input is damped over native scroll: each frame closes 12% of the remaining gap, worked out from elapsed time. */
function onWheel(event: WheelEvent): void {
  const s = stage.get();
  if (s.mode !== "webgl" || event.ctrlKey || document.getElementById("page")?.hasAttribute("inert")) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("[role=listbox], .toolbar, select, textarea, .layer, .nav")) return;
  event.preventDefault();
  jumpStep?.cancel();
  jumpStep = null;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (wheelTarget === null) wheelPos = window.scrollY;
  wheelTarget = Math.min(max, Math.max(0, (wheelTarget ?? window.scrollY) + event.deltaY * unit));
  if (!wheelFrame) {
    wheelLast = performance.now();
    wheelFrame = requestAnimationFrame(dampStep);
  }
}

function dampStep(): void {
  wheelFrame = 0;
  if (wheelTarget === null) return;
  const now = performance.now();
  const dt = Math.max(1, now - wheelLast);
  wheelLast = now;
  const k = 1 - (1 - DAMPING) ** (dt / (1000 / 60));
  let y = wheelPos + (wheelTarget - wheelPos) * k;
  if (Math.abs(wheelTarget - y) < 0.6) y = wheelTarget;
  wheelPos = y;
  window.scrollTo(0, y);
  if (y === wheelTarget || Math.abs(window.scrollY - y) > 3) {
    wheelTarget = null;
    return;
  }
  wheelFrame = requestAnimationFrame(dampStep);
}

/** Progress follows the scroll position on every animation frame, so it never waits on the browser's scroll event. */
let lastScroll = -1;
function followScroll(): void {
  if (stopped) return;
  requestAnimationFrame(followScroll);
  const y = window.scrollY;
  if (y === lastScroll) return;
  lastScroll = y;
  onScroll();
}

function onResize(): void {
  const s = stage.get();
  if (s.mode !== "webgl" || s.paused || !stepsDone()) return;
  window.scrollTo(0, scrollFor(s.progress));
  shiftStatement();
}

const stepsDone = (): boolean => !stepRunning("camera-to-part");

/** Eases the page to a progress over the camera step; the scroll position, the camera and the URL all follow. */
function glideTo(progress: number): void {
  jumpStep?.cancel();
  const from = window.scrollY;
  const to = scrollFor(progress);
  wheelTarget = null;
  jumpStep = runStep(
    "camera-to-part",
    (e) => window.scrollTo(0, from + (to - from) * e),
    () => {
      jumpStep = null;
    },
  );
}

export function jumpTo(id: ChapterId): void {
  const s = stage.get();
  if (s.paused) return;
  const target = (CHAPTERS.find((c) => c.id === id) as (typeof CHAPTERS)[number]).jump;
  if (s.mode === "webgl") glideTo(target);
  else change({ progress: target });
}

export function selectPart(id: string | null): void {
  const s = stage.get();
  if (s.paused) return;
  change({ part: s.part === id ? null : id });
}

export function choose(patch: Partial<Pick<StageState, "model" | "hub" | "finish">>): void {
  change(patch);
}

/** Applies a URL's pose: scroll and progress agree before the first interaction. */
export function applyUrl(search: string, path: string): void {
  const url = parseRoomUrl(search);
  const wantsStage = path === "/showroom" || /[?&](at|ch|part)=/.test(search);
  const s = stage.get();
  ownsUrl = true;
  reachedStage = wantsStage;
  stage.set({ model: url.model, hub: url.hub, finish: url.finish, part: url.part, progress: url.at, ch: url.ch });
  if (url.model !== s.model || url.hub !== s.hub || url.finish !== s.finish) follow({ hub: url.hub, model: url.model, finish: url.finish });
  if (wantsStage) window.scrollTo(0, stage.get().mode === "webgl" ? scrollFor(url.at) : stageTop());
  push();
  shiftStatement();
  if (wantsStage) scheduleUrl();
}

// --- the probe

function drawn(): Record<string, unknown> {
  const r = room.get().drawn;
  const s = stage.get();
  if (!r) return { seq: null, unitsLeft: null, onRoadPaise: null, lockExpiresAt: null, nextSlot: null, finish: s.finish, display: "" };
  return {
    seq: r.seq,
    unitsLeft: r.unitsLeft,
    onRoadPaise: r.quote.onRoadPaise,
    lockExpiresAt: lockedLock(r)?.expiresAt ?? null,
    nextSlot: r.nextSlot?.startsAt ?? null,
    finish: s.finish,
    display: displayText(r),
  };
}

function snapshot(): Record<string, unknown> {
  const s = stage.get();
  const inner: SceneSnapshot | null = scene ? scene.snapshot() : null;
  const none = { x: 0, y: 0 };
  return {
    mode: s.mode,
    paused: s.paused,
    progress: s.progress,
    chapter: s.ch,
    part: s.part,
    camera: inner?.camera ?? { x: 0, y: 0, z: 0 },
    seatOffsets: seatOffsets(s.progress),
    keyedOn: inner?.keyedOn ?? false,
    needleDeg: inner?.needleDeg ?? -135,
    lamp: inner?.lamp ?? false,
    drawn: drawn(),
    probes: inner?.probes ?? { tank: none, lamp: none, needleTip: none, display: { x: 0, y: 0, w: 0, h: 0 } },
    geometry: inner?.geometry ?? geometryFor(s.model),
    steps: stepLog(),
    easing: EASING,
  };
}

const geometryFor = (model: ModelId): Record<string, string | number> => ({
  wheelbaseMm: model === "desh-648" ? 1465 : 1440,
  cylinders: model === "desh-648" ? 2 : 1,
  silencers: model === "desh-648" ? 2 : 1,
  rakeDeg: 26,
  frontRimIn: 19,
  rearRimIn: 17,
  sideStandSide: "left",
  chainSide: "left",
  exhaustSide: "right",
  leanDeg: 8,
  leanSide: "left",
});

// --- start and stop

function onPause(paused: boolean): void {
  stage.set({ paused });
  announce(paused ? STATUS.paused : STATUS.back, RANK.other);
  if (!paused) {
    const s = stage.get();
    if (s.mode === "webgl") window.scrollTo(0, scrollFor(s.progress));
    push();
  }
}

/** Starts the stage on the page's canvas: scroll, wheel, resize, reduced-motion changes and the scene itself. */
export async function startStage(refs: NonNullable<typeof elements>): Promise<() => void> {
  elements = refs;
  stopped = false;
  clearStepLog();
  history.scrollRestoration = "manual";
  const query = reducedQuery();
  const reduced = query.matches;
  setMode(reduced ? "reduced" : "webgl");
  window.addEventListener("scroll", onScroll, { passive: true });
  requestAnimationFrame(followScroll);
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", onResize);
  const onMotion = (): void => {
    const s = stage.get();
    const nowReduced = query.matches;
    if (nowReduced === (s.mode === "reduced") || s.mode === "fallback") return;
    jumpStep?.cancel();
    const kept = stage.get().progress;
    restoring = true;
    setMode(nowReduced ? "reduced" : "webgl");
    push();
    // the stage changes height with the mode: restore the scroll once that layout has settled
    requestAnimationFrame(() => {
      if (!nowReduced) window.scrollTo(0, scrollFor(kept));
      restoring = false;
      change({ progress: kept });
    });
  };
  query.addEventListener("change", onMotion);
  applyUrl(location.search, location.pathname);

  const loaded = await import("./scene.js");
  if (stopped) return () => undefined;
  try {
    scene = new loaded.Scene(refs.canvas, refs.label, refs.cover, onPause, { progress: stage.get().progress, model: stage.get().model, finish: stage.get().finish, part: stage.get().part, reading: room.get().drawn, reduced });
  } catch {
    scene = null;
    setMode("fallback");
    announce(STATUS.noWebgl, RANK.other);
  }
  push();
  const unsubscribe = room.subscribe(push);
  window.__showroom = { snapshot };
  follow({ hub: stage.get().hub, model: stage.get().model, finish: stage.get().finish });
  return () => {
    stopped = true;
    unsubscribe();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("resize", onResize);
    query.removeEventListener("change", onMotion);
    scene?.dispose();
    scene = null;
    elements = null;
    ownsUrl = false;
    if (urlTimer) clearTimeout(urlTimer);
    urlTimer = null;
    jumpStep?.cancel();
    delete window.__showroom;
    document.documentElement.removeAttribute("data-mode");
  };
}

declare global {
  interface Window {
    __showroom?: { snapshot: () => Record<string, unknown> };
  }
}

