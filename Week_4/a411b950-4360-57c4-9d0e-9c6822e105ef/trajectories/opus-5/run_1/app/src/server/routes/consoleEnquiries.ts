import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from '../config.ts';
import { query, withTransaction, type Queryable } from '../db/pool.ts';
import { businessDate, businessMonth, isMonthKey } from '../../shared/dates.ts';
import { csvRow, CSV_HEADER } from '../domain/csv.ts';
import { decodeCursor, encodeCursor } from '../domain/cursor.ts';
import { ENQUIRY_STATUSES, isLegalEnquiryMove, READ_TIME_STATUS_SQL, type EnquiryStatus } from '../../shared/enquiryStatus.ts';
import {
  FEE_MAX_CENTS,
  FEE_MIN_CENTS,
  milestoneDescription,
  splitMilestones,
  type MilestoneNumber,
} from '../../shared/money.ts';
import { addressField, multiLineField, singleLineField } from '../domain/text.ts';
import { isJsonInteger, unwritableKeyErrors, WRITABLE_FIELDS } from '../domain/writable.ts';
import { ApiError, conflict, notFound, storageUnavailable, validation, type FieldErrors } from '../errors.ts';
import { sendBytes, sendJson } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import {
  bumpVersion,
  ENQUIRY_COLUMNS,
  ENQUIRY_FROM,
  enquiryReadTimeStatus,
  invoicedMilestoneNumbers,
  lockEnquiry,
  readEnquiryRow,
  serializeEnquiries,
  serializeEnquiryById,
  type EnquiryRow,
} from '../repo/enquiries.ts';
import { lockMonth } from '../repo/months.ts';
import { readSettings } from '../repo/settings.ts';
import { renderProposalEmail } from '../services/emails.ts';
import { cancelPendingProposalEmail, deliverQueued, queueEmail, readMailStates } from '../services/mail.ts';
import { getObject } from '../services/storage.ts';
import { createExternalCharge, listAccountInvoices } from '../services/killbill.ts';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function etag(version: number): Record<string, string> {
  return { etag: `"${version}"` };
}

async function staleVersion(row: EnquiryRow, now: Date, client?: Queryable): Promise<ApiError> {
  const serialized = await serializeEnquiries([row], now, client);
  return new ApiError(412, 'stale_version', 'This enquiry changed in another window.', {
    current: serialized[0],
  });
}

function requireIfMatchHeader(request: IncomingMessage): string {
  const header = request.headers['if-match'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value === '') {
    throw new ApiError(428, 'precondition_required', 'Send the enquiry version in If-Match.');
  }
  return value;
}

async function loadEnquiry(id: string): Promise<EnquiryRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('That enquiry does not exist.');
  const row = await readEnquiryRow(id);
  if (row === null) throw notFound('That enquiry does not exist.');
  return row;
}

type WriteResult = { status: number; body: unknown; version: number };

async function withVersionedWrite(
  request: IncomingMessage,
  id: string,
  now: Date,
  work: (client: Queryable, row: EnquiryRow) => Promise<unknown>,
): Promise<WriteResult> {
  const ifMatch = requireIfMatchHeader(request);
  await loadEnquiry(id);
  return withTransaction(async (client) => {
    const row = await lockEnquiry(client, id);
    if (row === null) throw notFound('That enquiry does not exist.');
    if (ifMatch !== `"${row.version}"`) throw await staleVersion(row, now, client);
    const extra = await work(client, row);
    const version = await bumpVersion(client, id);
    const enquiry = await serializeEnquiryById(id, now, client);
    return {
      status: extra === undefined ? 200 : 201,
      body: extra === undefined ? { enquiry } : { ...(extra as Record<string, unknown>), enquiry },
      version,
    };
  });
}

function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_PAGE_SIZE;
  if (!/^\d+$/.test(raw)) throw validation({ limit: 'Use a whole number from 1 to 100.' });
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_PAGE_SIZE) throw validation({ limit: 'Use a whole number from 1 to 100.' });
  return limit;
}

function parseStatus(raw: string | null): EnquiryStatus | null {
  if (raw === null) return null;
  if (!ENQUIRY_STATUSES.includes(raw as EnquiryStatus)) throw validation({ status: 'Choose one of the eight statuses.' });
  return raw as EnquiryStatus;
}

