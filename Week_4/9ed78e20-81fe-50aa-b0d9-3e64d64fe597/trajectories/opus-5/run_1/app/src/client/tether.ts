import { all, formatCalendarDate, narrow, one, reducedMotion, setStatus } from './dom.js';
import { settleChart } from './motion.js';

const DRAW_MS = 570;
const FADE_MS = 250;
const GLIDE_MS = 450;

type Claim = {
  readonly id: string;
  readonly number: number;
  readonly benchmark: string;
  readonly eval_date: string;
  readonly model_row_id: string;
  readonly comparator_row_id: string;
  readonly delta: string;
};

type Elements = {
  readonly chart: HTMLElement;
  readonly plot: HTMLElement;
  readonly line: HTMLElement;
  readonly bracketLabel: HTMLElement | null;
  readonly delta: HTMLElement;
  readonly status: HTMLElement | null;
};

let active: string | null = null;
let pinned = false;
let instant = false;
let timers: number[] = [];

function still(): boolean {
  return instant || reducedMotion();
}

function clearTimers(): void {
  for (const timer of timers) window.clearTimeout(timer);
  timers = [];
}

function later(run: () => void, delay: number): void {
  if (delay <= 0) {
    run();
    return;
  }
  timers.push(window.setTimeout(run, delay));
}

function rowOf(id: string): HTMLElement | null {
  return one(`.bar-row[data-row-id="${id}"]`);
}

function describe(claim: Claim): string {
  const model = rowOf(claim.model_row_id);
  const comparator = rowOf(claim.comparator_row_id);
  const name = (row: HTMLElement | null): string =>
    one('.bar-name', row ?? document)?.textContent?.trim() ?? '';
  const score = (row: HTMLElement | null): string =>
    one('.bar-score', row ?? document)?.textContent?.trim() ?? '';
  return `Claim ${claim.number}: ${claim.benchmark}, ${name(model)} ${score(model)} versus ${name(
    comparator,
  )} ${score(comparator)}, evaluated ${formatCalendarDate(claim.eval_date)}.`;
}

function setAddress(claimId: string | null): void {
  const url = new URL(window.location.href);
  if (claimId === null) url.searchParams.delete('claim');
  else url.searchParams.set('claim', claimId);
  window.history.replaceState(window.history.state, '', url.toString());
}

function placeLine(
  elements: Elements,
  marker: HTMLElement,
  cited: readonly HTMLElement[],
  claim: Claim,
): void {
  const line = elements.line;
  if (narrow()) {
    const plot = elements.plot.getBoundingClientRect();
    const tops = cited.map((row) => row.getBoundingClientRect());
    const top = Math.min(...tops.map((rect) => rect.top)) - plot.top;
    const bottom = Math.max(...tops.map((rect) => rect.bottom)) - plot.top;
    line.style.top = `${top}px`;
    line.style.height = `${Math.max(8, bottom - top)}px`;
    line.style.width = '';
    line.style.transform = '';
    if (elements.bracketLabel !== null) {
      elements.bracketLabel.textContent = `Claim ${claim.number}`;
    }
    return;
  }
  const from = marker.getBoundingClientRect();
  const boxes = cited.map((row) => row.getBoundingClientRect());
  const target = {
    left: Math.min(...boxes.map((rect) => rect.left)),
    top: Math.min(...boxes.map((rect) => rect.top)),
    bottom: Math.max(...boxes.map((rect) => rect.bottom)),
  };
  const startX = from.left + from.width / 2;
  const startY = from.top + from.height / 2;
  const endX = target.left;
  const endY = (target.top + target.bottom) / 2;
  const length = Math.hypot(endX - startX, endY - startY);
  const angle = Math.atan2(endY - startY, endX - startX);
  line.style.left = `${startX}px`;
  line.style.top = `${startY}px`;
  line.style.height = '2px';
  line.style.width = `${length}px`;
  line.style.transition = 'none';
  line.style.transform = `rotate(${angle}rad) scaleX(0)`;
  if (elements.bracketLabel !== null) elements.bracketLabel.textContent = '';
  if (still()) {
    line.style.transform = `rotate(${angle}rad) scaleX(1)`;
    return;
  }
  window.requestAnimationFrame(() => {
    line.style.transition = `transform ${DRAW_MS}ms cubic-bezier(.22,.61,.36,1)`;
    line.style.transform = `rotate(${angle}rad) scaleX(1)`;
  });
}

