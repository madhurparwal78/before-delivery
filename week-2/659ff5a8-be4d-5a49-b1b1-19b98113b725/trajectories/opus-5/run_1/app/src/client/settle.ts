import type { StandingsRow, StandingsView } from '../shared/api';
import { copy } from './copy';
import { clear, el } from './dom';
import type { RowView } from './screens/live';

const ROLL_MS = 200;
const CHIP_MS = 125;
const TIME_REVEAL_MS = 100;
const SLIDE_MS = 500;
const CONE_PENALTY_SECONDS = 2;

export interface SettleTrigger {
  row: StandingsRow;
  runNumber: number;
  rawTime: string | null;
  cones: number;
  outcome: 'time' | 'dnf' | 'rerun' | null;
}

export interface SettleOptions {
  parent: HTMLElement;
  order: HTMLElement[];
  instance: RowView;
  trigger: SettleTrigger;
  view: StandingsView;
  reducedMotion: boolean;
  onDone: () => void;
}

function penaltyText(cones: number): string {
  return `+${(cones * CONE_PENALTY_SECONDS).toFixed(3)}`;
}

function reorder(parent: HTMLElement, order: HTMLElement[], animate: boolean): void {
  if (!animate) {
    for (const node of order) parent.appendChild(node);
    return;
  }
  const before = new Map<HTMLElement, number>();
  for (const node of order) before.set(node, node.getBoundingClientRect().top);
  for (const node of order) parent.appendChild(node);
  const moved: HTMLElement[] = [];
  for (const node of order) {
    const after = node.getBoundingClientRect().top;
    const delta = (before.get(node) ?? after) - after;
    if (Math.abs(delta) < 1) continue;
    node.style.transition = 'none';
    node.style.transform = `translateY(${delta}px)`;
    moved.push(node);
  }
  if (moved.length === 0) return;
  requestAnimationFrame(() => {
    for (const node of moved) {
      node.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.17, 0.84, 0.25, 1)`;
      node.style.transform = 'translateY(0px)';
    }
    window.setTimeout(() => {
      for (const node of moved) {
        node.style.transition = '';
        node.style.transform = '';
      }
    }, SLIDE_MS + 60);
  });
}

function rollDigits(target: HTMLElement, from: string, to: string, token: { cancelled: boolean }): void {
  const steps = 5;
  const parsedFrom = Number.parseFloat(from);
  const parsedTo = Number.parseFloat(to);
  if (!Number.isFinite(parsedTo)) {
    target.textContent = to;
    return;
  }
  const start = Number.isFinite(parsedFrom) ? parsedFrom : parsedTo;
  for (let step = 1; step <= steps; step += 1) {
    window.setTimeout(() => {
      if (token.cancelled) return;
      const value = start + ((parsedTo - start) * step) / steps;
      target.textContent = value.toFixed(3);
    }, (ROLL_MS / steps) * step);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** The cone-to-rank settle: the signature move of the live results page. */
export function createSettle(): {
  play: (options: SettleOptions) => void;
  cancel: () => void;
} {
  let current: { token: { cancelled: boolean }; finish: () => void } | null = null;

  /** What the row keeps showing once the settle has landed. */
  function renderFinalSlot(options: SettleOptions): void {
    const { instance, trigger } = options;
    const slot = instance.settleSlot;
    clear(slot);
    if (trigger.outcome === 'dnf') {
      slot.appendChild(
        el(
          'span',
          { class: 'settle__dnf' },
          el('span', { class: 'settle__struck mono', text: trigger.rawTime ?? '' }),
          el('span', { class: 'settle__dnf-label', text: 'DNF' }),
        ),
      );
      return;
    }
    if (trigger.cones > 0) {
      if (options.reducedMotion) {
        slot.appendChild(el('span', { class: 'settle__cone-count', text: copy.coneCount(trigger.cones) }));
      } else {
        for (let index = 0; index < trigger.cones; index += 1) {
          slot.appendChild(el('span', { class: 'settle__chip', attrs: { 'aria-hidden': 'true' } }));
        }
      }
      slot.appendChild(el('span', { class: 'settle__penalty mono', text: penaltyText(trigger.cones) }));
    }
  }

  function endState(options: SettleOptions): void {
    const { instance, trigger, view } = options;
    renderFinalSlot(options);
    const finalTime =
      view === 'indexed' ? trigger.row.bestIndexed : trigger.row.bestAdjusted;
    const timeCell = view === 'indexed' ? instance.bestIndexed : instance.bestAdjusted;
    timeCell.textContent = finalTime ?? '';
    reorder(options.parent, options.order, false);
    instance.badge.textContent = trigger.row.lastChange?.rankChange[view] ?? '';
    options.onDone();
  }

  function play(options: SettleOptions): void {
    current?.finish();
    const token = { cancelled: false };
    const finish = (): void => {
      if (token.cancelled) return;
      token.cancelled = true;
      endState(options);
    };
    current = { token, finish };

    if (options.reducedMotion) {
      finish();
      current = null;
      return;
    }

    void (async () => {
      const { instance, trigger, view } = options;
      const slot = instance.settleSlot;
      const timeCell = view === 'indexed' ? instance.bestIndexed : instance.bestAdjusted;
      clear(slot);

      const rolling = el('span', { class: 'settle__raw mono' });
      slot.appendChild(rolling);
      if (trigger.outcome === 'dnf') {
        rolling.classList.add('settle__struck');
        rolling.textContent = trigger.rawTime ?? '';
        slot.appendChild(el('span', { class: 'settle__dnf-label', text: 'DNF' }));
      } else {
        rollDigits(rolling, timeCell.textContent ?? '', trigger.rawTime ?? '', token);
      }
      await sleep(ROLL_MS);
      if (token.cancelled) return;

      if (trigger.outcome === 'time' && trigger.cones > 0) {
        const penalty = el('span', { class: 'settle__penalty mono' });
        slot.appendChild(penalty);
        for (let index = 1; index <= trigger.cones; index += 1) {
          await sleep(CHIP_MS);
          if (token.cancelled) return;
          slot.insertBefore(
            el('span', { class: 'settle__chip', attrs: { 'aria-hidden': 'true' } }),
            penalty,
          );
          penalty.textContent = penaltyText(index);
        }
      }

      await sleep(TIME_REVEAL_MS);
      if (token.cancelled) return;
      const finalTime = view === 'indexed' ? trigger.row.bestIndexed : trigger.row.bestAdjusted;
      timeCell.textContent = finalTime ?? '';

      reorder(options.parent, options.order, true);
      instance.badge.textContent = trigger.row.lastChange?.rankChange[view] ?? '';
      await sleep(SLIDE_MS);
      if (token.cancelled) return;
      token.cancelled = true;
      renderFinalSlot(options);
      options.onDone();
      current = null;
    })();
  }

  return {
    play,
    cancel: () => {
      current?.finish();
      current = null;
    },
  };
}
