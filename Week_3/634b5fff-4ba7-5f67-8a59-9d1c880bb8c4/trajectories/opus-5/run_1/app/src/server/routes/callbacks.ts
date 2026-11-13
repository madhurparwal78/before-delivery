import { Router } from 'express';
import { applyCallback, signatureAccepted, type CallbackBody } from '../callbacks.js';
import { ApiError } from '../errors.js';
import { handler } from '../http.js';

export const callbacksRouter: Router = Router();

callbacksRouter.post(
  '/api/gateway/callbacks',
  handler(async (req, res) => {
    const signature = req.headers['x-gateway-signature'];
    const raw = req.rawBody ?? Buffer.alloc(0);
    if (!signatureAccepted(typeof signature === 'string' ? signature : undefined, raw)) {
      throw new ApiError(401, 'bad_signature', 'Signature refused.');
    }
    const body = (req.jsonBody ?? {}) as unknown as CallbackBody;
    res.json({ status: await applyCallback(body) });
  }),
);
