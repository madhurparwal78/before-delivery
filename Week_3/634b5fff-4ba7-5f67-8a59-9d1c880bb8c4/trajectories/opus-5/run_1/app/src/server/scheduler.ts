import { announceBox, drainSearchBacklog, moveBox, syncSearch } from './boxes.js';
import { transferClockNow } from './checkout.js';
import { editionClosed, realNow } from './clock.js';
import { flushKeptCharityEvents } from './charityEvents.js';
import { pool, query } from './db.js';
import { handleFulfilmentMessage, publishPendingEvents } from './fulfilment.js';
import { loadOrder, type OrderRow } from './orders.js';
import { lapseTransfer, voidAuthorisation } from './payments.js';
import { flushAlerts } from './services/alerts.js';
import { brokerUp, consumeFulfilment } from './services/broker.js';
import { liveHoldNumbers, valkeyUp } from './services/valkey.js';
import { publishSales } from './sse.js';

let consuming = false;
let lastSalesPaused: boolean | null = null;
let lastSalesOpen: boolean | null = null;

/** A lapsed hold darkens the box on every open shelf within two seconds. */
async function reconcileHolds(): Promise<void> {
  if (!valkeyUp()) return;
  const live = await liveHoldNumbers();
  const held = await query<{ number: number }>("SELECT number FROM boxes WHERE state = 'held'");
  for (const row of held) {
    if (live.has(row.number)) continue;
    await moveBox(pool, row.number, 'held', 'available').catch(() => undefined);
    announceBox(row.number, 'available');
    await syncSearch([row.number]);
  }
}

async function expireAuthorisations(): Promise<void> {
  const rows = await query<{ reference: string }>(
    `SELECT reference FROM orders
      WHERE payment_state IN ('authorised','capture_failed')
        AND auth_expires_at IS NOT NULL AND auth_expires_at <= $1`,
    [realNow()],
  );
  for (const row of rows) {
    const order: OrderRow | null = await loadOrder(row.reference);
    if (order === null) continue;
    await voidAuthorisation(order, 'authorisation_expired').catch(() => undefined);
  }
}

async function lapseTransfers(): Promise<void> {
  const rows = await query<{ reference: string }>(
    `SELECT reference FROM orders
      WHERE payment_state = 'pending' AND transfer_deadline_at IS NOT NULL
        AND transfer_deadline_at <= $1`,
    [transferClockNow()],
  );
  for (const row of rows) {
    const order = await loadOrder(row.reference);
    if (order === null) continue;
    await lapseTransfer(order).catch(() => undefined);
  }
}

function announceSales(): void {
  const salesPaused = !valkeyUp();
  const salesOpen = !editionClosed() && !salesPaused;
  if (salesPaused !== lastSalesPaused || salesOpen !== lastSalesOpen) {
    lastSalesPaused = salesPaused;
    lastSalesOpen = salesOpen;
    publishSales(salesPaused, salesOpen);
  }
}

async function keepConsuming(): Promise<void> {
  if (!brokerUp()) consuming = false;
  if (consuming) return;
  try {
    await consumeFulfilment(handleFulfilmentMessage);
    consuming = true;
  } catch {
    consuming = false;
  }
}

async function tick(): Promise<void> {
  announceSales();
  await reconcileHolds().catch(() => undefined);
  await expireAuthorisations().catch(() => undefined);
  await lapseTransfers().catch(() => undefined);
  await publishPendingEvents().catch(() => undefined);
  await flushAlerts().catch(() => undefined);
  await flushKeptCharityEvents().catch(() => undefined);
  await keepConsuming();
}

export function startScheduler(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void tick().finally(() => {
      running = false;
    });
  }, 1000).unref();

  let draining = false;
  setInterval(() => {
    if (draining) return;
    draining = true;
    void drainSearchBacklog()
      .catch(() => undefined)
      .finally(() => {
        draining = false;
      });
  }, 10_000).unref();
}
