// The Wake dial: one degree equals one tick. Dragging follows the pointer exactly; a fling
// coasts losing about 8% of its speed per frame, then a stiff spring settles on a whole tick.
// With reduced motion it becomes a stepped slider with tick buttons and a numeric input.
import { reducedMotion } from './ui.ts';

export interface DialCallbacks {
  onDrawnTick(tick: number): void;
  onSettle(tick: number): void;
  onSettling(): void;
}

export class WakeDial {
  readonly element: HTMLElement;
  private finalTick: number;
  private tick = 0;
  private velocity = 0; // ticks per frame at 60fps
  private dragging = false;
  private lastPointerAngle = 0;
  private lastMoveTime = 0;
  private coasting = false;
  private rafHandle: number | null = null;
  private readonly cb: DialCallbacks;
  private readonly canvas: HTMLCanvasElement | null = null;
  private readonly ctx: CanvasRenderingContext2D | null = null;
  private readonly reduced: boolean;
  private readonly slider: HTMLElement;
  private readonly counter: HTMLElement;
  private lastDrawnTick = -1;
  private lastSettledTick = -1;

  constructor(finalTick: number, cb: DialCallbacks) {
    this.finalTick = finalTick;
    this.cb = cb;
    this.reduced = reducedMotion();
    this.element = document.createElement('div');
    this.element.className = 'wake-dial';
    this.counter = document.createElement('span');
    this.counter.className = 'tick-counter mono';

    if (this.reduced) {
      this.slider = this.buildReduced();
      this.element.append(this.slider);
    } else {
      this.slider = document.createElement('div');
      const canvas = document.createElement('canvas');
      canvas.style.width = 'min(34vh, 260px)';
      canvas.style.height = 'min(34vh, 260px)';
      canvas.style.display = 'block';
      canvas.style.touchAction = 'none';
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.element.append(canvas, this.counter);
      this.element.setAttribute('role', 'slider');
      this.element.setAttribute('aria-label', 'Wake dial');
      this.element.tabIndex = 0;
      this.updateAria();
      this.bindPointer();
      this.bindKeyboard();
      this.draw();
    }
  }

