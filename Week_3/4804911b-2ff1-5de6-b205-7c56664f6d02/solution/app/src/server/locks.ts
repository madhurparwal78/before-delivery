// One Node process owns a database, so in-process queues serialise the multi-row invariants the brief names.
const tails = new Map<string, Promise<unknown>>();

export function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** The writers of price history (publish, correction, batch registration) share this key. */
export const PRICE_HISTORY = "price-history";
