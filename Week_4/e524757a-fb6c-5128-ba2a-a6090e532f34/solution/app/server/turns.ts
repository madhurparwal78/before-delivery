const locks = new Map<string, Promise<unknown>>()

/** Runs the work of one key one after the other, so a repeat waits for the first and then sees its result. */
export async function inTurn<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = locks.get(key) ?? Promise.resolve()
  const turn = before.then(work, work)
  locks.set(key, turn)
  try {
    return await turn
  } finally {
    if (locks.get(key) === turn) locks.delete(key)
  }
}
