import { PoolClient } from 'pg';
import { DECLINED_CARD_DIGITS, DEPOSIT_CENTS, KERF_WHOLE_MM } from '../../shared/constants';
import { offcutDefects } from '../../shared/geometry';
import { invoiceLines, volumeMm3 } from '../../shared/money';
import { config } from '../config';
import { yardId } from '../db/meta';
import { pool, rows, transaction } from '../db/pool';
import { loadBoard, nextBoardTag } from '../domain/boards';
import { computeFit, requireHoldableFit } from '../domain/fit';
import {
  HoldRow,
  claimBoard,
  holdShape,
  isActive,
  loadAllHolds,
  loadHold,
  loadHoldsForMaker,
  lockHoldAndSettleExpiry,
  markHeld,
  markPaymentFailed,
  releaseExpiredHolds
} from '../domain/holds';
import { KERF_ACCOUNT, accountBalance, boardAccount, soldAccount, writeMovement } from '../domain/ledger';
import { ratesInForce } from '../domain/rates';
import { renderCutTicketPdf } from '../domain/ticketpdf';
import { readCardNumber, readIdempotencyKey, readPieces } from '../domain/validate';
import { ApiError } from '../errors';
import { Reply, RequestContext, headerOf, jsonReply, pathParam, requireUser } from '../http';
import { fingerprintOf, withIdempotency } from '../idempotency';
import { ensureBillingAccount, purchase, refund } from '../services/killbill';
import { deleteObject, putObject } from '../services/s3';
import { rateForBoard, requireVisibleBoard } from './boards';
import { Route, route } from './types';

const holdPaymentKey = (yard: string, holdId: string): string => `hold-${yard}-${holdId}`;
const salePaymentKey = (yard: string, ticketId: string): string => `sale-${yard}-${ticketId}`;

async function createHold(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  const rawKey = headerOf(context, 'idempotency-key');
  const wellFormed = rawKey !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(rawKey);
  const run = async (): Promise<Reply> => placeHold(context);
  if (!wellFormed) return run();
  return withIdempotency(user.id, rawKey, fingerprintOf(context.method, context.path, context.json), run);
}

async function placeHold(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  const boardTag = context.json.board;
  if (typeof boardTag !== 'string' || boardTag === '') throw new ApiError('not_found');
  await releaseExpiredHolds(pool, context.now);
  const board = await requireVisibleBoard(context, boardTag);
  if (user.role !== 'maker') throw new ApiError('forbidden');

  const live = await rows<{ status: string; expires_at: Date | null }>(
    pool,
    `SELECT status, expires_at FROM holds WHERE board_tag = $1 AND status IN ('pending-payment', 'held')`,
    [board.tag]
  );
  if (live.length > 0) throw new ApiError('already_held');
  if (board.status !== 'available') throw new ApiError('board_state');

  const pieces = readPieces(context.json.pieces);
  const rates = await ratesInForce(pool, context.now);
  const fit = computeFit(board, pieces, rateForBoard(board, rates));
  const holdable = requireHoldableFit(fit);
  const card = readCardNumber(context.json.card_number);
  readIdempotencyKey(headerOf(context, 'idempotency-key'));

  const claimed = await transaction((client) =>
    claimBoard(
      client,
      board,
      user.id,
      {
        pieces,
        cuts_mm: fit.cuts_mm,
        take_mm: holdable.take_mm,
        sale: holdable.sale,
        offcut_mm: fit.offcut_mm,
        price_cents: holdable.price_cents
      },
      context.now
    )
  );

  if (card === DECLINED_CARD_DIGITS) {
    await transaction((client) => markPaymentFailed(client, claimed.id, null));
    throw new ApiError('card_declined');
  }

  const yard = await yardId();
  let outcome: { paymentId: string; success: boolean };
  try {
    const accountId = await ensureBillingAccount(user);
    outcome = await purchase(accountId, DEPOSIT_CENTS, holdPaymentKey(yard, claimed.id));
  } catch (error) {
    await transaction((client) => markPaymentFailed(client, claimed.id, null));
    throw error;
  }
  if (!outcome.success) {
    await transaction((client) => markPaymentFailed(client, claimed.id, outcome.paymentId));
    throw new ApiError('payment_failed');
  }

  const held = await transaction(async (client) => {
    await markHeld(client, claimed.id, outcome.paymentId, context.now, config.holdSeconds);
    const after = await loadHold(client, claimed.id);
    if (after === null) throw new Error('hold vanished while being confirmed');
    return after;
  });
  return jsonReply(201, { hold: holdShape(held, false) });
}

async function listHolds(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  if (user.role === 'hand') throw new ApiError('forbidden');
  await releaseExpiredHolds(pool, context.now);
  const held = user.role === 'owner' ? await loadAllHolds(pool) : await loadHoldsForMaker(pool, user.id);
  return jsonReply(200, { holds: held.map((hold) => holdShape(hold, user.role === 'owner')) });
}

