import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { LABOUR_RATE_LABEL, formatMoney, parseMoney, parseQty } from '../../shared/money';
import { PANELS, isPanelId, type PanelId } from '../../shared/panels';
import { isStageName, stageOrder } from '../../shared/stages';
import { addSeconds, zurichDate, zurichParts } from '../../shared/zurich';
import type { Job, LineKind } from '../../shared/types';
import { query, withTransaction, type Tx } from '../db';
import { VALIDATION_MESSAGES, fail, type FieldErrors } from '../http/errors';
import type { RequestContext, Route } from '../http/pipeline';
import { filmToUm } from '../../shared/units';
import {
  JOB_SELECT,
  bumpVersion,
  loadCoatStack,
  loadJob,
  loadJobIn,
  loadJobRow,
  loadLines,
  loadStages,
  requireJobAction,
  toJob,
  type JobRow,
  type LineRow,
} from '../domain/jobs';
import { buildInvoice, loadInvoiceRow } from '../domain/invoices';
import { estimateMail, invoiceMail, queueMail } from '../domain/mailer';
import { ensureAccount, externalCharge } from '../providers/killbill';
import { ownerScope } from './cars';

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function etag(job: Job): Record<string, string> {
  return { etag: `"${job.version}"` };
}

interface ParsedLine {
  readonly kind: LineKind;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
}

const LINE_KINDS: readonly LineKind[] = ['part', 'labour', 'paint_materials'];

function parseLines(raw: unknown, errors: FieldErrors): ParsedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.lines = VALIDATION_MESSAGES.lines;
    return [];
  }
  const parsed: ParsedLine[] = [];
  for (const [index, entry] of raw.entries()) {
    const line = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const kind = textOf(line.kind) as LineKind;
    if (!LINE_KINDS.includes(kind)) {
      errors[`lines[${index}].kind`] = 'Choose a line kind from the list.';
      continue;
    }
    const description = textOf(line.description);
    if (description.length < 1 || description.length > 120) {
      errors[`lines[${index}].description`] = VALIDATION_MESSAGES.description;
    }
    const quantity = parseQty(textOf(line.quantity));
    if (quantity === null) {
      errors[`lines[${index}].quantity`] = quantityMessage(kind);
    } else if (kind === 'part' && (quantity % 100n !== 0n || quantity < 100n || quantity > 99900n)) {
      errors[`lines[${index}].quantity`] = VALIDATION_MESSAGES.partQuantity;
    } else if (kind === 'labour' && (quantity % 25n !== 0n || quantity < 25n || quantity > 20000n)) {
      errors[`lines[${index}].quantity`] = VALIDATION_MESSAGES.labourQuantity;
    } else if (kind === 'paint_materials' && quantity <= 0n) {
      errors[`lines[${index}].quantity`] = VALIDATION_MESSAGES.paintQuantity;
    }

    let unitPrice = LABOUR_RATE_LABEL;
    const priceGiven = line.unit_price !== undefined && line.unit_price !== null && textOf(line.unit_price) !== '';
    if (kind === 'labour') {
      if (priceGiven) errors[`lines[${index}].unit_price`] = VALIDATION_MESSAGES.labourPrice;
    } else {
      const price = priceGiven ? parseMoney(textOf(line.unit_price)) : null;
      if (price === null || price < 1n || price > 9999999n) {
        errors[`lines[${index}].unit_price`] = VALIDATION_MESSAGES.unitPrice;
      } else {
        unitPrice = formatMoney(price);
      }
    }
    parsed.push({
      kind,
      description,
      quantity: quantity === null ? '0.00' : formatQuantity(quantity),
      unitPrice,
    });
  }
  return parsed;
}

function formatQuantity(scaled: bigint): string {
  const digits = scaled.toString().padStart(3, '0');
  return `${digits.slice(0, digits.length - 2)}.${digits.slice(digits.length - 2)}`;
}

function quantityMessage(kind: LineKind): string {
  if (kind === 'part') return VALIDATION_MESSAGES.partQuantity;
  if (kind === 'labour') return VALIDATION_MESSAGES.labourQuantity;
  return VALIDATION_MESSAGES.paintQuantity;
}

