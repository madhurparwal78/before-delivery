import { Router } from 'express';
import { AppError } from '../../errors.js';
import { copy, donationAmountError } from '../../../shared/copy.js';
import { isCurrency, type Currency } from '../../../shared/money.js';
import { formatLisbonDateTime, toLisbonIso } from '../../../shared/lisbon.js';
import { body } from '../boundary.js';
import { requireUser } from '../auth.js';
import { withIdempotency } from '../idempotency.js';
import { FieldErrors, readInteger, readText } from '../validate.js';
import { readCardNumber } from '../../domain/cards.js';
import { DONATION_LIMITS, buildCatalog } from '../../domain/prices.js';
import {
  accountForPayment,
  listUserOrders,
  loadOrder,
  readAccount,
  requireProvidersReady,
  settlePayment,
} from '../../domain/orders.js';
import { receiptObjectKey } from '../../domain/receipts.js';
import {
  allocateSeats,
  confirmBooking,
  listSessions,
  loadSession,
  releaseSeats,
  sessionStatus,
  toSessionView,
} from '../../domain/sessions.js';
import * as killbill from '../../services/killbill.js';
import * as storage from '../../services/storage.js';
import * as mail from '../../services/mail.js';

export const commerceRouter = Router();

const now = (): number => Date.now();

/** Session cards and dialogs use the buyer's fixed account currency, otherwise EUR. */
async function cardCurrency(userId: string | undefined): Promise<Currency> {
  if (!userId) return 'EUR';
  const account = await readAccount(userId);
  return account?.currency ?? 'EUR';
}

commerceRouter.get('/catalog', async (_request, response) => {
  response.json(await buildCatalog(now()));
});

commerceRouter.get('/sessions', async (request, response) => {
  const nowMs = now();
  const rows = await listSessions();
  const currency = await cardCurrency(request.user?.id);
  let price: { amountMinor: number; currency: Currency } | null = null;
  try {
    const catalog = await buildCatalog(nowMs);
    price = { amountMinor: catalog.ticket.prices[currency], currency };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'billing_unavailable') throw error;
  }
  const sessions = [];
  for (const row of rows) sessions.push(await toSessionView(row, nowMs, price));
  response.json({ server_time: toLisbonIso(nowMs), sessions });
});

commerceRouter.post('/sessions/:id/bookings', async (request, response) => {
  const user = requireUser(request);
  const session = await loadSession(request.params.id as string);
  if (!session) throw new AppError('not_found');

  const outcome = await withIdempotency(request, response, async () => {
    const nowMs = now();
    const input = body(request);
    const errors = new FieldErrors();
    const seats = readInteger(input.seats);
    if (seats === null || seats < 1 || seats > 4) errors.add('seats', copy.seatsRange);
    const currencyText = readText(input.currency);
    if (!isCurrency(currencyText)) errors.add('currency', 'Choose a currency.');
    const card = readCardNumber(input.card_number);
    if (!card) errors.add('card_number', copy.cardInvalid);

    if (sessionStatus(session, nowMs) !== 'on_sale') throw new AppError('booking_closed');
    if (isCurrency(currencyText)) {
      const account = await readAccount(user.id);
      if (account && account.currency !== currencyText) {
        throw new AppError('currency_locked', { context: { accountCurrency: account.currency } });
      }
    }
    errors.throwIfAny();
    const currency = currencyText as Currency;
    const seatCount = seats as number;
    const details = card as NonNullable<typeof card>;

    const catalog = await buildCatalog(nowMs);
    const amountMinor = catalog.ticket.prices[currency] * seatCount;
    const account = await accountForPayment(user, currency);
    await requireProvidersReady();

    const allocation = await allocateSeats(session.id, user.id, seatCount, nowMs);
    if (allocation.kind === 'booking_closed') throw new AppError('booking_closed');
    if (allocation.kind === 'sold_out') throw new AppError('sold_out');

    try {
      const description = `Guided session: ${session.title} × ${seatCount}`;
      const invoiceId = await killbill.createExternalCharge(
        account.accountId,
        amountMinor,
        currency,
        description,
      );
      const startsAtDisplay = formatLisbonDateTime(session.starts_at.getTime());
      const settlement = await settlePayment({
        user,
        accountId: account.accountId,
        invoiceId,
        amountMinor,
        currency,
        kind: 'ticket',
        description,
        cardClass: details.class,
        cardLast4: details.last4,
        bookingId: allocation.bookingId,
        receiptExtraLines: [
          `Ticket ${allocation.ticketCode}`,
          `${seatCount} ${seatCount === 1 ? 'seat' : 'seats'}`,
          startsAtDisplay,
        ],
        message: (facts) =>
          mail.ticketMessage({
            ...facts,
            sessionTitle: session.title,
            startsAtDisplay,
            ticketCode: allocation.ticketCode,
            seats: seatCount,
          }),
      });
      if (settlement === 'declined') {
        await releaseSeats(allocation.bookingId);
        throw new AppError('card_declined');
      }
      await confirmBooking(allocation.bookingId);
      return {
        status: 201,
        payload: {
          booking: {
            id: allocation.bookingId,
            ticket_code: allocation.ticketCode,
            session_id: session.id,
            seats: seatCount,
          },
          order: settlement.order,
          receipt_email: settlement.receiptEmail,
        },
      };
    } catch (error) {
      await releaseSeats(allocation.bookingId);
      throw error;
    }
  });
  response.status(outcome.status).json(outcome.payload);
});