function placeDelta(elements: Elements, cited: readonly HTMLElement[]): void {
  const plot = elements.plot.getBoundingClientRect();
  const boxes = cited.map((row) => row.getBoundingClientRect());
  const tracks = cited
    .map((row) => one('.bar-track', row))
    .filter((track): track is HTMLElement => track !== null)
    .map((track) => track.getBoundingClientRect());
  const right = tracks.length === 0 ? plot.right : Math.max(...tracks.map((rect) => rect.right));
  const middle =
    (Math.min(...boxes.map((rect) => rect.top)) + Math.max(...boxes.map((rect) => rect.bottom))) / 2;
  elements.delta.style.left = `${right - plot.left - 80}px`;
  elements.delta.style.top = `${middle - plot.top - 14}px`;
  elements.delta.classList.add('is-active');
}

function countDelta(label: HTMLElement, delta: string): void {
  const sign = delta.startsWith('-') ? '-' : '+';
  const magnitude = Number.parseFloat(delta.replace(/^[+-]/, ''));
  const decimals = (delta.split('.')[1] ?? '').length;
  const render = (value: number): string => `${sign}${value.toFixed(decimals)}`;
  if (still()) {
    label.textContent = delta;
    return;
  }
  const started = performance.now();
  const step = (now: number): void => {
    const progress = Math.min(1, (now - started) / DRAW_MS);
    label.textContent = render(magnitude * progress);
    if (progress < 1 && label.classList.contains('is-active')) {
      window.requestAnimationFrame(step);
      return;
    }
    if (label.classList.contains('is-active')) label.textContent = delta;
  };
  label.textContent = render(0);
  window.requestAnimationFrame(step);
}

function citedRows(claim: Claim): HTMLElement[] {
  return [rowOf(claim.model_row_id), rowOf(claim.comparator_row_id)].filter(
    (row): row is HTMLElement => row !== null,
  );
}

function engage(elements: Elements, claims: readonly Claim[], claimId: string, animate: boolean): void {
  const claim = claims.find((candidate) => candidate.id === claimId);
  if (claim === undefined) return;
  const marker = one<HTMLButtonElement>(`.claim-marker[data-claim="${claimId}"]`);
  if (marker === null) return;
  clearTimers();
  settleChart(elements.chart);
  active = claimId;
  instant = !animate;

  setAddress(claimId);
  marker.setAttribute('aria-pressed', 'true');

  const cited = citedRows(claim);
  const citedIds = new Set([claim.model_row_id, claim.comparator_row_id]);

  const drawLine = (): void => {
    elements.line.dataset.tetherLine = claimId;
    placeLine(elements, marker, cited, claim);
  };

  const fadeRows = (): void => {
    for (const row of all('.bar-row')) {
      const id = row.dataset.rowId ?? '';
      const isCited = citedIds.has(id);
      row.dataset.cited = isCited ? 'true' : 'false';
      row.classList.toggle('is-cited', isCited);
    }
  };

  const chartRect = elements.chart.getBoundingClientRect();
  const offScreen = chartRect.top > window.innerHeight * 0.9 || chartRect.bottom < 0;
  if (offScreen && animate) {
    elements.chart.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  } else if (offScreen) {
    elements.chart.scrollIntoView({ behavior: 'auto', block: 'center' });
  }

  const glide = offScreen && animate && !reducedMotion() ? GLIDE_MS : 0;
  later(() => {
    drawLine();
    fadeRows();
    placeDelta(elements, cited);
    countDelta(elements.delta, claim.delta);
    setStatus(elements.status, describe(claim));
  }, glide);
}

