import { el } from './dom.js';
import { motion, onFrame } from './motion.js';

type Phase = 'idle' | 'entering' | 'shown' | 'leaving';

const ENTER_MS = 200;
const LEAVE_MS = 200;
const SLIDE_PX = 10;

/** The one polite live region every screen shows its feedback copy in. */
export class Notices {
  readonly region: HTMLElement;
  private readonly line: HTMLElement;
  private phase: Phase = 'idle';
  private startedAt = 0;
  private fromOpacity = 0;
  private fromOffset = SLIDE_PX;

  constructor() {
    this.line = el('p', { class: 'notice-line' });
    this.region = el('div', {
      role: 'status',
      'aria-label': 'Notices',
      'aria-live': 'polite',
      class: 'notices',
      'data-notice-phase': 'idle',
    }, [this.line]);
    onFrame((now) => this.draw(now));
  }

  say(copy: string): void {
    if (copy.length === 0) {
      this.clear();
      return;
    }
    const now = performance.now();
    this.captureCurrent(now);
    this.line.textContent = copy;
    if (motion.reduced) {
      this.phase = 'shown';
      this.fromOpacity = 1;
      this.fromOffset = 0;
    } else {
      this.phase = 'entering';
      this.startedAt = now;
    }
    this.apply(1, 0);
    this.region.setAttribute('data-notice-phase', this.phase);
  }

  clear(): void {
    if (this.phase === 'idle') return;
    const now = performance.now();
    this.captureCurrent(now);
    if (motion.reduced) {
      this.phase = 'idle';
      this.line.textContent = '';
      this.apply(0, SLIDE_PX);
    } else {
      this.phase = 'leaving';
      this.startedAt = now;
    }
    this.region.setAttribute('data-notice-phase', this.phase);
  }

  private captureCurrent(now: number): void {
    const eased = this.eased(now);
    this.fromOpacity = eased.opacity;
    this.fromOffset = eased.offset;
  }

  private eased(now: number): { opacity: number; offset: number } {
    if (this.phase === 'entering') {
      const amount = Math.min(1, (now - this.startedAt) / ENTER_MS);
      return {
        opacity: this.fromOpacity + (1 - this.fromOpacity) * amount,
        offset: this.fromOffset + (0 - this.fromOffset) * amount,
      };
    }
    if (this.phase === 'leaving') {
      const amount = Math.min(1, (now - this.startedAt) / LEAVE_MS);
      return { opacity: this.fromOpacity * (1 - amount), offset: this.fromOffset };
    }
    return this.phase === 'shown' ? { opacity: 1, offset: 0 } : { opacity: 0, offset: SLIDE_PX };
  }

  private apply(opacity: number, offset: number): void {
    this.line.style.opacity = String(opacity);
    this.line.style.transform = `translateY(${offset}px)`;
  }

  private draw(now: number): void {
    if (this.phase !== 'entering' && this.phase !== 'leaving') return;
    const { opacity, offset } = this.eased(now);
    this.apply(opacity, offset);
    const elapsed = now - this.startedAt;
    if (this.phase === 'entering' && elapsed >= ENTER_MS) {
      this.phase = 'shown';
      this.region.setAttribute('data-notice-phase', 'shown');
    } else if (this.phase === 'leaving' && elapsed >= LEAVE_MS) {
      this.phase = 'idle';
      this.line.textContent = '';
      this.region.setAttribute('data-notice-phase', 'idle');
    }
  }

  /** Reduced motion applies at once, in either direction. */
  settleForPreference(): void {
    if (!motion.reduced) return;
    if (this.phase === 'entering') {
      this.phase = 'shown';
      this.apply(1, 0);
    } else if (this.phase === 'leaving') {
      this.phase = 'idle';
      this.line.textContent = '';
      this.apply(0, SLIDE_PX);
    }
    this.region.setAttribute('data-notice-phase', this.phase);
  }
}
