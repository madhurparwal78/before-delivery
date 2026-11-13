/** Workspace writes still on their way to the server, so the pages read after them see their effect. */
const pending = new Set<Promise<unknown>>()

export function track<T>(work: Promise<T>): Promise<T> {
  pending.add(work)
  const done = () => pending.delete(work)
  work.then(done, done)
  return work
}

export async function settleWrites(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending])
}
