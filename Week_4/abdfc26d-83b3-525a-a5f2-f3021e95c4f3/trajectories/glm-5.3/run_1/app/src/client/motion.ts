export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function onReducedMotionChange(fn: () => void): void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', fn);
}

/**
 * Scroll entrance: siblings rise about a tenth of a second apart, each once.
 */
export function observeEntrances(root: ParentNode = document): void {
  const items = Array.from(root.querySelectorAll<HTMLElement>('.rise'));
  if (prefersReducedMotion()) {
    for (const item of items) item.classList.add('entered');
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (!entry.isIntersecting) return;
      const target = entry.target as HTMLElement;
      setTimeout(() => target.classList.add('entered'), index * 100);
      observer.unobserve(target);
    });
  }, { threshold: 0.15 });
  for (const item of items) observer.observe(item);
}

/** Studio header: dark glass after the hero. */
export function watchHeaderScroll(header: HTMLElement | null): void {
  if (!header) return;
  const apply = (): void => {
    header.classList.toggle('scrolled', window.scrollY > 80);
  };
  window.addEventListener('scroll', apply, { passive: true });
  apply();
}

/**
 * Five-verb workflow stack: the active verb advances every 3 seconds,
 * pausing while the hero is off-screen and under reduced motion.
 */
export function startVerbStack(list: HTMLElement | null): void {
  if (!list) return;
  const verbs = Array.from(list.querySelectorAll<HTMLElement>('li'));
  let index = 0;
  let timer = 0;
  const reduced = prefersReducedMotion();

  const paint = (): void => {
    verbs.forEach((verb, i) => {
      const active = !reduced && i === index;
      verb.classList.toggle('active', active);
      if (active) verb.setAttribute('aria-current', 'step');
      else verb.removeAttribute('aria-current');
    });
  };

  if (reduced) {
    paint();
    return;
  }

  const step = (): void => {
    index = (index + 1) % verbs.length;
    paint();
  };

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        if (!timer) timer = window.setInterval(step, 3000);
      } else if (timer) {
        window.clearInterval(timer);
        timer = 0;
      }
    }
  }, { threshold: 0.2 });
  observer.observe(list);
  paint();
}

/**
 * Prompt bar typewriter: 25 characters a second, stopping for good on the
 * first focus or input.
 */
export function startTypewriter(input: HTMLInputElement | null, text: string): void {
  if (!input) return;
  if (prefersReducedMotion()) {
    input.placeholder = text;
    return;
  }
  let index = 0;
  let timer = 0;
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    if (timer) window.clearInterval(timer);
    timer = 0;
    input.removeEventListener('focus', stop);
    input.removeEventListener('input', stop);
  };
  input.addEventListener('focus', stop);
  input.addEventListener('input', stop);
  const tick = (): void => {
    if (stopped) return;
    index += 1;
    input.placeholder = text.slice(0, index);
    if (index >= text.length) stop();
  };
  timer = window.setInterval(tick, 1000 / 25);
}

/**
 * Assistant render-status pixel panel: still when idle, flickering single
 * cells every 100-200ms while drafting or rendering, fixed under reduced motion.
 */
export class PixelPanel {
  private cells: HTMLElement[] = [];
  private timer = 0;
  private state: 'idle' | 'drafting' | 'rendering' | 'error' = 'idle';

  constructor(private panel: HTMLImageElement) {
    this.build();
    this.setState('idle');
  }

  private build(): void {
    const grid = this.panel.querySelector<HTMLElement>('.grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        if (row < 2) cell.classList.add('top');
        const isEye = row >= 4 && row <= 5 && col >= 4 && col <= 5;
        if (isEye) cell.classList.add('eye');
        grid.appendChild(cell);
        this.cells.push(cell);
      }
    }
  }

  setState(state: 'idle' | 'drafting' | 'rendering' | 'error'): void {
    this.state = state;
    this.panel.dataset.state = state;
    this.panel.alt = `Assistant status: ${state}`;
    const caption = this.panel.querySelector<HTMLElement>('.caption');
    if (caption) caption.textContent = `Assistant / ${state}`;
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
    for (const cell of this.cells) cell.classList.remove('lit');
    if ((state === 'drafting' || state === 'rendering') && !prefersReducedMotion()) {
      this.timer = window.setInterval(() => {
        const body = this.cells.filter((c) => !c.classList.contains('eye'));
        const cell = body[Math.floor(Math.random() * body.length)];
        if (cell) {
          cell.classList.add('lit');
          window.setTimeout(() => cell.classList.remove('lit'), 220);
        }
      }, 150);
    }
  }

  getState(): 'idle' | 'drafting' | 'rendering' | 'error' {
    return this.state;
  }
}

export function announce(region: HTMLElement | null, text: string): void {
  if (!region) return;
  region.textContent = '';
  window.requestAnimationFrame(() => {
    region.textContent = text;
  });
}

export function focusTrap(dialog: HTMLDialogElement, onClose: () => void, initialFocus: HTMLElement | null): void {
  const focusables = (): HTMLElement[] =>
    Array.from(dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'));

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first || document.activeElement === dialog) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if (initialFocus) initialFocus.focus();
}
