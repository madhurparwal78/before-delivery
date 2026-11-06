import type { SeasonState } from '../../shared/domain.ts';
import { addCalendarDays, instantFromDateAt } from './time.ts';

export type StoredSeasonState = 'draft' | 'scheduled' | 'archived' | 'withdrawn';

export function priorityOpensAt(publicSaleDate: string): Date {
  return instantFromDateAt(addCalendarDays(publicSaleDate, -3), 10, 0);
}

export function publicOpensAt(publicSaleDate: string): Date {
  return instantFromDateAt(publicSaleDate, 10, 0);
}

export function derivedState(stored: StoredSeasonState, publicSaleDate: string, now: Date): SeasonState {
  if (stored !== 'scheduled') return stored;
  if (now.getTime() < priorityOpensAt(publicSaleDate).getTime()) return 'scheduled';
  if (now.getTime() < publicOpensAt(publicSaleDate).getTime()) return 'member-priority';
  return 'on-sale';
}

export const PUBLIC_STAGE_STATES: SeasonState[] = ['scheduled', 'member-priority', 'on-sale'];

export type TransitionTarget = 'scheduled' | 'archived' | 'withdrawn';

export function isLegalTransition(from: SeasonState, to: TransitionTarget): boolean {
  if (to === 'scheduled') return from === 'draft';
  if (to === 'archived') return from === 'on-sale';
  return from === 'scheduled' || from === 'on-sale';
}