async function writeLines(tx: Tx, jobId: string, lines: readonly ParsedLine[]): Promise<void> {
  await tx.query('delete from job_lines where job_id = $1', [jobId]);
  for (const [index, line] of lines.entries()) {
    await tx.query(
      'insert into job_lines (id, job_id, position, kind, description, quantity, unit_price) values ($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), jobId, index + 1, line.kind, line.description, line.quantity, line.unitPrice],
    );
  }
}

function ifMatchVersion(ctx: RequestContext): number {
  const header = ctx.header('if-match');
  const match = header === null ? null : /^"(\d+)"$/.exec(header.trim());
  if (match === null) throw fail.validation({ if_match: VALIDATION_MESSAGES.ifMatch });
  return Number(match[1]);
}

async function visibleJobRow(ctx: RequestContext, jobId: string): Promise<JobRow> {
  const row = await loadJobRow(jobId, ownerScope(ctx));
  if (row === null) throw fail.notFound();
  return row;
}

async function jobResult(jobId: string, now: Date, status = 200): Promise<{
  kind: 'json';
  status: number;
  body: { job: Job };
  headers: Record<string, string>;
}> {
  const job = await loadJob(jobId, null, now);
  if (job === null) throw fail.notFound();
  return { kind: 'json', status, body: { job }, headers: etag(job) };
}

