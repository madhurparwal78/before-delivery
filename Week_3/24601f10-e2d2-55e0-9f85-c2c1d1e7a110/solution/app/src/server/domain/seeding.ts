// The seeding placement: the one place that decides which seeds meet in round 1.

export function bracketSize(entrantCount: number): number {
  let size = 2;
  while (size < entrantCount) size *= 2;
  return size;
}

// Start from 1, 2; to double the size replace each seed s by the pair s, size + 1 - s.
export function slotOrder(size: number): number[] {
  let order = [1, 2];
  for (let current = 2; current < size;) {
    current *= 2;
    order = order.flatMap((seed) => [seed, current + 1 - seed]);
  }
  return order;
}
