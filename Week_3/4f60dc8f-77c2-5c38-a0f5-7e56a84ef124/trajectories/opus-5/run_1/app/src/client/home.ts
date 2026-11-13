import { onBreakpointChange, qs, qsa, reducedMotion, tween } from './core.js';
import { initCaseStudySubjects } from './scenes.js';

const MORPH_MS = 600;

const runMorph = (figure: HTMLElement, reverse: boolean): void => {
  if (reducedMotion()) {
    figure.dataset.transition = 'done';
    figure.dataset.morph = reverse ? '0.000' : figure.dataset.morph ?? '0.000';
    return;
  }
  figure.dataset.transition = 'morphing';
  tween(
    MORPH_MS,
    (progress) => {
      figure.style.transform = reverse
        ? `scale(${1 + (1 - progress) * 0.06})`
        : `scale(${1.06 - progress * 0.06})`;
    },
    () => {
      figure.style.transform = '';
      figure.dataset.transition = 'done';
    },
  );
};

export const initClaySwitch = (): void => {
  const switchButton = qs<HTMLButtonElement>('[data-clay-switch]');
  const figure = qs<HTMLElement>('.case-subject');
  if (switchButton === null || figure === null) return;
  let stop: (() => void) | null = null;
  switchButton.addEventListener('click', () => {
    const on = switchButton.getAttribute('aria-checked') === 'true';
    const next = !on;
    switchButton.setAttribute('aria-checked', next ? 'true' : 'false');
    stop?.();
    const from = Number(figure.dataset.morph ?? '0');
    const to = next ? 1 : 0;
    stop = tween(MORPH_MS, (progress) => {
      figure.dataset.morph = (from + (to - from) * progress).toFixed(3);
    });
  });
};

/** The tile's subject lifts out of the grid and morphs into the detail subject. */
export const initCaseStudyTransition = (): void => {
  const main = qs<HTMLElement>('[data-page]');
  if (main === null) return;
  let cachedHome: { html: string; scroll: number } | null = null;

  const mountDetail = (): void => {
    initCaseStudySubjects();
    initClaySwitch();
    const figure = qs<HTMLElement>('.case-subject');
    if (figure !== null) runMorph(figure, false);
  };

  const mountHome = (): void => {
    initCaseStudySubjects();
    initDeck();
  };

  document.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest('a');
    if (link === null || link === undefined) return;
    const tile = link.closest('[data-tile]');
    if (tile === null) return;
    const href = link.getAttribute('href');
    if (href === null || !href.startsWith('/work/')) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const subject = qs<HTMLElement>('[data-transition]', tile);
    if (subject !== null) subject.dataset.transition = 'morphing';
    void (async () => {
      const response = await fetch(href, { headers: { Accept: 'text/html' } });
      if (!response.ok) {
        window.location.assign(href);
        return;
      }
      const document_ = new DOMParser().parseFromString(await response.text(), 'text/html');
      const nextMain = document_.querySelector('[data-page]');
      if (nextMain === null) {
        window.location.assign(href);
        return;
      }
      cachedHome = { html: main.innerHTML, scroll: window.scrollY };
      main.innerHTML = nextMain.innerHTML;
      document.title = document_.title;
      history.pushState({ gloamwork: 'case-study' }, '', href);
      window.scrollTo(0, 0);
      mountDetail();
    })();
  });

  window.addEventListener('popstate', () => {
    if (cachedHome === null) {
      window.location.reload();
      return;
    }
    main.innerHTML = cachedHome.html;
    const scroll = cachedHome.scroll;
    cachedHome = null;
    mountHome();
    window.scrollTo(0, scroll);
    const subject = qs<HTMLElement>('[data-tile] [data-transition]');
    if (subject !== null) runMorph(subject, true);
  });
};

export const initDeck = (): void => {
  const list = qs<HTMLElement>('[data-case-studies]');
  if (list === null) return;
  const tiles = qsa<HTMLElement>('[data-tile]', list);
  if (tiles.length === 0) return;
  let index = 0;
  let deckMode = false;

  const paint = (): void => {
    list.dataset.deckIndex = String(index + 1);
    if (!deckMode) {
      for (const tile of tiles) {
        tile.style.transform = '';
        tile.style.zIndex = '';
        tile.removeAttribute('aria-hidden');
        for (const link of qsa<HTMLAnchorElement>('a', tile)) link.removeAttribute('tabindex');
      }
      return;
    }
    tiles.forEach((tile, position) => {
      const offset = position - index;
      const front = offset === 0;
      tile.style.zIndex = String(100 - Math.abs(offset));
      tile.style.transform =
        offset < 0
          ? 'translateX(-120%) rotate(-6deg)'
          : `translate3d(${offset * 14}px, ${offset * 10}px, ${-offset * 40}px) scale(${1 - offset * 0.05})`;
      tile.setAttribute('aria-hidden', front ? 'false' : 'true');
      for (const link of qsa<HTMLAnchorElement>('a', tile))
        if (front) link.removeAttribute('tabindex');
        else link.setAttribute('tabindex', '-1');
    });
  };

  const advance = (delta: number): void => {
    const next = Math.min(tiles.length - 1, Math.max(0, index + delta));
    if (next === index) {
      paint();
      return;
    }
    index = next;
    paint();
    qs<HTMLAnchorElement>('a', tiles[index])?.focus();
  };

  onBreakpointChange((phone) => {
    deckMode = phone;
    list.dataset.deck = phone ? 'true' : 'false';
    paint();
  });

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let dragging = false;
  let axis: 'none' | 'horizontal' | 'vertical' = 'none';

  list.addEventListener('pointerdown', (event) => {
    if (!deckMode) return;
    dragging = true;
    axis = event.pointerType === 'touch' ? 'none' : 'horizontal';
    startX = event.clientX;
    startY = event.clientY;
    startTime = performance.now();
  });

  list.addEventListener('pointermove', (event) => {
    if (!dragging || !deckMode) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (axis === 'none') {
      if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
      axis = Math.abs(deltaX) >= Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }
    if (axis !== 'horizontal') return;
    const front = tiles[index];
    if (front !== undefined) front.style.transform = `translateX(${deltaX}px)`;
  });

  const release = (event: PointerEvent): void => {
    if (!dragging || !deckMode) {
      dragging = false;
      return;
    }
    dragging = false;
    const deltaX = event.clientX - startX;
    const elapsed = Math.max(1, performance.now() - startTime);
    const speed = Math.abs(deltaX) / elapsed;
    if (axis === 'horizontal' && (speed > 0.5 || Math.abs(deltaX) >= 120)) {
      advance(deltaX < 0 ? 1 : -1);
    } else {
      paint();
    }
    axis = 'none';
  };

  list.addEventListener('pointerup', release);
  list.addEventListener('pointercancel', release);

  list.addEventListener('keydown', (event) => {
    if (!deckMode) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      advance(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      advance(-1);
    }
  });
};
