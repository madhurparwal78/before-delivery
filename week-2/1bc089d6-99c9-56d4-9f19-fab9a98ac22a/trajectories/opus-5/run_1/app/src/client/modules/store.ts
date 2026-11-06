import {
  MAX_HOUR_MINUTES,
  MAX_RITUAL_MINUTES,
  MIN_RITUAL_MINUTES,
  RITUAL_MINUTE_STEP,
  RITUAL_CATALOGUE,
  findRitual,
} from '../../shared/rituals.js';

export interface ChosenRitual {
  id: string;
  minutes: number;
}

export type ChangeReason = 'added' | 'removed' | 'minutes' | 'loaded';

export interface Change {
  reason: ChangeReason;
  id?: string;
  total: number;
}

type Listener = (chosen: ChosenRitual[], change: Change) => void;

const listeners: Listener[] = [];
let chosen: ChosenRitual[] = [];

export const chosenRituals = (): ChosenRitual[] => chosen.map((ritual) => ({ ...ritual }));

export const totalMinutes = (): number => chosen.reduce((sum, ritual) => sum + ritual.minutes, 0);

export const isChosen = (id: string): boolean => chosen.some((ritual) => ritual.id === id);

export const minutesFor = (id: string): number =>
  chosen.find((ritual) => ritual.id === id)?.minutes ?? findRitual(id)!.defaultMinutes;

export function subscribe(listener: Listener): void {
  listeners.push(listener);
}

function announce(change: Change): void {
  for (const listener of listeners) listener(chosenRituals(), change);
}

/** Adds a ritual at its default minutes, unless that would take the hour past 60. */
export function addRitual(id: string): boolean {
  if (isChosen(id)) return true;
  const ritual = findRitual(id)!;
  if (totalMinutes() + ritual.defaultMinutes > MAX_HOUR_MINUTES) return false;
  chosen = [...chosen, { id, minutes: ritual.defaultMinutes }];
  announce({ reason: 'added', id, total: totalMinutes() });
  return true;
}

export function removeRitual(id: string): void {
  if (!isChosen(id)) return;
  chosen = chosen.filter((ritual) => ritual.id !== id);
  announce({ reason: 'removed', id, total: totalMinutes() });
}

/** Changes one ritual's minutes, unless that would take the hour past 60. */
export function setMinutes(id: string, minutes: number): boolean {
  const current = chosen.find((ritual) => ritual.id === id);
  if (!current) return false;
  if (
    minutes < MIN_RITUAL_MINUTES ||
    minutes > MAX_RITUAL_MINUTES ||
    minutes % RITUAL_MINUTE_STEP !== 0 ||
    totalMinutes() - current.minutes + minutes > MAX_HOUR_MINUTES
  ) {
    return false;
  }
  chosen = chosen.map((ritual) => (ritual.id === id ? { id, minutes } : ritual));
  announce({ reason: 'minutes', id, total: totalMinutes() });
  return true;
}

export function loadRituals(list: ChosenRitual[]): void {
  chosen = list.map((ritual) => ({ ...ritual }));
  announce({ reason: 'loaded', total: totalMinutes() });
}

/**
 * Reads the rituals parameter, dropping unknown ids, repeats, minutes off the
 * five-minute step and any entry that would take the hour past 60 minutes.
 */
export function readRitualsParameter(value: string | null): ChosenRitual[] {
  if (!value) return [];
  const cleaned: ChosenRitual[] = [];
  let total = 0;
  for (const entry of value.split(',')) {
    const [id, rawMinutes] = entry.split(':');
    if (!id || rawMinutes === undefined) continue;
    if (!findRitual(id) || cleaned.some((ritual) => ritual.id === id)) continue;
    const minutes = Number(rawMinutes);
    if (!Number.isInteger(minutes)) continue;
    if (minutes < MIN_RITUAL_MINUTES || minutes > MAX_RITUAL_MINUTES || minutes % RITUAL_MINUTE_STEP !== 0) continue;
    if (total + minutes > MAX_HOUR_MINUTES) continue;
    total += minutes;
    cleaned.push({ id, minutes });
  }
  return cleaned;
}

export const ritualsParameter = (list: ChosenRitual[]): string =>
  list.map((ritual) => `${ritual.id}:${ritual.minutes}`).join(',');

export const catalogue = RITUAL_CATALOGUE;