  private buildReduced(): HTMLElement {
    const holder = document.createElement('div');
    holder.className = 'reduced-dial';
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    slider.setAttribute('aria-label', 'Wake dial');
    slider.tabIndex = 0;
    slider.style.display = 'flex';
    slider.style.gap = '6px';
    slider.style.alignItems = 'center';
    slider.style.border = '1px solid rgba(244,241,230,0.3)';
    slider.style.borderRadius = '6px';
    slider.style.padding = '6px 10px';

    const back = document.createElement('button');
    back.textContent = 'Back 10 ticks';
    const prev = document.createElement('button');
    prev.textContent = 'Previous tick';
    const next = document.createElement('button');
    next.textContent = 'Next tick';
    const fwd = document.createElement('button');
    fwd.textContent = 'Forward 10 ticks';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(this.finalTick);
    input.value = '0';
    input.setAttribute('aria-label', 'Tick');

    const apply = (value: number): void => {
      const clamped = Math.max(0, Math.min(this.finalTick, Math.round(value)));
      if (clamped === this.tick) return;
      this.lastSettledTick = clamped;
      this.tick = clamped;
      input.value = String(clamped);
      slider.setAttribute('aria-valuenow', String(clamped));
      slider.setAttribute('aria-valuetext', `Tick ${clamped} of ${this.finalTick}`);
      this.cb.onSettle(clamped);
      this.cb.onDrawnTick(clamped);
      this.counter.textContent = String(clamped);
    };

    back.addEventListener('click', () => apply(this.tick - 10));
    prev.addEventListener('click', () => apply(this.tick - 1));
    next.addEventListener('click', () => apply(this.tick + 1));
    fwd.addEventListener('click', () => apply(this.tick + 10));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        apply(Number(input.value) || 0);
      }
    });
    slider.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') apply(this.tick + 1);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') apply(this.tick - 1);
      if (event.key === 'PageUp') apply(this.tick + 10);
      if (event.key === 'PageDown') apply(this.tick - 10);
      if (event.key === 'Home') apply(0);
      if (event.key === 'End') apply(this.finalTick);
    });

    slider.setAttribute('aria-valuemin', '0');
    slider.setAttribute('aria-valuemax', String(this.finalTick));
    slider.setAttribute('aria-valuenow', '0');
    slider.setAttribute('aria-valuetext', `Tick 0 of ${this.finalTick}`);
    slider.append(back, prev, input, next, fwd);
    holder.append(slider);
    return slider;
  }

  getTick(): number {
    return this.tick;
  }

  setFinalTick(finalTick: number): void {
    this.finalTick = finalTick;
  }

  // A key press lands on its tick at once, with no coasting, and counts as a settle.
  private bindKeyboard(): void {
    this.element.addEventListener('keydown', (event) => {
      let delta = 0;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = 1;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -1;
      else if (event.key === 'PageUp') delta = 10;
      else if (event.key === 'PageDown') delta = -10;
      else if (event.key === 'Home') {
        event.preventDefault();
        this.settleTo(0);
        return;
      } else if (event.key === 'End') {
        event.preventDefault();
        this.settleTo(this.finalTick);
        return;
      } else {
        return;
      }
      event.preventDefault();
      this.settleTo(Math.max(0, Math.min(this.finalTick, this.tick + delta)));
    });
  }

  private settleTo(tick: number): void {
    this.stopCoast();
    this.tick = tick;
    this.lastSettledTick = tick;
    this.updateAria();
    this.draw();
    this.cb.onDrawnTick(tick);
    this.cb.onSettle(tick);
    this.counter.textContent = String(tick);
  }

  private updateAria(): void {
    this.element.setAttribute('aria-valuemin', '0');
    this.element.setAttribute('aria-valuemax', String(this.finalTick));
    this.element.setAttribute('aria-valuenow', String(this.tick));
    this.element.setAttribute('aria-valuetext', `Tick ${this.tick} of ${this.finalTick}`);
  }

  private pointerAngle(event: PointerEvent | MouseEvent): number {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(event.clientX - cx, cy - event.clientY) * (180 / Math.PI);
  }

  private bindPointer(): void {
    const canvas = this.canvas!;
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      this.dragging = true;
      this.stopCoast();
      this.lastPointerAngle = this.pointerAngle(event);
      this.lastMoveTime = performance.now();
      this.cb.onSettling();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const angle = this.pointerAngle(event);
      let delta = angle - this.lastPointerAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      this.lastPointerAngle = angle;
      const now = performance.now();
      const dt = Math.max(1, now - this.lastMoveTime);
      this.lastMoveTime = now;
      const before = this.tick;
      this.tick = Math.max(0, Math.min(this.finalTick, this.tick + delta));
      this.velocity = (this.velocity * 0.6 + (delta / dt) * 16.6 * 0.4);
      if (before !== this.tick) {
        this.updateAria();
        this.draw();
        this.emitDrawn();
      }
    });
    const release = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      if (Math.abs(this.velocity) < 0.8) {
        // a slow release settles straight onto the nearest whole tick
        this.settleTo(Math.round(this.tick));
        return;
      }
      this.startCoast();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  private emitDrawn(): void {
    // redraw the scene at every notch crossed while dragging or coasting
    const drawn = Math.round(this.tick / 10) * 10;
    if (drawn !== this.lastDrawnTick) {
      this.lastDrawnTick = drawn;
      this.cb.onDrawnTick(Math.max(0, Math.min(this.finalTick, drawn)));
    }
  }

  private startCoast(): void {
    this.coasting = true;
    const step = (): void => {
      if (!this.coasting) return;
      this.tick += this.velocity;
      this.velocity *= 0.92; // about 8% of the speed lost every frame
      if (this.tick <= 0) {
        this.settleTo(0);
        return;
      }
      if (this.tick >= this.finalTick) {
        this.settleTo(this.finalTick);
        return;
      }
      if (Math.abs(this.velocity) < 0.5) {
        this.startSpring();
        return;
      }
      this.updateAria();
      this.draw();
      this.emitDrawn();
      this.rafHandle = requestAnimationFrame(step);
    };
    this.rafHandle = requestAnimationFrame(step);
  }

  // a stiff, well-damped spring lands on the nearest whole tick in under half a second
  private startSpring(): void {
    const target = Math.round(this.tick);
    let velocity = this.velocity;
    const stiffness = 0.28;
    const damping = 0.62;
    const startTime = performance.now();
    const step = (): void => {
      if (this.coasting && !this.dragging && performance.now() - startTime > 600) {
        this.settleTo(target);
        return;
      }
      const force = (target - this.tick) * stiffness;
      velocity = velocity * damping + force;
      this.tick += velocity;
      if (Math.abs(this.tick - target) < 0.02 && Math.abs(velocity) < 0.02) {
        this.settleTo(target);
        return;
      }
      this.updateAria();
      this.draw();
      this.emitDrawn();
      this.rafHandle = requestAnimationFrame(step);
    };
    this.rafHandle = requestAnimationFrame(step);
  }

  private stopCoast(): void {
    this.coasting = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  jumpTo(tick: number): void {
    this.settleTo(Math.max(0, Math.min(this.finalTick, Math.round(tick))));
  }

  play(): void {
    // advances ten ticks per second and settles on every tenth tick
    this.stopCoast();
    let lastSettle = performance.now();
    const step = (): void => {
      if (this.playing === false) return;
      const now = performance.now();
      this.tick += ((now - lastSettle) / 1000) * 10;
      lastSettle = now;
      if (this.tick >= this.finalTick) {
        this.settleTo(this.finalTick);
        this.playing = false;
        return;
      }
      this.updateAria();
      this.draw();
      const drawn = Math.round(this.tick / 10) * 10;
      if (drawn !== this.lastDrawnTick) {
        this.lastDrawnTick = drawn;
        this.cb.onDrawnTick(drawn);
      }
      const whole = Math.round(this.tick);
      if (whole % 10 === 0 && whole !== this.lastSettledTick) {
        this.lastSettledTick = whole;
        this.cb.onSettle(whole);
        this.counter.textContent = String(whole);
      }
      if (this.tick >= this.finalTick) {
        this.settleTo(this.finalTick);
        this.playing = false;
        return;
      }
      this.rafHandle = requestAnimationFrame(step);
    };
    this.playing = true;
    this.rafHandle = requestAnimationFrame(step);
  }

  playing = false;

  pause(): void {
    this.playing = false;
    this.stopCoast();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private draw(): void {
    if (this.ctx === null || this.canvas === null) return;
    const ctx = this.ctx;
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const sizePx = 260;
    if (canvas.width !== sizePx * dpr) {
      canvas.width = sizePx * dpr;
      canvas.height = sizePx * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sizePx, sizePx);
    const center = sizePx / 2;
    const radius = sizePx / 2 - 16;

    // ring
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(244, 241, 230, 0.4)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // notches every ten ticks
    for (let notch = 0; notch <= this.finalTick; notch += 10) {
      const angle = ((notch % 360) * Math.PI) / 180 - Math.PI / 2;
      const inner = radius - 8;
      ctx.beginPath();
      ctx.moveTo(center + Math.sin(angle + Math.PI / 2) * inner, center - Math.cos(angle + Math.PI / 2) * inner);
      ctx.lineTo(center + Math.sin(angle + Math.PI / 2) * (inner + 6), center - Math.cos(angle + Math.PI / 2) * (inner + 6));
      ctx.strokeStyle = 'rgba(244, 241, 230, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // the orange bead at the tick's angle
    const angle = ((this.tick % 360) * Math.PI) / 180 - Math.PI / 2;
    const beadX = center + Math.sin(angle + Math.PI / 2) * radius;
    const beadY = center - Math.cos(angle + Math.PI / 2) * radius;
    ctx.beginPath();
    ctx.arc(beadX, beadY, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#e8763a';
    ctx.fill();
    this.counter.textContent = String(Math.round(this.tick));
  }
}
