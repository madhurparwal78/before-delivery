export function yesVotesNeeded(eligible: number): number {
  return Math.ceil((eligible * 6) / 10);
}