commerceRouter.post('/donations', async (request, response) => {
  const user = requireUser(request);
  const outcome = await withIdempotency(request, response, async () => {
    const input = body(request);
    const errors = new FieldErrors();
    const amountMinor = readInteger(input.amount_minor);
    const currencyText = readText(input.currency);
    if (!isCurrency(currencyText)) errors.add('currency', 'Choose a currency.');
    const card = readCardNumber(input.card_number);
    if (!card) errors.add('card_number', copy.cardInvalid);
    const note = input.note === undefined || input.note === null ? '' : readText(input.note);
    if (note === null || note.length > 500) errors.add('note', 'Use up to 500 characters.');
    if (isCurrency(currencyText)) {
      const limitCurrency = currencyText;
      const min = DONATION_LIMITS.min[limitCurrency];
      const max = DONATION_LIMITS.max[limitCurrency];
      if (amountMinor === null || amountMinor < min || amountMinor > max) {
        errors.add('amount_minor', donationAmountError(min, max, limitCurrency));
      }
      const account = await readAccount(user.id);
      if (account && account.currency !== limitCurrency) {
        throw new AppError('currency_locked', { context: { accountCurrency: account.currency } });
      }
    }
    errors.throwIfAny();
    const currency = currencyText as Currency;
    const amount = amountMinor as number;
    const details = card as NonNullable<typeof card>;

    const account = await accountForPayment(user, currency);
    await requireProvidersReady();
    const invoiceId = await killbill.createExternalCharge(account.accountId, amount, currency, 'Donation');
    const settlement = await settlePayment({
      user,
      accountId: account.accountId,
      invoiceId,
      amountMinor: amount,
      currency,
      kind: 'donation',
      description: 'Donation',
      cardClass: details.class,
      cardLast4: details.last4,
      message: mail.donationMessage,
    });
    if (settlement === 'declined') throw new AppError('card_declined');
    return {
      status: 201,
      payload: { order: settlement.order, receipt_email: settlement.receiptEmail },
    };
  });
  response.status(outcome.status).json(outcome.payload);
});

commerceRouter.get('/me/orders', async (request, response) => {
  const user = requireUser(request);
  response.json({ orders: await listUserOrders(user.id) });
});

commerceRouter.get('/orders/:id/receipt', async (request, response) => {
  const user = requireUser(request);
  const row = await loadOrder(request.params.id as string);
  if (!row) throw new AppError('not_found');
  if (row.user_id !== user.id && user.role !== 'manager') throw new AppError('not_found');
  const key = receiptObjectKey(row.receipt_number);
  if (!(await storage.objectExists(key))) throw new AppError('not_found');
  response.redirect(302, storage.presignGet(key));
});
