import { lockKey, query, queryOne, transaction, txRow, txRows } from '../db.js';
import {
  billingUnavailable,
  conflict,
  mailUnavailable,
  notFound,
  validation,
  yachtWithdrawn,
} from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction } from '../auth.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { formatDate, formatMoney } from '../../shared/format.js';
import { findYacht, yachtRates, type YachtRow } from '../records.js';
import {
  effectiveStatus,
  holdJson,
  holdTaker,
  placeHold,
  releaseHold,
  requireLiveHold,
  settleWeek,
  type HoldRow,
} from '../domain/holds.js';
import { isWeekStartInFuture, seasonOf, weekEndOf } from '../domain/weeks.js';
import { CURRENCIES, priceCharter, rateFor, type Currency } from '../domain/pricing.js';
import { formatDecimalString, majorUnits } from '../domain/money.js';
import {
  charterJson,
  insertCharter,
  type CharterLineRow,
  type CharterRow,
} from '../domain/charters.js';
import { BillingUnreachable, invoiceCharter, voidInvoice } from '../services/killbill.js';
import { MailUnreachable, sendMail } from '../services/mail.js';
import { isSaturday, toInstantString } from '../../shared/zone.js';
import { exchangeTableInForce, json, today } from './helpers.js';

async function yachtOfHold(hold: HoldRow): Promise<YachtRow> {
  return (await queryOne<YachtRow>('SELECT * FROM yachts WHERE id = $1', [
    hold.yacht_id,
  ])) as YachtRow;
}

export async function charterReply(
  status: number,
  charterId: string,
  yachtSlug: string,
): Promise<Reply> {
  const charter = (await queryOne<CharterRow>('SELECT * FROM charters WHERE id = $1', [
    charterId,
  ])) as CharterRow;
  const lines = await query<CharterLineRow>(
    'SELECT * FROM charter_lines WHERE charter_id = $1 ORDER BY line_index',
    [charterId],
  );
  return json(status, { charter: charterJson(charter, yachtSlug, lines) });
}

async function listHolds(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'holds_read');
  const found = await query<HoldRow & { yacht_slug: string }>(
    `SELECT h.*, y.slug AS yacht_slug FROM holds h JOIN yachts y ON y.id = h.yacht_id
      WHERE h.workspace_id = $1
        AND ($2::text IS NULL OR y.slug = $2)
        AND ($3::date IS NULL OR h.week_start = $3)
      ORDER BY h.placed_at DESC`,
    [actor.workspaceId, ctx.query.get('yachtSlug'), ctx.query.get('weekStart')],
  );
  return json(200, { holds: found.map((hold) => holdJson(hold, hold.yacht_slug, ctx.now)) });
}

async function requireHold(workspaceId: string, holdId: string): Promise<HoldRow> {
  const hold = await queryOne<HoldRow>('SELECT * FROM holds WHERE id = $1 AND workspace_id = $2', [
    holdId,
    workspaceId,
  ]);
  if (hold === null) throw notFound();
  return hold;
}

async function readHold(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const hold = await requireHold(actor.workspaceId, ctx.params.holdId);
  requireAction(actor, 'holds_read');
  const yacht = await yachtOfHold(hold);
  return json(200, { hold: holdJson(hold, yacht.slug, ctx.now) });
}

export async function resolveYachtFromBody(workspaceId: string, value: unknown): Promise<YachtRow> {
  if (typeof value !== 'string' || value.trim() === '') throw notFound();
  const yacht = await findYacht(workspaceId, value.trim());
  if (yacht === null) throw notFound();
  return yacht;
}

function readFutureWeekStart(value: unknown, splitToday: string): string {
  if (typeof value !== 'string' || !isWeekStartInFuture(value.trim(), splitToday)) {
    throw validation({ weekStart: FIELD_ERRORS.weekStart });
  }
  return value.trim();
}

export function readClientName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validation({ clientName: FIELD_ERRORS.required });
  }
  const trimmed = value.trim();
  if ([...trimmed].length > 80) throw validation({ clientName: FIELD_ERRORS.maxLength(80) });
  return trimmed;
}

export function readCurrency(value: unknown): Currency {
  if (value === undefined || value === null || value === '') return 'EUR';
  if (typeof value !== 'string' || !(CURRENCIES as readonly string[]).includes(value)) {
    throw validation({ currency: FIELD_ERRORS.options });
  }
  return value as Currency;
}

export function readClientEmail(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validation({ clientEmail: FIELD_ERRORS.required });
  }
  const trimmed = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw validation({ clientEmail: FIELD_ERRORS.email });
  }
  return trimmed;
}

