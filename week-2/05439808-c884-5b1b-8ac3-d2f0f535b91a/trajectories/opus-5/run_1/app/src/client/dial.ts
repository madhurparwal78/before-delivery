import { button, el, prefersReducedMotion } from './dom.js';

const FRICTION_PER_FRAME = 0.92;
const FRAME_MS = 1000 / 60;
const COAST_FLOOR = 0.5;
const SPRING_MS = 420;
const NOTCH = 10;
const PLAY_TICKS_PER_SECOND = 10;

export type DialHandlers = {
  onDraw: (tick: number) => void;
  onSettle: (tick: number) => void;
};

export class WakeDial {
  readonly root: HTMLElement;
  readonly slider: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly bead: SVGCircleElement;
  private readonly finalTick: number;
  private readonly handlers: DialHandlers;
  private readonly reduced = prefersReducedMotion();
  private tickValue = 0;
  private floating = 0;
  private velocity = 0;
  private lastNotch = 0;
  private frame = 0;
  private dragging = false;
  private lastAngle = 0;
  private playing = false;
  private playHandle = 0;
  private readonly playButton: HTMLButtonElement;
  private readonly tickInput: HTMLInputElement | null = null;

  constructor(finalTick: number, handlers: DialHandlers) {
    this.finalTick = Math.max(0, finalTick);
    this.handlers = handlers;

    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('class', 'dial-svg');
    svg.setAttribute('aria-hidden', 'true');
    const ring = document.createElementNS(svgNamespace, 'circle');
    ring.setAttribute('cx', '100');
    ring.setAttribute('cy', '100');
    ring.setAttribute('r', '82');
    ring.setAttribute('class', 'dial-ring');
    svg.append(ring);
    for (let degree = 0; degree < 360; degree += NOTCH) {
      const radians = ((degree - 90) * Math.PI) / 180;
      const notch = document.createElementNS(svgNamespace, 'line');
      notch.setAttribute('x1', String(100 + 74 * Math.cos(radians)));
      notch.setAttribute('y1', String(100 + 74 * Math.sin(radians)));
      notch.setAttribute('x2', String(100 + 82 * Math.cos(radians)));
      notch.setAttribute('y2', String(100 + 82 * Math.sin(radians)));
      notch.setAttribute('class', 'dial-notch');
      svg.append(notch);
    }
    this.bead = document.createElementNS(svgNamespace, 'circle');
    this.bead.setAttribute('r', '9');
    this.bead.setAttribute('class', 'dial-bead');
    svg.append(this.bead);

    this.counter = el('span', { class: 'dial-counter', text: '0' });
    this.slider = el(
      'div',
      {
        role: 'slider',
        'aria-label': 'Wake dial',
        tabindex: '0',
        class: 'dial-slider',
        'aria-valuemin': '0',
        'aria-valuemax': String(this.finalTick),
        'aria-valuenow': '0'
      },
      [svg, this.counter]
    );
    this.playButton = button('Play replay', { class: 'dial-play' });
    this.playButton.addEventListener('click', () => this.togglePlay());

    const controls = el('div', { class: 'dial-controls' }, [this.playButton]);
    if (this.reduced) {
      const back10 = button('Back 10 ticks');
      back10.addEventListener('click', () => this.step(-10));
      const previous = button('Previous tick');
      previous.addEventListener('click', () => this.step(-1));
      const next = button('Next tick');
      next.addEventListener('click', () => this.step(1));
      const forward10 = button('Forward 10 ticks');
      forward10.addEventListener('click', () => this.step(10));
      const input = el('input', {
        type: 'number',
        min: '0',
        max: String(this.finalTick),
        value: '0',
        'aria-label': 'Tick',
        class: 'dial-tick-input'
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.jumpTo(Number(input.value));
      });
      this.tickInput = input;
      controls.append(back10, previous, next, forward10, input);
    }

    this.root = el('div', { class: 'wake-dial' }, [this.slider, controls]);
    this.bindPointer();
    this.bindKeyboard();
    this.applyTick(0, true);
  }

  get tick(): number {
    return this.tickValue;
  }

  private clamp(value: number): number {
    return Math.min(this.finalTick, Math.max(0, value));
  }

  private beadAt(tick: number): void {
    const radians = (((tick % 360) - 90) * Math.PI) / 180;
    this.bead.setAttribute('cx', String(100 + 82 * Math.cos(radians)));
    this.bead.setAttribute('cy', String(100 + 82 * Math.sin(radians)));
  }

  private draw(tick: number): void {
    this.beadAt(tick);
    this.counter.textContent = String(tick);
    this.handlers.onDraw(tick);
  }

  private applyTick(tick: number, settle: boolean): void {
    this.tickValue = this.clamp(Math.round(tick));
    this.floating = this.tickValue;
    this.lastNotch = Math.floor(this.tickValue / NOTCH) * NOTCH;
    this.slider.setAttribute('aria-valuenow', String(this.tickValue));
    this.slider.setAttribute(
      'aria-valuetext',
      `Tick ${this.tickValue} of ${this.finalTick}`
    );
    if (this.tickInput) this.tickInput.value = String(this.tickValue);
    this.beadAt(this.tickValue);
    this.counter.textContent = String(this.tickValue);
    if (settle) this.handlers.onSettle(this.tickValue);
  }

