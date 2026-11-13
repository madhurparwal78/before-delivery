import { readerMessages } from './messages';

/** Helpful is Yes divided by Yes plus No, as a whole percent rounded half up. */
export function helpfulPercent(yes: number, no: number): string {
  const total = yes + no;
  if (total === 0) return readerMessages.noVotes;
  return `${Math.round((yes * 100) / total)}%`;
}
