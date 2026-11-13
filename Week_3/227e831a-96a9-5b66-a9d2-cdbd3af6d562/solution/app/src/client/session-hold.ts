import { Store } from './status'

/** A change that found the session ended: kept, not lost, until the hiker signs in again or cancels. */
interface HeldChange {
  resume(): Promise<void>
  cancel(): void
}

export const heldChanges = new Store<readonly HeldChange[]>([])

export function holdForSignIn(change: HeldChange): void {
  heldChanges.set([...heldChanges.get(), change])
}

/** After sign-in each held change is sent once, in the order it was held. */
export async function resumeHeld(): Promise<void> {
  const held = heldChanges.get()
  heldChanges.set([])
  for (const change of held) await change.resume()
}

export function cancelHeld(): void {
  const held = heldChanges.get()
  heldChanges.set([])
  for (const change of held) change.cancel()
}
