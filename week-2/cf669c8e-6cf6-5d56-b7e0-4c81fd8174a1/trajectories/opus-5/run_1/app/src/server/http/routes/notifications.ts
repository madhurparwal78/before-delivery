/**
 * The Kill Bill callback.
 *
 * A wrong secret answers like any unknown route. Every delivery handled or
 * ignored answers 200, so Kill Bill stops retrying; only a re-read that cannot
 * reach Kill Bill answers 503 so it tries again.
 */

import type { Router } from 'express';

import { ensureCallbackSecret } from '../../db/seed.js';
import { handleNotification } from '../../services/notifications.js';
import { asyncRoute } from '../context.js';

export function registerNotificationRoutes(api: Router): void {
  api.post(
    '/killbill/notifications/:secret',
    asyncRoute<{ secret: string }>(async (req, res) => {
      const secret = await ensureCallbackSecret();
      if (req.params.secret !== secret) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const outcome = await handleNotification(req.body);
      if (outcome === 'bad_body') {
        res.status(400).json({ error: 'bad_notification' });
        return;
      }
      if (outcome === 'unreachable') {
        res.status(503).json({ error: 'provider_unreachable' });
        return;
      }
      res.status(200).json({ status: 'ok' });
    }),
  );
}
