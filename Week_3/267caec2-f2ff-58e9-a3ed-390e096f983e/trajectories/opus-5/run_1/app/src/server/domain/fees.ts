import { isOpen } from './time';
import type { FeeTier, ProgramRow } from './types';

export const TIER_LABEL: Record<FeeTier, string> = {
  early_bird: 'Early-bird',
  standard: 'Standard',
};

export function tierAt(program: ProgramRow, now: Date): FeeTier {
  return isOpen(program.early_bird_date, program.time_zone, now) ? 'early_bird' : 'standard';
}

export function feeCentsAt(program: ProgramRow, now: Date): number {
  return tierAt(program, now) === 'early_bird' ? program.early_bird_fee_cents : program.standard_fee_cents;
}

export function entriesOpen(program: ProgramRow, now: Date): boolean {
  return isOpen(program.deadline_date, program.time_zone, now);
}

export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