export const consoleEnquiryRoutes: readonly Route[] = [
  {
    path: '/api/console/enquiries',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response, search, now }) => {
      const settings = await readSettings();
      const status = parseStatus(search.get('status'));
      const limit = parseLimit(search.get('limit'));
      const rawCursor = search.get('cursor');
      let after: string | null = null;
      if (rawCursor !== null) {
        const decoded = decodeCursor(rawCursor, settings.cursor_key);
        if (decoded === null || decoded.status !== status) throw validation({ cursor: 'That cursor is not valid here.' });
        after = decoded.lastReference;
      }

      const result = await query<EnquiryRow>(
        `SELECT ${ENQUIRY_COLUMNS} ${ENQUIRY_FROM}
          WHERE ($1::text IS NULL OR ${READ_TIME_STATUS_SQL} = $1::text)
            AND ($2::text IS NULL OR e.reference < $2::text)
          ORDER BY e.reference DESC
          LIMIT $3`,
        [status, after, limit + 1],
      );
      const page = result.rows.slice(0, limit);
      const hasMore = result.rows.length > limit;
      const last = page[page.length - 1];
      sendJson(response, 200, {
        enquiries: await serializeEnquiries(page, now),
        next_cursor:
          hasMore && last !== undefined
            ? encodeCursor({ lastReference: last.reference, status }, settings.cursor_key)
            : null,
      });
    },
  },
  {
    path: '/api/console/enquiries.csv',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response, now }) => {
      const result = await query<EnquiryRow & { export_slug: string }>(
        `SELECT ${ENQUIRY_COLUMNS},
                CASE WHEN EXISTS (
                  SELECT 1 FROM projects p WHERE p.slug = e.project_slug AND p.status = 'withdrawn'
                ) THEN '' ELSE e.project_slug END AS export_slug
           ${ENQUIRY_FROM}
          ORDER BY e.reference DESC`,
      );
      const states = await readMailStates({ query }, result.rows.map((row) => row.id));
      const lines = [CSV_HEADER];
      for (const row of result.rows) {
        lines.push(
          csvRow([
            row.reference,
            row.received_at.toISOString(),
            enquiryReadTimeStatus(row, now),
            row.name,
            row.email,
            row.studio,
            row.brief,
            row.preferred_month ?? '',
            row.export_slug,
            row.fit_score === null ? '' : String(row.fit_score),
            states.get(row.id)?.receipt ?? 'pending',
          ]),
        );
      }
      sendBytes(response, 200, Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'), {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="earshot-enquiries.csv"',
      });
    },
  },
  {
    path: '/api/console/enquiries/:id',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response, params, now }) => {
      const row = await loadEnquiry(params.id as string);
      const serialized = await serializeEnquiries([row], now);
      sendJson(response, 200, { enquiry: serialized[0] }, etag(row.version));
    },
  },
  {
    path: '/api/console/enquiries/:id/attachment',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response, params }) => {
      const row = await loadEnquiry(params.id as string);
      if (row.attachment_key === null) throw notFound('That enquiry has no reference file.');
      const bytes = await getObject(row.attachment_key);
      if (bytes === null) throw storageUnavailable();
      sendBytes(response, 200, bytes, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment',
      });
    },
  },
  {
    path: '/api/console/enquiries/:id',
    method: 'PATCH',
    requiresSession: true,
    handler: async ({ request, response, params, json, now }) => {
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.enquiryTriage);
      if (Object.keys(json).length === 0) errors.body = 'Send at least one field to change.';

      let notes: string | undefined;
      if (Object.hasOwn(json, 'triage_notes')) {
        const checked = multiLineField(json.triage_notes, 0, 4_000);
        if (!checked.ok) errors.triage_notes = checked.message;
        else notes = checked.value;
      }
      let fitScore: number | null | undefined;
      if (Object.hasOwn(json, 'fit_score')) {
        const raw = json.fit_score;
        if (raw === null) fitScore = null;
        else if (!isJsonInteger(raw) || raw < 1 || raw > 5) errors.fit_score = 'Use a whole number from 1 to 5.';
        else fitScore = raw;
      }
      let rateFloor: number | null | undefined;
      if (Object.hasOwn(json, 'rate_floor_cents')) {
        const raw = json.rate_floor_cents;
        if (raw === null) rateFloor = null;
        else if (!isJsonInteger(raw) || raw < 0) errors.rate_floor_cents = 'Use a whole number of cents.';
        else rateFloor = raw;
      }
      if (Object.keys(errors).length > 0) throw validation(errors);

      const result = await withVersionedWrite(request, params.id as string, now, async (client, row) => {
        const assignments: string[] = [];
        const values: unknown[] = [row.id];
        const push = (column: string, value: unknown): void => {
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        };
        if (notes !== undefined) push('triage_notes', notes);
        if (fitScore !== undefined) push('fit_score', fitScore);
        if (rateFloor !== undefined) push('rate_floor_cents', rateFloor);
        await client.query(`UPDATE enquiries SET ${assignments.join(', ')} WHERE id = $1`, values);
        return undefined;
      });
      sendJson(response, result.status, result.body, etag(result.version));
    },
  },
  {
    path: '/api/console/enquiries/:id/transition',
    method: 'POST',
    requiresSession: true,
    handler: async ({ request, response, params, json, now }) => {
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.transition);
      const allowed: EnquiryStatus[] = ['qualified', 'declined', 'booked'];
      if (!allowed.includes(json.to as EnquiryStatus)) errors.to = 'Choose qualified, declined or booked.';
      if (Object.keys(errors).length > 0) throw validation(errors);
      const target = json.to as EnquiryStatus;

      const result = await withVersionedWrite(request, params.id as string, now, async (client, row) => {
        if (!isLegalEnquiryMove(row.status, target)) {
          throw conflict('illegal_transition', 'That move is not allowed from the current state.', {
            from: enquiryReadTimeStatus(row, now),
            to: target,
          });
        }
        await client.query(`UPDATE enquiries SET status = $2 WHERE id = $1`, [row.id, target]);
        if (target === 'declined') await cancelPendingProposalEmail(client, row.id);
        return undefined;
      });
      sendJson(response, result.status, result.body, etag(result.version));
    },
  },
  {
    path: '/api/console/enquiries/:id/proposal',
    method: 'POST',
    requiresSession: true,
    handler: async ({ request, response, params, json, now }) => {
      const settings = await readSettings();
      const errors: FieldErrors = unwritableKeyErrors(json, WRITABLE_FIELDS.proposal);
      const producerName = singleLineField(json.producer_name, 1, 120);
      if (!producerName.ok) errors.producer_name = producerName.message;
      const producerEmail = addressField(json.producer_email);
      if (!producerEmail.ok) errors.producer_email = producerEmail.message;
      const projectTitle = singleLineField(json.project_title, 1, 120);
      if (!projectTitle.ok) errors.project_title = projectTitle.message;
      const scope = multiLineField(json.scope, 1, 2_000);
      if (!scope.ok) errors.scope = scope.message;
      if (!isJsonInteger(json.fee_cents) || json.fee_cents < FEE_MIN_CENTS || json.fee_cents > FEE_MAX_CENTS) {
        errors.fee_cents = 'Use a whole number of cents from 100 to 100,000,000.';
      }
      const month = json.production_month;
      if (typeof month !== 'string' || !isMonthKey(month)) {
        errors.production_month = 'Choose a production month.';
      }

      const token = randomBytes(24).toString('base64url');
      const expiresAt = new Date(now.getTime() + config.proposalLinkTtlSeconds * 1000);

      const result = await withVersionedWrite(request, params.id as string, now, async (client, row) => {
        if (!isLegalEnquiryMove(row.status, 'proposal_sent')) {
          throw conflict('illegal_transition', 'Only a qualified enquiry can be sent a proposal.', {
            from: enquiryReadTimeStatus(row, now),
            to: 'proposal_sent',
          });
        }
        const feeCents = json.fee_cents as number;
        if (
          errors.fee_cents === undefined &&
          row.rate_floor_cents !== null &&
          feeCents < Number(row.rate_floor_cents)
        ) {
          errors.fee_cents = 'That fee is below the rate floor.';
        }
        if (errors.production_month === undefined) {
          const locked = await lockMonth(client, month as string);
          if (!locked.open || (month as string) < businessMonth(now, settings.time_zone)) {
            errors.production_month = 'That production month is not open.';
          }
        }
        if (Object.keys(errors).length > 0) throw validation(errors);

        await client.query(
          `INSERT INTO proposals (id, enquiry_id, token, producer_name, producer_email, project_title, scope,
             fee_cents, production_month, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            randomUUID(),
            row.id,
            token,
            (producerName as { value: string }).value,
            (producerEmail as { value: string }).value,
            (projectTitle as { value: string }).value,
            (scope as { value: string }).value,
            feeCents,
            month,
            expiresAt,
          ],
        );
        await client.query(`UPDATE enquiries SET status = 'proposal_sent' WHERE id = $1`, [row.id]);
        const proposalEmailId = await queueEmail(client, {
          kind: 'proposal',
          enquiryId: row.id,
          reference: row.reference,
          message: renderProposalEmail({
            producerName: (producerName as { value: string }).value,
            producerEmail: (producerEmail as { value: string }).value,
            reference: row.reference,
            projectTitle: (projectTitle as { value: string }).value,
            feeCents,
            productionMonth: month as string,
            token,
            expiresAt,
            timeZone: settings.time_zone,
            queuedAt: now,
          }),
        });
        return { mail_id: proposalEmailId };
      });

      const body = result.body as { mail_id: string | null; enquiry: unknown };
      await deliverQueued(body.mail_id);
      const enquiry = await serializeEnquiryById(params.id as string, now);
      sendJson(response, 201, { enquiry }, etag(result.version));
    },
  },
  {
    path: '/api/console/enquiries/:id/milestones/:number/invoice',
    method: 'POST',
    requiresSession: true,
    handler: async ({ request, response, params, json, now }) => {
      const settings = await readSettings();
      const number = Number(params.number);
      if (![2, 3, 4].includes(number)) throw notFound('That milestone cannot be invoiced.');
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.empty);
      if (Object.keys(errors).length > 0) throw validation(errors);

      const result = await withVersionedWrite(request, params.id as string, now, async (client, row) => {
        if (row.status !== 'booked') {
          throw conflict('illegal_transition', 'Only a booked enquiry can be invoiced.', {
            from: enquiryReadTimeStatus(row, now),
            to: 'booked',
          });
        }
        const invoiced = invoicedMilestoneNumbers(row);
        if (invoiced.includes(number)) {
          throw conflict('milestone_already_invoiced', `Milestone ${number} is already invoiced.`);
        }
        for (let earlier = 2; earlier < number; earlier += 1) {
          if (!invoiced.includes(earlier)) {
            throw conflict('milestone_out_of_order', 'Invoice the earlier milestones first.');
          }
        }

        const milestone = splitMilestones(Number(row.fee_cents))[number - 1] as { amount_cents: number };
        const description = milestoneDescription(number as MilestoneNumber, row.reference);
        const accountId = row.killbill_account_id as string;
        const existing = (await listAccountInvoices(accountId)).find((invoice) =>
          invoice.items.some((item) => item.description === description),
        );

        let invoiceNumber: string;
        let invoiceId: string;
        let invoiceDate: string;
        if (existing !== undefined) {
          const item = existing.items.find((candidate) => candidate.description === description) as {
            amount_cents: number;
            start_date: string;
          };
          if (item.amount_cents !== milestone.amount_cents) {
            throw conflict('milestone_mismatch', `Kill Bill already holds a different amount for milestone ${number}.`);
          }
          invoiceNumber = existing.invoice_number;
          invoiceId = existing.invoice_id;
          invoiceDate = item.start_date;
        } else {
          const chargeDate = businessDate(now, settings.time_zone);
          const invoice = await createExternalCharge({
            accountId,
            amountCents: milestone.amount_cents,
            description,
            businessDate: chargeDate,
          });
          const item = invoice.items.find((candidate) => candidate.description === description);
          invoiceNumber = invoice.invoice_number;
          invoiceId = invoice.invoice_id;
          invoiceDate = item?.start_date ?? chargeDate;
        }

        await client.query(
          `UPDATE proposals SET milestone_invoices = milestone_invoices || $2::jsonb WHERE id = $1`,
          [
            row.proposal_id,
            JSON.stringify({
              [String(number)]: {
                invoice_number: invoiceNumber,
                killbill_invoice_id: invoiceId,
                invoice_date: invoiceDate,
                amount_cents: milestone.amount_cents,
              },
            }),
          ],
        );

        return {
          milestone: {
            number,
            amount_cents: milestone.amount_cents,
            invoice_number: invoiceNumber,
            killbill_invoice_id: invoiceId,
            invoice_date: invoiceDate,
          },
        };
      });
      sendJson(response, 201, result.body, etag(result.version));
    },
  },
  {
    path: '/api/console/milestones/preview',
    method: 'POST',
    requiresSession: true,
    handler: async ({ response, json }) => {
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.milestonePreview);
      if (!isJsonInteger(json.fee_cents) || json.fee_cents < FEE_MIN_CENTS || json.fee_cents > FEE_MAX_CENTS) {
        errors.fee_cents = 'Use a whole number of cents from 100 to 100,000,000.';
      }
      if (Object.keys(errors).length > 0) throw validation(errors);
      sendJson(response, 200, { milestones: splitMilestones(json.fee_cents as number) });
    },
  },
];
