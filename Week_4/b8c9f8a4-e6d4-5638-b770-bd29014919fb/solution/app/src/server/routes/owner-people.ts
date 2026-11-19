// Named links, viewing slots, offers and alerts, from the owner's side.

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { one, query, transaction } from '../db/pool.js';
import { fail } from '../http/errors.js';
import { asObject, readJson, type Context } from '../http/request.js';
import { sendEmpty, sendJson } from '../http/respond.js';
import type { Router } from '../http/router.js';
import { requireOwner } from '../http/session.js';
import { Fields } from '../http/validate.js';
import { MESSAGE } from '../../shared/copy.js';
import { formatSlotLabel, instantFromLocal, localStartOf, zoneOf } from '../../shared/london.js';
import { bodyHash, keepSuccess, replayOf, requireKey } from '../domain/idempotency.js';
import { effectiveStatus, LIVE_OFFER, offerJson, offersOfCar, refuseMove, type OfferRow } from '../domain/offers.js';
import { insertLink, linksOfCar, newToken, secondsRemaining, statusOf, type LinkRow } from '../domain/links.js';
import { requireMove, requireOpenForEditing } from '../domain/listing.js';
import { progressFor } from '../domain/seen.js';
import { deliver, type AlertRow } from '../services/alerts.js';
import { loadCar, type CarRow, type ListingStatus } from '../domain/state.js';

async function ownedCar(context: Context): Promise<CarRow> {
  await requireOwner(context.request);
  const car = await loadCar(context.params.id);
  if (!car) fail(404, 'not_found', 'That car file is not one of ours.');
  return car;
}

async function linkJson(link: LinkRow, car: CarRow): Promise<Record<string, unknown>> {
  const progress = link.role === 'buyer'
    ? await progressFor(car.id, car.current_version as number, link.id) // a link's car is published
    : { seen: 0, total: 0, materialUnseen: 0 };
  const lastSeen = link.role === 'buyer'
    ? await one<{ seen_at: Date }>(
      'SELECT seen_at FROM seen_record WHERE link_id = $1 ORDER BY seen_at DESC LIMIT 1',
      [link.id],
    )
    : null;
  const offer = await one<OfferRow>(
    'SELECT * FROM offer WHERE link_id = $1 ORDER BY stamped_at DESC LIMIT 1',
    [link.id],
  );
  return {
    id: link.id,
    role: link.role,
    name: link.name,
    status: statusOf(link),
    expiresAt: link.expires_at.toISOString(),
    secondsRemaining: secondsRemaining(link),
    seen: progress.seen,
    total: progress.total,
    materialUnseen: progress.materialUnseen,
    lastSeenAt: lastSeen ? lastSeen.seen_at.toISOString() : null,
    offerStatus: offer ? effectiveStatus(offer) : null,
  };
}

async function slotJson(slot: SlotRow, forOwner: boolean, linkId?: string): Promise<Record<string, unknown>> {
  const holder = slot.holder_link_id
    ? await one<{ name: string }>('SELECT name FROM link WHERE id = $1', [slot.holder_link_id])
    : null;
  return {
    id: slot.id,
    localStart: slot.local_start,
    zone: zoneOf(slot.starts_at),
    startsAt: slot.starts_at.toISOString(),
    durationMinutes: slot.duration_minutes,
    label: formatSlotLabel(slot.starts_at),
    held: slot.holder_link_id !== null,
    heldByYou: linkId !== undefined && slot.holder_link_id === linkId,
    ...(forOwner ? { holderName: holder ? holder.name : null } : {}),
  };
}

export interface SlotRow {
  id: string;
  car_id: string;
  local_start: string;
  starts_at: Date;
  duration_minutes: number;
  holder_link_id: string | null;
}

export { slotJson };

