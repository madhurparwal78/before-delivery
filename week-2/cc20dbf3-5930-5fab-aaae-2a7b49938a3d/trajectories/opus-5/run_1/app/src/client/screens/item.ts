import { ApiFailure, freshKey, request } from '../api.js';
import { addDays, type LocalDate } from '../../domain/calendar.js';
import { FIELD_COPY } from '../../shared/errors.js';
import type { Hold, Item, LanesResponse } from '../../shared/api.js';
import { money, openDay, todayLocal } from '../format.js';
import type { Screen } from '../shell.js';
import {
  announce,
  clear,
  element,
  labelledField,
  liveRegion,
  markPending,
  prefersReducedMotion,
  region,
  setFieldError,
} from '../ui/dom.js';
import { renderLanes } from '../ui/lanes.js';

const HORIZON_DAYS = 28;
const MAX_LOAN_DAYS = 7;
const STEP_MS = 140;
const SETTLE_MS = 260;
const COUNTDOWN_MS = 420;
const FADE_MS = 240;

interface HoldAnswer {
  hold: Hold;
  units_free: number;
  unit_count: number;
}

export function itemScreen(itemId: string, onMissing: () => void): Screen {
  const heading = element('h1', {}, ['\u2026']);
  const card = element('div', { class: 'box' });
  const numeral = element('span', { class: 'numeral' }, ['0']);
  const availabilityText = element('span', { class: 'mono' }, ['']);
  const availability = region('Availability', [
    element('div', { class: 'availability' }, [numeral, availabilityText]),
  ]);
  const lanesContainer = element('div', { style: 'position:relative' });
  const lanesRegion = region('Unit lanes', [lanesContainer]);
  const claimResult = liveRegion('Claim result');

  const pickup = element('input', { id: 'pickup-date', type: 'date' });
  const returnDate = element('input', { id: 'return-date', type: 'date' });
  const holdButton = element('button', { type: 'button', class: 'primary', disabled: true });
  holdButton.textContent = 'Hold a unit';

  const datesBox = element('div', { class: 'box' }, [
    labelledField('Pickup date', pickup, 'pickup-date-error'),
    labelledField('Return date', returnDate, 'return-date-error'),
    holdButton,
  ]);

  const node = element('div', {}, [
    heading,
    element('div', { class: 'grid' }, [
      element('div', { class: 'span-4' }, [card, datesBox, availability]),
      element('div', { class: 'span-8' }, [lanesRegion]),
    ]),
    claimResult,
  ]);

  let item: Item | null = null;
  let lanes: LanesResponse | null = null;
  let settledLabel: string | null = null;
  let claimBar: HTMLElement | null = null;
  const timers: number[] = [];

  const clearTimers = (): void => {
    for (const timer of timers) window.clearTimeout(timer);
    timers.length = 0;
  };
  const later = (callback: () => void, delay: number): void => {
    timers.push(window.setTimeout(callback, delay));
  };

  const range = (): { start: LocalDate; end: LocalDate } | null =>
    pickup.value !== '' && returnDate.value !== ''
      ? { start: pickup.value, end: returnDate.value }
      : null;

  const paintAvailability = (): void => {
    if (item === null) return;
    const chosen = range();
    const free =
      chosen !== null && lanes !== null && lanes.units_free !== null
        ? lanes.units_free
        : item.units_free_today;
    numeral.textContent = String(free);
    availabilityText.textContent =
      chosen === null
        ? `of ${item.unit_count} units free today`
        : `of ${item.unit_count} units free for these dates`;
  };

  const paintLanes = (): void => {
    if (lanes === null) return;
    clear(lanesContainer);
    lanesContainer.appendChild(renderLanes(lanes, range()));
    if (settledLabel !== null && claimBar !== null) attachSettledBar(settledLabel);
  };

  const laneGroups = (): HTMLElement[] =>
    Array.from(lanesContainer.querySelectorAll<HTMLElement>('.lane'));

  function attachSettledBar(label: string): void {
    if (claimBar === null) return;
    const group = laneGroups().find(
      (candidate) => candidate.getAttribute('aria-label') === `Unit ${label}`,
    );
    if (group === undefined) return;
    claimBar.className = 'claim-bar settled';
    claimBar.removeAttribute('style');
    group.appendChild(claimBar);
  }

  function makeBar(floating: boolean): HTMLElement {
    const bar = element('div', {
      class: floating ? 'claim-bar floating instant' : 'claim-bar settled',
      role: 'img',
      'aria-label': 'Claim bar',
    });
    return bar;
  }

  function showPendingBar(): void {
    if (prefersReducedMotion()) return;
    const groups = laneGroups();
    const first = groups[0];
    if (first === undefined) return;
    const bar = makeBar(true);
    bar.style.transform = `translateY(${first.offsetTop - 16}px)`;
    lanesContainer.appendChild(bar);
    claimBar = bar;
    window.requestAnimationFrame(() => bar.classList.remove('instant'));
  }

  function countNumeral(target: number): void {
    const from = Number(numeral.textContent ?? '0');
    if (prefersReducedMotion() || from === target) {
      numeral.textContent = String(target);
      return;
    }
    const steps = Math.abs(target - from);
    const direction = target > from ? 1 : -1;
    const interval = Math.max(40, Math.round(COUNTDOWN_MS / steps));
    for (let step = 1; step <= steps; step += 1) {
      later(() => {
        numeral.textContent = String(from + direction * step);
      }, interval * step);
    }
  }

  /** The lane drop: the bar steps down one lane at a time and settles, or drops past. */
  function playDrop(assignedLaneIndex: number | null, onFinished: () => void): void {
    const groups = laneGroups();
    if (prefersReducedMotion()) {
      if (assignedLaneIndex === null) {
        removeBar();
      } else {
        if (claimBar === null) claimBar = makeBar(false);
        settledLabel = labelOf(groups, assignedLaneIndex);
        if (settledLabel !== null) attachSettledBar(settledLabel);
      }
      onFinished();
      return;
    }
    const bar = claimBar;
    if (bar === null) {
      onFinished();
      return;
    }
    const lastIndex = assignedLaneIndex ?? groups.length - 1;
    for (let index = 0; index <= lastIndex; index += 1) {
      const group = groups[index];
      if (group === undefined) continue;
      const top = group.offsetTop + 4;
      later(() => {
        bar.style.transform = `translateY(${top}px)`;
      }, STEP_MS * index);
    }
    const stepsDone = STEP_MS * (lastIndex + 1);
    if (assignedLaneIndex === null) {
      later(() => {
        bar.style.transform = `translateY(${lanesContainer.offsetHeight + 8}px)`;
        bar.classList.add('gone');
      }, stepsDone);
      later(() => {
        removeBar();
        onFinished();
      }, stepsDone + FADE_MS);
      return;
    }
    later(() => {
      settledLabel = labelOf(groups, assignedLaneIndex);
      if (settledLabel !== null) attachSettledBar(settledLabel);
      onFinished();
    }, stepsDone + SETTLE_MS);
  }

  function labelOf(groups: readonly HTMLElement[], laneIndex: number): string | null {
    const group = groups[laneIndex];
    const label = group?.getAttribute('aria-label') ?? null;
    return label === null ? null : label.replace(/^Unit /, '');
  }

  function removeBar(): void {
    claimBar?.remove();
    claimBar = null;
    settledLabel = null;
  }

  async function readLanes(): Promise<void> {
    if (item === null) return;
    const chosen = range();
    const query =
      chosen === null ? '' : `?start=${chosen.start}&end=${chosen.end}`;
    lanes = await request<LanesResponse>(`/api/items/${item.id}/lanes${query}`);
    paintLanes();
    paintAvailability();
  }

  function validateDates(): void {
    const today = todayLocal();
    const start = pickup.value;
    const end = returnDate.value;
    setFieldError('pickup-date-error', 'pickup-date', null);
    setFieldError('return-date-error', 'return-date', null);
    if (start !== '' && (!openDay(start) || start < today || start > addDays(today, HORIZON_DAYS - 1))) {
      setFieldError('pickup-date-error', 'pickup-date', FIELD_COPY.start_date);
    }
    if (end !== '' && start !== '' && (!openDay(end) || end < start || end > addDays(start, MAX_LOAN_DAYS))) {
      setFieldError('return-date-error', 'return-date', FIELD_COPY.end_date);
    }
    holdButton.disabled = start === '' || end === '';
  }

  const onDateChange = (): void => {
    if (pickup.value !== '') {
      returnDate.min = pickup.value;
      returnDate.max = addDays(pickup.value, MAX_LOAN_DAYS);
    }
    validateDates();
    void readLanes();
  };

  pickup.addEventListener('change', onDateChange);
  returnDate.addEventListener('change', onDateChange);
  for (const field of [pickup, returnDate]) {
    field.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        holdButton.click();
      }
    });
  }

  holdButton.addEventListener('click', () => {
    void placeHold();
  });

  async function placeHold(): Promise<void> {
    if (item === null) return;
    clearTimers();
    removeBar();
    setFieldError('pickup-date-error', 'pickup-date', null);
    setFieldError('return-date-error', 'return-date', null);
    const pending = markPending(holdButton, 'Finding a free unit\u2026');
    showPendingBar();
    try {
      const answer = await request<HoldAnswer>('/api/holds', {
        method: 'POST',
        idempotencyKey: freshKey(),
        body: { item_id: item.id, start_date: pickup.value, end_date: returnDate.value },
      });
      playDrop(answer.hold.unit.lane_index, () => {
        countNumeral(answer.units_free);
        announce(
          'Claim result',
          `Held unit ${answer.hold.unit.lane_index + 1} of ${answer.unit_count}, ${answer.units_free} units still free for these dates`,
        );
        void readLanes();
      });
    } catch (error) {
      const failure = error instanceof ApiFailure ? error : null;
      playDrop(null, () => {
        announce('Claim result', failure?.message ?? 'The network dropped. Try again.');
      });
      if (failure !== null) {
        if (failure.fields['start_date'] !== undefined) {
          setFieldError('pickup-date-error', 'pickup-date', failure.fields['start_date']);
        }
        if (failure.fields['end_date'] !== undefined) {
          setFieldError('return-date-error', 'return-date', failure.fields['end_date']);
        }
      }
    } finally {
      pending.release();
      validateDates();
    }
  }

  void (async () => {
    try {
      const answer = await request<{ item: Item }>(`/api/items/${itemId}`);
      item = answer.item;
    } catch {
      onMissing();
      return;
    }
    heading.textContent = item.name;
    const today = todayLocal();
    pickup.min = today;
    pickup.max = addDays(today, HORIZON_DAYS - 1);
    returnDate.min = today;
    returnDate.max = addDays(today, HORIZON_DAYS - 1 + MAX_LOAN_DAYS);
    clear(card);
    card.appendChild(element('h2', {}, [item.name]));
    card.appendChild(element('div', { class: 'row-meta' }, [item.category]));
    card.appendChild(
      element('div', { class: 'mono' }, [
        item.deposit_cents === 0 ? 'No deposit' : `Deposit ${money(item.deposit_cents)}`,
      ]),
    );
    card.appendChild(
      element('div', { class: 'mono' }, [`Replacement ${money(item.replacement_cents)}`]),
    );
    await readLanes();
  })();

  return { node, stop: clearTimers };
}
