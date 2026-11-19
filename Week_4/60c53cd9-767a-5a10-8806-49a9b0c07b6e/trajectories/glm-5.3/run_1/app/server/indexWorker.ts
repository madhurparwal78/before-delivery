// The index worker: pushes pending index updates to Meilisearch every 2 seconds,
// polls the tasks until they succeed, and only then clears the pending row
// (DP-40). One worker per process; several instances share the table safely.
import type { Store } from './store/store.js';
import type { MeiliClient } from './services/meili.js';
import { type UnitRow } from './domain/units.js';

export class IndexWorker {
  private timer: unknown = null;
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly meili: MeiliClient,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, 2000);
    void this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  // Called by API handlers right after queuing updates, so confirmation starts
  // immediately rather than waiting for the next tick.
  syncNow(): void {
    setImmediate(() => {
      void this.tick();
    });
  }

  async waitForIdle(unitCodes: string[], timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pending = await this.store.pendingUpdateUnits();
      if (!unitCodes.some((code) => pending.includes(code))) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const pending = await this.store.pendingUpdateUnits();
    return !unitCodes.some((code) => pending.includes(code));
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const codes = await this.store.pendingUpdateUnits();
      if (codes.length === 0) return;
      const units = (await this.store.allUnits()).filter((unit) => codes.includes(unit.code));
      const upsertable = units.filter((unit) => unit.released && !unit.withdrawn);
      const deletable = codes.filter((code) => !upsertable.some((unit) => unit.code === code));
      if (upsertable.length > 0) {
        const documents = upsertable.map((unit) => this.documentFor(unit));
        const task = await this.meili.upsertDocuments(documents);
        if (task >= 0) {
          const succeeded = await this.meili.waitForTask(task, 10000);
          if (succeeded) {
            for (const unit of upsertable) await this.store.clearPendingUpdates(unit.code);
          }
        }
      }
      if (deletable.length > 0) {
        const task = await this.meili.deleteDocuments(deletable);
        if (task >= 0) {
          const succeeded = await this.meili.waitForTask(task, 10000);
          if (succeeded) {
            for (const code of deletable) await this.store.clearPendingUpdates(code);
          }
        }
      }
    } catch {
      // Meilisearch unreachable: the pending rows stay and are retried.
    } finally {
      this.running = false;
    }
  }

  // One document per released, non-withdrawn unit, with exactly the public unit
  // keys except syncing and viewUrl (Services: Meilisearch).
  documentFor(unit: UnitRow): Record<string, unknown> {
    return {
      code: unit.code,
      floor: unit.floor,
      stack: unit.stack,
      band: unit.band,
      bedrooms: unit.bedrooms,
      areaM2: unit.areaM2,
      areaSqft: unit.areaSqft,
      bearing: unit.bearing,
      facing: unit.facing,
      viewTag: unit.viewTag,
      price: unit.price,
      priceVersion: unit.priceVersion,
      status: unit.status,
      viewPhotographed: unit.viewPhotographed,
    };
  }
}
