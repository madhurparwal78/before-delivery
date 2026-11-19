import { config } from '../config';
import type { AdvisoryDto, BlockerReason } from '../../shared/types';

export interface GateInput {
  readonly findingCount: number;
  readonly pulledAt: Date | null;
  readonly advisories: readonly AdvisoryDto[];
  readonly now: Date;
}

/** The publish gate checks every condition and reports all failed reasons together. */
export const publishBlockers = (input: GateInput): BlockerReason[] => {
  const reasons: BlockerReason[] = [];
  if (input.findingCount === 0) reasons.push('no_findings');
  if (input.pulledAt === null) {
    reasons.push('no_record_pull');
    return reasons;
  }
  const ageSeconds = (input.now.getTime() - input.pulledAt.getTime()) / 1000;
  if (ageSeconds > config.recordPullMaxAgeSeconds) reasons.push('record_stale');
  if (input.advisories.some((advisory) => advisory.stance === null)) reasons.push('advisories_unanswered');
  if (input.advisories.some((advisory) => advisory.recurred)) reasons.push('advisory_recurred');
  return reasons;
};