export const jobRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/jobs',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const owner = ownerScope(ctx);
      const rows = await query<JobRow>(
        `${JOB_SELECT} ${owner === null ? '' : "where j.owner_id = $1 and j.status <> 'draft'"} order by j.number`,
        owner === null ? [] : [owner],
      );
      const jobs = await Promise.all(
        rows.map(async (row) =>
          toJob(row, await loadLines(row.id), await loadStages(row.id), ctx.now),
        ),
      );
      return { kind: 'json', status: 200, body: { jobs } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const carId = textOf(ctx.body.car_id);
      const car = await query<{ id: string; owner_id: string; status: string }>(
        'select id, owner_id, status from cars where id = $1',
        [carId],
      );
      const found = car[0];
      if (found === undefined) throw fail.notFound();
      ctx.requireRole('workshop_lead', 'house_manager');

      return withTransaction(async (tx) => {
        await tx.lock(`car-job:${carId}`);
        if (found.status !== 'stored') throw fail.conflict('car_not_stored');
        const open = await tx.queryOne<{ id: string }>(
          `select id from jobs where car_id = $1
           and status in ('draft','sent','approved','declined','expired','in_progress','finished')`,
          [carId],
        );
        if (open !== null) throw fail.conflict('job_already_open');

        const errors: FieldErrors = {};
        const title = textOf(ctx.body.title);
        if (title.length < 1 || title.length > 120) errors.title = VALIDATION_MESSAGES.title;
        const lines = parseLines(ctx.body.lines, errors);
        if (Object.keys(errors).length > 0) throw fail.validation(errors);

        const counter = await tx.queryOne<{ value: number }>(
          "update counters set value = value + 1 where name = 'job_number' returning value",
        );
        if (counter === null) throw fail.notFound();
        const jobId = `j-${randomUUID()}`;
        await tx.query(
          `insert into jobs (id, number, car_id, owner_id, title, status, version, created_at)
           values ($1,$2,$3,$4,$5,'draft',1,$6)`,
          [jobId, `J-${counter.value}`, carId, found.owner_id, title, ctx.now],
        );
        await writeLines(tx, jobId, lines);
        const job = await loadJobIn(tx, jobId, ctx.now);
        if (job === null) throw fail.notFound();
        return { kind: 'json', status: 201, body: { job }, headers: etag(job) };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      const job = toJob(row, await loadLines(row.id), await loadStages(row.id), ctx.now);
      return { kind: 'json', status: 200, body: { job }, headers: etag(job) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/jobs/:id',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      ctx.requireRole('workshop_lead', 'house_manager');
      return withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'edit');
        if (job.version !== ifMatchVersion(ctx)) throw fail.estimateChanged();

        const errors: FieldErrors = {};
        const title = textOf(ctx.body.title);
        if (title.length < 1 || title.length > 120) errors.title = VALIDATION_MESSAGES.title;
        const lines = parseLines(ctx.body.lines, errors);
        if (Object.keys(errors).length > 0) throw fail.validation(errors);

        await tx.query('update jobs set title = $2 where id = $1', [row.id, title]);
        await writeLines(tx, row.id, lines);
        await bumpVersion(tx, row.id);
        const updated = await loadJobIn(tx, row.id, ctx.now);
        if (updated === null) throw fail.notFound();
        return { kind: 'json', status: 200, body: { job: updated }, headers: etag(updated) };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/send',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      ctx.requireRole('workshop_lead', 'house_manager');
      return withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'send');
        if (job.version !== ifMatchVersion(ctx)) throw fail.estimateChanged();

        const expiresAt = addSeconds(ctx.now, config.estimateExpirySeconds);
        await tx.query(
          "update jobs set status = 'sent', sent_at = $2, expires_at = $3 where id = $1",
          [row.id, ctx.now, expiresAt],
        );
        await bumpVersion(tx, row.id);
        const owner = await tx.queryOne<{ name: string; email: string }>(
          'select name, email from users where id = $1',
          [row.owner_id],
        );
        const updated = await loadJobIn(tx, row.id, ctx.now);
        if (updated === null || owner === null) throw fail.notFound();
        await queueMail(
          tx,
          estimateMail({
            to: owner.email,
            ownerName: owner.name,
            jobNumber: updated.number,
            jobId: updated.id,
            carName: updated.car.name,
            title: updated.title,
            total: updated.total,
            expiresDate: zurichDate(expiresAt),
          }),
        );
        return { kind: 'json', status: 200, body: { job: updated }, headers: etag(updated) };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/revise',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      ctx.requireRole('workshop_lead', 'house_manager');
      return withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'revise');
        await tx.query(
          "update jobs set status = 'draft', sent_at = null, expires_at = null, declined_at = null where id = $1",
          [row.id],
        );
        await bumpVersion(tx, row.id);
        const updated = await loadJobIn(tx, row.id, ctx.now);
        if (updated === null) throw fail.notFound();
        return { kind: 'json', status: 200, body: { job: updated }, headers: etag(updated) };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/approve',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      ctx.requireRole('owner');
      return withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'approve');
        await tx.query("update jobs set status = 'approved', approved_at = $2 where id = $1", [
          row.id,
          ctx.now,
        ]);
        await bumpVersion(tx, row.id);
        const updated = await loadJobIn(tx, row.id, ctx.now);
        if (updated === null) throw fail.notFound();
        return { kind: 'json', status: 200, body: { job: updated }, headers: etag(updated) };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/decline',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      ctx.requireRole('owner');
      return withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'decline');
        await tx.query("update jobs set status = 'declined', declined_at = $2 where id = $1", [
          row.id,
          ctx.now,
        ]);
        await bumpVersion(tx, row.id);
        const updated = await loadJobIn(tx, row.id, ctx.now);
        if (updated === null) throw fail.notFound();
        return { kind: 'json', status: 200, body: { job: updated }, headers: etag(updated) };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/stages',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      ctx.requireRole('workshop_lead', 'house_manager');
      return withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'log_stage');

        const name = textOf(ctx.body.name);
        if (!isStageName(name)) throw fail.validation({ name: VALIDATION_MESSAGES.stageName });
        if (job.stages.some((stage) => stage.name === name)) {
          throw fail.conflict('stage_already_logged');
        }
        const order = stageOrder(name);
        const later = await tx.queryOne<{ id: string }>(
          'select id from job_stages where job_id = $1 and stage_order > $2 limit 1',
          [row.id, order],
        );
        if (later !== null) throw fail.conflict('stage_out_of_order');

        const errors: FieldErrors = {};
        const readings = parseReadings(ctx, name, errors);
        if (Object.keys(errors).length > 0) throw fail.validation(errors);

        const stageId = randomUUID();
        await tx.query(
          'insert into job_stages (id, job_id, name, stage_order, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6)',
          [stageId, row.id, name, order, ctx.now, ctx.user().id],
        );
        for (const reading of readings) {
          await tx.query(
            'insert into readings (id, job_id, stage_id, panel, film_um, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6,$7)',
            [randomUUID(), row.id, stageId, reading.panel, reading.filmUm, ctx.now, ctx.user().id],
          );
        }
        await tx.query("update jobs set status = 'in_progress' where id = $1", [row.id]);
        await bumpVersion(tx, row.id);
        const updated = await loadJobIn(tx, row.id, ctx.now);
        if (updated === null) throw fail.notFound();
        const stage = updated.stages.find((entry) => entry.id === stageId);
        return {
          kind: 'json',
          status: 201,
          body: { stage, job: updated },
          headers: etag(updated),
        };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/stages/:stageId/readings',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      const stageId = ctx.params.stageId ?? '';
      const stage = await query<{ id: string; name: string }>(
        'select id, name from job_stages where id = $1 and job_id = $2',
        [stageId, row.id],
      );
      const found = stage[0];
      if (found === undefined) throw fail.notFound();
      ctx.requireRole('workshop_lead', 'house_manager');

      return withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'add_reading');

        const errors: FieldErrors = {};
        const panel = textOf(ctx.body.panel);
        if (!isPanelId(panel)) errors.panel = VALIDATION_MESSAGES.panel;
        const filmUm = parseReadingValue(ctx.body.value, ctx.body.unit, errors, 'value');
        if (Object.keys(errors).length > 0) throw fail.validation(errors);

        const readingId = randomUUID();
        await tx.query(
          'insert into readings (id, job_id, stage_id, panel, film_um, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6,$7)',
          [readingId, row.id, stageId, panel, filmUm, ctx.now, ctx.user().id],
        );
        await bumpVersion(tx, row.id);
        return {
          kind: 'json',
          status: 201,
          body: {
            reading: {
              id: readingId,
              panel,
              stage: found.name,
              film_um: filmUm,
              logged_at: ctx.now.toISOString(),
              logged_by: { id: ctx.user().id, name: ctx.user().name },
            },
          },
        };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/coat-stack',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      return { kind: 'json', status: 200, body: await loadCoatStack(row.id) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/panels/:panel/readings',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      const panel = ctx.params.panel ?? '';
      if (!isPanelId(panel)) throw fail.notFound();
      const rows = await query<{
        id: string;
        stage: string;
        film_um: number;
        logged_at: Date;
        logged_by: string;
        logged_by_name: string;
      }>(
        `select r.id, s.name as stage, r.film_um, r.logged_at, r.logged_by, u.name as logged_by_name
         from readings r
         join job_stages s on s.id = r.stage_id
         join users u on u.id = r.logged_by
         where r.job_id = $1 and r.panel = $2
         order by s.stage_order, r.logged_at, r.id`,
        [row.id, panel],
      );
      return {
        kind: 'json',
        status: 200,
        body: {
          panel,
          readings: rows.map((reading) => ({
            id: reading.id,
            stage: reading.stage,
            film_um: reading.film_um,
            logged_at: reading.logged_at.toISOString(),
            logged_by: { id: reading.logged_by, name: reading.logged_by_name },
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/finish',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      ctx.requireRole('workshop_lead', 'house_manager');
      return withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'finish');
        await tx.query("update jobs set status = 'finished', finished_at = $2 where id = $1", [
          row.id,
          ctx.now,
        ]);
        await bumpVersion(tx, row.id);
        const updated = await loadJobIn(tx, row.id, ctx.now);
        if (updated === null) throw fail.notFound();
        return { kind: 'json', status: 200, body: { job: updated }, headers: etag(updated) };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/invoice',
    body: 'json',
    session: 'required',
    idempotent: true,
    async handle(ctx) {
      const row = await visibleJobRow(ctx, ctx.params.id ?? '');
      ctx.requireRole('workshop_lead', 'house_manager');
      const invoiceId = await withTransaction(async (tx) => {
        await tx.lock(`job:${row.id}`);
        const job = await loadJobIn(tx, row.id, ctx.now);
        if (job === null) throw fail.notFound();
        requireJobAction(job, 'issue_invoice');
        if (ctx.idempotencyKey === null) {
          throw fail.validation({ idempotency_key: VALIDATION_MESSAGES.idempotencyKey });
        }

        const owner = await tx.queryOne<{ id: string; name: string; email: string }>(
          'select id, name, email from users where id = $1',
          [row.owner_id],
        );
        if (owner === null) throw fail.notFound();
        const accountId = await ensureAccount(owner.id, owner.name, owner.email);
        const charge = await externalCharge(
          accountId,
          job.total,
          `Workshop job ${job.number}`,
        );

        const year = zurichParts(ctx.now).year;
        const counter = await tx.queryOne<{ value: number }>(
          `insert into counters (name, value) values ($1, 1)
           on conflict (name) do update set value = counters.value + 1
           returning value`,
          [`invoice-${year}`],
        );
        if (counter === null) throw fail.notFound();
        const number = `INV-${year}-${String(counter.value).padStart(4, '0')}`;
        const newInvoiceId = `inv-${randomUUID()}`;
        await tx.query(
          `insert into invoices (id, number, job_id, car_id, owner_id, killbill_invoice_id,
             killbill_account_id, net_total, vat_total, rounding, total, issued_at,
             last_balance, last_status, status_confirmed_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,'awaiting_payment',$12)`,
          [
            newInvoiceId,
            number,
            job.id,
            row.car_id,
            row.owner_id,
            charge.invoiceId,
            accountId,
            job.net_total,
            job.vat_total,
            job.rounding,
            job.total,
            ctx.now,
          ],
        );
        const lines = await tx.query<LineRow>(
          'select id, kind, description, quantity, unit_price from job_lines where job_id = $1 order by position',
          [job.id],
        );
        for (const [index, line] of lines.entries()) {
          await tx.query(
            `insert into invoice_lines (id, invoice_id, position, kind, description, quantity, unit_price)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [
              randomUUID(),
              newInvoiceId,
              index + 1,
              line.kind,
              line.description,
              line.quantity,
              line.unit_price,
            ],
          );
        }
        await tx.query("update jobs set status = 'invoiced', invoice_id = $2 where id = $1", [
          job.id,
          newInvoiceId,
        ]);
        await bumpVersion(tx, job.id);
        await queueMail(
          tx,
          invoiceMail({
            to: owner.email,
            ownerName: owner.name,
            carName: job.car.name,
            invoiceNumber: number,
            invoiceId: newInvoiceId,
            total: job.total,
          }),
        );
        return newInvoiceId;
      });

      const invoiceRow = await loadInvoiceRow(invoiceId, null);
      if (invoiceRow === null) throw fail.notFound();
      const built = await buildInvoice(invoiceRow);
      const job = await loadJob(row.id, null, ctx.now);
      if (job === null) throw fail.notFound();
      return {
        kind: 'json',
        status: 201,
        body: { invoice: built.invoice, job },
        headers: etag(job),
      };
    },
  },
];

interface ParsedReading {
  readonly panel: PanelId;
  readonly filmUm: number;
}

function parseReadings(
  ctx: RequestContext,
  stageName: string,
  errors: FieldErrors,
): ParsedReading[] {
  const raw = ctx.body.readings;
  const list = Array.isArray(raw) ? raw : [];
  const parsed: ParsedReading[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of list.entries()) {
    const reading =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const panel = textOf(reading.panel);
    if (!isPanelId(panel) || seen.has(panel)) {
      errors[`readings[${index}].panel`] = VALIDATION_MESSAGES.panel;
    } else {
      seen.add(panel);
    }
    const filmUm = parseReadingValue(
      reading.value,
      reading.unit,
      errors,
      `readings[${index}].value`,
    );
    if (isPanelId(panel) && filmUm !== null) parsed.push({ panel, filmUm });
  }
  if (stageName === 'Intake') {
    if (parsed.length !== PANELS.length) errors.readings = VALIDATION_MESSAGES.intakeReadings;
  } else if (list.length === 0) {
    errors.readings = VALIDATION_MESSAGES.someReadings;
  }
  return parsed;
}

function parseReadingValue(
  value: unknown,
  unit: unknown,
  errors: FieldErrors,
  field: string,
): number | null {
  const filmUnit = textOf(unit) === 'mil' ? 'mil' : 'um';
  const raw = typeof value === 'number' ? String(value) : textOf(value);
  const message =
    filmUnit === 'mil' ? VALIDATION_MESSAGES.readingMil : VALIDATION_MESSAGES.readingUm;
  if (filmUnit === 'mil') {
    const scaled = /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : null;
    if (scaled === null || scaled < 0 || scaled > 78.7) {
      errors[field] = message;
      return null;
    }
  } else if (!/^\d+$/.test(raw) || Number(raw) > 2000) {
    errors[field] = message;
    return null;
  }
  const filmUm = filmToUm(raw, filmUnit);
  if (filmUm === null || filmUm < 0 || filmUm > 2000) {
    errors[field] = message;
    return null;
  }
  return filmUm;
}
