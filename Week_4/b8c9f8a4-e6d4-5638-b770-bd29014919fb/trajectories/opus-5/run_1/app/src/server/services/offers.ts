import { query, transaction, type Tx } from '../db';
import { notFound, refuse } from '../domain/errors';
import { effectiveStatus, isLive, secondsRemaining } from '../domain/offers';
import { formatSlotLabel, londonZoneOf } from '../../shared/format';
import type { OfferDto, OwnerOfferDto, SlotDto } from '../../shared/types';
import { recordAlert, sendRecordedAlert } from '../repo/alerts';
import { withIdempotency } from '../repo/idempotency';
import { loadSeenRows, seenStateOf } from '../repo/links';
import { loadVersion } from '../repo/versions';

interface OfferRow {
  id: string;
  car_id: string;
  link_id: string;
  amount_pounds: number;
  status: OfferDto['status'];
  stamped_at: Date;
  lapses_at: Date;
}

const OFFER_COLUMNS = 'id, car_id, link_id, amount_pounds, status, stamped_at, lapses_at';

export const offerDto = (row: OfferRow, now: Date): OfferDto => {
  const status = effectiveStatus(row.status, row.lapses_at, now);
  return {
    id: row.id,
    amountPounds: row.amount_pounds,
    status,
    stampedAt: row.stamped_at.toISOString(),
    lapsesAt: row.lapses_at.toISOString(),
    secondsRemaining: secondsRemaining(row.lapses_at, now, status),
  };
};

export const listOwnerOffers = async (carId: string, currentVersion: number | null): Promise<OwnerOfferDto[]> => {
  const rows = await query<OfferRow & { buyer_name: string }>(
    `SELECT ${OFFER_COLUMNS.split(', ')
      .map((column) => `o.${column}`)
      .join(', ')}, l.name AS buyer_name
     FROM offer o JOIN named_link l ON l.id = o.link_id
     WHERE o.car_id = $1 ORDER BY o.stamped_at DESC, o.id DESC`,
    [carId],
  );
  const now = new Date();
  const version = currentVersion === null ? null : await loadVersion(carId, currentVersion);

  return Promise.all(
    rows.map(async (row) => {
      const state = seenStateOf(version, await loadSeenRows(row.link_id));
      return {
        ...offerDto(row, now),
        linkId: row.link_id,
        buyerName: row.buyer_name,
        seen: state.seen,
        total: state.total,
      };
    }),
  );
};

export interface AcceptResult {
  offer: OfferDto;
  closedOfferIds: string[];
  listingStatus: 'under_offer';
}

/**
 * Acceptance, closing every other live offer and moving the listing to under offer
 * happen in one step. A replay returns the stored success before any state refusal.
 */
export const acceptOffer = async (
  offerId: string,
  idempotencyKey: string,
): Promise<{ status: number; response: AcceptResult }> => {
  const result = await withIdempotency<AcceptResult>(`offer-accept:${offerId}`, idempotencyKey, null, async (tx) => {
    const offer = await tx.queryOne<OfferRow>(`SELECT ${OFFER_COLUMNS} FROM offer WHERE id = $1 FOR UPDATE`, [offerId]);
    if (offer === null) throw notFound();

    await tx.query('SELECT id FROM car WHERE id = $1 FOR UPDATE', [offer.car_id]);

    const alreadyAccepted = await tx.queryOne<{ one: number }>(
      "SELECT 1 AS one FROM offer WHERE car_id = $1 AND status = 'accepted' LIMIT 1",
      [offer.car_id],
    );
    if (alreadyAccepted !== null) {
      throw refuse(409, 'offer_already_accepted', 'Another offer has already been accepted');
    }

    const now = new Date();
    const status = effectiveStatus(offer.status, offer.lapses_at, now);
    if (status === 'lapsed') throw refuse(409, 'offer_lapsed', 'This offer has lapsed');
    if (status === 'needs_reread') {
      throw refuse(409, 'offer_needs_reread', 'This offer is waiting for the buyer to re-read the changes');
    }
    if (status !== 'open') throw refuse(409, 'offer_not_open', 'This offer is no longer open');

    const car = await tx.queryOne<{ listing_status: string }>('SELECT listing_status FROM car WHERE id = $1', [
      offer.car_id,
    ]);
    if (car === null || car.listing_status !== 'live') {
      throw refuse(409, 'offer_not_open', 'This offer is no longer open');
    }

    const closed = await tx.query<{ id: string }>(
      `UPDATE offer SET status = 'closed_by_acceptance'
       WHERE car_id = $1 AND id <> $2 AND status IN ('open','needs_reread') AND lapses_at > now()
       RETURNING id`,
      [offer.car_id, offerId],
    );
    await tx.query("UPDATE offer SET status = 'accepted' WHERE id = $1", [offerId]);
    await tx.query("UPDATE car SET listing_status = 'under_offer' WHERE id = $1", [offer.car_id]);

    const after = await tx.queryOne<OfferRow>(`SELECT ${OFFER_COLUMNS} FROM offer WHERE id = $1`, [offerId]);
    if (after === null) throw notFound();

    return {
      status: 200,
      response: {
        offer: offerDto(after, now),
        closedOfferIds: closed.map((row) => row.id),
        listingStatus: 'under_offer' as const,
      },
    };
  });

  return { status: result.status, response: result.response };
};

