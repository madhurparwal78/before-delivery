import { SEAT_CURRENCY, SEAT_PRICE } from '../config.js';
import { query } from '../db.js';
import { sendTo } from '../events.js';
import { withAudit } from '../audit.js';
import {
  BillingUnreachable,
  bundleKeyFor,
  cancelSeat,
  ensureAccount,
  ensureCatalog,
  findSeatByBundleKey,
  listSeats,
  purchaseSeat,
  type SeatSubscription,
} from '../services/killbill.js';
import { deskStaffIds, loadPeople } from './people.js';
import type { PersonRow } from '../types.js';

let officeAccountId: string | null = null;
let catalogReady = false;

/** Only the account whose external key is the office key is ever counted. */
export async function officeAccount(): Promise<string> {
  if (!catalogReady) {
    await ensureCatalog();
    catalogReady = true;
  }
  if (officeAccountId === null) officeAccountId = await ensureAccount();
  return officeAccountId;
}

function purchaseConfirmed(seat: SeatSubscription | null): boolean {
  return seat !== null && seat.state === 'ACTIVE' && seat.chargedThroughDate !== null;
}

function releaseConfirmed(seat: SeatSubscription | null): boolean {
  return (
    seat !== null &&
    seat.state === 'CANCELLED' &&
    seat.chargedThroughDate !== null &&
    seat.billingEndDate === seat.chargedThroughDate
  );
}

export type SeatOutcome = { confirmed: boolean; subscriptionId: string | null };

const CONFIRM_WAIT_MS = 5_000;
const CONFIRM_POLL_MS = 250;

async function waitForConfirmation(
  accountId: string,
  bundleKey: string,
  settled: (seat: SeatSubscription | null) => boolean,
  waitMs: number,
): Promise<SeatSubscription | null> {
  const until = Date.now() + waitMs;
  let seat = await findSeatByBundleKey(accountId, bundleKey);
  while (!settled(seat) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
    seat = await findSeatByBundleKey(accountId, bundleKey);
  }
  return seat;
}

/**
 * Asks Kill Bill within the request that caused the change and waits up to five
 * seconds for a confirmed subscription. Anything slower waits on billing.
 */
export async function requestSeat(handle: string, waitMs = CONFIRM_WAIT_MS): Promise<SeatOutcome> {
  const bundleKey = bundleKeyFor(handle);
  try {
    const accountId = await officeAccount();
    // A retry looks the bundle up first, so one seat never gets a second subscription.
    if ((await findSeatByBundleKey(accountId, bundleKey)) === null) await purchaseSeat(accountId, bundleKey);
    const seat = await waitForConfirmation(accountId, bundleKey, purchaseConfirmed, waitMs);
    return { confirmed: purchaseConfirmed(seat), subscriptionId: seat?.subscriptionId ?? null };
  } catch (error) {
    if (error instanceof BillingUnreachable) return { confirmed: false, subscriptionId: null };
    throw error;
  }
}

export async function requestRelease(person: PersonRow, waitMs = CONFIRM_WAIT_MS): Promise<SeatOutcome> {
  const bundleKey = person.seat_bundle_key ?? bundleKeyFor(person.handle);
  try {
    const accountId = await officeAccount();
    const seat = await findSeatByBundleKey(accountId, bundleKey);
    if (seat === null) return { confirmed: false, subscriptionId: null };
    if (releaseConfirmed(seat)) return { confirmed: true, subscriptionId: seat.subscriptionId };
    // A release for a seat whose purchase is still waiting is sent once that purchase confirms.
    if (!purchaseConfirmed(seat)) return { confirmed: false, subscriptionId: seat.subscriptionId };
    await cancelSeat(seat.subscriptionId);
    const after = await waitForConfirmation(accountId, bundleKey, releaseConfirmed, waitMs);
    return { confirmed: releaseConfirmed(after), subscriptionId: seat.subscriptionId };
  } catch (error) {
    if (error instanceof BillingUnreachable) return { confirmed: false, subscriptionId: null };
    throw error;
  }
}

export type BillingView = {
  reachable: boolean;
  seats: number | null;
  seat_price: string;
  currency: string;
  next_invoice: { date: string; amount: string } | null;
  licence_term_ends_on: string | null;
  waiting: { person_id: string; name: string; change: 'add' | 'release'; since: string }[];
};

export async function readBilling(): Promise<BillingView> {
  const waitingRows = await query<{ id: string; full_name: string; seat_change: 'add' | 'release'; seat_change_since: Date }>(
    `select id, full_name, seat_change, seat_change_since from people
      where seat in ('waiting_on_billing','release_waiting') and seat_change is not null
      order by order_no asc`,
  );
  const waiting = waitingRows.map((row) => ({
    person_id: row.id,
    name: row.full_name,
    change: row.seat_change,
    since: row.seat_change_since.toISOString(),
  }));
  try {
    const accountId = await officeAccount();
    const active = (await listSeats(accountId)).filter(purchaseConfirmed);
    const dates = active.map((seat) => seat.chargedThroughDate as string).sort();
    const earliest = dates[0] ?? null;
    const atEarliest = active.filter((seat) => seat.chargedThroughDate === earliest).length;
    return {
      reachable: true,
      seats: active.length,
      seat_price: SEAT_PRICE,
      currency: SEAT_CURRENCY,
      next_invoice: earliest === null ? null : { date: earliest, amount: (Number(SEAT_PRICE) * atEarliest).toFixed(2) },
      licence_term_ends_on: earliest,
      waiting,
    };
  } catch (error) {
    if (!(error instanceof BillingUnreachable)) throw error;
    return {
      reachable: false,
      seats: null,
      seat_price: SEAT_PRICE,
      currency: SEAT_CURRENCY,
      next_invoice: null,
      licence_term_ends_on: null,
      waiting,
    };
  }
}

/** Re-checks every waiting seat change, without a restart. */
export async function retryWaitingSeats(): Promise<void> {
  const people = (await loadPeople()).filter(
    (person) => person.seat === 'waiting_on_billing' || person.seat === 'release_waiting',
  );
  if (people.length === 0) return;
  for (const person of people) {
    const outcome =
      person.seat === 'waiting_on_billing' ? await requestSeat(person.handle, 0) : await requestRelease(person, 0);
    if (!outcome.confirmed) continue;
    const seat = person.seat === 'waiting_on_billing' ? 'confirmed' : 'released';
    const action = person.seat === 'waiting_on_billing' ? 'seat_confirmed' : 'seat_released';
    const change = person.seat === 'waiting_on_billing' ? 'add' : 'release';
    const settled = await withAudit(async (client, write) => {
      const updated = await client.query(
        `update people set seat = $2, seat_change = null, seat_change_since = null, seat_subscription_id = $3
          where id = $1 and seat = $4`,
        [person.id, seat, outcome.subscriptionId, person.seat],
      );
      if ((updated.rowCount ?? 0) === 0) return false;
      await write({
        actor: 'Lockset',
        action,
        subject: { kind: 'person', id: person.id, name: person.full_name },
        details: { change },
      });
      return true;
    });
    if (!settled) continue;
    const staff = await deskStaffIds();
    sendTo(staff, { name: 'billing-changed', data: {} });
    sendTo(staff, { name: 'seat-confirmed', data: { person_id: person.id, name: person.full_name, change } });
  }
}
