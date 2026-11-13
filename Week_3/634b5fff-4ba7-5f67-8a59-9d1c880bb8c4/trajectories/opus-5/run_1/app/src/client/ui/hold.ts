import { ApiCallFailed, call } from '../api.js';
import { errorCopy, storyCopy } from '../../shared/copy.js';
import { store, type HeldBox } from '../store.js';

type Listener = () => void;

const listeners = new Set<Listener>();
let status = '';
let polling = false;

function announce(): void {
  for (const listener of listeners) listener();
}

export function onHoldChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function holdStatus(): string {
  return status;
}

export function heldBox(): HeldBox | null {
  return store.hold();
}

/** Boxes held is this browser session's own count, never a shelf-wide figure. */
export function boxesHeld(): number {
  return store.hold() === null ? 0 : 1;
}

function setStatus(text: string): void {
  status = text;
  announce();
}

export async function reachFor(boxNumber: number): Promise<HeldBox | null> {
  setStatus(storyCopy.holdPending(boxNumber));
  try {
    const hold = await call<HeldBox>('/api/holds', { method: 'POST', body: { number: boxNumber } });
    store.keepHold(hold);
    setStatus(storyCopy.holdGranted(boxNumber));
    startPolling();
    return hold;
  } catch (error) {
    if (error instanceof ApiCallFailed) setStatus(error.failure.message);
    return null;
  }
}

export async function putBack(): Promise<void> {
  const hold = store.hold();
  if (hold === null) return;
  try {
    await call<void>(`/api/holds/${hold.number}`, {
      method: 'DELETE',
      headers: { 'X-Hold-Token': hold.holdToken },
    });
  } catch (error) {
    if (error instanceof ApiCallFailed && error.failure.code !== 'hold_ended') {
      setStatus(error.failure.message);
      return;
    }
  }
  store.dropHold();
  setStatus(storyCopy.holdReleased(hold.number));
}

/** A hold that becomes an order is no longer held by this session. */
export function holdBecameOrder(): void {
  store.dropHold();
  announce();
}

interface HoldReading {
  number: number;
  state: 'held';
  holdMs: number;
  remainingMs: number;
}

/** The time left comes only from the server, asked for once a second. */
export function startPolling(): void {
  if (polling) return;
  polling = true;
  const tick = async (): Promise<void> => {
    const hold = store.hold();
    if (hold === null) {
      polling = false;
      return;
    }
    try {
      const reading = await call<HoldReading>(`/api/holds/${hold.number}`, {
        headers: { 'X-Hold-Token': hold.holdToken },
      });
      store.keepHold({ ...hold, remainingMs: reading.remainingMs, holdMs: reading.holdMs });
      announce();
    } catch (error) {
      if (error instanceof ApiCallFailed && (error.failure.status === 410 || error.failure.status === 403)) {
        store.dropHold();
        setStatus(
          error.failure.status === 410
            ? errorCopy.hold_ended(hold.number)
            : errorCopy.hold_not_yours,
        );
        polling = false;
        return;
      }
    }
    setTimeout(() => void tick(), 1000);
  };
  void tick();
}

export function formatTimeLeft(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
