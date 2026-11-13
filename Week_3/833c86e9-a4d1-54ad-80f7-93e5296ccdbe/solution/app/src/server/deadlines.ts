import { addDays, localMoment } from '../shared/dates'
import type { PolicyTier } from '../shared/types'

interface DeadlineTier extends PolicyTier { at: Date }

/** The policy's tiers with the instant each one ends, earliest first. */
export function deadlineTiers(policy: PolicyTier[], arrival: string, zone: string): DeadlineTier[] {
  return policy.map((tier) => ({ ...tier, at: localMoment(addDays(arrival, -tier.days_before), tier.hour, zone) })).sort((a, b) => a.at.getTime() - b.at.getTime())
}

export function tierInForce(tiers: DeadlineTier[], now: Date): { pct: number; until: Date | null } {
  const ahead = tiers.find((tier) => now.getTime() < tier.at.getTime())
  return ahead ? { pct: ahead.refund_pct, until: ahead.at } : { pct: 0, until: null }
}
