import type { SegmentState } from '../../shared/types.js';
import { localTime } from './zone.js';

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

const STATE_WORDS: Record<SegmentState, string> = {
  booked: 'Booked',
  held: 'Held',
  yours_booked: 'Your booking',
  yours_held: 'Your hold',
};

/** The one time-state label used by the dial, blockers and callouts. */
export function segmentLabel(state: SegmentState, zone: string, start: Date, end: Date): string {
  return `${STATE_WORDS[state]} ${localTime(zone, start)}–${localTime(zone, end)}`;
}

export function termsLine(noticeHours: number): string {
  return `Free cancellation until ${noticeHours} hours before start. Later cancellations keep the time charge and the deposit.`;
}
