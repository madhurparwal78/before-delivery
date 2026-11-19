import { el, prefersReducedMotion, setAttribute } from '../dom.js';
import { BINS, STRIP_HEIGHT, TerrainScene, type CrestMode } from './scene.js';
import type { FieldState, SessionState, SpectrumView } from '../../shared/types.js';

const GROUND_CSS = '#08090b';
const BAR_CSS: Record<CrestMode, string> = { live: '#3ddc97', closed: '#c9ced6', halted: '#5b626d' };

const RISE_SECONDS = 0.05;
const FALL_SECONDS = 0.25;

const fieldStateOf = (state: SessionState | null): FieldState => {
  if (state === null) return 'idle';
  if (state === 'closed' || state === 'idle_closed') return 'closed';
  if (state === 'quota_halted' || state === 'revoked') return 'quota_halted';
  return state;
};

const crestOf = (state: FieldState): CrestMode => {
  if (state === 'live' || state === 'connecting') return 'live';
  if (state === 'quota_halted') return 'halted';
  return 'closed';
};

export interface FieldOptions {
  /** Supplies a fresh spectrum reading for the still fallback's once-a-second redraw. */
  readonly spectrum?: () => Promise<SpectrumView>;
  readonly surfaceClass?: string;
}

/**
 * The session field: a WebGL history terrain with its readback strip, or a still
 * 2D strip of the mean spectrum when WebGL is unavailable. Both carry the same
 * accessible name and the same four data attributes.
 */
export class SessionField {
  readonly node: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly usesFallback: boolean;
  private readonly scene: TerrainScene | null;
  private readonly context2d: CanvasRenderingContext2D | null = null;
  private readonly options: FieldOptions;
  private readonly bars = new Float32Array(BINS);
  private target = new Float32Array(BINS);
  private pending: { frame: number; peak: number; bins: readonly number[] } | null = null;
  private drawnFrame = 0;
  private peak = 0;
  private meanRow: readonly number[] = [];
  private state: FieldState = 'idle';
  private serverState: SessionState | null = null;
  private raf = 0;
  private lastTick = 0;
  private stepAccumulator = 0;
  private fallbackTimer = 0;
  private stopped = false;

  constructor(options: FieldOptions = {}) {
    this.options = options;
    this.canvas = el('canvas', { role: 'img', 'aria-label': 'Session field', class: 'field-canvas' });
    this.node = el('div', { class: `field-surface ${options.surfaceClass ?? ''}`.trim() }, [this.canvas]);
    this.scene = TerrainScene.create(this.canvas);
    this.usesFallback = this.scene === null;
    if (this.scene === null) this.context2d = this.canvas.getContext('2d');
    this.writeAttributes();
    new ResizeObserver(() => this.resize()).observe(this.node);
    this.raf = requestAnimationFrame((time) => this.tick(time));
    if (this.usesFallback) this.startFallbackRefresh();
  }

  private writeAttributes(): void {
    setAttribute(this.canvas, 'data-session-state', this.state);
    setAttribute(this.canvas, 'data-end-state', this.serverState ?? 'idle');
    setAttribute(this.canvas, 'data-frame', String(this.drawnFrame));
    setAttribute(this.canvas, 'data-peak-bin', String(this.peak));
  }

  private resize(): void {
    const width = Math.max(1, Math.round(this.node.clientWidth));
    const height = Math.max(STRIP_HEIGHT + 1, Math.round(this.node.clientHeight));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.scene?.resize(width, height);
    if (this.usesFallback) this.drawStill();
  }

  setSessionState(state: SessionState | null): void {
    this.serverState = state;
    const next = fieldStateOf(state);
    const changed = next !== this.state;
    this.state = next;
    this.scene?.setMode(crestOf(next), prefersReducedMotion() || !changed);
    this.writeAttributes();
    if (this.usesFallback) {
      this.startFallbackRefresh();
      this.drawStill();
    }
  }

