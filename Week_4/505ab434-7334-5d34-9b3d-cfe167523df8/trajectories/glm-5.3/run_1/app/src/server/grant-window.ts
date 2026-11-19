import type { Tx } from './db';
import { query } from './db';
import type { Config } from './config';
import { formatDay } from './datetime';
import { type ApplicationClass, type ConditionKind } from '../shared/domain';
import { addDays } from './datetime';

export interface GrantWindowResult {
  notBefore: string | null;
  notAfter: string;
  cap: string;
  zeroLength: boolean;
}

export interface WindowInputs {
  campaignEndsOn: string;
  approvalDate: string;
  defaultDurationDays: number;
  expiryOverride: string | null;
  engagementEndsOn: string | null;
}

/**
 * The single grant-window calculation. `notAfter` is the earliest of the four
 * published caps, ties going to the earlier cap in the published order.
 */
export function grantWindow(inputs: WindowInputs): GrantWindowResult {
  const candidates: { date: string; cap: string }[] = [
    { date: inputs.campaignEndsOn, cap: 'campaign end' },
    { date: addDays(inputs.approvalDate, inputs.defaultDurationDays), cap: 'licence term' },
  ];
  if (inputs.expiryOverride) candidates.push({ date: inputs.expiryOverride, cap: 'expiry override' });
  if (inputs.engagementEndsOn) candidates.push({ date: inputs.engagementEndsOn, cap: 'engagement end' });
  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.date < best.date) best = candidate;
  }
  const notAfter = best.date;
  const zeroLength = notAfter < inputs.approvalDate;
  return { notBefore: inputs.approvalDate, notAfter, cap: best.cap, zeroLength };
}

