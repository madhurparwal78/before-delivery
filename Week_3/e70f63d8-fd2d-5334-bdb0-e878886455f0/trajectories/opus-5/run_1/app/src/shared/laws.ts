import type { Extra, WicketKind } from './types.js';

/** A delivery that counts toward the over. */
export function isLegalDelivery(extra: Extra): boolean {
  return extra === 'none' || extra === 'bye' || extra === 'leg-bye';
}

/** The kinds of dismissal the laws allow on a delivery. */
export function wicketAllowed(kind: WicketKind, extra: Extra, freeHit: boolean): boolean {
  if (freeHit) return kind === 'run-out';
  switch (extra) {
    case 'none':
      return true;
    case 'wide':
      return kind === 'stumped' || kind === 'run-out';
    default:
      return kind === 'run-out';
  }
}
