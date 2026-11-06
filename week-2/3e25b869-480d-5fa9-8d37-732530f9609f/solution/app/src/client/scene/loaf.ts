// The "Wire through the loaf" scene: scroll drives the wire and the cut step, the loaf answers stock,
// pointer and preference changes, and the figure publishes its state as data attributes.
import type { Tint } from '../../shared/catalog.js';
import type { BarStatus } from '../types';
import { barSpans, type Camera, deepLinkY, fit, loafBand, scrollValues } from './geometry';
import { type BarPose, LoafRenderer } from './renderer';

const LONG_MS = 600;
const MEDIUM_MS = 320;
const YAW_EDGE = 12;
const LETTER: Record<BarStatus, string> = { available: 'A', held: 'H', sold: 'S' };

/** Starts fast and settles softly, without overshoot. */
const easeOut = (t: number) => 1 - (1 - t) ** 4;

class Tween {
  private from: number;
  private to: number;
  private start = 0;
  private duration = 0;

  constructor(value: number) {
    this.from = value;
    this.to = value;
  }

  value(now: number): number {
    if (!this.running(now)) return this.to;
    return this.from + (this.to - this.from) * easeOut((now - this.start) / this.duration);
  }

  running(now: number): boolean {
    return this.duration > 0 && now < this.start + this.duration;
  }

  target(): number {
    return this.to;
  }

  /** Moves toward `to` over `duration`; returns whether a motion started. */
  go(to: number, now: number, duration: number): boolean {
    if (to === this.to) return false;
    this.from = this.value(now);
    this.to = to;
    this.start = now;
    this.duration = duration;
    return duration > 0;
  }

  finish(): void {
    this.from = this.to;
    this.duration = 0;
  }
}

interface Bar {
  status: BarStatus;
  tip: Tween;
  wrap: Tween;
  presence: Tween;
}

interface SceneBatch {
  code: string;
  tint: Tint;
  bars: BarStatus[];
}

interface SceneLabels {
  caption: (c: number, n: number) => string;
  diagram: string;
}

const KRAFT = '#9a7044';
const FOLD = '#c29a68';
const INK = '#2a2420';
const RUST = '#9e421d';
const TINT_HEX: Record<Tint, string> = { lilac: '#8b76a6', ash: '#6e6863', mint: '#5a8f74', rose: '#b06f78' };

export class LoafScene {
  private renderer: LoafRenderer | null = null;
  private state: 'ready' | 'lost' | 'fallback' = 'fallback';
  private batch: SceneBatch | null = null;
  private bars: Bar[] = [];
  private scroll = -1;
  private cutStep = 0;
  private wire = new Tween(0);
  private yaw = new Tween(0);
  private pointerInside = false;
  private reduced: boolean;
  private width = 0;
  private height = 0;
  private dirty = true;
  private frame = 0;
  private published = new Map<string, string>();
  private readonly media = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly observer: ResizeObserver;
  private readonly diagram: SVGSVGElement;

  constructor(
    private readonly figure: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly caption: HTMLElement,
    private labels: SceneLabels,
  ) {
    this.reduced = this.media.matches;
    this.diagram = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.diagram.setAttribute('role', 'img');
    this.diagram.setAttribute('class', 'loaf-diagram');
    this.diagram.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.startGl();
    this.media.addEventListener('change', this.onMotionPreference);
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    figure.addEventListener('pointermove', this.onPointerMove);
    figure.addEventListener('pointerleave', this.onPointerLeave);
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(figure);
    this.measure();
    this.frame = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.media.removeEventListener('change', this.onMotionPreference);
    this.figure.removeEventListener('pointermove', this.onPointerMove);
    this.figure.removeEventListener('pointerleave', this.onPointerLeave);
  }

  setLabels(labels: SceneLabels): void {
    this.labels = labels;
    this.publish();
  }

  /** Shows a batch: a new scent applies its tint, swirl and stock at once; the wire snaps over the medium duration. */
  setBatch(batch: SceneBatch): void {
    const now = performance.now();
    const previous = this.batch;
    this.batch = batch;
    this.renderer?.setBatch(batch.tint, batch.code);
    const values = scrollValues(window.scrollY, batch.bars.length);
    this.scroll = values.s;
    this.cutStep = values.cutStep;
    this.bars = batch.bars.map((status, i) => {
      const bar: Bar = { status, tip: new Tween(this.tipTarget(i, status)), wrap: new Tween(status === 'held' ? 1 : 0), presence: new Tween(status === 'sold' ? 0 : 1) };
      return bar;
    });
    const fraction = values.s / 2400;
    if (previous && previous.code !== batch.code && !this.reduced) this.wire.go(fraction, now, MEDIUM_MS);
    else {
      this.wire.go(fraction, now, 0);
      this.wire.finish();
    }
    this.dirty = true;
    this.publish();
  }

