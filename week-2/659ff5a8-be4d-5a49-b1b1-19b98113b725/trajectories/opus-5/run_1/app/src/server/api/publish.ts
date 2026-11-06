import type { PublicationDto, StandingsView } from '../../shared/api';
import { config } from '../config';
import { query, queryOne } from '../db/pool';
import { apiError } from '../http/errors';
import { json, memberRoute, pdfResult, type Route } from '../http/router';
import { withIdempotency } from '../http/idempotency';
import { attemptDelivery, enqueueDelivery, recordDeliveryFailure } from '../services/deliveries';
import { RendererUnavailable, renderPdf, rendererStatus } from '../services/renderer';
import { resultsHeaderHtml, resultsHtml, type ResultsRow } from '../services/documents';
import { StorageUnavailable, getObject, putObjectOnce, resultsKey } from '../services/storage';
import { eventStandings, standingsRows } from './standingsService';
import {
  clubOf,
  eventDto,
  loadEvent,
  requireRole,
  requireTableInForce,
  statusOf,
  type EventRecord,
} from './support';
import type { ClubRow } from '../auth';

const SECTIONS: { view: StandingsView; heading: string }[] = [
  { view: 'raw', heading: 'Raw' },
  { view: 'class', heading: 'Class' },
  { view: 'indexed', heading: 'Indexed' },
];

async function resultsDocument(event: EventRecord, club: ClubRow): Promise<string> {
  const standings = await eventStandings(event.id);
  const table = await requireTableInForce(club.id, event.event_date);
  const sections = SECTIONS.map((section) => {
    const rows: ResultsRow[] = standingsRows(standings, section.view, null).map((row) => ({
      position:
        section.view === 'indexed'
          ? row.position
          : section.view === 'class'
            ? row.classPosition
            : row.rawPosition,
      carNumber: row.carNumber,
      classCode: row.classCode,
      driverName: row.driverName,
      time: section.view === 'indexed' ? row.bestIndexed : row.bestAdjusted,
      factor: table.factors[row.classCode] ?? null,
    }));
    return { view: section.view, heading: section.heading, rows };
  });
  return resultsHtml({
    eventName: event.name,
    eventDate: event.event_date,
    venue: event.venue,
    clubName: club.name,
    sections,
  });
}

async function publicationPayload(
  event: EventRecord,
  now: Date,
  withRenderer: boolean,
): Promise<PublicationDto> {
  const stored = await queryOne<{ pdf_key: string | null; checksum: string | null }>(
    'SELECT pdf_key, checksum FROM publications WHERE event_id = $1',
    [event.id],
  );
  const totals = await queryOne<{ total: string }>(
    'SELECT count(*) AS total FROM registrations WHERE event_id = $1 AND checked_in = true',
    [event.id],
  );
  const accepted = await queryOne<{ accepted: string }>(
    `SELECT count(*) AS accepted FROM email_deliveries
      WHERE event_id = $1 AND kind = 'final_results' AND state = 'sent'`,
    [event.id],
  );
  return {
    status: statusOf(event, now),
    renderer: withRenderer ? await rendererStatus() : 'ok',
    publishedAt: event.published_at ? event.published_at.toISOString() : null,
    pdfKey: event.published_at ? stored?.pdf_key ?? null : null,
    checksum: event.results_checksum,
    emailsAccepted: Number(accepted?.accepted ?? '0'),
    emailsTotal: Number(totals?.total ?? '0'),
  };
}

