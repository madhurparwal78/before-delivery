import type { Compliance, Tally } from './types.js';

const COMPLIANCE_ORDER: readonly Compliance[] = ['on-target', 'close', 'off-target', 'missed', 'unplanned', 'planned'];

export const COMPLIANCE_LABELS: Record<Compliance, string> = {
  'on-target': 'On target',
  close: 'Close',
  'off-target': 'Off target',
  missed: 'Missed',
  unplanned: 'Unplanned',
  planned: 'Planned'
};

export const emptyTally = (): Tally => ({ 'on-target': 0, close: 0, 'off-target': 0, missed: 0, unplanned: 0, planned: 0 });

export const tallyLine = (tally: Tally): string =>
  COMPLIANCE_ORDER.map((state) => `${COMPLIANCE_LABELS[state]} ${tally[state]}`).join(' · ');

/** The share of on-target items among paired items plus missed items, or null when there are none. */
export function onTargetPercent(tallies: readonly Tally[]): number | null {
  let onTarget = 0;
  let counted = 0;
  for (const tally of tallies) {
    onTarget += tally['on-target'];
    counted += tally['on-target'] + tally.close + tally['off-target'] + tally.missed;
  }
  return counted === 0 ? null : (onTarget / counted) * 100;
}
