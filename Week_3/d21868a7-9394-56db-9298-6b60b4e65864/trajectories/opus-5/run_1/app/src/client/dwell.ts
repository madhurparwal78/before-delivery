import { el, prefersReducedMotion } from './dom.ts';

/**
 * The headgate dwell control. The page's own timers drive it, so the progress
 * value at any moment follows the time the control has been held.
 */

const DWELL_MS = 1_000;

export interface DwellControl {
  element: HTMLElement;
  button: HTMLButtonElement;
  cancel: () => void;
  destroy: () => void;
}

export interface DwellOptions {
  turnoutCode: string;
  onCommit: () => void;
  onEarlyRelease: () => void;
}

function gateGlyph(): { element: SVGSVGElement; sweep: SVGRectElement } {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="gate-glyph" aria-hidden="true">
<defs><clipPath id="gate-leaf-clip"><rect x="14" y="8" width="20" height="30" rx="1"/></clipPath></defs>
<rect class="gate-sweep" x="14" y="38" width="20" height="0" clip-path="url(#gate-leaf-clip)"/>
<path class="gate-line" d="M4 38 L8 44 M44 38 L40 44 M4 38 L44 38" fill="none"/>
<rect class="gate-line" x="14" y="8" width="20" height="30" rx="1" fill="none"/>
<path class="gate-line" d="M14 18 H34 M14 28 H34 M24 4 V8" fill="none"/>
</svg>`;
  const element = wrapper.firstElementChild as SVGSVGElement;
  return { element, sweep: element.querySelector('.gate-sweep') as SVGRectElement };
}

export function dwellControl(options: DwellOptions): DwellControl {
  const glyph = gateGlyph();
  const progress = el('div', {
    class: 'dwell-progress',
    attrs: {
      role: 'progressbar',
      'aria-label': `Dwell progress ${options.turnoutCode}`,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
    },
    children: [el('span', { class: 'dwell-progress-fill' })],
  });
  const fill = progress.firstElementChild as HTMLElement;
  const button = el('button', {
    class: 'dwell-button',
    attrs: { type: 'button', 'aria-label': `Hold to stroke ${options.turnoutCode}` },
    children: [glyph.element],
  });

  let started = 0;
  let frame = 0;
  let holding = false;
  let spaceHeld = false;

  const paint = (value: number): void => {
    progress.setAttribute('aria-valuenow', String(value));
    fill.style.width = `${value}%`;
    const sweep = prefersReducedMotion() ? Math.floor(value / 25) * 25 : value;
    const height = (30 * sweep) / 100;
    glyph.sweep.setAttribute('height', String(height));
    glyph.sweep.setAttribute('y', String(38 - height));
  };

  const stop = (): void => {
    holding = false;
    spaceHeld = false;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  };

  const cancel = (announce: boolean): void => {
    if (!holding) return;
    stop();
    glyph.sweep.classList.add('draining');
    paint(0);
    window.setTimeout(() => glyph.sweep.classList.remove('draining'), 200);
    if (announce) options.onEarlyRelease();
  };

  const step = (): void => {
    if (!holding) return;
    const elapsed = performance.now() - started;
    if (elapsed >= DWELL_MS) {
      paint(100);
      stop();
      options.onCommit();
      return;
    }
    paint(Math.min(100, Math.floor(elapsed / 10)));
    frame = requestAnimationFrame(step);
  };

  const start = (): void => {
    if (holding) return;
    holding = true;
    started = performance.now();
    paint(0);
    frame = requestAnimationFrame(step);
  };

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.focus();
    start();
  });
  button.addEventListener('pointerup', () => cancel(true));
  button.addEventListener('pointercancel', () => cancel(true));
  button.addEventListener('pointerleave', () => cancel(true));
  button.addEventListener('blur', () => cancel(true));
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });

  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      return;
    }
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    if (event.repeat || spaceHeld) return;
    spaceHeld = true;
    start();
  });
  button.addEventListener('keyup', (event) => {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    if (!spaceHeld) return;
    cancel(true);
  });

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') cancel(true);
  };
  document.addEventListener('visibilitychange', onVisibility);

  paint(0);

  return {
    element: el('div', { class: 'dwell', children: [button, progress] }),
    button,
    cancel: () => cancel(false),
    destroy: () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
