import { prefersReducedMotion } from './settings.js';

const RISE_STAGGER_MS = 100;
const RISE_DURATION_MS = 600;

/** Section copy and pills fade up from a slight blur, once on first sight. */
export function observeEntrances(root: ParentNode): void {
  const nodes = [...root.querySelectorAll<HTMLElement>('.entrance')];
  if (prefersReducedMotion()) {
    for (const node of nodes) node.classList.add('shown');
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target as HTMLElement;
        const index = Number(node.dataset.entranceIndex ?? '0');
        window.setTimeout(() => node.classList.add('shown'), index * RISE_STAGGER_MS);
        observer.unobserve(node);
      }
    },
    { threshold: 0.12 },
  );
  for (const node of nodes) observer.observe(node);
}

/** Split-letter headings settle left to right; the name stays the whole word. */
export function initSplitHeadings(root: ParentNode): void {
  const headings = [...root.querySelectorAll<HTMLElement>('.split-letter')];
  const reduced = prefersReducedMotion();
  for (const heading of headings) {
    const letters = [...heading.querySelectorAll<HTMLElement>('span')];
    if (reduced) {
      for (const letter of letters) letter.style.opacity = '1';
      continue;
    }
    for (const letter of letters) {
      letter.style.opacity = '0';
      letter.style.transform = 'translateY(6px)';
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          letters.forEach((letter, index) => {
            letter.style.transition = `opacity 260ms ease ${index * 30}ms, transform 260ms ease ${index * 30}ms`;
            letter.style.opacity = '1';
            letter.style.transform = 'none';
          });
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(heading);
  }
}

/** The validator monogram marquee: pauses on hover and while off-screen. */
export function initMarquee(region: HTMLElement): void {
  if (prefersReducedMotion()) {
    region.dataset.motion = 'off';
    return;
  }
  let visible = false;
  let hovered = false;
  const apply = (): void => {
    region.dataset.motion = visible && !hovered ? 'running' : 'paused';
  };
  region.dataset.motion = 'paused';
  region.addEventListener('mouseenter', () => {
    hovered = true;
    apply();
  });
  region.addEventListener('mouseleave', () => {
    hovered = false;
    apply();
  });
  const observer = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    apply();
  });
  observer.observe(region);
}

export interface SquareWalkHandles {
  destroy: () => void;
}

/**
 * The square walk: cards rise in, then the scroll third, hover or focus
 * decides which card is the active step.
 */
export function initSquareWalk(section: HTMLElement): SquareWalkHandles {
  const list = section.querySelector<HTMLElement>('.walk-list');
  const cards = [...section.querySelectorAll<HTMLElement>('.walk-card')];
  if (!list || cards.length === 0) return { destroy: () => undefined };
  const reduced = prefersReducedMotion();
  const timers: number[] = [];
  let override: number | null = null;

  const setActive = (index: number): void => {
    cards.forEach((card, position) => {
      if (position === index) card.setAttribute('aria-current', 'step');
      else card.removeAttribute('aria-current');
    });
  };

  const activeFromScroll = (): number => {
    if (window.innerWidth < 768) {
      const middle = window.innerHeight / 2;
      let active = 0;
      cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();
        if (rect.top + rect.height / 2 <= middle) active = index;
      });
      return active;
    }
    const top = section.getBoundingClientRect().top + window.scrollY;
    const travel = section.offsetHeight - window.innerHeight;
    const progress = travel <= 0 ? 0 : (window.scrollY - top) / travel;
    const clamped = Math.max(0, Math.min(1, progress));
    if (clamped < 1 / 3) return 0;
    return clamped < 2 / 3 ? 1 : 2;
  };

  const refresh = (): void => {
    setActive(override ?? activeFromScroll());
  };

  cards.forEach((card, index) => {
    card.addEventListener('mouseenter', () => {
      override = index;
      refresh();
    });
    card.addEventListener('mouseleave', () => {
      override = null;
      refresh();
    });
    card.addEventListener('focus', () => {
      override = index;
      refresh();
    });
    card.addEventListener('blur', () => {
      override = null;
      refresh();
    });
  });

  if (reduced) {
    for (const card of cards) card.dataset.state = 'shown';
    setActive(0);
  } else {
    for (const card of cards) card.dataset.state = 'hidden';
    let risen = false;
    const rise = (): void => {
      if (risen) return;
      if (list.getBoundingClientRect().top > window.innerHeight * 0.8) return;
      risen = true;
      cards.forEach((card, index) => {
        const start = index * RISE_STAGGER_MS;
        timers.push(
          window.setTimeout(() => {
            card.dataset.state = 'rising';
          }, start),
        );
        timers.push(
          window.setTimeout(() => {
            card.dataset.state = 'shown';
          }, start + RISE_DURATION_MS),
        );
      });
      window.removeEventListener('scroll', rise);
    };
    window.addEventListener('scroll', rise, { passive: true });
    rise();
  }

  const onScroll = (): void => refresh();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  refresh();

  return {
    destroy: () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    },
  };
}
