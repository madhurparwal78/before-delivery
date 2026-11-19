import type { RuleSetName } from './rest-rules.js';

export type RuleSetPeriod = {
  id: string;
  ruleSet: 'flag_exception';
  effectiveFromMs: number;
  effectiveUntilMs: number;
  flagReference: string;
};

export const MAX_FLAG_EXCEPTION_HOURS = 336;

/** The rule set in force at an instant: a flag exception period from its start up to its end. */
export function ruleSetAt(periods: RuleSetPeriod[], ms: number): RuleSetName {
  for (const period of periods) {
    if (ms >= period.effectiveFromMs && ms < period.effectiveUntilMs) return period.ruleSet;
  }
  return 'standard';
}

export function periodsOverlap(
  periods: RuleSetPeriod[],
  fromMs: number,
  untilMs: number,
): boolean {
  return periods.some(
    (period) => fromMs < period.effectiveUntilMs && untilMs > period.effectiveFromMs,
  );
}
