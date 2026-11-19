import type { CaptureItem, CaptureItemState, LinkView, PanelDto } from '../../shared/types';

export type QueueWord = 'Queued' | 'Sending' | 'Synced' | 'Rejected' | 'Conflict';

export interface QueueRow {
  clientId: string;
  item: CaptureItem;
  word: QueueWord;
  reason: string | null;
}

interface DeviceState {
  rows: QueueRow[];
  panels: PanelDto[];
  car: LinkView['car'] | null;
  /** The id of the batch in flight, so only one batch is in flight across tabs. */
  inFlight: { batchId: string; at: number } | null;
}

const EMPTY: DeviceState = { rows: [], panels: [], car: null, inFlight: null };
const IN_FLIGHT_STALE_MS = 30_000;

/**
 * All tabs of one link on one device share one queue, through the device's own
 * storage, so items queued in any tab are kept and only one batch is in flight.
 */
export class CaptureQueue {
  private readonly key: string;
  private readonly listeners = new Set<() => void>();

  constructor(token: string) {
    this.key = `open-bonnet:capture:${token}`;
    window.addEventListener('storage', (event) => {
      if (event.key !== this.key) return;
      for (const listener of this.listeners) listener();
    });
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private read(): DeviceState {
    const raw = window.localStorage.getItem(this.key);
    if (raw === null) return { ...EMPTY, rows: [], panels: [] };
    try {
      const parsed = JSON.parse(raw) as DeviceState;
      return {
        rows: Array.isArray(parsed.rows) ? parsed.rows : [],
        panels: Array.isArray(parsed.panels) ? parsed.panels : [],
        car: parsed.car ?? null,
        inFlight: parsed.inFlight ?? null,
      };
    } catch {
      return { ...EMPTY, rows: [], panels: [] };
    }
  }

  private write(state: DeviceState): void {
    window.localStorage.setItem(this.key, JSON.stringify(state));
    for (const listener of this.listeners) listener();
  }

  rows(): QueueRow[] {
    return this.read().rows;
  }

  panels(): PanelDto[] {
    return this.read().panels;
  }

  rememberPanels(panels: readonly PanelDto[]): void {
    const state = this.read();
    state.panels = [...panels];
    this.write(state);
  }

  /** The car this link belongs to, so an offline reload has something to show. */
  rememberCar(car: LinkView['car']): void {
    const state = this.read();
    state.car = car;
    this.write(state);
  }

  storedCar(): LinkView['car'] | null {
    return this.read().car;
  }

  /** A queue action writes to the device first, and the row appears as Queued. */
  add(item: CaptureItem): void {
    const state = this.read();
    state.rows.push({ clientId: item.clientId, item, word: 'Queued', reason: null });
    this.write(state);
  }

  /** A row found as Sending on reload is Queued. */
  settleOnLoad(): void {
    const state = this.read();
    let changed = false;
    for (const row of state.rows) {
      if (row.word === 'Sending') {
        row.word = 'Queued';
        changed = true;
      }
    }
    if (state.inFlight !== null && Date.now() - state.inFlight.at > IN_FLIGHT_STALE_MS) {
      state.inFlight = null;
      changed = true;
    }
    if (changed) this.write(state);
  }

  queued(): QueueRow[] {
    return this.read().rows.filter((row) => row.word === 'Queued');
  }

  /** Claims the single in-flight slot shared by every tab of this link. */
  claimBatch(batchId: string): QueueRow[] | null {
    const state = this.read();
    if (state.inFlight !== null && Date.now() - state.inFlight.at <= IN_FLIGHT_STALE_MS) return null;
    const queued = state.rows.filter((row) => row.word === 'Queued');
    if (queued.length === 0) return null;
    for (const row of queued) row.word = 'Sending';
    state.inFlight = { batchId, at: Date.now() };
    this.write(state);
    return queued.map((row) => ({ ...row }));
  }

  /** A batch with no reply puts its rows back to Queued. */
  releaseBatch(clientIds: readonly string[]): void {
    const state = this.read();
    for (const row of state.rows) {
      if (clientIds.includes(row.clientId) && row.word === 'Sending') row.word = 'Queued';
    }
    state.inFlight = null;
    this.write(state);
  }

  /** A row is Synced only from a server result. */
  applyResults(results: readonly { clientId: string; state: CaptureItemState; errors?: Record<string, string> }[]): void {
    const state = this.read();
    for (const result of results) {
      const row = state.rows.find((candidate) => candidate.clientId === result.clientId);
      if (row === undefined) continue;
      row.word = wordFor(result.state);
      row.reason = result.errors === undefined ? null : Object.values(result.errors).join(' ');
    }
    state.inFlight = null;
    this.write(state);
  }

  /** An ended link leaves the rows on screen, so the inspector can read what was lost. */
  rejectAll(clientIds: readonly string[], reason: string): void {
    const state = this.read();
    for (const row of state.rows) {
      if (!clientIds.includes(row.clientId)) continue;
      row.word = 'Rejected';
      row.reason = reason;
    }
    state.inFlight = null;
    this.write(state);
  }
}

const wordFor = (state: CaptureItemState): QueueWord => {
  if (state === 'applied' || state === 'duplicate') return 'Synced';
  if (state === 'conflict') return 'Conflict';
  return 'Rejected';
};
