import type { GrantCap } from '../../shared/types.js';
import { addDays } from '../time.js';

export interface GrantWindowInput {
  /** The approval date, or the proof acceptance date when a proof is required. */
  startsOn: string;
  campaignEndsOn: string;
  licenceDurationDays: number;
  expiryOverride: string | null;
  engagementEndsOn: string | null;
}

export interface GrantWindow {
  notBefore: string;
  notAfter: string;
  cap: GrantCap;
  zeroLength: boolean;
}

/** The one place the grant window is decided. */
export function computeGrantWindow(input: GrantWindowInput): GrantWindow {
  const candidates: { cap: GrantCap; date: string }[] = [
    { cap: 'campaign end', date: input.campaignEndsOn },
    { cap: 'licence term', date: addDays(input.startsOn, input.licenceDurationDays) },
  ];
  if (input.expiryOverride) candidates.push({ cap: 'expiry override', date: input.expiryOverride });
  if (input.engagementEndsOn) candidates.push({ cap: 'engagement end', date: input.engagementEndsOn });

  let winner = candidates[0]!;
  for (const candidate of candidates.slice(1)) {
    if (candidate.date < winner.date) winner = candidate;
  }

  return {
    notBefore: input.startsOn,
    notAfter: winner.date,
    cap: winner.cap,
    zeroLength: winner.date < input.startsOn,
  };
}