  /** Each frame event offers the newest row; the loop draws it at the published rate. */
  setFrame(frame: number, peakBin: number, bins: readonly number[]): void {
    this.pending = { frame, peak: peakBin, bins };
  }

  /** A closed session shows its stored rows and mirrors the last of them. */
  setStoredSpectrum(spectrum: SpectrumView): void {
    this.scene?.setRows(spectrum.rows);
    const last = spectrum.rows[spectrum.rows.length - 1] ?? spectrum.mean;
    this.target = Float32Array.from({ length: BINS }, (_, i) => last[i] ?? 0);
    this.bars.set(this.target);
    this.drawnFrame = spectrum.frame;
    this.peak = spectrum.peak_bin;
    this.writeAttributes();
    if (this.usesFallback) this.drawMean(spectrum.mean);
  }

  private stepInterval(): number {
    return prefersReducedMotion() ? 1 : 1 / 30;
  }

  private tick(time: number): void {
    if (this.stopped) return;
    const dt = this.lastTick === 0 ? 0 : Math.min(0.25, (time - this.lastTick) / 1000);
    this.lastTick = time;
    this.stepAccumulator += dt;

    if (this.stepAccumulator >= this.stepInterval()) {
      this.stepAccumulator = 0;
      const next = this.pending;
      if (next !== null) {
        this.pending = null;
        this.drawnFrame = next.frame;
        this.peak = next.peak;
        this.target = Float32Array.from({ length: BINS }, (_, i) => next.bins[i] ?? 0);
        this.scene?.pushRow(next.bins);
        if (prefersReducedMotion()) this.bars.set(this.target);
        this.writeAttributes();
      }
    }

    if (!prefersReducedMotion()) this.advanceBars(dt);
    if (this.scene !== null) this.scene.render(dt, Array.from(this.bars));
    this.raf = requestAnimationFrame((next) => this.tick(next));
  }

  /** Bars rise within a twentieth of a second and fall back over a quarter, then sit exactly. */
  private advanceBars(dt: number): void {
    for (let i = 0; i < BINS; i += 1) {
      const current = this.bars[i] as number;
      const want = this.target[i] as number;
      const delta = want - current;
      if (delta === 0) continue;
      const step = dt / (delta > 0 ? RISE_SECONDS : FALL_SECONDS);
      this.bars[i] = Math.abs(delta) <= step ? want : current + Math.sign(delta) * step;
    }
  }

  private startFallbackRefresh(): void {
    window.clearInterval(this.fallbackTimer);
    const live = this.state === 'connecting' || this.state === 'live';
    if (!live || this.options.spectrum === undefined) return;
    this.fallbackTimer = window.setInterval(() => {
      void this.options.spectrum?.().then((spectrum) => {
        this.drawnFrame = spectrum.frame;
        this.peak = spectrum.peak_bin;
        this.writeAttributes();
        this.drawMean(spectrum.mean);
      });
    }, 1000);
  }

  private drawMean(mean: readonly number[]): void {
    this.meanRow = mean;
    this.drawStill();
  }

  /** The still draws the mean spectrum under the same column and height contract. */
  private drawStill(): void {
    const context = this.context2d;
    if (context === null) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    context.fillStyle = GROUND_CSS;
    context.fillRect(0, 0, width, height);
    context.fillStyle = BAR_CSS[crestOf(this.state)];
    for (let i = 0; i < BINS; i += 1) {
      const from = Math.floor((i * width) / BINS);
      const to = Math.floor(((i + 1) * width) / BINS) - 1;
      if (to < from) continue;
      const lit = Math.min(STRIP_HEIGHT, Math.round((this.meanRow[i] ?? 0) * STRIP_HEIGHT));
      if (lit <= 0) continue;
      context.fillRect(from, height - lit, to - from + 1, lit);
    }
  }

  destroy(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.fallbackTimer);
  }
}
