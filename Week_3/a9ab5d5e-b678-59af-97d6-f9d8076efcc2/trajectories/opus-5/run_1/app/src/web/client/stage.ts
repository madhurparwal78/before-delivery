import { Me } from './api';
import { el, prefersReducedMotion } from './dom';
import { formatDisplayDate, formatDmy, parseDmy } from '../../lib/format';

export interface YearDay {
  date: string;
  owner: 'planning' | 'other' | null;
  ruleId: string | null;
  kind: string | null;
  ruleName: string | null;
  beats: string | null;
  exchangeAt: string | null;
  exchangeZone: string | null;
}

export interface YearDoc {
  householdId: string;
  year: number;
  days: YearDay[];
  nights: { planning: number; other: number };
}

const SWEEP_PIXELS = 1200;

const kindWords: Record<string, string> = {
  swap: 'Swap',
  holiday: 'Holiday',
  school_break: 'School break',
  vacation: 'Vacation',
  base: 'Base rotation',
};

export function dayAnswerText(day: YearDay, me: Me): string {
  const date = formatDisplayDate(day.date);
  if (!day.owner || !day.ruleName || !day.kind) return `${date}: no plan`;
  const name = day.owner === 'planning' ? me.household.planningName : me.household.otherName;
  const kind = kindWords[day.kind] ?? day.kind;
  const beats = day.beats ? `, beats ${day.beats}` : '';
  return `${date}: ${name} — ${day.ruleName} (${kind})${beats}`;
}

interface OverrideRun {
  startIndex: number;
  ruleName: string;
  beats: string;
  owner: 'planning' | 'other' | null;
}

function overrideRuns(days: YearDay[]): OverrideRun[] {
  const runs: OverrideRun[] = [];
  let previous: YearDay | null = null;
  days.forEach((day, index) => {
    const isRun = day.beats !== null && day.ruleId !== null;
    if (!isRun) {
      previous = null;
      return;
    }
    if (previous && previous.ruleId === day.ruleId && previous.beats === day.beats) {
      previous = day;
      return;
    }
    runs.push({
      startIndex: index,
      ruleName: day.ruleName ?? '',
      beats: day.beats as string,
      owner: day.owner,
    });
    previous = day;
  });
  return runs;
}

export interface Stage {
  element: HTMLElement;
  update(doc: YearDoc): void;
  focusDate(date: string): void;
  dispose(): void;
}