async function createHold(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'holds_write');
  const body = readJsonBody(ctx);
  const yacht = await resolveYachtFromBody(actor.workspaceId, body.yachtSlug);
  if (yacht.status === 'withdrawn') throw yachtWithdrawn();
  const weekStart = readFutureWeekStart(body.weekStart, today(ctx.now));
  const clientName = readClientName(body.clientName);
  const hold = await transaction((client) =>
    placeHold(
      client,
      {
        workspaceId: actor.workspaceId,
        yachtId: yacht.id,
        weekStart,
        clientName,
        queue: body.queue === true,
        memberId: actor.id,
        memberName: actor.name,
        brokerId: null,
        brokerName: null,
      },
      ctx.now,
    ),
  );
  return json(201, { hold: holdJson(hold, yacht.slug, ctx.now) });
}

async function release(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const hold = await requireHold(actor.workspaceId, ctx.params.holdId);
  requireAction(actor, 'holds_write');
  const released = await transaction((client) => releaseHold(client, hold, ctx.now));
  const yacht = await yachtOfHold(hold);
  return json(200, { hold: holdJson(released, yacht.slug, ctx.now) });
}

async function quote(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const hold = await requireHold(actor.workspaceId, ctx.params.holdId);
  requireAction(actor, 'quotes_read');
  const currency = readCurrency(ctx.query.get('currency'));
  const yacht = await yachtOfHold(hold);
  const table = await exchangeTableInForce(actor.workspaceId, today(ctx.now));
  const rate = rateFor(table, currency);
  const priced = priceCharter({
    rates: yachtRates(yacht),
    season: seasonOf(hold.week_start),
    base: yacht.base,
    rate,
  });
  return json(200, {
    quote: {
      currency,
      exchangeTableId: currency === 'EUR' ? null : (table?.id ?? null),
      rate: formatDecimalString(rate),
      lines: priced.lines.map((line) => ({
        kind: line.kind,
        label: line.label,
        eurMinor: Number(line.eurMinor),
        amountMinor: Number(line.amountMinor),
      })),
      totalEurMinor: Number(priced.totalEurMinor),
      totalMinor: Number(priced.totalMinor),
    },
  });
}

function depositMailBody(options: {
  readonly clientName: string;
  readonly yachtName: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly currency: string;
  readonly lines: readonly { readonly label: string; readonly amountMinor: bigint }[];
  readonly totalMinor: bigint;
  readonly invoiceId: string;
}): string {
  return [
    `Dear ${options.clientName},`,
    '',
    `Your charter of ${options.yachtName} is confirmed.`,
    `Week: ${formatDate(options.weekStart)} to ${formatDate(options.weekEnd)}`,
    '',
    ...options.lines.map(
      (line) => `${line.label}: ${formatMoney(line.amountMinor.toString(), options.currency)}`,
    ),
    `Total: ${formatMoney(options.totalMinor.toString(), options.currency)}`,
    '',
    `Invoice: ${options.invoiceId}`,
    '',
    'Tidewright',
  ].join('\n');
}

async function deposit(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const hold = await requireHold(actor.workspaceId, ctx.params.holdId);
  requireAction(actor, 'deposits');
  const body = readJsonBody(ctx);
  const clientEmail = readClientEmail(body.clientEmail);
  const currency = readCurrency(body.currency);
  const yacht = await yachtOfHold(hold);
  const depositDate = today(ctx.now);
  const table = await exchangeTableInForce(actor.workspaceId, depositDate);
  const rate = rateFor(table, currency);
  const season = seasonOf(hold.week_start);
  const priced = priceCharter({ rates: yachtRates(yacht), season, base: yacht.base, rate });

  let invoiceId: string | null = null;
  try {
    const charterId = await transaction(async (client) => {
      await lockKey(client, 'week', hold.yacht_id, hold.week_start);
      await settleWeek(client, hold.yacht_id, hold.week_start, ctx.now);
      const locked = (await txRow<HoldRow>(client, 'SELECT * FROM holds WHERE id = $1 FOR UPDATE', [
        hold.id,
      ])) as HoldRow;
      requireLiveHold(locked, ctx.now);
      const id = await insertCharter(
        client,
        {
          workspaceId: actor.workspaceId,
          yachtId: yacht.id,
          holdId: hold.id,
          weekStart: hold.week_start,
          weekEnd: hold.week_end,
          clientName: hold.client_name,
          clientEmail,
          currency,
          season,
          depositDate,
          exchangeTableId: currency === 'EUR' ? null : (table?.id ?? null),
          rate: formatDecimalString(rate),
          quote: priced,
        },
        ctx.now,
      );
      invoiceId = await invoiceCharter({
        charterId: id,
        clientName: hold.client_name,
        clientEmail,
        currency,
        charges: priced.lines.map((line) => ({
          description:
            line.kind === 'charter_fee'
              ? `Charter fee — ${yacht.name}, week of ${hold.week_start}`
              : line.label,
          amount: majorUnits(line.amountMinor),
        })),
      });
      await client.query(
        `UPDATE charters SET invoice_status = 'invoiced', killbill_invoice_id = $2, invoiced_at = $3
          WHERE id = $1`,
        [id, invoiceId, ctx.now],
      );
      await sendMail({
        to: clientEmail,
        subject: `Charter confirmed: ${yacht.name}, week of ${formatDate(hold.week_start)}`,
        body: depositMailBody({
          clientName: hold.client_name,
          yachtName: yacht.name,
          weekStart: hold.week_start,
          weekEnd: hold.week_end,
          currency,
          lines: priced.lines,
          totalMinor: priced.totalMinor,
          invoiceId,
        }),
      });
      await client.query(`UPDATE holds SET status = 'charter', charter_id = $2 WHERE id = $1`, [
        hold.id,
        id,
      ]);
      return id;
    });
    return charterReply(201, charterId, yacht.slug);
  } catch (error) {
    if (error instanceof BillingUnreachable) {
      process.stderr.write(`${error.message}\n`);
      throw billingUnavailable();
    }
    if (error instanceof MailUnreachable) {
      if (invoiceId !== null) await voidInvoice(invoiceId);
      throw mailUnavailable();
    }
    throw error;
  }
}