export const declineOffer = async (offerId: string): Promise<OfferDto> =>
  transaction(async (tx) => {
    const offer = await tx.queryOne<OfferRow>(`SELECT ${OFFER_COLUMNS} FROM offer WHERE id = $1 FOR UPDATE`, [offerId]);
    if (offer === null) throw notFound();
    const now = new Date();
    const status = effectiveStatus(offer.status, offer.lapses_at, now);
    if (status === 'lapsed') throw refuse(409, 'offer_lapsed', 'This offer has lapsed');
    if (!isLive(status)) throw refuse(409, 'offer_not_open', 'This offer is no longer open');
    await tx.query("UPDATE offer SET status = 'declined' WHERE id = $1", [offerId]);
    const after = await tx.queryOne<OfferRow>(`SELECT ${OFFER_COLUMNS} FROM offer WHERE id = $1`, [offerId]);
    if (after === null) throw notFound();
    return offerDto(after, now);
  });

interface SlotRow {
  id: string;
  car_id: string;
  local_start: string;
  starts_at: Date;
  duration_minutes: number;
  holder_link_id: string | null;
}

const SLOT_COLUMNS = 'id, car_id, local_start, starts_at, duration_minutes, holder_link_id';

export const slotDto = (row: SlotRow, linkId: string | null): SlotDto => ({
  id: row.id,
  localStart: row.local_start,
  zone: londonZoneOf(row.starts_at),
  startsAt: row.starts_at.toISOString(),
  durationMinutes: row.duration_minutes,
  label: formatSlotLabel(row.starts_at),
  held: row.holder_link_id !== null,
  heldByYou: row.holder_link_id !== null && row.holder_link_id === linkId,
});

export const listLinkSlots = async (carId: string, linkId: string): Promise<SlotDto[]> => {
  const rows = await query<SlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM viewing_slot WHERE car_id = $1 ORDER BY starts_at ASC`,
    [carId],
  );
  return rows.map((row) => slotDto(row, linkId));
};

export interface ClaimInput {
  carId: string;
  linkId: string;
  slotId: string;
  idempotencyKey: string;
}

/** Of simultaneous claims on a slot exactly one buyer wins. */
export const claimSlot = async (
  input: ClaimInput,
  checkGate: (tx: Tx) => Promise<void>,
): Promise<{ status: number; response: SlotDto; replayed: boolean }> => {
  let raisedAlertId: string | null = null;

  const result = await withIdempotency<SlotDto>(
    `link-claim:${input.linkId}`,
    input.idempotencyKey,
    { slotId: input.slotId },
    async (tx) => {
      const slot = await tx.queryOne<SlotRow>(
        `SELECT ${SLOT_COLUMNS} FROM viewing_slot WHERE id = $1 AND car_id = $2 FOR UPDATE`,
        [input.slotId, input.carId],
      );
      if (slot === null) throw notFound();
      await checkGate(tx);

      if (slot.holder_link_id !== null) throw refuse(409, 'slot_taken', 'That slot has just gone');
      if (slot.starts_at.getTime() <= Date.now()) throw refuse(409, 'slot_past', 'That slot has just gone');

      const held = await tx.queryOne<{ id: string }>(
        'SELECT id FROM viewing_slot WHERE car_id = $1 AND holder_link_id = $2 LIMIT 1',
        [input.carId, input.linkId],
      );
      if (held !== null) {
        throw refuse(409, 'already_holding_slot', 'You already hold a viewing. Release it first.');
      }

      await tx.query('UPDATE viewing_slot SET holder_link_id = $2 WHERE id = $1', [input.slotId, input.linkId]);
      raisedAlertId = await recordAlert(tx, input.carId, 'viewing_claim');

      const after = await tx.queryOne<SlotRow>(`SELECT ${SLOT_COLUMNS} FROM viewing_slot WHERE id = $1`, [
        input.slotId,
      ]);
      if (after === null) throw notFound();
      return { status: 201, response: slotDto(after, input.linkId) };
    },
  );

  if (!result.replayed && raisedAlertId !== null) {
    await sendRecordedAlert(raisedAlertId, 'viewing_claim');
  }
  return result;
};

export const releaseSlot = async (carId: string, linkId: string, slotId: string): Promise<SlotDto> =>
  transaction(async (tx) => {
    const slot = await tx.queryOne<SlotRow>(
      `SELECT ${SLOT_COLUMNS} FROM viewing_slot WHERE id = $1 AND car_id = $2 FOR UPDATE`,
      [slotId, carId],
    );
    if (slot === null) throw notFound();
    if (slot.holder_link_id !== linkId) throw refuse(403, 'not_slot_holder', 'You are not holding that slot');
    await tx.query('UPDATE viewing_slot SET holder_link_id = NULL WHERE id = $1', [slotId]);
    const after = await tx.queryOne<SlotRow>(`SELECT ${SLOT_COLUMNS} FROM viewing_slot WHERE id = $1`, [slotId]);
    if (after === null) throw notFound();
    return slotDto(after, linkId);
  });