export function createStage(options: {
  me: Me;
  doc: YearDoc;
  onRequestSwap: (firstNight: string | null, opener: HTMLElement) => void;
}): Stage {
  let doc = options.doc;
  const me = options.me;
  let focusedIndex = 0;
  let reduced = prefersReducedMotion();

  const headline = el('h1', { class: 'stage-headline', text: 'Who has tonight, and why.' });
  const planningCounter = el('div', {
    role: 'status',
    'aria-label': `Nights with ${me.household.planningName}`,
    class: 'counter counter-planning',
    'aria-live': 'off',
  });
  const otherCounter = el('div', {
    role: 'status',
    'aria-label': `Nights with ${me.household.otherName}`,
    class: 'counter counter-other',
    'aria-live': 'off',
  });
  const counters = el('div', { class: 'counters' }, [planningCounter, otherCounter]);
  const stickers = el('div', { class: 'stickers' });
  const strip = el('div', {
    role: 'slider',
    'aria-label': 'Year strip',
    tabindex: '0',
    class: 'year-strip',
    'aria-valuemin': '0',
  });
  const dayBox = el('input', { type: 'text', 'aria-label': 'Day', class: 'day-box', autocomplete: 'off' });
  const dayAnswer = el('p', { role: 'status', 'aria-label': 'Day answer', class: 'day-answer' });
  const swapButton = el('button', { type: 'button', class: 'pill stage-pill', text: 'Request a swap' });
  const region = el('section', { role: 'region', class: 'stage' }, [
    el('div', { class: 'stage-fields', 'aria-hidden': 'true' }, [
      el('div', { class: 'field-mint' }),
      el('div', { class: 'field-pink' }),
    ]),
    el('div', { class: 'stage-inner' }, [
      headline,
      counters,
      stickers,
      strip,
      el('div', { class: 'stage-day' }, [dayBox, dayAnswer]),
      swapButton,
    ]),
  ]);

  swapButton.addEventListener('click', () => {
    const day = doc.days[focusedIndex];
    options.onRequestSwap(day ? day.date : null, swapButton);
  });

  const bars: HTMLElement[] = [];

  function buildBars(): void {
    bars.length = 0;
    const fragment = document.createDocumentFragment();
    for (const day of doc.days) {
      const bar = el('span', {
        class: 'day-bar',
        'aria-hidden': 'true',
        'data-date': day.date,
        'data-owner': day.owner ?? 'none',
      });
      bars.push(bar);
      fragment.append(bar);
    }
    strip.replaceChildren(fragment);
    strip.setAttribute('aria-valuemax', String(doc.days.length - 1));
  }

  let displayedPlanning = 0;
  let displayedOther = 0;
  let frame = 0;

  function prefixCount(index: number, owner: 'planning' | 'other'): number {
    let count = 0;
    for (let position = 0; position <= index && position < doc.days.length; position += 1) {
      if ((doc.days[position] as YearDay).owner === owner) count += 1;
    }
    return count;
  }

  function paintCounters(planning: number, other: number): void {
    displayedPlanning = planning;
    displayedOther = other;
    planningCounter.textContent = String(planning);
    otherCounter.textContent = String(other);
  }

  function moveCounters(targetPlanning: number, targetOther: number): void {
    if (frame) window.cancelAnimationFrame(frame);
    if (reduced) {
      paintCounters(targetPlanning, targetOther);
      return;
    }
    const startPlanning = displayedPlanning;
    const startOther = displayedOther;
    const started = performance.now();
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - started) / 200);
      const eased = 1 - (1 - progress) * (1 - progress);
      paintCounters(
        Math.round(startPlanning + (targetPlanning - startPlanning) * eased),
        Math.round(startOther + (targetOther - startOther) * eased),
      );
      if (progress < 1) frame = window.requestAnimationFrame(step);
      else paintCounters(targetPlanning, targetOther);
    };
    frame = window.requestAnimationFrame(step);
  }

  function paintStickers(upToIndex: number): void {
    const runs = overrideRuns(doc.days).filter((run) => run.startIndex <= upToIndex);
    const wanted = new Map(runs.map((run) => [run.startIndex, run]));
    for (const existing of [...stickers.children] as HTMLElement[]) {
      const index = Number.parseInt(existing.dataset.runIndex ?? '-1', 10);
      if (!wanted.has(index)) existing.remove();
    }
    runs.forEach((run, position) => {
      const name = `${run.ruleName} beats ${run.beats}`;
      let node = stickers.querySelector<HTMLElement>(`[data-run-index="${run.startIndex}"]`);
      if (!node) {
        node = el('span', {
          role: 'img',
          'aria-label': name,
          class: `sticker sticker-${run.owner ?? 'none'}`,
          'data-run-index': String(run.startIndex),
          'data-state': reduced ? 'resting' : 'settling',
          text: name,
        });
        stickers.append(node);
        if (!reduced) {
          const settling = node;
          window.setTimeout(() => settling.setAttribute('data-state', 'resting'), 420);
        }
      }
      node.style.setProperty('--tilt', `${position % 2 === 0 ? -4 : 3}deg`);
    });
  }

  function paintField(index: number, atTop: boolean): void {
    const day = doc.days[index];
    if (reduced || atTop) {
      region.setAttribute('data-field', 'split');
      return;
    }
    region.setAttribute('data-field', day && day.owner ? day.owner : 'split');
  }

  function writeAnswer(day: YearDay): void {
    dayAnswer.textContent = dayAnswerText(day, me);
  }

  function setFocused(index: number, atTop: boolean): void {
    focusedIndex = Math.max(0, Math.min(doc.days.length - 1, index));
    const day = doc.days[focusedIndex] as YearDay;
    region.setAttribute('data-day', day.date);
    region.setAttribute('aria-label', `Year ${doc.year}`);
    strip.setAttribute('aria-valuenow', String(focusedIndex));
    strip.setAttribute('aria-valuetext', formatDisplayDate(day.date));
    for (const [position, bar] of bars.entries()) {
      bar.classList.toggle('is-focused', position === focusedIndex);
    }
    paintField(focusedIndex, atTop);
    if (reduced) {
      paintCounters(doc.nights.planning, doc.nights.other);
      paintStickers(doc.days.length - 1);
    } else {
      moveCounters(prefixCount(focusedIndex, 'planning'), prefixCount(focusedIndex, 'other'));
      paintStickers(focusedIndex);
    }
    writeAnswer(day);
  }

  function indexFromScroll(): { index: number; atTop: boolean } {
    const scroll = Math.max(0, Math.min(SWEEP_PIXELS, window.scrollY));
    const index = Math.min(doc.days.length - 1, Math.floor((scroll * doc.days.length) / SWEEP_PIXELS));
    return { index, atTop: scroll === 0 };
  }

  function syncFromScroll(): void {
    const { index, atTop } = indexFromScroll();
    setFocused(index, atTop);
  }

  function scrollToIndex(index: number): void {
    if (reduced) {
      setFocused(index, false);
      return;
    }
    const target = Math.ceil((index * SWEEP_PIXELS) / doc.days.length);
    window.scrollTo({ top: target, behavior: 'auto' });
    setFocused(index, target === 0);
  }

  const onScroll = (): void => {
    syncFromScroll();
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  strip.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      scrollToIndex(Math.min(doc.days.length - 1, focusedIndex + 1));
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      scrollToIndex(Math.max(0, focusedIndex - 1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      scrollToIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      scrollToIndex(doc.days.length - 1);
    }
  });

  strip.addEventListener('pointerdown', (event) => {
    const rect = strip.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    strip.focus();
    scrollToIndex(Math.min(doc.days.length - 1, Math.floor(ratio * doc.days.length)));
  });

  dayBox.addEventListener('input', () => {
    const date = parseDmy(dayBox.value);
    if (!date) return;
    const index = doc.days.findIndex((day) => day.date === date);
    if (index < 0) {
      dayAnswer.textContent = `Choose a day in ${doc.year}.`;
      return;
    }
    writeAnswer(doc.days[index] as YearDay);
  });

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onMotionChange = (): void => {
    reduced = motionQuery.matches;
    stickers.replaceChildren();
    if (reduced) setFocused(focusedIndex, true);
    else syncFromScroll();
  };
  motionQuery.addEventListener('change', onMotionChange);

  buildBars();
  syncFromScroll();

  return {
    element: region,
    update(next: YearDoc): void {
      const keptDate = (doc.days[focusedIndex] as YearDay | undefined)?.date;
      doc = next;
      buildBars();
      const index = keptDate ? Math.max(0, next.days.findIndex((day) => day.date === keptDate)) : focusedIndex;
      stickers.replaceChildren();
      setFocused(index, Math.max(0, Math.min(SWEEP_PIXELS, window.scrollY)) === 0);
    },
    focusDate(date: string): void {
      const index = doc.days.findIndex((day) => day.date === date);
      if (index >= 0) scrollToIndex(index);
      dayBox.value = formatDmy(date);
    },
    dispose(): void {
      window.removeEventListener('scroll', onScroll);
      motionQuery.removeEventListener('change', onMotionChange);
      if (frame) window.cancelAnimationFrame(frame);
    },
  };
}
