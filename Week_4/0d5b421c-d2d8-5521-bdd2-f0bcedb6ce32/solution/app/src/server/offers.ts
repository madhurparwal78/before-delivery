// Offers: a freed table goes to the earliest waiting entry it fits, for OFFER_SECONDS.
import type pg from "pg";
import type { BookingReceipt, OfferResponse } from "../shared/api.js";
import { catalog, targetById, type Target } from "./catalog.js";
import { claimWindow, markOffer, releaseWindow, unmarkOffer } from "./claims.js";
import { addMs, now } from "./clock.js";
import { config } from "./config.js";
import { holdsAnswering } from "./dependencies.js";
import { EXCLUSION_VIOLATION, isPgError, pool, rows, transaction } from "./db.js";
import { depositCents } from "./domain/deposit.js";
import { fitsParty } from "./domain/fit.js";
import { loadOccupancy } from "./domain/occupancy.js";
import { slotAvailability, slotTimes } from "./domain/slots.js";
import { turnWindow } from "./domain/turn.js";
import { confirmationEmail, lapsedEmail, offerEmail, queueEmail } from "./emails.js";
import { apiErrors } from "./errors.js";
import { publishEvent, type EventDetail } from "./events.js";
import { bookingEvent, insertBooking, manageUrl, recordPayment } from "./bookings.js";
import { newId, newToken } from "./ids.js";
import { exclusively } from "./locks.js";
import { purchaseDeposit, refundDeposit, type Settled } from "./killbill.js";
import { slotInstant } from "./lisbon.js";
import { reserveReference } from "./reference.js";
import { OFFER_COLUMNS, toBooking, toOffer, type BookingRow, type OfferRow } from "./records.js";
import { requireAnswering } from "./valkey.js";
import { ENTRY_COLUMNS, type EntryRow } from "./waitlist.js";

interface FreedRow {
  id: string;
  date: string;
  table_ids: string[];
}

interface Candidate {
  target: Target;
  time: string;
}

/** The earliest slot in the entry's window at which a target containing a freed table is free for its party. */
async function earliestOffer(client: pg.PoolClient, entry: EntryRow, freed: string[], at: Date): Promise<Candidate | null> {
  const targets = catalog().targets.filter(
    (target) => fitsParty(target, entry.party_size) && target.tableIds.some((tableId) => freed.includes(tableId)),
  );
  const first = slotInstant(entry.date, entry.earliest);
  const occupancy = await loadOccupancy(client, first, addMs(slotInstant(entry.date, entry.latest), 24 * 3_600_000), at);
  for (const time of slotTimes().filter((slot) => slot >= entry.earliest && slot <= entry.latest)) {
    const startsAt = slotInstant(entry.date, time);
    if (!slotAvailability(startsAt, at).bookable) continue;
    const window = turnWindow(entry.party_size, startsAt);
    const target = targets.find((candidate) => occupancy.isFree(candidate, window));
    if (target !== undefined) return { target, time };
  }
  return null;
}

interface Claimed {
  offerId: string;
  tableIds: string[];
  window: { start: Date; end: Date };
}

/** Offers the freed tables of one date to waiting entries, in join order. */
async function offerFreedTables(client: pg.PoolClient, date: string, freed: string[], claimed: Claimed[], events: EventDetail[]): Promise<void> {
  const at = now();
  const waiting = await rows<EntryRow>(
    client,
    `SELECT ${ENTRY_COLUMNS} FROM waitlist_entries WHERE date = $1 AND status = 'waiting' ORDER BY sequence FOR UPDATE`,
    [date],
  );
  for (const entry of waiting) {
    const candidate = await earliestOffer(client, entry, freed, at);
    if (candidate === null) continue;
    const startsAt = slotInstant(date, candidate.time);
    const window = turnWindow(entry.party_size, startsAt);
    const offerId = newId();
    const lifetimeMs = config.offerSeconds * 1000;
    if (!(await claimWindow(client, offerId, candidate.target.tableIds, window, lifetimeMs))) continue;
    claimed.push({ offerId, tableIds: candidate.target.tableIds, window });
    await markOffer(offerId, lifetimeMs);
    const [offer] = await rows<OfferRow>(
      client,
      `INSERT INTO offers (offer_id, token, entry_id, date, time, party_size, target_id, table_ids, status, deposit_cents, window_start, window_end, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'offered', $9, $10, $11, $12) RETURNING ${OFFER_COLUMNS}`,
      [offerId, newToken(), entry.entry_id, date, candidate.time, entry.party_size, candidate.target.targetId, candidate.target.tableIds,
        depositCents(entry.party_size, candidate.target), window.start, window.end, addMs(at, lifetimeMs)],
    );
    if (offer === undefined) throw new Error("the offer was not written");
    await client.query("UPDATE waitlist_entries SET status = 'offered' WHERE entry_id = $1", [entry.entry_id]);
    await queueEmail(client, offerEmail(offer, entry.email));
    events.push({ type: "offer.created", startsAt, tableIds: offer.table_ids, partySize: offer.party_size, expiresAt: offer.expires_at });
  }
}

/** Runs the waitlist rule for every freed table not yet handled; waits while Valkey is unreachable. */
export async function offerFreedTablesToWaitlist(): Promise<void> {
  while (holdsAnswering()) {
    const claimed: Claimed[] = [];
    const events: EventDetail[] = [];
    let handled: boolean;
    try {
      handled = await transaction(async (client) => {
        const [freed] = await rows<FreedRow>(
          client,
          "SELECT id::text AS id, date, table_ids FROM freed_tables WHERE processed_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
        );
        if (freed === undefined) return false;
        await offerFreedTables(client, freed.date, freed.table_ids, claimed, events);
        await client.query("UPDATE freed_tables SET processed_at = now() WHERE id = $1", [freed.id]);
        return true;
      });
    } catch (error) {
      for (const { offerId, tableIds, window } of claimed) {
        await releaseWindow(offerId, tableIds, window).catch(() => undefined);
        await unmarkOffer(offerId).catch(() => undefined);
      }
      throw error;
    }
    for (const event of events) void publishEvent(event);
    if (!handled) return;
  }
}

