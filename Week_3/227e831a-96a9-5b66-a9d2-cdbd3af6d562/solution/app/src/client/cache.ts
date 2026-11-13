import type { Item, ListSummary, Profile, SyncOp, TripList } from '../shared/api-types'

/** What the device keeps of the last loaded closet, lists and profile, so a workspace opens with no connection. */
const PREFIX = 'skinout:'

function read<T>(key: string): T | null {
  try {
    const text = window.localStorage.getItem(PREFIX + key)
    return text ? (JSON.parse(text) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable: the app still works online, only offline reloads lose this copy.
  }
}

export const cache = {
  profile: { get: () => read<Profile>('profile'), set: (v: Profile) => write('profile', v) },
  closet: { get: () => read<Item[]>('closet'), set: (v: Item[]) => write('closet', v) },
  lists: {
    get: () => read<ListSummary[]>('lists'),
    set: (v: ListSummary[]) => write('lists', v),
    /** Keeps the Trips rows in step with a list the workspace just showed, new lists first. */
    upsert(summary: ListSummary): void {
      const known = read<ListSummary[]>('lists') ?? []
      const exists = known.some((entry) => entry.id === summary.id)
      write('lists', exists ? known.map((entry) => (entry.id === summary.id ? summary : entry)) : [summary, ...known])
    },
  },
  list: { get: (id: string) => read<TripList>(`list:${id}`), set: (v: TripList) => write(`list:${v.id}`, v) },
  queue: { get: () => read<QueuedOp[]>('queue') ?? [], set: (v: QueuedOp[]) => write('queue', v) },
  clearReads(): void {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX) && key !== `${PREFIX}queue`) window.localStorage.removeItem(key)
    }
  },
}

/** An op waiting for a connection, with the names its refusal sentence needs. */
export interface QueuedOp {
  op: SyncOp
  itemName: string
  listName: string
}
