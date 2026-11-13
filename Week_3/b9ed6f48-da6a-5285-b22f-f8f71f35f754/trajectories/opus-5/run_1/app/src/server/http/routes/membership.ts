import { Router } from 'express';
import { AppError } from '../../errors.js';
import { copy, type TierKey } from '../../../shared/copy.js';
import { isCurrency, type Currency } from '../../../shared/money.js';
import { body } from '../boundary.js';
import { requireUser } from '../auth.js';
import { withIdempotency } from '../idempotency.js';
import { FieldErrors, readText } from '../validate.js';
import { readCardNumber } from '../../domain/cards.js';
import * as membership from '../../domain/membership.js';

export const membershipRouter = Router();

const now = (): number => Date.now();

function readTier(value: unknown): TierKey | null {
  return value === 'reader' || value === 'fellow' || value === 'patron' ? value : null;
}

membershipRouter.get('/me/membership', async (request, response) => {
  const user = requireUser(request);
  response.json({ membership: await membership.readMembershipView(user.id, now()) });
});

membershipRouter.post('/me/membership', async (request, response) => {
  const user = requireUser(request);
  const outcome = await withIdempotency(request, response, async () => {
    const input = body(request);
    const errors = new FieldErrors();
    const tier = readTier(input.tier);
    if (!tier) errors.add('tier', 'Choose a supporter tier.');
    const currencyText = readText(input.currency);
    if (!isCurrency(currencyText)) errors.add('currency', 'Choose a currency.');
    const card = readCardNumber(input.card_number);
    if (!card) errors.add('card_number', copy.cardInvalid);
    errors.throwIfAny();
    const result = await membership.join(
      user,
      tier as TierKey,
      currencyText as Currency,
      card as NonNullable<typeof card>,
      now(),
    );
    return {
      status: 201,
      payload: {
        membership: result.membership,
        order: result.order,
        receipt_email: result.receiptEmail,
      },
    };
  });
  response.status(outcome.status).json(outcome.payload);
});

membershipRouter.post('/me/membership/change', async (request, response) => {
  const user = requireUser(request);
  const outcome = await withIdempotency(request, response, async () => {
    const tier = readTier(body(request).tier);
    if (!tier) {
      const errors = new FieldErrors();
      errors.add('tier', 'Choose a supporter tier.');
      errors.throwIfAny();
    }
    const result = await membership.change(user, tier as TierKey, now());
    return {
      status: 200,
      payload: {
        membership: result.membership,
        order: result.order,
        receipt_email: result.receiptEmail,
      },
    };
  });
  response.status(outcome.status).json(outcome.payload);
});

membershipRouter.post('/me/membership/cancel', async (request, response) => {
  const user = requireUser(request);
  const outcome = await withIdempotency(request, response, async () => ({
    status: 200,
    payload: { membership: await membership.cancel(user, now()) },
  }));
  response.status(outcome.status).json(outcome.payload);
});

membershipRouter.post('/me/membership/undo', async (request, response) => {
  const user = requireUser(request);
  const outcome = await withIdempotency(request, response, async () => ({
    status: 200,
    payload: { membership: await membership.undo(user, now()) },
  }));
  response.status(outcome.status).json(outcome.payload);
});

membershipRouter.put('/me/membership/card', async (request, response) => {
  const user = requireUser(request);
  const card = readCardNumber(body(request).card_number);
  const state = await membership.readMembershipState(user.id, now());
  if (!state || state.view.status === 'cancelled') throw new AppError('not_a_member');
  if (!card) {
    const errors = new FieldErrors();
    errors.add('card_number', copy.cardInvalid);
    errors.throwIfAny();
  }
  const updated = await membership.updateCard(user, card as NonNullable<typeof card>, now());
  response.json({ membership: updated });
});

membershipRouter.post('/me/membership/retry', async (request, response) => {
  const user = requireUser(request);
  const outcome = await withIdempotency(request, response, async () => {
    const result = await membership.retry(user, now());
    return {
      status: 200,
      payload: {
        membership: result.membership,
        order: result.order,
        receipt_email: result.receiptEmail,
      },
    };
  });
  response.status(outcome.status).json(outcome.payload);
});