  /** Stock from the server: wraps, unwraps and removals each take the long duration. */
  setStock(statuses: BarStatus[]): void {
    if (!this.batch || statuses.length !== this.bars.length) return;
    const now = performance.now();
    const duration = this.reduced ? 0 : LONG_MS;
    statuses.forEach((status, i) => {
      const bar = this.bars[i] as Bar;
      bar.status = status;
      bar.wrap.go(status === 'held' ? 1 : 0, now, duration);
      bar.presence.go(status === 'sold' ? 0 : 1, now, duration);
      bar.tip.go(this.tipTarget(i, status), now, 0);
      bar.tip.finish();
      if (this.reduced) {
        bar.wrap.finish();
        bar.presence.finish();
      }
    });
    this.batch = { ...this.batch, bars: statuses };
    this.dirty = true;
    this.publish();
  }

  /** Scrolls to a bar deep link; a bar outside 1 to N leaves the page at the top. */
  static deepLink(k: number, n: number): number {
    return k >= 1 && k <= n ? deepLinkY(k, n) : 0;
  }

  private tipTarget(index: number, status: BarStatus): number {
    const n = this.batch?.bars.length ?? 0;
    return status !== 'sold' && this.cutStep < n && index + 1 <= this.cutStep ? 1 : 0;
  }