export function registerPeople(router: Router): void {
  router.post('/api/owner/cars/:id/links', async (context) => {
    const car = await ownedCar(context);
    const body = asObject(readJson(context));
    // Only a live car can have a new link, and a live car always carries its frozen version.
    if (car.listing_status !== 'live') {
      fail(409, 'listing_not_published', 'Publish the car before issuing a link.');
    }
    const fields = new Fields();
    const role = fields.choice('role', body.role, ['buyer', 'inspector'] as const);
    const name = fields.text('name', body.name, 1, 80);
    fields.done();
    const link = await insertLink(car.id, role, name);
    sendJson(context.response, 201, {
      id: link.id,
      role: link.role,
      name: link.name,
      status: 'active',
      expiresAt: link.expires_at.toISOString(),
      secondsRemaining: secondsRemaining(link),
      token: link.token,
      path: `/l/${link.token}`,
    });
  });

  router.get('/api/owner/cars/:id/links', async (context) => {
    const car = await ownedCar(context);
    const links = await linksOfCar(car.id);
    sendJson(context.response, 200, { links: await Promise.all(links.map((link) => linkJson(link, car))) });
  });

  router.post('/api/owner/links/:linkId/revoke', async (context) => {
    const { link, car } = await ownedLink(context);
    if (statusOf(link) === 'revoked') fail(409, 'link_already_ended', 'That link has already ended.');
    await transaction(async (tx) => {
      await tx.query('UPDATE link SET revoked = true WHERE id = $1', [link.id]);
      await tx.query('UPDATE slot SET holder_link_id = NULL WHERE holder_link_id = $1', [link.id]);
    });
    const after = await one<LinkRow>('SELECT * FROM link WHERE id = $1', [link.id]);
    sendJson(context.response, 200, await linkJson(after as LinkRow, car));
  });

  router.post('/api/owner/links/:linkId/renew', async (context) => {
    const { link, car } = await ownedLink(context);
    if (link.revoked) fail(409, 'link_revoked', 'A revoked link cannot be renewed.');
    const after = await one<LinkRow>(
      'UPDATE link SET expires_at = now() + ($2 || \' seconds\')::interval WHERE id = $1 RETURNING *',
      [link.id, String(linkTtl())],
    );
    sendJson(context.response, 200, await linkJson(after as LinkRow, car));
  });

  router.post('/api/owner/links/:linkId/replace', async (context) => {
    const { link, car } = await ownedLink(context);
    if (link.revoked) fail(409, 'link_revoked', 'A revoked link cannot be replaced.');
    const token = newToken();
    const after = await one<LinkRow>(
      'UPDATE link SET token = $2, expires_at = now() + ($3 || \' seconds\')::interval WHERE id = $1 RETURNING *',
      [link.id, token, String(linkTtl())],
    );
    sendJson(context.response, 200, {
      ...(await linkJson(after as LinkRow, car)),
      token,
      path: `/l/${token}`,
    });
  });

  router.get('/api/owner/cars/:id/slots', async (context) => {
    const car = await ownedCar(context);
    const rows = await query<SlotRow>('SELECT * FROM slot WHERE car_id = $1 ORDER BY starts_at ASC', [car.id]);
    sendJson(context.response, 200, { slots: await Promise.all(rows.map((row) => slotJson(row, true))) });
  });

  router.post('/api/owner/cars/:id/slots', async (context) => {
    const car = await ownedCar(context);
    const body = asObject(readJson(context));
    requireOpenForEditing(car.listing_status);
    const fields = new Fields();
    const duration = fields.whole('durationMinutes', body.durationMinutes, 15, 240);
    const localStart = typeof body.localStart === 'string' ? body.localStart : '';
    const made = instantFromLocal(localStart);
    if (made.kind === 'malformed') fields.add('localStart', 'Use the date and time as YYYY-MM-DDTHH:mm.');
    else if (made.kind === 'missing') fields.add('localStart', MESSAGE.slotMissing);
    else if (made.instant.getTime() <= Date.now()) fields.add('localStart', MESSAGE.slotPast);
    fields.done();
    const instant = (made as { kind: 'ok'; instant: Date }).instant;
    const row = await one<SlotRow>(
      'INSERT INTO slot (id, car_id, local_start, starts_at, duration_minutes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [randomUUID(), car.id, localStartOf(instant), instant, duration],
    );
    sendJson(context.response, 201, await slotJson(row as SlotRow, true));
  });

  router.delete('/api/owner/cars/:id/slots/:slotId', async (context) => {
    const car = await ownedCar(context);
    const slot = await one<SlotRow>('SELECT * FROM slot WHERE id = $1 AND car_id = $2', [context.params.slotId, car.id]);
    if (!slot) fail(404, 'not_found', 'That viewing slot is not on this car.');
    if (slot.holder_link_id) fail(409, 'slot_held', 'A buyer is holding that slot.');
    await query('DELETE FROM slot WHERE id = $1', [slot.id]);
    sendEmpty(context.response, 204);
  });

  router.get('/api/owner/cars/:id/offers', async (context) => {
    const car = await ownedCar(context);
    const offers = await offersOfCar(car.id);
    const rows = await Promise.all(
      offers.map(async (offer) => {
        // offer.link_id is a NOT NULL FK to a link, and links are never deleted
        const link = (await one<{ name: string }>('SELECT name FROM link WHERE id = $1', [offer.link_id])) as { name: string };
        const progress = await progressFor(car.id, car.current_version as number, offer.link_id); // an offer's car is published
        return {
          ...offerJson(offer),
          linkId: offer.link_id,
          buyerName: link.name,
          seen: progress.seen,
          total: progress.total,
        };
      }),
    );
    sendJson(context.response, 200, { offers: rows });
  });

  router.post('/api/owner/offers/:offerId/accept', async (context) => {
    await requireOwner(context.request);
    const scope = `accept:${context.params.offerId}`;
    const header = context.request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    const hash = bodyHash({});
    if (key) {
      const replay = await replayOf(scope, key, hash);
      if (replay) {
        sendJson(context.response, replay.status, replay.response);
        return;
      }
    }
    const offer = await loadOffer(context.params.offerId);
    const result = await transaction(async (tx): Promise<{
      offer: ReturnType<typeof offerJson>; closedOfferIds: string[]; listingStatus: 'under_offer';
    }> => {
      const car = await tx.one<{ listing_status: ListingStatus }>(
        'SELECT listing_status FROM car WHERE id = $1 FOR UPDATE',
        [offer.car_id],
      );
      const accepted = await tx.one<{ id: string }>(
        "SELECT id FROM offer WHERE car_id = $1 AND status = 'accepted'",
        [offer.car_id],
      );
      if (accepted) fail(409, 'offer_already_accepted', MESSAGE.offerAlreadyAccepted);
      const current = await tx.one<OfferRow>('SELECT * FROM offer WHERE id = $1', [offer.id]);
      const status = effectiveStatus(current as OfferRow);
      if (status !== 'open') refuseMove(status);
      requireKey(context.request.headers['idempotency-key']);
      // Acceptance is the only way a listing becomes under_offer, and it moves from live alone.
      requireMove((car as { listing_status: ListingStatus }).listing_status, 'under_offer');
      await tx.query("UPDATE offer SET status = 'accepted' WHERE id = $1", [offer.id]);
      const closed = await tx.query<{ id: string }>(
        `UPDATE offer SET status = 'closed_by_acceptance'
         WHERE car_id = $1 AND id <> $2 AND ${LIVE_OFFER}
         RETURNING id`,
        [offer.car_id, offer.id],
      );
      await tx.query("UPDATE car SET listing_status = 'under_offer' WHERE id = $1", [offer.car_id]);
      const after = await tx.one<OfferRow>('SELECT * FROM offer WHERE id = $1', [offer.id]);
      return {
        offer: offerJson(after as OfferRow),
        closedOfferIds: closed.map((row) => row.id),
        listingStatus: 'under_offer' as const,
      };
    });
    const stored = await keepSuccess(scope, key as string, hash, 200, result);
    sendJson(context.response, stored.status, stored.response);
  });

  router.post('/api/owner/offers/:offerId/decline', async (context) => {
    await requireOwner(context.request);
    const offer = await loadOffer(context.params.offerId);
    const status = effectiveStatus(offer);
    if (status !== 'open' && status !== 'needs_reread') refuseMove(status);
    const after = await one<OfferRow>(
      "UPDATE offer SET status = 'declined' WHERE id = $1 RETURNING *",
      [offer.id],
    );
    sendJson(context.response, 200, offerJson(after as OfferRow));
  });

  router.get('/api/owner/alerts', async (context) => {
    await requireOwner(context.request);
    const rows = await query<AlertRow>('SELECT * FROM phone_alert ORDER BY created_at DESC, id DESC');
    sendJson(context.response, 200, {
      alerts: rows.map((row) => ({
        id: row.id,
        carId: row.car_id,
        kind: row.kind,
        state: row.state,
        attempts: row.attempts,
        createdAt: row.created_at.toISOString(),
        deliveredAt: row.delivered_at ? row.delivered_at.toISOString() : null,
      })),
    });
  });

  router.post('/api/owner/alerts/:alertId/retry', async (context) => {
    await requireOwner(context.request);
    const id = context.params.alertId;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) fail(404, 'not_found', 'That alert is not one of ours.');
    const claimed = await one<AlertRow>(
      "UPDATE phone_alert SET state = 'waiting' WHERE id = $1 AND state = 'failed' RETURNING *",
      [id],
    );
    if (!claimed) {
      const existing = await one<AlertRow>('SELECT * FROM phone_alert WHERE id = $1', [id]);
      if (!existing) fail(404, 'not_found', 'That alert is not one of ours.');
      if (existing.state === 'delivered') fail(409, 'alert_already_delivered', MESSAGE.alertInProgress);
      fail(409, 'alert_retry_in_progress', MESSAGE.alertInProgress);
    }
    const sent = await deliver(claimed);
    const after = await one<AlertRow>('SELECT * FROM phone_alert WHERE id = $1', [id]);
    if (!sent) fail(503, 'alert_undelivered', 'The phone alert did not go through.');
    sendJson(context.response, 200, {
      id: after!.id,
      carId: after!.car_id,
      kind: after!.kind,
      state: after!.state,
      attempts: after!.attempts,
      createdAt: after!.created_at.toISOString(),
      deliveredAt: after!.delivered_at ? after!.delivered_at.toISOString() : null,
    });
  });
}

function linkTtl(): number {
  return config.linkTtlSeconds;
}

async function ownedLink(context: Context): Promise<{ link: LinkRow; car: CarRow }> {
  await requireOwner(context.request);
  const id = context.params.linkId;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) fail(404, 'not_found', 'That link is not one of ours.');
  const link = await one<LinkRow>('SELECT * FROM link WHERE id = $1', [id]);
  if (!link) fail(404, 'not_found', 'That link is not one of ours.');
  const car = (await loadCar(link.car_id)) as CarRow; // a link's car exists; car files are never deleted
  return { link, car };
}

async function loadOffer(id: string): Promise<OfferRow> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) fail(404, 'not_found', 'That offer is not one of ours.');
  const offer = await one<OfferRow>('SELECT * FROM offer WHERE id = $1', [id]);
  if (!offer) fail(404, 'not_found', 'That offer is not one of ours.');
  return offer;
}
