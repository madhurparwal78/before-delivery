import { floorDivide } from "./decimal.js";

type Tendered = { shares: number; sequence: number };

/** Pro rata allocation in whole shares; leftover shares go one each to the earliest submissions. */
export function allocate(shareCap: number, submissions: Tendered[]): number[] {
  const total = submissions.reduce((sum, submission) => sum + submission.shares, 0);
  if (total <= shareCap) return submissions.map((submission) => submission.shares);
  const shares = submissions.map((submission) => floorDivide(submission.shares * shareCap, total));
  const leftover = shareCap - shares.reduce((sum, value) => sum + value, 0);
  const earliest = submissions.map((_, index) => index).sort((a, b) => (submissions[a]?.sequence ?? 0) - (submissions[b]?.sequence ?? 0));
  for (const index of earliest.slice(0, leftover)) shares[index] = (shares[index] ?? 0) + 1;
  return shares;
}