  private startGl(): void {
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false }) as WebGLRenderingContext | null;
    if (!gl) {
      this.setState('fallback');
      return;
    }
    this.renderer = new LoafRenderer(gl);
    if (this.batch) this.renderer.setBatch(this.batch.tint, this.batch.code);
    this.setState('ready');
  }

  private setState(state: 'ready' | 'lost' | 'fallback'): void {
    this.state = state;
    const live = state === 'ready';
    this.canvas.hidden = !live;
    if (live) this.diagram.remove();
    else if (!this.diagram.isConnected) this.figure.insertBefore(this.diagram, this.caption);
    this.dirty = true;
    this.publish();
  }

  private readonly onLost = (event: Event) => {
    event.preventDefault();
    this.renderer = null;
    this.setState('lost');
  };

  private readonly onRestored = () => {
    this.startGl();
  };

  private readonly onMotionPreference = (event: MediaQueryListEvent) => {
    this.reduced = event.matches;
    if (this.reduced) {
      for (const bar of this.bars) {
        bar.tip.finish();
        bar.wrap.finish();
        bar.presence.finish();
      }
      this.wire.finish();
      this.yaw.go(0, performance.now(), 0);
      this.yaw.finish();
    }
    this.dirty = true;
    this.publish();
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || this.reduced) return;
    const rect = this.figure.getBoundingClientRect();
    const yaw = Math.max(-YAW_EDGE, Math.min(YAW_EDGE, Math.round(((event.clientX - rect.left) / rect.width - 0.5) * 2 * YAW_EDGE)));
    this.pointerInside = true;
    this.yaw.go(yaw, performance.now(), 0);
    this.yaw.finish();
    this.dirty = true;
    this.publish();
  };

  private readonly onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !this.pointerInside) return;
    this.pointerInside = false;
    this.yaw.go(0, performance.now(), this.reduced ? 0 : MEDIUM_MS);
    this.dirty = true;
  };

  private measure(): void {
    const rect = this.figure.getBoundingClientRect();
    this.width = Math.round(rect.width);
    this.height = Math.round(rect.height);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(this.width * ratio));
    this.canvas.height = Math.max(1, Math.round(this.height * ratio));
    this.dirty = true;
    this.publish();
    this.render(performance.now());
  }

  /** Reads the scroll offset; crossing bar boundaries starts each slice's own motion. */
  private follow(now: number): void {
    if (!this.batch) return;
    const values = scrollValues(window.scrollY, this.bars.length);
    if (values.s === this.scroll) return;
    this.scroll = values.s;
    this.cutStep = values.cutStep;
    const duration = this.reduced ? 0 : LONG_MS;
    this.bars.forEach((bar, i) => {
      bar.tip.go(this.tipTarget(i, bar.status), now, duration);
      if (this.reduced) bar.tip.finish();
    });
    if (!this.wire.running(now)) {
      this.wire.go(values.s / 2400, now, 0);
      this.wire.finish();
    } else this.wire.go(values.s / 2400, now, MEDIUM_MS);
    this.dirty = true;
    this.publish();
  }

  /** Called on every scroll event, so the attributes follow in the same frame. */
  readonly onScroll = () => this.follow(performance.now());

  private animating(now: number): boolean {
    if (this.reduced) return false;
    return this.wire.running(now) || this.bars.some((b) => b.tip.running(now) || b.wrap.running(now) || b.presence.running(now));
  }

  private camera(): Camera {
    const base = fit(this.bars.length, this.width, this.height);
    return { ...base, yaw: this.reduced ? 0 : this.yaw.value(performance.now()) };
  }

  private readonly tick = (now: number) => {
    this.follow(now);
    const settling = this.published.get('data-animating') === 'true' || this.published.get('data-yaw') !== '0';
    if (this.animating(now) || this.yaw.running(now) || this.dirty || settling) {
      this.publish();
      this.render(now);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private render(now: number): void {
    this.dirty = false;
    if (!this.batch) return;
    if (this.state !== 'ready') {
      this.drawDiagram();
      return;
    }
    if (!this.renderer || this.width === 0) return;
    const poses: BarPose[] = this.bars.map((bar, index) => ({
      index,
      tip: bar.tip.value(now),
      wrap: bar.wrap.value(now),
      presence: bar.presence.value(now),
    }));
    this.renderer.draw(
      { width: this.width, height: this.height, cam: this.camera(), bars: this.bars.length, poses, wire: this.wire.value(now) * this.bars.length },
      Math.min(2, window.devicePixelRatio || 1),
    );
  }

  private set(name: string, value: string): void {
    if (this.published.get(name) === value) return;
    this.published.set(name, value);
    this.figure.setAttribute(name, value);
  }

  private publish(): void {
    const now = performance.now();
    // data-state appears only once the batch and its bars are known, so a reader waiting for a ready scene
    // never sees the cut step, stock or bar spans half-published.
    const loaded = this.batch !== null && this.bars.length > 0;
    if (loaded) this.set('data-state', this.state);
    this.set('data-motion', this.reduced ? 'reduced' : 'full');
    this.set('data-animating', this.animating(now) ? 'true' : 'false');
    if (!this.batch || !loaded) return;
    const n = this.bars.length;
    const values = scrollValues(window.scrollY, n);
    const cam = this.camera();
    this.set('data-batch', this.batch.code);
    this.set('data-tint', this.batch.tint);
    this.set('data-swirl-seed', this.batch.code);
    this.set('data-bars-total', String(n));
    this.set('data-progress', values.progress);
    this.set('data-wire', values.wire);
    this.set('data-cut-step', String(values.cutStep));
    this.set('data-bars', this.bars.map((b) => LETTER[b.status]).join(''));
    this.set('data-yaw', String(Math.round(cam.yaw) || 0));
    const [y0, y1] = loafBand(cam, n, this.height);
    this.set('data-loaf-band', `${y0}-${y1}`);
    this.set('data-bar-spans', barSpans(cam, n, this.width).map(([a, b]) => `${a}-${b}`).join(' '));
    const caption = this.labels.caption(values.cutStep, n);
    if (this.caption.textContent !== caption) this.caption.textContent = caption;
    this.diagram.setAttribute('aria-label', this.labels.diagram);
    if (this.state !== 'ready') this.drawDiagram();
  }

  /** The flat fallback: N bars in a row in their state shapes, with the wire at the current cut step. */
  private drawDiagram(): void {
    if (!this.batch) return;
    const n = this.bars.length;
    const cell = 30;
    const width = n * cell + 20;
    const tint = TINT_HEX[this.batch.tint];
    const parts: string[] = [];
    this.bars.forEach((bar, i) => {
      const x = 10 + i * cell + 3;
      if (bar.status === 'sold') {
        parts.push(`<rect x="${x}" y="20" width="24" height="60" rx="2" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      } else if (bar.status === 'held') {
        parts.push(`<rect x="${x}" y="20" width="24" height="60" rx="2" fill="${KRAFT}"/>`);
        parts.push(`<path d="M${x + 14} 20 H${x + 24} V30 Z" fill="${FOLD}" stroke="${INK}" stroke-width="0.8"/>`);
        parts.push(`<rect x="${x + 5}" y="40" width="14" height="10" rx="1" fill="#e6d6b6" stroke="${INK}" stroke-width="0.8"/>`);
      } else {
        parts.push(`<rect x="${x}" y="20" width="24" height="60" rx="2" fill="${tint}"/>`);
      }
    });
    const wireX = 10 + this.cutStep * cell;
    parts.push(`<line x1="${wireX}" y1="8" x2="${wireX}" y2="92" stroke="${RUST}" stroke-width="2"/>`);
    parts.push(`<rect x="${wireX - 3}" y="2" width="6" height="8" fill="${INK}"/><rect x="${wireX - 3}" y="90" width="6" height="8" fill="${INK}"/>`);
    this.diagram.setAttribute('viewBox', `0 0 ${width} 100`);
    this.diagram.innerHTML = parts.join('');
  }
}
