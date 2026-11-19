const chains = new Map<string, Promise<unknown>>();

/** Serialises work on one key, so saves are applied in the order the server received them. */
export async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  chains.set(key, current.catch(() => undefined));
  try {
    return await current;
  } finally {
    if (chains.get(key) === current) chains.delete(key);
  }
}
