import { TIER_PLANS, type Fare, type Tier, sortSeats } from '../../shared/domain.ts';

export type FareContext = { tier: Tier | null; group: boolean };

export function allowedFares(context: FareContext): Fare[] {
  if (context.group) return ['group'];
  const fares: Fare[] = ['regular', 'reduced'];
  if (context.tier !== null) fares.push('member', 'member-guest');
  return fares;
}

export function defaultFares(seats: string[], context: FareContext): Record<string, Fare> {
  const ordered = sortSeats(seats);
  const out: Record<string, Fare> = {};
  if (context.group) {
    for (const seat of ordered) out[seat] = 'group';
    return out;
  }
  const allowance = context.tier === null ? 0 : TIER_PLANS[context.tier].allowance;
  ordered.forEach((seat, index) => {
    if (context.tier !== null && index === 0) out[seat] = 'member';
    else if (context.tier !== null && index <= allowance) out[seat] = 'member-guest';
    else out[seat] = 'regular';
  });
  return out;
}

/** Returns the seat whose fare breaks the fare rules, or null when the selection is allowed. */
export function firstInvalidFareSeat(fares: Record<string, Fare>, context: FareContext): string | null {
  const allowed = new Set(allowedFares(context));
  const ordered = sortSeats(Object.keys(fares));
  for (const seat of ordered) {
    if (!allowed.has(fares[seat])) return seat;
  }
  const limits: Partial<Record<Fare, number>> = context.group
    ? {}
    : { member: 1, 'member-guest': context.tier === null ? 0 : TIER_PLANS[context.tier].allowance };
  const used = new Map<Fare, number>();
  for (const seat of ordered) {
    const fare = fares[seat];
    const limit = limits[fare];
    if (limit === undefined) continue;
    const count = (used.get(fare) ?? 0) + 1;
    used.set(fare, count);
    if (count > limit) return seat;
  }
  return null;
}
