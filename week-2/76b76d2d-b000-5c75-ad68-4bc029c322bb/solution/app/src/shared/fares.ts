import { compareSeats, type Fare, type Tier } from "./domain.ts";

/** Member-guest allowance per tier (brief: Prices). */
export const MEMBER_GUEST_ALLOWANCE: Record<Tier, number> = { friend: 1, cinephile: 2, projectionist: 3 };

/** Fares a seat may be offered in an individual hold, in the Fare labels order (brief: Fare rules). */
export function offeredFares(memberTier: Tier | null): Fare[] {
  return memberTier ? ["regular", "reduced", "member", "member-guest"] : ["regular", "reduced"];
}

/**
 * Default fares (brief: Fare rules): for a member, `member` on the first seat in seat order,
 * `member-guest` on the next seats up to the allowance, then `regular`; otherwise `regular`.
 * Group holds use `group` on every seat.
 */
export function defaultFares(seats: readonly string[], memberTier: Tier | null, group: boolean): Record<string, Fare> {
  const ordered = [...seats].sort(compareSeats);
  const fares: Record<string, Fare> = {};
  ordered.forEach((seat, index) => {
    if (group) fares[seat] = "group";
    else if (!memberTier) fares[seat] = "regular";
    else if (index === 0) fares[seat] = "member";
    else if (index <= MEMBER_GUEST_ALLOWANCE[memberTier]) fares[seat] = "member-guest";
    else fares[seat] = "regular";
  });
  return fares;
}
