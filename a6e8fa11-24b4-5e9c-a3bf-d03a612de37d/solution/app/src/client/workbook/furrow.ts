// The Recalc furrow (Motion and effects · Signature). After a committed cell edit, every closure cell
// lands in a wave by dependency depth — depth 1 at 0 ms, each deeper depth 60 ms later, depth 8 and
// beyond at 420 ms — gets a rust outline, and counts from its old value to its new one over 180 ms in
// its number format. Off-sheet tab badges rise as waves land; bound chart points move in their source
// cell's wave. Outlines fade together over 600 ms, starting 600 ms after the last wave. Every frame is
// scheduled up front as a timer at its own offset and drawn from that offset, so the furrow follows
// the page clock exactly and never depends on a self-rescheduling loop.
import { type ChartData } from "../../shared/engine.js";
import { type CellChange, type ChartChange, type CommitEffect } from "./session.js";

const WAVE_STEP_MS = 60;
const MAX_WAVE = 8;
const COUNT_MS = 180;
const HOLD_MS = 600;
const FADE_MS = 600;
const REDUCED_HOLD_MS = 1500;
const FRAME_MS = 16;

interface CellOverlay {
  display: string | null;
  outlined: boolean;
  fading: boolean;
}

const NONE: CellOverlay = { display: null, outlined: false, fading: false };

// The product's one easing, cubic-bezier(0.2, 0.8, 0.2, 1) — the same curve as the stylesheet's
// `--ease` — solved for the bezier parameter whose x is the elapsed fraction.
const X1 = 0.2;
const Y1 = 0.8;
const X2 = 0.2;
const Y2 = 1;
const bezier = (t: number, a: number, b: number): number => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
const ease = (p: number): number => {
  if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, X1, X2) < p) lo = mid;
    else hi = mid;
  }
  return bezier((lo + hi) / 2, Y1, Y2);
};

const waveOf = (depth: number): number => Math.min(Math.max(depth, 0), MAX_WAVE);
/** Depth 1 lands at 0 ms; the edited cell itself (depth 0) moves at 0 ms too. */
const landingMs = (depth: number): number => Math.max(0, waveOf(depth) - 1) * WAVE_STEP_MS;

interface Running {
  cells: Array<CellChange & { key: string; landAt: number }>;
  charts: ChartChange[];
  lastLanding: number;
  currentSheet: string;
}

export class Furrow {
  private overlays = new Map<string, CellOverlay>();
  private keyListeners = new Map<string, Set<() => void>>();
  private listeners = new Set<() => void>();
  private running: Running | null = null;
  private frames: Array<ReturnType<typeof setTimeout>> = [];
  private reducedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Off-sheet change badges, by sheet id. */
  badges = new Map<string, number>();
  /** The last committed edit's closure, as "<ref> <old> → <new>". */
  changedLines: string[] = [];
  announcement = "";
  /** Chart values while bars and points move, by chart id. */
  chartValues = new Map<string, ChartData>();
  private version = 0;

  constructor(private readonly formatIn: (sheetId: string, cell: string, value: number) => string) {}

  // ---- subscriptions ----

  subscribeCell = (key: string, listener: () => void): (() => void) => {
    let set = this.keyListeners.get(key);
    if (!set) this.keyListeners.set(key, (set = new Set()));
    set.add(listener);
    return () => set?.delete(listener);
  };

  cell = (key: string): CellOverlay => this.overlays.get(key) ?? NONE;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private set(key: string, next: CellOverlay | null): void {
    const before = this.overlays.get(key) ?? NONE;
    const after = next ?? NONE;
    if (before.display === after.display && before.outlined === after.outlined && before.fading === after.fading) return;
    if (next) this.overlays.set(key, next);
    else this.overlays.delete(key);
    for (const l of this.keyListeners.get(key) ?? []) l();
  }

  // ---- playing ----

