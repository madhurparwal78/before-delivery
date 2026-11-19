// In-process queues: work under one name runs one at a time, in arrival order.
const tails = new Map<string, Promise<unknown>>();

export async function exclusively<Result>(name: string, work: () => Promise<Result>): Promise<Result> {
  const previous = tails.get(name) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.catch(() => undefined);
  tails.set(name, tail);
  try {
    return await run;
  } finally {
    if (tails.get(name) === tail) tails.delete(name);
  }
}
