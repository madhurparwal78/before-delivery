/**
 * The per-store split: whole-cent floors by weight, then the cents left over go
 * one each to the largest fractional remainders, ties to the first store code.
 */

export interface SplitStore {
  code: string;
  name: string;
  weight: number;
}

export interface SplitPart {
  storeCode: string;
  storeName: string;
  weight: number;
  amountCents: number;
}

export function allocateStoreSplit(
  amountCents: number,
  stores: readonly SplitStore[],
): SplitPart[] {
  const totalWeight = stores.reduce((total, store) => total + store.weight, 0);
  const amount = BigInt(amountCents);
  const weightTotal = BigInt(totalWeight);

  const working = stores.map((store, index) => {
    const scaled = amount * BigInt(store.weight);
    const floor = scaled / weightTotal;
    return {
      index,
      store,
      amount: Number(floor),
      remainder: scaled - floor * weightTotal,
    };
  });

  const allocated = working.reduce((total, part) => total + part.amount, 0);
  let leftOver = amountCents - allocated;

  const order = [...working].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return left.store.code < right.store.code ? -1 : left.store.code > right.store.code ? 1 : 0;
  });

  for (const part of order) {
    if (leftOver <= 0) break;
    part.amount += 1;
    leftOver -= 1;
  }

  return working
    .sort((left, right) => left.index - right.index)
    .map((part) => ({
      storeCode: part.store.code,
      storeName: part.store.name,
      weight: part.store.weight,
      amountCents: part.amount,
    }));
}
