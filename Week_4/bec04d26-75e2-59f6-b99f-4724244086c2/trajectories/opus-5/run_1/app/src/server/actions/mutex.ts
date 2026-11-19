const chains = new Map<string, Promise<unknown>>();

/** Serialises work on one key, so a job is never attempted twice at once. */
export function serialise<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  chains.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}