function release(elements: Elements, claims: readonly Claim[], animate: boolean): void {
  const claimId = active;
  if (claimId === null) return;
  const claim = claims.find((candidate) => candidate.id === claimId);
  const marker = one<HTMLButtonElement>(`.claim-marker[data-claim="${claimId}"]`);
  clearTimers();
  active = null;
  pinned = false;

  instant = !animate;
  const stepDelay = animate && !reducedMotion() ? 1 : 0;
  setStatus(elements.status, claim === undefined ? '' : `Claim ${claim.number} released.`);

  later(() => {
    elements.delta.classList.remove('is-active');
    elements.delta.textContent = '';
  }, stepDelay * FADE_MS);

  later(() => {
    for (const row of all('.bar-row')) {
      row.dataset.cited = 'true';
      row.classList.remove('is-cited');
    }
  }, stepDelay * (FADE_MS + 20));

  later(() => {
    const line = elements.line;
    if (still() || narrow()) {
      line.dataset.tetherLine = '';
      if (elements.bracketLabel !== null) elements.bracketLabel.textContent = '';
      return;
    }
    const current = line.style.transform.replace('scaleX(1)', 'scaleX(0)');
    line.style.transition = `transform ${DRAW_MS}ms cubic-bezier(.22,.61,.36,1)`;
    line.style.transform = current;
    later(() => {
      line.dataset.tetherLine = '';
    }, DRAW_MS);
  }, stepDelay * (FADE_MS + 40));

  later(
    () => {
      if (marker !== null) marker.setAttribute('aria-pressed', 'false');
      setAddress(null);
    },
    stepDelay * (FADE_MS + DRAW_MS + 60),
  );
}

export function startClaimTether(): void {
  const article = one('[data-model-route]');
  const chart = one('[data-chart]');
  const plot = one('.chart-plot');
  const line = one('[data-tether-line]');
  const delta = one('[data-tether-delta]');
  if (article === null || chart === null || plot === null || line === null || delta === null) return;
  const claims = JSON.parse(article.dataset.claims ?? '[]') as Claim[];
  const elements: Elements = {
    chart,
    plot,
    line,
    bracketLabel: one('.tether-bracket-label'),
    delta,
    status: one('[data-tether-status]'),
  };

  for (const marker of all<HTMLButtonElement>('.claim-marker')) {
    const claimId = marker.dataset.claim ?? '';
    marker.addEventListener('click', () => {
      if (active === claimId && pinned) {
        release(elements, claims, true);
        marker.focus();
        return;
      }
      if (active !== null && active !== claimId) release(elements, claims, false);
      pinned = true;
      engage(elements, claims, claimId, true);
    });
    marker.addEventListener('mouseenter', () => {
      if (pinned || active === claimId) return;
      engage(elements, claims, claimId, true);
    });
    marker.addEventListener('mouseleave', () => {
      if (pinned) return;
      release(elements, claims, true);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || active === null) return;
    const open = one('dialog[open]');
    if (open !== null) return;
    release(elements, claims, true);
  });

  const reposition = (): void => {
    if (active === null) return;
    const claim = claims.find((candidate) => candidate.id === active);
    const marker = one<HTMLButtonElement>(`.claim-marker[data-claim="${active}"]`);
    if (claim === undefined || marker === null) return;
    const cited = citedRows(claim);
    const previous = line.style.transition;
    line.style.transition = 'none';
    placeLine(elements, marker, cited, claim);
    line.style.transform = line.style.transform.replace('scaleX(0)', 'scaleX(1)');
    line.style.transition = previous;
    placeDelta(elements, cited);
  };
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);

  const fromAddress = new URL(window.location.href).searchParams.get('claim');
  if (fromAddress !== null && claims.some((claim) => claim.id === fromAddress)) {
    pinned = true;
    window.requestAnimationFrame(() => {
      engage(elements, claims, fromAddress, false);
    });
  }
}