async function requireVisibleHold(context: RequestContext, id: string): Promise<HoldRow> {
  const user = requireUser(context);
  const hold = await loadHold(pool, id);
  if (hold === null) throw new ApiError('not_found');
  if (user.role === 'maker' && hold.maker_id !== user.id) throw new ApiError('not_found');
  return hold;
}

async function readHold(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  await releaseExpiredHolds(pool, context.now);
  const hold = await requireVisibleHold(context, pathParam(context, 'id'));
  if (user.role === 'hand') throw new ApiError('forbidden');
  return jsonReply(200, { hold: holdShape(hold, user.role === 'owner') });
}

async function cancelHold(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  const id = pathParam(context, 'id');
  const settled = await transaction((client) => lockHoldAndSettleExpiry(client, id, context.now));
  if (settled === null) throw new ApiError('not_found');
  if (user.role !== 'maker') throw new ApiError('forbidden');
  if (settled.maker_id !== user.id) throw new ApiError('not_found');
  if (!isActive(settled, context.now)) throw new ApiError('hold_not_active');

  const yard = await yardId();
  const released = await transaction(async (client) => {
    const hold = await lockHoldAndSettleExpiry(client, id, context.now);
    if (hold === null) throw new ApiError('not_found');
    if (!isActive(hold, context.now)) throw new ApiError('hold_not_active');
    if (hold.killbill_payment_id === null) throw new ApiError('payment_failed');
    const refunded = await refund(hold.killbill_payment_id, hold.deposit_cents, `${holdPaymentKey(yard, hold.id)}-refund`);
    if (!refunded) throw new ApiError('payment_failed');
    await client.query(`UPDATE holds SET status = 'released', release_reason = 'cancelled' WHERE id = $1`, [hold.id]);
    await client.query(`UPDATE boards SET status = 'available' WHERE tag = $1 AND status = 'held'`, [hold.board_tag]);
    const after = await loadHold(client, id);
    if (after === null) throw new Error('hold vanished while being cancelled');
    return after;
  });
  return jsonReply(200, { hold: holdShape(released, false) });
}

async function nextSequenceId(client: PoolClient, sequence: string, prefix: string): Promise<string> {
  const allocated = await rows<{ value: string }>(client, `SELECT nextval('${sequence}')::text AS value`);
  const value = allocated[0]?.value;
  if (value === undefined) throw new Error(`${sequence} did not allocate`);
  return `${prefix}-${value.padStart(4, '0')}`;
}

async function purchaseHold(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  const rawKey = headerOf(context, 'idempotency-key');
  const wellFormed = rawKey !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(rawKey);
  const run = async (): Promise<Reply> => payForCuts(context);
  if (!wellFormed) return run();
  return withIdempotency(user.id, rawKey, fingerprintOf(context.method, context.path, context.json), run);
}

