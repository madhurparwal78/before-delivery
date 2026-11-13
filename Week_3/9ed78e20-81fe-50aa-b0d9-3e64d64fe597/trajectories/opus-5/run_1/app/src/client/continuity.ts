import { all, one, reducedMotion } from './dom.js';

const STORE_KEY = 'aor-continuity';
const DURATION = 400;

type Handover = {
  readonly path: string;
  readonly text: string;
  readonly rect: { left: number; top: number; width: number; height: number };
};

function remember(handover: Handover | null): void {
  try {
    if (handover === null) window.sessionStorage.removeItem(STORE_KEY);
    else window.sessionStorage.setItem(STORE_KEY, JSON.stringify(handover));
  } catch {
    // A visitor who refuses storage simply gets a plain page change.
  }
}

function recall(): Handover | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    return raw === null ? null : (JSON.parse(raw) as Handover);
  } catch {
    return null;
  }
}

function flip(element: HTMLElement, from: Handover['rect']): void {
  const to = element.getBoundingClientRect();
  if (to.height === 0) return;
  const scale = Math.min(2, Math.max(0.3, from.height / to.height));
  element.dataset.continuity = 'running';
  const animation = element.animate(
    [
      {
        transformOrigin: 'left top',
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`,
      },
      { transformOrigin: 'left top', transform: 'none' },
    ],
    { duration: DURATION, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'none' },
  );
  animation.addEventListener('finish', () => {
    element.dataset.continuity = 'done';
  });
}

export function startContinuity(): void {
  for (const link of all<HTMLAnchorElement>('[data-continuity-title]')) {
    link.addEventListener('click', () => {
      if (reducedMotion()) {
        remember(null);
        return;
      }
      const rect = link.getBoundingClientRect();
      remember({
        path: new URL(link.href).pathname,
        text: link.textContent?.trim() ?? '',
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      });
    });
  }

  if (reducedMotion()) return;
  const stored = recall();
  if (stored === null) return;

  const heading = one('[data-continuity-heading]');
  if (heading !== null && stored.path === window.location.pathname) {
    flip(heading, stored.rect);
    const rect = heading.getBoundingClientRect();
    remember({
      path: stored.path,
      text: stored.text,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
    return;
  }

  const returning = all<HTMLAnchorElement>('[data-continuity-title]').find(
    (link) => new URL(link.href).pathname === stored.path,
  );
  if (returning !== undefined) {
    flip(returning, stored.rect);
    remember(null);
  }
}
