// Publishing, withdrawing, completing the sale and reading what was frozen.

import { createHash } from 'node:crypto';
import { lockKey, one, query, withWaitingLock } from '../db/pool.js';
import { fail } from '../http/errors.js';
import { type Context } from '../http/request.js';
import { sendBytes, sendJson } from '../http/respond.js';
import type { Router } from '../http/router.js';
import { requireOwner } from '../http/session.js';
import { handoverHtml } from '../render/report.js';
import { renderPdf, RenderError } from '../services/render.js';
import { keys, putObject, StorageError } from '../services/store.js';
import { requireMove } from '../domain/listing.js';
import { publishCar } from '../domain/publish.js';
import type { Finding } from '../domain/findings.js';
import { LIVE_OFFER, type OfferRow } from '../domain/offers.js';
import { seenAtOf, versionFindings } from '../domain/seen.js';
import { carJson, currentVersion, loadCar, maskRegistration, type CarRow, type VersionRow } from '../domain/state.js';
import { fromStore } from './owner-uploads.js';

async function ownedCar(context: Context): Promise<CarRow> {
  await requireOwner(context.request);
  const car = await loadCar(context.params.id);
  if (!car) fail(404, 'not_found', 'That car file is not one of ours.');
  return car;
}

export function registerPublish(router: Router): void {
  router.post('/api/owner/cars/:id/publish', async (context) => {
    const car = await ownedCar(context);
    sendJson(context.response, 201, await publishCar(car.id));
  });

  router.post('/api/owner/cars/:id/withdraw', async (context) => {
    const car = await ownedCar(context);
    requireMove(car.listing_status, 'withdrawn');
    const live = (await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM offer WHERE car_id = $1 AND ${LIVE_OFFER}`,
      [car.id],
    )) as { count: number }; // an aggregate SELECT always returns one row
    if (live.count > 0) fail(409, 'offers_open', 'Close every open offer before withdrawing.');
    await query("UPDATE car SET listing_status = 'withdrawn' WHERE id = $1", [car.id]);
    const after = await loadCar(car.id);
    sendJson(context.response, 200, await carJson(after as CarRow));
  });

  router.post('/api/owner/cars/:id/complete', async (context) => {
    const car = await ownedCar(context);
    await withWaitingLock(lockKey('complete', car.id), async () => {
      // Fresh status under the lock; a car file is never deleted, so it is still there.
      const current = (await loadCar(car.id)) as CarRow;
      requireMove(current.listing_status, 'sold');
      // Only an accepted offer on a published version makes a listing under_offer, the one state that may become sold.
      const version = (await currentVersion(current)) as VersionRow;
      const offer = (await one<OfferRow>(
        "SELECT * FROM offer WHERE car_id = $1 AND status = 'accepted' ORDER BY stamped_at DESC LIMIT 1",
        [current.id],
      )) as OfferRow;
      // offer.link_id is a NOT NULL FK to a link, and links are never deleted
      const buyer = (await one<{ id: string; name: string }>(
        'SELECT id, name FROM link WHERE id = $1',
        [offer.link_id],
      )) as { id: string; name: string };
      const frozen = await versionFindings(current.id, version.number);
      const seenAt = await seenAtOf(offer.link_id);
      const seen = frozen
        .map((item) => {
          const when = seenAt.get(`${item.finding_id}:${item.content_hash}`);
          // every frozen finding is in the version's snapshot
          const finding = version.snapshot.findings.find((row) => row.id === item.finding_id) as Finding;
          return when ? { title: finding.title, seenAt: when } : null;
        })
        .filter((row): row is { title: string; seenAt: Date } => row !== null);
      const html = handoverHtml({
        carName: current.name,
        maskedRegistration: maskRegistration(current.registration),
        version: version.number,
        agreedPounds: offer.amount_pounds,
        buyerName: buyer.name,
        seen,
      });
      let pdf: Buffer;
      try {
        pdf = await renderPdf(html);
      } catch (error) {
        if (error instanceof RenderError) fail(503, 'report_render_failed', 'The handover record could not be made.');
        throw error;
      }
      const handoverSha256 = createHash('sha256').update(pdf).digest('hex');
      try {
        await putObject(keys.handover(current.id), pdf, 'application/pdf');
      } catch (error) {
        if (error instanceof StorageError) fail(503, 'report_store_failed', 'The handover record could not be stored.');
        throw error;
      }
      await query("UPDATE car SET listing_status = 'sold' WHERE id = $1", [current.id]);
      sendJson(context.response, 201, { listingStatus: 'sold', handoverSha256 });
    });
  });

  router.get('/api/owner/cars/:id/versions', async (context) => {
    const car = await ownedCar(context);
    const rows = await query<VersionRow>('SELECT * FROM version WHERE car_id = $1 ORDER BY number ASC', [car.id]);
    sendJson(context.response, 200, {
      versions: rows.map((row) => ({
        number: row.number,
        publishedAt: row.published_at.toISOString(),
        reportSha256: row.report_sha256,
      })),
    });
  });

  router.get('/api/owner/cars/:id/versions/:number', async (context) => {
    const car = await ownedCar(context);
    const version = await versionOf(car.id, context.params.number);
    sendJson(context.response, 200, versionJson(version));
  });

  router.get('/api/owner/cars/:id/report/:number', async (context) => {
    const car = await ownedCar(context);
    const version = await versionOf(car.id, context.params.number);
    const object = await fromStore(keys.report(car.id, version.number));
    sendBytes(context.response, 200, object.body, 'application/pdf');
  });

  router.get('/api/owner/cars/:id/handover', async (context) => {
    const car = await ownedCar(context);
    if (car.listing_status !== 'sold') fail(409, 'listing_not_sold', 'This car is not sold.');
    const object = await fromStore(keys.handover(car.id));
    sendBytes(context.response, 200, object.body, 'application/pdf');
  });
}

export async function versionOf(carId: string, text: string): Promise<VersionRow> {
  const number = Number(text);
  if (!Number.isInteger(number)) fail(404, 'not_found', 'That version is not one of ours.');
  const row = await one<VersionRow>('SELECT * FROM version WHERE car_id = $1 AND number = $2', [carId, number]);
  if (!row) fail(404, 'not_found', 'That version is not one of ours.');
  return row;
}

export function versionJson(version: VersionRow): unknown {
  return {
    number: version.number,
    publishedAt: version.published_at.toISOString(),
    findings: version.snapshot.findings,
    panels: version.snapshot.panels,
    record: version.snapshot.record,
  };
}