async function payForCuts(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  const id = pathParam(context, 'id');
  const settled = await transaction((client) => lockHoldAndSettleExpiry(client, id, context.now));
  if (settled === null) throw new ApiError('not_found');
  if (user.role !== 'maker') throw new ApiError('forbidden');
  if (settled.maker_id !== user.id) throw new ApiError('not_found');
  if (!isActive(settled, context.now)) throw new ApiError('hold_not_active');
  readIdempotencyKey(headerOf(context, 'idempotency-key'));

  const yard = await yardId();
  const accountId = await ensureBillingAccount(user);
  let storedPdfKey: string | null = null;
  let paidPaymentId: string | null = null;
  let salePaymentExternalKey: string | null = null;
  let amountCents = 0;

  try {
    const sale = await transaction(async (client) => {
      const hold = await lockHoldAndSettleExpiry(client, id, context.now);
      if (hold === null) throw new ApiError('not_found');
      if (!isActive(hold, context.now)) throw new ApiError('hold_not_active');
      const board = await loadBoard(client, hold.board_tag);
      if (board === null) throw new Error('the held board is missing');

      const ticketId = await nextSequenceId(client, 'ticket_id_seq', 'CT');
      const invoiceId = await nextSequenceId(client, 'invoice_id_seq', 'INV');
      const lines = invoiceLines(hold.price_cents, hold.pieces.map((piece) => ({ label: piece.label, length_mm: piece.length_mm })));
      amountCents = hold.price_cents - hold.deposit_cents;
      const pdfKey = `tickets/${ticketId}.pdf`;
      const pdf = renderCutTicketPdf({
        ticketId,
        boardTag: board.tag,
        makerName: hold.maker_name,
        pieces: hold.pieces,
        cuts_mm: hold.cuts_mm,
        take_mm: hold.take_mm,
        offcut_mm: hold.offcut_mm,
        lines
      });

      await putObject(pdfKey, pdf, 'application/pdf');
      storedPdfKey = pdfKey;

      salePaymentExternalKey = salePaymentKey(yard, ticketId);
      const outcome = await purchase(accountId, amountCents, salePaymentExternalKey);
      if (!outcome.success) throw new ApiError('payment_failed');
      paidPaymentId = outcome.paymentId;

      let offcutTag: string | null = null;
      if (hold.sale === 'cut' && hold.offcut_mm !== null) {
        offcutTag = await nextBoardTag(client);
        const offcutStart = hold.take_mm + KERF_WHOLE_MM;
        await client.query(
          `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, defects,
                               parent_tag, from_cut, cut_ticket_id, created_at)
           VALUES ($1, $2, $3, 'graded', $4, $5, $6, $7, $8::jsonb, $9, true, $10, $11)`,
          [
            offcutTag,
            board.species,
            board.grade,
            board.lot_id,
            hold.offcut_mm,
            board.width_mm,
            board.thickness_mm,
            JSON.stringify(offcutDefects(board.defects, offcutStart, hold.offcut_mm)),
            board.tag,
            ticketId,
            context.now
          ]
        );
      }

      await client.query(
        `INSERT INTO tickets (id, status, board_tag, maker_id, pieces, cuts_mm, take_mm, sale, offcut_tag,
                              offcut_planned_mm, offcut_measured_mm, pdf_key, created_at)
         VALUES ($1, 'issued', $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, NULL, $10, $11)`,
        [
          ticketId,
          board.tag,
          hold.maker_id,
          JSON.stringify(hold.pieces),
          JSON.stringify(hold.cuts_mm),
          hold.take_mm,
          hold.sale,
          offcutTag,
          hold.offcut_mm,
          pdfKey,
          context.now
        ]
      );
      await client.query('INSERT INTO ticket_events (ticket_id, kind, by_user_id, at) VALUES ($1, $2, $3, $4)', [
        ticketId,
        'issued',
        hold.maker_id,
        context.now
      ]);
      await client.query(
        `INSERT INTO invoices (id, ticket_id, board_tag, maker_id, price_cents, deposit_cents, amount_cents, lines,
                               status, paid_at, killbill_payment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'paid', $9, $10)`,
        [
          invoiceId,
          ticketId,
          board.tag,
          hold.maker_id,
          hold.price_cents,
          hold.deposit_cents,
          amountCents,
          JSON.stringify(lines),
          context.now,
          outcome.paymentId
        ]
      );
      await client.query(`UPDATE holds SET status = 'converted-to-sale' WHERE id = $1`, [hold.id]);
      await client.query('UPDATE boards SET status = $2 WHERE tag = $1', [
        board.tag,
        hold.sale === 'cut' ? 'cut' : 'sold-whole'
      ]);

      const balance = await accountBalance(client, boardAccount(board.tag));
      if (hold.sale === 'cut' && offcutTag !== null && hold.offcut_mm !== null) {
        const soldVolume = volumeMm3(board.thickness_mm, board.width_mm, hold.take_mm);
        const offcutVolume = volumeMm3(board.thickness_mm, board.width_mm, hold.offcut_mm);
        const kerfVolume = volumeMm3(board.thickness_mm, board.width_mm, KERF_WHOLE_MM);
        await writeMovement(client, {
          kind: 'split',
          ticketId,
          byUserId: hold.maker_id,
          at: context.now,
          entries: [
            { account: boardAccount(board.tag), volume_mm3: -balance },
            { account: soldAccount(ticketId), volume_mm3: soldVolume },
            { account: boardAccount(offcutTag), volume_mm3: offcutVolume },
            { account: KERF_ACCOUNT, volume_mm3: kerfVolume }
          ]
        });
      } else {
        await writeMovement(client, {
          kind: 'whole-sale',
          ticketId,
          byUserId: hold.maker_id,
          at: context.now,
          entries: [
            { account: boardAccount(board.tag), volume_mm3: -balance },
            { account: soldAccount(ticketId), volume_mm3: balance }
          ]
        });
      }

      return {
        ticket: ticketId,
        invoice: invoiceId,
        board: board.tag,
        sale: hold.sale,
        sold_mm: hold.take_mm,
        offcut: offcutTag === null || hold.offcut_mm === null ? null : { tag: offcutTag, length_mm: hold.offcut_mm },
        price_cents: hold.price_cents,
        deposit_cents: hold.deposit_cents,
        amount_cents: amountCents,
        killbill_payment_id: outcome.paymentId,
        pdf_url: `/api/tickets/${ticketId}/pdf`
      };
    });
    return jsonReply(201, { sale });
  } catch (error) {
    if (paidPaymentId !== null && salePaymentExternalKey !== null) {
      await refund(paidPaymentId, amountCents, `${salePaymentExternalKey}-refund`).catch(() => undefined);
    }
    if (storedPdfKey !== null) await deleteObject(storedPdfKey).catch(() => undefined);
    throw error;
  }
}

export const holdRoutes: Route[] = [
  route('POST', '/api/holds', true, createHold),
  route('GET', '/api/holds', true, listHolds),
  route('GET', '/api/holds/:id', true, readHold),
  route('POST', '/api/holds/:id/cancel', true, cancelHold),
  route('POST', '/api/holds/:id/purchase', true, purchaseHold)
];