  /** Ends the current furrow at once: outlines go, values show their final state. */
  private finish(): void {
    for (const f of this.frames) clearTimeout(f);
    this.frames = [];
    if (this.reducedTimer) clearTimeout(this.reducedTimer);
    this.reducedTimer = null;
    for (const key of [...this.overlays.keys()]) this.set(key, null);
    this.running = null;
    this.chartValues.clear();
  }

  clearBadge(sheetId: string): void {
    if (!this.badges.has(sheetId)) return;
    this.badges.delete(sheetId);
    this.emit();
  }

  play(effect: CommitEffect, currentSheet: string, reduced: boolean, announce: string): void {
    this.finish();
    this.badges.clear();
    this.changedLines = effect.changes.map((c) => `${c.ref} ${c.before.display} → ${c.after.display}`);
    this.announcement = announce;
    const cells = effect.changes.map((c) => ({ ...c, key: `${c.sheetId}!${c.cell}`, landAt: landingMs(c.depth) }));
    if (reduced) {
      for (const c of cells) {
        this.set(c.key, { display: null, outlined: true, fading: false });
        if (c.sheetId !== currentSheet) this.badges.set(c.sheetId, (this.badges.get(c.sheetId) ?? 0) + 1);
      }
      this.reducedTimer = setTimeout(() => this.finish(), REDUCED_HOLD_MS);
      this.emit();
      return;
    }
    for (const c of cells) this.set(c.key, { display: c.before.display, outlined: false, fading: false });
    for (const chart of effect.charts) this.chartValues.set(chart.chartId, { categories: chart.after.categories, series: chart.before.series });
    this.running = {
      cells,
      charts: effect.charts,
      lastLanding: Math.max(0, ...cells.map((c) => c.landAt)),
      currentSheet,
    };
    const end = this.running.lastLanding + HOLD_MS + FADE_MS;
    const offsets = new Set<number>([end, this.running.lastLanding + HOLD_MS, ...cells.map((c) => c.landAt), ...cells.map((c) => c.landAt + COUNT_MS)]);
    for (let t = 0; t < end; t += FRAME_MS) offsets.add(t);
    this.draw(0);
    for (const t of [...offsets].filter((o) => o > 0).sort((a, b) => a - b)) this.frames.push(setTimeout(() => this.draw(t), t));
  }

  /** Draws the furrow as it stands `elapsed` ms after the commit. */
  private draw(elapsed: number): void {
    const run = this.running;
    if (!run) return;
    const fadeAt = run.lastLanding + HOLD_MS;
    if (elapsed >= fadeAt + FADE_MS) {
      this.finish();
      this.emit();
      return;
    }
    const fading = elapsed >= fadeAt;
    const badges = new Map<string, number>();
    for (const c of run.cells) {
      if (elapsed < c.landAt) continue;
      if (c.sheetId !== run.currentSheet) badges.set(c.sheetId, (badges.get(c.sheetId) ?? 0) + 1);
      const p = Math.min(1, (elapsed - c.landAt) / COUNT_MS);
      const from = c.before.value;
      const to = c.after.value;
      const display = typeof from === "number" && typeof to === "number" && p < 1 ? this.formatIn(c.sheetId, c.cell, from + (to - from) * ease(p)) : c.after.display;
      this.set(c.key, { display, outlined: true, fading });
    }
    for (const chart of run.charts) {
      const series = chart.after.series.map((s, i) => ({
        name: s.name,
        values: s.values.map((to, j) => {
          const from = chart.before.series[i]?.values[j] ?? null;
          const depth = chart.depths.get(`${i}:${j}`);
          if (depth === undefined || from === null || to === null) return to;
          const p = Math.min(1, Math.max(0, (elapsed - landingMs(depth)) / COUNT_MS));
          return from + (to - from) * ease(p);
        }),
      }));
      this.chartValues.set(chart.chartId, { categories: chart.after.categories, series });
    }
    const changed = badges.size !== this.badges.size || [...badges].some(([k, v]) => this.badges.get(k) !== v);
    if (changed) this.badges = badges;
    this.emit();
  }
}