  setTick(tick: number): void {
    this.stopMotion();
    this.applyTick(tick, true);
  }

  private stopMotion(): void {
    if (this.frame !== 0) {
      window.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  private step(delta: number): void {
    this.pause();
    this.stopMotion();
    this.applyTick(this.tickValue + delta, true);
  }

  private jumpTo(tick: number): void {
    this.pause();
    this.stopMotion();
    this.applyTick(Number.isFinite(tick) ? tick : 0, true);
  }

  private crossNotches(): void {
    const notch = Math.floor(this.clamp(this.floating) / NOTCH) * NOTCH;
    if (notch !== this.lastNotch) {
      this.lastNotch = notch;
      this.draw(this.clamp(notch));
    }
  }

  private bindPointer(): void {
    const angleOf = (event: PointerEvent): number => {
      const bounds = this.slider.getBoundingClientRect();
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      return (Math.atan2(dy, dx) * 180) / Math.PI;
    };

    this.slider.addEventListener('pointerdown', (event) => {
      this.pause();
      this.stopMotion();
      this.dragging = true;
      this.velocity = 0;
      this.lastAngle = angleOf(event);
      this.slider.setPointerCapture(event.pointerId);
      this.slider.focus();
    });

    this.slider.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const angle = angleOf(event);
      let delta = angle - this.lastAngle;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      this.lastAngle = angle;
      this.floating = this.clamp(this.floating + delta);
      this.velocity = this.reduced ? 0 : delta;
      this.beadAt(Math.round(this.floating));
      this.crossNotches();
    });

    const release = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.reduced || Math.abs(this.velocity) <= COAST_FLOOR) {
        this.applyTick(Math.round(this.floating), true);
        return;
      }
      this.coast();
    };
    this.slider.addEventListener('pointerup', release);
    this.slider.addEventListener('pointercancel', release);
  }

  private coast(): void {
    let previous = performance.now();
    const stepFrame = (): void => {
      const now = performance.now();
      const frames = Math.max(1, Math.min(6, (now - previous) / FRAME_MS));
      previous = now;
      this.velocity *= Math.pow(FRICTION_PER_FRAME, frames);
      this.floating += this.velocity * frames;
      if (this.floating <= 0 || this.floating >= this.finalTick) {
        this.floating = this.clamp(this.floating);
        this.settleSpring();
        return;
      }
      this.beadAt(Math.round(this.floating));
      this.crossNotches();
      if (Math.abs(this.velocity) < COAST_FLOOR) {
        this.settleSpring();
        return;
      }
      this.frame = window.requestAnimationFrame(stepFrame);
    };
    this.frame = window.requestAnimationFrame(stepFrame);
  }

  private settleSpring(): void {
    const from = this.floating;
    const target = this.clamp(Math.round(from));
    const start = performance.now();
    const stepFrame = (): void => {
      const progress = Math.min(1, (performance.now() - start) / SPRING_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.floating = from + (target - from) * eased;
      this.beadAt(Math.round(this.floating));
      this.crossNotches();
      if (progress >= 1) {
        this.frame = 0;
        this.applyTick(target, true);
        return;
      }
      this.frame = window.requestAnimationFrame(stepFrame);
    };
    this.frame = window.requestAnimationFrame(stepFrame);
  }

  private bindKeyboard(): void {
    this.slider.addEventListener('keydown', (event) => {
      const steps: Record<string, number> = {
        ArrowRight: 1,
        ArrowUp: 1,
        ArrowLeft: -1,
        ArrowDown: -1,
        PageUp: 10,
        PageDown: -10
      };
      if (event.key in steps) {
        event.preventDefault();
        this.step(steps[event.key] ?? 0);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        this.jumpTo(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        this.jumpTo(this.finalTick);
      }
    });
  }

  private togglePlay(): void {
    if (this.playing) {
      this.pause();
      return;
    }
    this.playing = true;
    this.playButton.setAttribute('aria-label', 'Pause replay');
    this.playButton.textContent = 'Pause replay';
    const advance = (): void => {
      if (!this.playing) return;
      const next = this.tickValue + NOTCH;
      if (next >= this.finalTick) {
        this.applyTick(this.finalTick, true);
        this.pause();
        return;
      }
      this.applyTick(next, true);
      this.playHandle = window.setTimeout(advance, (NOTCH / PLAY_TICKS_PER_SECOND) * 1000);
    };
    this.playHandle = window.setTimeout(advance, (NOTCH / PLAY_TICKS_PER_SECOND) * 1000);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    window.clearTimeout(this.playHandle);
    this.playButton.setAttribute('aria-label', 'Play replay');
    this.playButton.textContent = 'Play replay';
  }

  destroy(): void {
    this.pause();
    this.stopMotion();
    this.root.remove();
  }
}
