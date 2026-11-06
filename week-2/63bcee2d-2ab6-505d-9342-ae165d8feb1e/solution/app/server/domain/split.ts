// The per-store certificate split (brief: Per-store split): each store gets the floor of
// amount × weight ÷ total weight, and the cents left over go one each to the largest remainders,
// ties to the store code that sorts first. Allocated in exact integers, never rounded.

export interface StorePart {
  storeCode: string;
  storeName: string;
  weight: number;
  amountCents: number;
}

export function splitByWeight(amountCents: number, stores: { code: string; name: string; weight: number }[]): StorePart[] {
  const amount = BigInt(amountCents);
  const total = BigInt(stores.reduce((sum, store) => sum + store.weight, 0));
  const parts = stores.map((store) => {
    const share = amount * BigInt(store.weight);
    return { store, cents: share / total, remainder: share % total };
  });
  let left = amount - parts.reduce((sum, part) => sum + part.cents, 0n);
  const order = [...parts].sort((a, b) =>
    a.remainder !== b.remainder ? (a.remainder > b.remainder ? -1 : 1) : a.store.code < b.store.code ? -1 : a.store.code > b.store.code ? 1 : 0);
  for (const part of order) {
    if (left <= 0n) break;
    part.cents += 1n;
    left -= 1n;
  }
  return parts.map(({ store, cents }) => ({ storeCode: store.code, storeName: store.name, weight: store.weight, amountCents: Number(cents) }));
}