async function listCharters(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'charters_read');
  const found = await query<CharterRow & { yacht_slug: string }>(
    `SELECT c.*, y.slug AS yacht_slug FROM charters c JOIN yachts y ON y.id = c.yacht_id
      WHERE c.workspace_id = $1 ORDER BY c.week_start, c.created_at`,
    [actor.workspaceId],
  );
  const lines = await query<CharterLineRow>(
    `SELECT l.* FROM charter_lines l JOIN charters c ON c.id = l.charter_id
      WHERE c.workspace_id = $1 ORDER BY l.line_index`,
    [actor.workspaceId],
  );
  return json(200, {
    charters: found.map((charter) =>
      charterJson(
        charter,
        charter.yacht_slug,
        lines.filter((line) => line.charter_id === charter.id),
      ),
    ),
  });
}

async function createDirectCharter(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'deposits');
  const body = readJsonBody(ctx);
  const yacht = await resolveYachtFromBody(actor.workspaceId, body.yachtSlug);
  if (yacht.status === 'withdrawn') throw yachtWithdrawn();
  if (typeof body.weekStart !== 'string' || !isSaturday(body.weekStart.trim())) {
    throw validation({ weekStart: FIELD_ERRORS.saturday });
  }
  const weekStart = body.weekStart.trim();
  const clientName = readClientName(body.clientName);
  const clientEmail = readClientEmail(body.clientEmail);
  const currency = readCurrency(body.currency);
  const depositDate = today(ctx.now);
  const table = await exchangeTableInForce(actor.workspaceId, depositDate);
  const rate = rateFor(table, currency);
  const season = seasonOf(weekStart);
  const priced = priceCharter({ rates: yachtRates(yacht), season, base: yacht.base, rate });
  const charterId = await transaction(async (client) => {
    await lockKey(client, 'week', yacht.id, weekStart);
    await settleWeek(client, yacht.id, weekStart, ctx.now);
    const booked = await txRows<{ id: string }>(
      client,
      'SELECT id FROM charters WHERE yacht_id = $1 AND week_start = $2',
      [yacht.id, weekStart],
    );
    if (booked.length > 0) throw conflict('week_booked');
    const held = await txRows<HoldRow>(
      client,
      `SELECT * FROM holds WHERE yacht_id = $1 AND week_start = $2 AND status IN ('live','waiting')`,
      [yacht.id, weekStart],
    );
    const live = held.find((hold) => effectiveStatus(hold, ctx.now) === 'live');
    if (live !== undefined) {
      throw conflict('week_taken', {
        takenBy: holdTaker(live),
        takenAt: toInstantString(live.live_since as Date),
      });
    }
    return insertCharter(
      client,
      {
        workspaceId: actor.workspaceId,
        yachtId: yacht.id,
        holdId: null,
        weekStart,
        weekEnd: weekEndOf(weekStart),
        clientName,
        clientEmail,
        currency,
        season,
        depositDate,
        exchangeTableId: currency === 'EUR' ? null : (table?.id ?? null),
        rate: formatDecimalString(rate),
        quote: priced,
      },
      ctx.now,
    );
  });
  return charterReply(201, charterId, yacht.slug);
}

export function registerHoldRoutes(router: Router): void {
  router.add('/api/w/:ws/holds', { GET: listHolds, POST: createHold });
  router.add('/api/w/:ws/holds/:holdId', { GET: readHold });
  router.add('/api/w/:ws/holds/:holdId/release', { POST: release });
  router.add('/api/w/:ws/holds/:holdId/quote', { GET: quote });
  router.add('/api/w/:ws/holds/:holdId/deposit', { POST: deposit });
  router.add('/api/w/:ws/charters', { GET: listCharters, POST: createDirectCharter });
}
