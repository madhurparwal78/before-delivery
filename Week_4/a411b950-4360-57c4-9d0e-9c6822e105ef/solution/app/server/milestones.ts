// The 30/20/20/30 milestone split, decided here only.

export const MILESTONES = [
  { number: 1, name: "Deposit", percent: 30 },
  { number: 2, name: "Vertical slice", percent: 20 },
  { number: 3, name: "Content complete", percent: 20 },
  { number: 4, name: "Final delivery", percent: 30 },
] as const;

export const FEE_MIN_CENTS = 100;
export const FEE_MAX_CENTS = 100_000_000;

/** Milestones 1–3 are fee × percent / 100 rounded down; milestone 4 takes the remainder. */
export function splitFee(feeCents: number): number[] {
  const fee = BigInt(feeCents);
  const first = MILESTONES.slice(0, 3).map((m) => (fee * BigInt(m.percent)) / 100n);
  const last = fee - first.reduce((sum, part) => sum + part, 0n);
  return [...first, last].map((part) => Number(part));
}

export function milestoneView(cents: number[]) {
  return MILESTONES.map((m, i) => ({ number: m.number, name: m.name, percent: m.percent, amount_cents: cents[i] ?? 0 }));
}

/** The Kill Bill item description for milestone `number` of an enquiry. */
export function milestoneDescription(number: number, reference: string): string {
  const milestone = MILESTONES[number - 1];
  return `Milestone ${number} of 4: ${milestone?.name ?? ""} (${reference})`;
}