export const publishRoutes: Route[] = [
  memberRoute('GET', '/api/events/:id/publication', async (ctx) => {
    clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    requireRole(ctx.actor, 'chair');
    return json(200, await publicationPayload(event, ctx.now, true));
  }),

  memberRoute('POST', '/api/events/:id/publish', async (ctx) => {
    const club = clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    requireRole(ctx.actor, 'chair');
    return withIdempotency(ctx, async () => {
      const status = statusOf(event, ctx.now);
      if (status === 'published') {
        throw apiError.conflict('already_published', 'These results are already published.');
      }
      if (status !== 'final') {
        throw apiError.conflict('not_final', 'Set results final before publishing.');
      }

      const key = resultsKey(club.slug, event.id);
      const existing = await queryOne<{ pdf_key: string; checksum: string | null }>(
        'SELECT pdf_key, checksum FROM publications WHERE event_id = $1',
        [event.id],
      );
      let checksum = existing?.checksum ?? null;

      if (checksum === null) {
        let bytes: Buffer;
        try {
          bytes = await renderPdf({
            html: await resultsDocument(event, club),
            headerHtml: resultsHeaderHtml(event.name),
          });
        } catch (error) {
          if (error instanceof RendererUnavailable) {
            await recordDeliveryFailure(club.id, 'renderer', event.id);
            throw apiError.unavailable('renderer_unavailable', 'Results PDF renderer is offline.');
          }
          throw error;
        }
        try {
          checksum = await putObjectOnce(key, bytes, 'application/pdf');
        } catch (error) {
          if (error instanceof StorageUnavailable) {
            await recordDeliveryFailure(club.id, 'storage', event.id);
            throw apiError.unavailable('storage_unavailable', 'Results storage is offline.');
          }
          throw error;
        }
        await query(
          `INSERT INTO publications (event_id, pdf_key, checksum) VALUES ($1, $2, $3)
           ON CONFLICT (event_id) DO UPDATE SET pdf_key = $2, checksum = $3`,
          [event.id, key, checksum],
        );
      }

      const standings = await eventStandings(event.id);
      const drivers = await query<{ registration_id: string; email: string }>(
        `SELECT r.id AS registration_id, u.email
           FROM registrations r JOIN users u ON u.id = r.driver_id
          WHERE r.event_id = $1 AND r.checked_in = true
          ORDER BY r.class_code, r.car_number`,
        [event.id],
      );
      const link = `${config.publicUrl}/api/events/${event.id}/results.pdf`;
      for (const driver of drivers) {
        const entry = standings.byRegistration.get(driver.registration_id);
        const position = entry?.ranked.position ?? null;
        const deliveryId = await enqueueDelivery({
          clubId: club.id,
          eventId: event.id,
          registrationId: driver.registration_id,
          kind: 'final_results',
          dedupeKey: `final_results:${event.id}:${driver.registration_id}`,
          recipient: driver.email,
          subject: `Final results: ${event.name}`,
          body: [
            `Final results for ${event.name} on ${event.event_date} are published.`,
            '',
            `Results PDF: ${link}`,
            '',
            position === null
              ? 'Your indexed finish: no time'
              : `Your indexed finish: P${position}`,
          ].join('\n'),
        });
        const pendingId =
          deliveryId ??
          (
            await queryOne<{ id: string }>(
              `SELECT id FROM email_deliveries WHERE dedupe_key = $1 AND state = 'pending'`,
              [`final_results:${event.id}:${driver.registration_id}`],
            )
          )?.id ??
          null;
        if (pendingId !== null) {
          const accepted = await attemptDelivery(pendingId);
          if (!accepted) {
            throw apiError.unavailable(
              'mail_unavailable',
              'The mail server did not accept the results emails.',
            );
          }
        }
      }

      const rows = await query<EventRecord>(
        `UPDATE events SET status = 'published', published_at = $2, results_checksum = $3
          WHERE id = $1
          RETURNING id, club_id, name, event_date, venue, registration_cutoff_local,
                    registration_cutoff_utc, runs_per_driver, heats, stations, status,
                    running_heat, provisional_at, protest_window_closes_at, version,
                    published_at, results_checksum`,
        [event.id, ctx.now, checksum],
      );
      const published = rows[0];
      if (!published) throw apiError.notFound();
      const table = await requireTableInForce(club.id, published.event_date);
      return json(200, {
        event: eventDto(published, club, table, ctx.now),
        publication: await publicationPayload(published, ctx.now, false),
      });
    });
  }),

  memberRoute('GET', '/api/events/:id/results.pdf', async (ctx) => {
    const club = clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    if (statusOf(event, ctx.now) !== 'published') throw apiError.notPublished();
    let bytes: Buffer | null;
    try {
      bytes = await getObject(resultsKey(club.slug, event.id));
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        throw apiError.unavailable('storage_unavailable', 'Results storage is offline.');
      }
      throw error;
    }
    if (bytes === null) throw apiError.notFound();
    return pdfResult(bytes);
  }),
];
