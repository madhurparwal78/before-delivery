import { findProvince, type ProvinceCode } from '../../shared/catalogue.js';
import { apiMessages, settingsCopy } from '../../shared/copy.js';
import { applicationDecisionMail } from '../app/emails.js';
import { publishStockLevels } from '../app/live.js';
import { pendingReviews } from '../app/reviews.js';
import { committedDropCans, stockFigures } from '../db/ledger.js';
import { dashboardRefunds } from '../db/orders.js';
import { queueMail } from '../db/outbox.js';
import { query, queryOne } from '../db/pool.js';
import {
  loadSettings,
  saveDropPrice,
  saveDropRelease,
  saveProvinceRates,
} from '../db/settings.js';
import { dashboardDunning } from '../db/subscriptions.js';
import { conflict, notFound, validationError } from '../http/errors.js';
import type { Route } from '../http/router.js';
import { getObject, objectKeys } from '../services/files.js';
import { allServiceStatuses } from '../services/health.js';
import { setReviewStatus, getReview } from '../services/pocketbase.js';
import { applicationBody, isUuid } from './stockists.js';
import { OWNER_ONLY } from './support.js';

interface ApplicationRow {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  province: string;
  licence_extension: string;
  licence_content_type: string;
  status: string;
  submitted_at: Date;
}

function wholeNumber(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    return null;
  }
  return value;
}

