import { query, queryOne, transaction } from '../db.js';
import { notFound, staleVersion, validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import type { MemberRow } from '../data/members.js';
import { findTalentById } from '../data/talent.js';
import { findClient } from '../data/clients.js';
import { licenceEndsAt, licenceEndsOn, licenceStatus } from '../domain/licences.js';
import { MEDIA_NAMES, TERRITORY_NAMES } from '../../shared/format.js';
import { formatIsoDate, parseIsoDate, toIsoInstant } from '../../shared/zone.js';
import { json, readNumber, readString } from './helpers.js';
import { newId } from '../ids.js';
import { createCommittedCharge, ensureAccount } from '../services/killbill.js';
import {
  MEDIA_VALUES,
  TERRITORY_VALUES,
  type Licence,
  type LicenceStatus,
  type Media,
  type Territory,
} from '../../shared/types.js';

type LicenceRow = {
  id: string;
  client_id: string;
  talent_id: string;
  media: Media;
  territory: Territory;
  first_use_date: string;
  term_months: number;
  extra_months: number;
  monthly_fee_cents: number;
  version: number;
  client_company: string;
  client_time_zone: string;
  talent_display_name: string;
};

type ExtensionRow = {
  id: string;
  licence_id: string;
  months: number;
  amount_cents: number;
  killbill_invoice_id: string | null;
  extended_by_name: string;
  extended_at: Date;
};

const SELECT_LICENCE = `
  SELECT l.*, c.company AS client_company, c.time_zone AS client_time_zone,
         t.display_name AS talent_display_name
  FROM licences l
  JOIN clients c ON c.id = l.client_id
  JOIN talent t ON t.id = l.talent_id`;

async function lastExtension(licenceId: string): Promise<ExtensionRow | null> {
  return queryOne<ExtensionRow>(
    'SELECT * FROM licence_extensions WHERE licence_id = $1 ORDER BY extended_at DESC, id DESC LIMIT 1',
    [licenceId],
  );
}

async function licenceView(row: LicenceRow, nowMs: number): Promise<Licence> {
  const firstUse = parseIsoDate(row.first_use_date);
  if (!firstUse) throw new Error('bad first use date');
  const endsOn = licenceEndsOn(firstUse, row.term_months + row.extra_months);
  const extension = await lastExtension(row.id);
  return {
    id: row.id,
    clientId: row.client_id,
    clientCompany: row.client_company,
    clientTimeZone: row.client_time_zone,
    talentId: row.talent_id,
    talentDisplayName: row.talent_display_name,
    media: row.media,
    territory: row.territory,
    firstUseDate: row.first_use_date,
    termMonths: row.term_months,
    endsOn: formatIsoDate(endsOn),
    endsAt: toIsoInstant(licenceEndsAt(endsOn, row.client_time_zone)),
    status: licenceStatus(endsOn, row.client_time_zone, nowMs),
    monthlyFeeCents: row.monthly_fee_cents,
    version: row.version,
    lastExtension: extension
      ? {
        id: extension.id,
        months: extension.months,
        amountCents: extension.amount_cents,
        killbillInvoiceId: extension.killbill_invoice_id,
        extendedBy: extension.extended_by_name,
        extendedAt: toIsoInstant(extension.extended_at.getTime()),
      }
      : null,
  };
}

async function findLicenceRow(id: string): Promise<LicenceRow | null> {
  const rows = await query<LicenceRow>(`${SELECT_LICENCE} WHERE l.id = $1`, [id]);
  return rows[0] ?? null;
}

export const licenceRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/licences',
    auth: 'session',
    roles: ['accounts_lead', 'agency_director'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const clientId = readString(ctx.json, 'clientId') ?? '';
      const talentId = readString(ctx.json, 'talentId') ?? '';
      const client = await findClient(clientId);
      const talent = await findTalentById(talentId);
      if (!client || !talent) throw notFound();
      const errors: Record<string, string> = {};
      const media = readString(ctx.json, 'media') ?? '';
      const territory = readString(ctx.json, 'territory') ?? '';
      const firstUseDate = readString(ctx.json, 'firstUseDate') ?? '';
      const termMonths = readNumber(ctx.json, 'termMonths');
      const monthlyFeeCents = readNumber(ctx.json, 'monthlyFeeCents');
      if (!MEDIA_VALUES.includes(media as Media)) errors.media = 'Enter media.';
      if (!TERRITORY_VALUES.includes(territory as Territory)) errors.territory = 'Enter territory.';
      if (!parseIsoDate(firstUseDate)) errors.firstUseDate = 'Enter first use date.';
      if (termMonths === null || !Number.isInteger(termMonths) || termMonths < 1 || termMonths > 36) {
        errors.termMonths = 'Enter months between 1 and 36.';
      }
      if (monthlyFeeCents === null || !Number.isInteger(monthlyFeeCents) || monthlyFeeCents < 0) {
        errors.monthlyFeeCents = 'Enter monthly fee.';
      }
      if (Object.keys(errors).length > 0) throw validation(errors);

      const id = newId('lic');
      await query(
        `INSERT INTO licences (id, client_id, talent_id, media, territory, first_use_date, term_months, monthly_fee_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, clientId, talentId, media, territory, firstUseDate, termMonths, monthlyFeeCents],
      );
      const row = await findLicenceRow(id);
      if (!row) throw notFound();
      return json(201, { licence: await licenceView(row, ctx.nowMs) });
    },
  },
  {
    method: 'GET',
    path: '/api/licences',
    auth: 'session',
    roles: ['accounts_lead', 'agency_director'],
    handler: async (ctx: Ctx): Promise<Reply> => {
      const wanted = ctx.url.searchParams.get('status');
      if (wanted && !['active', 'expiring', 'expired'].includes(wanted)) {
        throw validation({ status: 'Choose one of the published statuses.' });
      }
      const rows = await query<LicenceRow>(`${SELECT_LICENCE} ORDER BY l.created_at DESC`);
      const all: Licence[] = [];
      for (const row of rows) all.push(await licenceView(row, ctx.nowMs));
      const counts = {
        active: all.filter((licence) => licence.status === 'active').length,
        expiring: all.filter((licence) => licence.status === 'expiring').length,
        expired: all.filter((licence) => licence.status === 'expired').length,
      };
      const licences = wanted ? all.filter((licence) => licence.status === (wanted as LicenceStatus)) : all;
      return json(200, { counts, licences });
    },
  },
  {
    method: 'GET',
    path: '/api/licences/:id',
    auth: 'session',
    roles: ['accounts_lead', 'agency_director'],
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await findLicenceRow(ctx.params.id);
      if (!row) throw notFound();
      return json(200, { licence: await licenceView(row, ctx.nowMs) });
    },
  },
  {
    method: 'POST',
    path: '/api/licences/:id/extensions',
    auth: 'session',
    roles: ['accounts_lead', 'agency_director'],
    body: 'json',
    idempotency: true,
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findLicenceRow(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const row = await findLicenceRow(ctx.params.id);
      if (!row) throw notFound();
      const version = readNumber(ctx.json, 'version');
      if (version !== null && version !== row.version) {
        const extension = await lastExtension(row.id);
        throw staleVersion(
          extension?.extended_by_name ?? member.name,
          toIsoInstant((extension?.extended_at ?? new Date(ctx.nowMs)).getTime()),
        );
      }
      const months = readNumber(ctx.json, 'months');
      if (months === null || !Number.isInteger(months) || months < 1 || months > 36) {
        throw validation({ months: 'Enter months between 1 and 36.' });
      }

      const client = await findClient(row.client_id);
      if (!client) throw notFound();
      const amountCents = row.monthly_fee_cents * months;
      const accountId = await ensureAccount(client);
      const invoiceId = await createCommittedCharge(accountId, {
        description: `Usage licence renewal: ${row.talent_display_name}, ${MEDIA_NAMES[row.media]}, ${TERRITORY_NAMES[row.territory]}, ${months} months`,
        amountCents,
      });

      const extensionId = newId('lex');
      await transaction(async (tx) => {
        await tx.query(
          `INSERT INTO licence_extensions (id, licence_id, months, amount_cents, killbill_invoice_id, extended_by, extended_by_name, extended_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [extensionId, row.id, months, amountCents, invoiceId, member.id, member.name, new Date(ctx.nowMs)],
        );
        await tx.query(
          'UPDATE licences SET extra_months = extra_months + $2, version = version + 1 WHERE id = $1',
          [row.id, months],
        );
      });

      const updated = await findLicenceRow(row.id);
      if (!updated) throw notFound();
      return json(201, {
        licence: await licenceView(updated, ctx.nowMs),
        extension: {
          id: extensionId,
          months,
          amountCents,
          killbillInvoiceId: invoiceId,
          extendedBy: member.name,
          extendedAt: toIsoInstant(ctx.nowMs),
        },
      });
    },
  },
];
