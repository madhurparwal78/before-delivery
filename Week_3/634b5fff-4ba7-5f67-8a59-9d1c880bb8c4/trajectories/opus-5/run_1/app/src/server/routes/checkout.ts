import { Router } from 'express';
import { runChallenge, runCheckout, validateCheckout } from '../checkout.js';
import { ApiError, fail, failOutage } from '../errors.js';
import { handler, requireHeader } from '../http.js';
import { claimKey, hashRequest, releaseKey, storeResult } from '../idempotency.js';
import { loadOrder } from '../orders.js';
import { GatewayUnreachable } from '../services/gateway.js';
import { LedgerUnreachable } from '../services/killbill.js';

export const checkoutRouter: Router = Router();

function asFailure(error: unknown): ApiError {
  if (error instanceof GatewayUnreachable) return failOutage('gateway_unreachable', 'checkout');
  if (error instanceof LedgerUnreachable) return failOutage('ledger_unreachable', 'checkout');
  return error as ApiError;
}

function bodyOf(failure: ApiError): Record<string, unknown> {
  return {
    error: { code: failure.code, message: failure.message, ...(failure.fields ? { fields: failure.fields } : {}) },
    ...(failure.extra ?? {}),
  };
}

checkoutRouter.post(
  '/api/checkout',
  handler(async (req, res) => {
    const attemptKey = requireHeader(req, 'Idempotency-Key');
    if (attemptKey === '') throw fail(422, 'validation_failed');
    const raw = req.jsonBody ?? {};
    const claim = await claimKey('checkout', attemptKey, hashRequest(raw));
    if (claim.kind === 'replay') {
      res.status(claim.status).json(claim.body);
      return;
    }
    try {
      const body = validateCheckout(raw);
      const outcome = await runCheckout(body, requireHeader(req, 'X-Hold-Token'), attemptKey);
      await storeResult('checkout', attemptKey, outcome.status, outcome.body);
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      const failure = asFailure(error);
      if (failure.status === 402) {
        const stored = bodyOf(failure);
        await storeResult('checkout', attemptKey, 402, stored);
        res.status(402).json(stored);
        return;
      }
      await releaseKey('checkout', attemptKey);
      throw failure;
    }
  }),
);

checkoutRouter.post(
  '/api/checkout/:reference/challenge',
  handler(async (req, res) => {
    const order = await loadOrder(String(req.params.reference));
    if (order === null) throw fail(404, 'not_found');
    if (order.hold_token !== requireHeader(req, 'X-Hold-Token')) throw fail(403, 'hold_not_yours');
    const payload = req.jsonBody ?? {};
    try {
      const outcome = await runChallenge(order, {
        code: typeof payload.code === 'string' ? payload.code : undefined,
        cancel: payload.cancel === true,
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      throw asFailure(error);
    }
  }),
);