export const ownerRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/owner/settings',
    roles: OWNER_ONLY,
    handle: async () => {
      const settings = await loadSettings();
      return {
        status: 200,
        json: {
          provinces: settings.provinces.map((province) => ({
            code: province.code,
            name: province.name,
            shipping_cents: province.shippingCents,
            free_shipping_threshold_cents: province.freeShippingThresholdCents,
            deposit_cents_per_can: province.depositCentsPerCan,
            taxes: province.taxes,
          })),
          drop: {
            flavour: settings.drop.flavour,
            can_price_cents: settings.drop.canPriceCents,
            released: settings.drop.released,
          },
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/api/owner/provinces/:code',
    roles: OWNER_ONLY,
    handle: async (ctx) => {
      const province = findProvince(ctx.params.code!.toUpperCase());
      if (province === undefined) throw notFound();
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      const shipping = wholeNumber(payload.shipping_cents, 10_000);
      const threshold = wholeNumber(payload.free_shipping_threshold_cents, 100_000);
      const fields: Record<string, string> = {};
      if (shipping === null) fields.shipping_cents = 'Enter a rate from $0.00 to $100.00.';
      if (threshold === null) {
        fields.free_shipping_threshold_cents = 'Enter a threshold from $0.00 to $1000.00.';
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);

      const saved = await saveProvinceRates(
        province.code as ProvinceCode,
        shipping!,
        threshold!,
      );
      return {
        status: 200,
        json: {
          province: {
            code: saved.code,
            name: saved.name,
            shipping_cents: saved.shippingCents,
            free_shipping_threshold_cents: saved.freeShippingThresholdCents,
            deposit_cents_per_can: saved.depositCentsPerCan,
            taxes: saved.taxes,
          },
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/api/owner/drop',
    roles: OWNER_ONLY,
    handle: async (ctx) => {
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      const fields: Record<string, string> = {};

      if (payload.can_price_cents !== undefined) {
        const price = wholeNumber(payload.can_price_cents, 2000);
        if (price === null || price < 1) {
          fields.can_price_cents = 'Enter a price from $0.01 to $20.00.';
        }
      }
      let released: number | null = null;
      if (payload.released !== undefined) {
        released = wholeNumber(payload.released, 1_000_000);
        if (released === null) fields.released = 'Enter a whole number of cans.';
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);

      if (released !== null) {
        const drop = (await stockFigures()).find((figure) => figure.released !== null)!;
        if (released > drop.received) {
          throw validationError({
            released: `Only ${drop.received} cans have been received.`,
          });
        }
        const committed = await committedDropCans();
        if (released < committed) {
          throw conflict('below_committed', settingsCopy.belowCommitted(committed), {
            committed,
          });
        }
        await saveDropRelease(released);
      }
      if (payload.can_price_cents !== undefined) {
        await saveDropPrice(payload.can_price_cents as number);
      }
      void publishStockLevels();

      const settings = await loadSettings();
      return {
        status: 200,
        json: {
          drop: {
            flavour: settings.drop.flavour,
            can_price_cents: settings.drop.canPriceCents,
            released: settings.drop.released,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/owner/dashboard',
    roles: OWNER_ONLY,
    handle: async () => ({
      status: 200,
      json: {
        dunning: await dashboardDunning(),
        refunds: await dashboardRefunds(),
        services: allServiceStatuses(),
      },
    }),
  },
  {
    method: 'GET',
    path: '/api/owner/applications',
    roles: OWNER_ONLY,
    handle: async (ctx) => {
      const status = ctx.query.get('status');
      const rows =
        status === null
          ? await query<ApplicationRow>(
              'select * from retailer_applications order by submitted_at desc',
            )
          : await query<ApplicationRow>(
              'select * from retailer_applications where status = $1 order by submitted_at desc',
              [status],
            );
      return {
        status: 200,
        json: {
          applications: rows.map((row) => ({
            ...(applicationBody(row) as Record<string, unknown>),
            contact_name: row.contact_name,
            email: row.email,
            province: row.province,
          })),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/owner/applications/:id/licence',
    roles: OWNER_ONLY,
    handle: async (ctx) => {
      if (!isUuid(ctx.params.id!)) throw notFound();
      const row = await queryOne<ApplicationRow>(
        'select * from retailer_applications where id = $1',
        [ctx.params.id!],
      );
      if (row === null) throw notFound();
      const stored = await getObject(objectKeys.licence(row.id, row.licence_extension));
      if (stored === null) throw notFound();
      return { status: 200, body: stored.body, contentType: row.licence_content_type };
    },
  },
  {
    method: 'POST',
    path: '/api/owner/applications/:id/decision',
    roles: OWNER_ONLY,
    handle: async (ctx) => {
      if (!isUuid(ctx.params.id!)) throw notFound();
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      if (payload.decision !== 'approved' && payload.decision !== 'declined') {
        throw validationError({ decision: 'Approve or decline the application.' });
      }
      const decided = await query<ApplicationRow>(
        `update retailer_applications
            set status = $2, decided_at = now()
          where id = $1 and status = 'submitted'
          returning *`,
        [ctx.params.id!, payload.decision],
      );
      if (decided.length === 0) {
        const row = await queryOne<ApplicationRow>(
          'select * from retailer_applications where id = $1',
          [ctx.params.id!],
        );
        if (row === null) throw notFound();
        throw conflict('already_decided', apiMessages.alreadyDecided);
      }
      const row = decided[0]!;
      await queueMail(
        applicationDecisionMail({
          email: row.email,
          applicationId: row.id,
          businessName: row.business_name,
          approved: payload.decision === 'approved',
        }),
      );
      return { status: 200, json: { application: applicationBody(row) } };
    },
  },
  {
    method: 'GET',
    path: '/api/owner/reviews',
    roles: OWNER_ONLY,
    handle: async () => ({ status: 200, json: { reviews: await pendingReviews() } }),
  },
  {
    method: 'POST',
    path: '/api/owner/reviews/:id/decision',
    roles: OWNER_ONLY,
    handle: async (ctx) => {
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      if (payload.decision !== 'approved' && payload.decision !== 'rejected') {
        throw validationError({ decision: 'Approve or reject the review.' });
      }
      const review = await getReview(ctx.params.id!);
      if (review === null) throw notFound();
      if (review.status !== 'pending') {
        throw conflict('already_decided', apiMessages.alreadyDecided);
      }
      const updated = await setReviewStatus(review.id, payload.decision);
      return {
        status: 200,
        json: {
          review: {
            id: updated.id,
            flavour: updated.flavour,
            rating: updated.rating,
            body: updated.body,
            status: updated.status,
          },
        },
      };
    },
  },
];
