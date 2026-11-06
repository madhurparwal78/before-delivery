import { renderCsv } from '../../domain/csv.js';
import type { LicenceState } from '../../domain/licensing.js';
import { minorToBillingAmount } from '../../domain/money.js';
import { coopDateOf, csvCoopTime, displayCoopTime, isoInstant } from '../../domain/time.js';
import { serverNow } from '../clock.js';
import { db, queryOn } from '../db/pool.js';
import { essayCreditLine, loadCredits, loadEssay } from '../data/essays.js';
import {
  newsroomLicences,
  REVOKED_PLACEHOLDER_TITLE,
  stateAt,
  type LicenceRow,
} from '../data/licences.js';
import { newsroomBySlug } from '../data/people.js';
import { notFound } from '../http/errors.js';
import { requireNewsroom, requireRole, type Reply, type Route } from '../http/router.js';

const CSV_HEADER = [
  'licence_id',
  'essay_title',
  'caption',
  'credit_line',
  'kind',
  'state',
  'confirmed_at',
  'window_start',
  'window_end',
  'amount',
  'currency',
];

interface Counted {
  licence: LicenceRow;
  state: LicenceState;
}

async function readLicences(newsroom: string, now: Date): Promise<Counted[]> {
  const rows = await newsroomLicences(db, newsroom, now);
  return rows.map((licence) => ({ licence, state: stateAt(licence, now) }));
}

export const usageRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/usage',
    roles: ['licensing_manager'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'licensing_manager');
      const slug = requireNewsroom(person);
      const now = await serverNow();
      const newsroom = await newsroomBySlug(slug);
      if (!newsroom) throw notFound();
      const counted = await readLicences(slug, now);
      const shortlist = await queryOn<{ count: string }>(
        db,
        `select count(*) as count from shortlist_items s join essays e on e.id = s.essay_id
         where s.newsroom_slug = $1 and e.state <> 'taken_down'`,
        [slug],
      );
      const byState = (state: LicenceState): number =>
        counted.filter((entry) => entry.state === state).length;
      const activeFuture = counted
        .filter((entry) => entry.state === 'active' && entry.licence.window_end.getTime() > now.getTime())
        .sort((left, right) => {
          const byEnd = left.licence.window_end.getTime() - right.licence.window_end.getTime();
          if (byEnd !== 0) return byEnd;
          const byConfirmed = left.licence.confirmed_at.getTime() - right.licence.confirmed_at.getTime();
          if (byConfirmed !== 0) return byConfirmed;
          return left.licence.id < right.licence.id ? -1 : 1;
        });
      const next = activeFuture[0];
      return {
        status: 200,
        json: {
          newsroom: { slug: newsroom.slug, name: newsroom.name },
          active: byState('active'),
          pending_invoice: byState('pending_invoice'),
          expired: byState('expired'),
          revoked: byState('revoked'),
          exclusive: counted.filter(
            (entry) =>
              entry.licence.kind === 'exclusive' &&
              (entry.state === 'pending_invoice' || entry.state === 'active'),
          ).length,
          standard: counted.filter(
            (entry) =>
              entry.licence.kind === 'standard' &&
              (entry.state === 'pending_invoice' || entry.state === 'active'),
          ).length,
          invoiced_minor: counted
            .filter((entry) => entry.licence.invoice_state === 'raised')
            .reduce((total, entry) => total + entry.licence.amount_minor, 0),
          shortlist_count: Number(shortlist.rows[0]?.count ?? '0'),
          next_expiry: next
            ? {
                licence_id: next.licence.id,
                window_end: isoInstant(next.licence.window_end),
                window_end_display: displayCoopTime(next.licence.window_end),
              }
            : null,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/usage.csv',
    roles: ['licensing_manager'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'licensing_manager');
      const slug = requireNewsroom(person);
      const now = await serverNow();
      const counted = await readLicences(slug, now);
      const rows: string[][] = [];
      for (const entry of counted) {
        const revoked = entry.state === 'revoked';
        const essay = await loadEssay(db, entry.licence.essay_id);
        const credits = revoked ? [] : await loadCredits(db, entry.licence.essay_id);
        rows.push([
          entry.licence.id,
          revoked ? REVOKED_PLACEHOLDER_TITLE : (essay?.title ?? ''),
          revoked ? '' : (essay?.caption ?? ''),
          revoked ? '' : essayCreditLine(credits),
          entry.licence.kind,
          entry.state,
          csvCoopTime(entry.licence.confirmed_at),
          csvCoopTime(entry.licence.window_start),
          csvCoopTime(entry.licence.window_end),
          minorToBillingAmount(entry.licence.amount_minor),
          'USD',
        ]);
      }
      return {
        status: 200,
        body: renderCsv(CSV_HEADER, rows),
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'content-disposition': `attachment; filename="saltprint-usage-${slug}-${coopDateOf(now)}.csv"`,
        },
      };
    },
  },
];
