import { all, one, reducedMotion } from './dom.js';

const BAR_STAGGER_MS = 60;
const BAR_GROW_MS = 500;

/** Calls back once for each element as it enters the viewport, however the visitor scrolls. */
function onEnterViewport(
  elements: readonly HTMLElement[],
  enter: (element: HTMLElement) => void,
): void {
  const pending = [...elements];
  if (pending.length === 0) return;
  let queued = false;
  const pass = (): void => {
    queued = false;
    for (const element of [...pending]) {
      if (element.getBoundingClientRect().top >= window.innerHeight * 0.94) continue;
      pending.splice(pending.indexOf(element), 1);
      enter(element);
    }
    if (pending.length === 0) {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    }
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(pass);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  pass();
}

export function startReveals(): void {
  const targets = all('[data-reveal]');
  if (reducedMotion()) {
    for (const target of targets) target.dataset.reveal = 'done';
    return;
  }
  onEnterViewport(targets, (element) => {
    element.dataset.reveal = 'done';
  });
}

/** Completes the chart's staggered entry at once, so motion never blocks input. */
export function settleChart(chart: HTMLElement): void {
  chart.dataset.chartEnter = 'running';
  chart.dataset.entered = 'true';
}

export function startChartEntry(): void {
  const chart = one('[data-chart]');
  if (chart === null) return;
  const bars = all('.bar-row', chart).length;
  if (reducedMotion()) {
    settleChart(chart);
    return;
  }
  onEnterViewport([chart], () => {
    chart.dataset.chartEnter = 'running';
    window.setTimeout(() => {
      chart.dataset.entered = 'true';
    }, BAR_GROW_MS + Math.max(0, bars - 1) * BAR_STAGGER_MS);
  });
}

export function startGalleryEntry(): void {
  const items = all('[data-gallery-item]');
  if (reducedMotion()) {
    for (const item of items) item.classList.add('is-shown');
    return;
  }
  onEnterViewport(items, (element) => {
    const index = items.indexOf(element);
    window.setTimeout(() => element.classList.add('is-shown'), index * 40);
  });
}

export function startThesisProgress(): void {
  const list = one('[data-theses]');
  if (list === null) return;
  const theses = all('.thesis', list);
  if (theses.length === 0) return;
  const fill = one('[data-progress-fill]');
  let queued = false;

  const update = (): void => {
    queued = false;
    const middle = window.innerHeight / 2;
    const first = theses[0] as HTMLElement;
    const last = theses[theses.length - 1] as HTMLElement;
    const firstTop = first.getBoundingClientRect().top;
    const lastBottom = last.getBoundingClientRect().bottom;
    const span = lastBottom - firstTop;
    const fraction = span <= 0 ? 0 : Math.min(1, Math.max(0, (middle - firstTop) / span));
    list.dataset.thesisProgress = fraction.toFixed(2);
    if (fill !== null) fill.style.setProperty('--progress', `${(fraction * 100).toFixed(2)}%`);

    let current: HTMLElement | null = null;
    for (const thesis of theses) {
      const rect = thesis.getBoundingClientRect();
      if (rect.top <= middle && rect.bottom >= middle) current = thesis;
    }
    if (current === null) current = middle < firstTop ? first : last;
    for (const thesis of theses) {
      if (thesis === current) thesis.dataset.current = 'true';
      else delete thesis.dataset.current;
    }
  };

  const schedule = (): void => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
}