async function findOffer(token: string): Promise<OfferRow> {
  const [offer] = await rows<OfferRow>(pool, `SELECT ${OFFER_COLUMNS} FROM offers WHERE token = $1`, [token]);
  if (offer === undefined) throw apiErrors.notFound();
  return offer;
}

function assertClaimable(offer: Pick<OfferRow, "status" | "expires_at">, at: Date): void {
  if (offer.status === "claimed") throw apiErrors.offerClaimed();
  if (offer.status === "lapsed" || at >= offer.expires_at) throw apiErrors.offerExpired();
}

export async function readOffer(token: string): Promise<OfferResponse> {
  const at = now();
  const offer = await findOffer(token);
  assertClaimable(offer, at);
  return toOffer(offer, offer.window_start, at);
}

export async function claimOffer(token: string): Promise<BookingReceipt> {
  const first = await findOffer(token);
  return exclusively(`offer:${first.offer_id}`, async () => {
    const at = now();
    const offer = await findOffer(token);
    assertClaimable(offer, at);
    await requireAnswering();
    const reference = await reserveReference(offer.offer_id);
    const target = targetById(offer.target_id);
    if (target === undefined) throw new Error(`offer ${offer.offer_id} names an unknown table`);
    const [entry] = await rows<EntryRow>(pool, `SELECT ${ENTRY_COLUMNS} FROM waitlist_entries WHERE entry_id = $1`, [offer.entry_id]);
    if (entry === undefined) throw new Error(`offer ${offer.offer_id} has no waitlist entry`);
    const bookingToken = newToken();
    const window = { start: offer.window_start, end: offer.window_end };

    const client = await pool.connect();
    let charge: Settled | null = null;
    try {
      await client.query("BEGIN");
      const [locked] = await rows<{ status: OfferRow["status"] }>(client, "SELECT status FROM offers WHERE offer_id = $1 FOR UPDATE", [offer.offer_id]);
      if (locked?.status === "claimed") throw apiErrors.offerClaimed();
      if (locked?.status !== "offered") throw apiErrors.offerExpired();
      if (offer.deposit_cents > 0) charge = await purchaseDeposit(reference, entry.name, entry.email, offer.deposit_cents);
      const booking: BookingRow = await insertBooking(client, {
        reference, token: bookingToken, source: "waitlist", status: "booked", target, date: offer.date, time: offer.time,
        startsAt: offer.window_start, window, partySize: offer.party_size, name: entry.name, email: entry.email, phone: null,
        depositCents: offer.deposit_cents, depositState: charge === null ? "none" : "paid",
      });
      if (charge !== null) await recordPayment(client, reference, "purchase", offer.deposit_cents, charge);
      await client.query("UPDATE offers SET status = 'claimed' WHERE offer_id = $1", [offer.offer_id]);
      await client.query("UPDATE waitlist_entries SET status = 'claimed' WHERE entry_id = $1", [offer.entry_id]);
      await queueEmail(client, confirmationEmail(booking, entry.email));
      await client.query("COMMIT");
      await releaseWindow(offer.offer_id, offer.table_ids, window).catch(() => undefined);
      await unmarkOffer(offer.offer_id).catch(() => undefined);
      void publishEvent({ type: "offer.claimed", startsAt: offer.window_start, tableIds: offer.table_ids, partySize: offer.party_size });
      void publishEvent(bookingEvent("booking.created", booking));
      return { booking: toBooking(booking), manage_url: manageUrl(bookingToken) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (charge !== null) await refundDeposit(reference, charge.paymentId, offer.deposit_cents).catch(() => undefined);
      throw isPgError(error, EXCLUSION_VIOLATION) ? apiErrors.tableTaken() : error;
    } finally {
      client.release();
    }
  });
}

/** Lapses every unclaimed offer past its expiry, tells the guest and frees the table for the next entry. */
export async function lapseOffers(): Promise<void> {
  const lapsed = await transaction(async (client) => {
    const ended = await rows<OfferRow & { email: string }>(
      client,
      `WITH ended AS (
         UPDATE offers SET status = 'lapsed'
          WHERE offer_id IN (SELECT offer_id FROM offers WHERE status = 'offered' AND expires_at <= $1 FOR UPDATE SKIP LOCKED)
          RETURNING ${OFFER_COLUMNS}
       ), entries AS (
         UPDATE waitlist_entries SET status = 'lapsed' WHERE entry_id IN (SELECT entry_id FROM ended) RETURNING entry_id, email
       )
       SELECT ended.*, entries.email FROM ended JOIN entries USING (entry_id)`,
      [now()],
    );
    for (const offer of ended) {
      await queueEmail(client, lapsedEmail(offer, offer.email));
      await client.query("INSERT INTO freed_tables (date, table_ids) VALUES ($1, $2)", [offer.date, offer.table_ids]);
    }
    return ended;
  });
  for (const offer of lapsed) {
    await releaseWindow(offer.offer_id, offer.table_ids, { start: offer.window_start, end: offer.window_end }).catch(() => undefined);
    await unmarkOffer(offer.offer_id).catch(() => undefined);
    void publishEvent({ type: "offer.lapsed", startsAt: offer.window_start, tableIds: offer.table_ids, partySize: offer.party_size });
  }
}
