import { Me } from './api';
import { el, fieldError, labelled, prefersReducedMotion } from './dom';
import { fields } from './layout';
import { formatDisplayDate, parseDmy } from '../../lib/format';

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
const COUNTER_MS = 200;
const SETTLE_MS = 420;

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

interface Stage {
  element: HTMLElement;
  update(doc: YearDoc): void;
  dispose(): void;
}

export function createStage(options: {
  me: Me;
  doc: YearDoc;
  onRequestSwap: (opener: HTMLElement) => void;
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
  const counters = el('div', { class: 'counters' }, [
    el('div', { class: 'counter-block' }, [planningCounter, el('span', { class: 'counter-caption', text: me.household.planningName })]),
    el('div', { class: 'counter-block' }, [otherCounter, el('span', { class: 'counter-caption', text: me.household.otherName })]),
  ]);
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
    fields(),
    el('div', { class: 'stage-inner' }, [
      headline,
      counters,
      strip,
      stickers,
      el('div', { class: 'stage-day' }, [labelled('Day', dayBox), dayAnswer]),
      swapButton,
    ]),
  ]);

  swapButton.addEventListener('click', () => options.onRequestSwap(swapButton));

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

  function moveCounters(targetPlanning: number, targetOther: number, instant: boolean): void {
    window.cancelAnimationFrame(frame);
    if (reduced || instant) {
      paintCounters(targetPlanning, targetOther);
      return;
    }
    const startPlanning = displayedPlanning;
    const startOther = displayedOther;
    const started = performance.now();
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - started) / COUNTER_MS);
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

  /** Stickers already in place rest; a sticker the sweep reaches now drops in unless the page just arrived. */
  function paintStickers(upToIndex: number, arriving: boolean): void {
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
          'data-state': reduced || arriving ? 'resting' : 'settling',
          text: name,
        });
        stickers.append(node);
        if (!reduced && !arriving) {
          const settling = node;
          settling.getBoundingClientRect();
          window.requestAnimationFrame(() => settling.classList.add('is-down'));
          window.setTimeout(() => settling.setAttribute('data-state', 'resting'), SETTLE_MS);
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

  function setFocused(index: number, atTop: boolean, arriving = false): void {
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
      moveCounters(doc.nights.planning, doc.nights.other, true);
      paintStickers(doc.days.length - 1, true);
    } else {
      moveCounters(prefixCount(focusedIndex, 'planning'), prefixCount(focusedIndex, 'other'), arriving);
      paintStickers(focusedIndex, arriving);
    }
    writeAnswer(day);
  }

  function indexFromScroll(): { index: number; atTop: boolean } {
    const scroll = Math.max(0, Math.min(SWEEP_PIXELS, window.scrollY));
    const index = Math.min(doc.days.length - 1, Math.floor((scroll * doc.days.length) / SWEEP_PIXELS));
    return { index, atTop: scroll === 0 };
  }

  function syncFromScroll(arriving = false): void {
    const { index, atTop } = indexFromScroll();
    setFocused(index, atTop, arriving);
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

  /** Answers for the typed day without moving the focused day; a half-typed date waits for Enter. */
  function answerTypedDay(complete: boolean): void {
    const typed = dayBox.value.trim();
    fieldError(dayBox, null);
    if (typed === '') return;
    const date = parseDmy(typed);
    if (!date) {
      if (complete || typed.length >= 10) fieldError(dayBox, 'Enter a real date as DD/MM/YYYY.');
      return;
    }
    const index = doc.days.findIndex((day) => day.date === date);
    if (index < 0) dayAnswer.textContent = `Choose a day in ${doc.year}.`;
    else writeAnswer(doc.days[index] as YearDay);
  }

  dayBox.addEventListener('input', () => answerTypedDay(false));
  dayBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') answerTypedDay(true);
  });

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onMotionChange = (): void => {
    reduced = motionQuery.matches;
    stickers.replaceChildren();
    if (reduced) setFocused(focusedIndex, true, true);
    else syncFromScroll(true);
  };
  motionQuery.addEventListener('change', onMotionChange);

  buildBars();
  syncFromScroll(true);

  return {
    element: region,
    update(next: YearDoc): void {
      const keptDate = (doc.days[focusedIndex] as YearDay | undefined)?.date;
      doc = next;
      buildBars();
      const index = keptDate ? Math.max(0, next.days.findIndex((day) => day.date === keptDate)) : focusedIndex;
      stickers.replaceChildren();
      setFocused(index, Math.max(0, Math.min(SWEEP_PIXELS, window.scrollY)) === 0, true);
    },
    dispose(): void {
      window.removeEventListener('scroll', onScroll);
      motionQuery.removeEventListener('change', onMotionChange);
      if (frame) window.cancelAnimationFrame(frame);
    },
  };
}
