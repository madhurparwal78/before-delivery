/** Runs work one at a time per key inside this process (all state-changing flows for one order or refund). */

const tails = new Map<string, Promise<unknown>>();

export const serial = <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
};
