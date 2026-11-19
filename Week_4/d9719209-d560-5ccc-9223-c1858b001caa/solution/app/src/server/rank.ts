const HOT_EPOCH_SECONDS = 1_704_067_200;
const HOT_DIVISOR = 45_000;

/** Hot rank = sign(score) * log10(max(|score|, 1)) + (creation epoch seconds - 2024-01-01) / 45000. */
export function hotRank(score: number, createdAt: Date): number {
  return Math.sign(score) * Math.log10(Math.max(Math.abs(score), 1)) +
    (createdAt.getTime() / 1000 - HOT_EPOCH_SECONDS) / HOT_DIVISOR;
}
