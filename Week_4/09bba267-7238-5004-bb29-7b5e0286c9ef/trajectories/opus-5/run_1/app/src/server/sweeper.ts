import { withTransaction } from './db';
import { endExpiredOffers, endOffersForClosedSales, releaseExpiredHolds } from './domain/seats';
import { pumpOutbox } from './services/outbox';

const SWEEP_INTERVAL_MS = 400;
const MAIL_INTERVAL_MS = 1_000;

async function sweep(): Promise<void> {
  await withTransaction((db) => releaseExpiredHolds(db, null));
  await withTransaction((db) => endExpiredOffers(db));
  await withTransaction((db) => endOffersForClosedSales(db));
}

export function startSweeper(): void {
  let sweeping = false;
  setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void sweep()
      .catch(() => undefined)
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_INTERVAL_MS).unref();

  let pumping = false;
  setInterval(() => {
    if (pumping) return;
    pumping = true;
    void pumpOutbox()
      .catch(() => undefined)
      .finally(() => {
        pumping = false;
      });
  }, MAIL_INTERVAL_MS).unref();
}
