// The price list in force on a date, and each version's standing. One rule for the server and the Price lists page.

interface PriceListVersion { id: string; effective_date: string; withdrawn_at: string | null }

/**
 * The version in force on `date`: not withdrawn, latest effective date on or before it, the most recently created
 * winning a tie. `newestFirst` is ordered by effective date then creation, newest first (the listing's order).
 */
export function priceListInForce<T extends PriceListVersion>(newestFirst: readonly T[], date: string): T | undefined {
  return newestFirst.find((v) => v.withdrawn_at === null && v.effective_date <= date);
}

type Standing = "Withdrawn" | "In force" | "Scheduled" | "Superseded";

export function standingOf(version: PriceListVersion, newestFirst: readonly PriceListVersion[], today: string): Standing {
  if (version.withdrawn_at !== null) return "Withdrawn";
  if (priceListInForce(newestFirst, today)?.id === version.id) return "In force";
  if (version.effective_date > today) return "Scheduled";
  return "Superseded";
}

/** A tier label: "<name>, <percent>% off remaining" (brief: Price lists). */
export function tierLabel(name: string, percent: number): string {
  return `${name}, ${percent}% off remaining`;
}
