import { acknowledgeAlert } from '../alerts.js';
import { pool, withTransaction } from '../db.js';
import { notFound } from '../errors.js';
import { requireUser, sendJson, type Router } from '../http.js';
import { findAlert, listAlerts, listVessels, toAlert } from '../repo.js';
import { staffOnly } from './guards.js';

export function registerAlertRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/alerts',
    body: 'none',
    handler: async (ctx) => {
      staffOnly(requireUser(ctx));
      const onlyOpen = ctx.query.get('status') !== 'all';
      const names = new Map((await listVessels(pool)).map((vessel) => [vessel.id, vessel.name]));
      const rows = await listAlerts(pool, onlyOpen);
      sendJson(
        ctx.res,
        200,
        rows.map((row) => toAlert(row, names.get(row.vessel_id) ?? '')),
      );
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/alerts/:alertId/ack',
    body: 'json',
    handler: async (ctx) => {
      const alertId = ctx.params.alertId!;
      const existing = await findAlert(pool, alertId);
      if (!existing) throw notFound();
      const user = staffOnly(requireUser(ctx));
      const updated = await withTransaction(async (client) => {
        const fresh = await findAlert(client, alertId);
        if (!fresh) throw notFound();
        return acknowledgeAlert(client, fresh, user.name, ctx.now);
      });
      const names = new Map((await listVessels(pool)).map((vessel) => [vessel.id, vessel.name]));
      sendJson(ctx.res, 200, toAlert(updated, names.get(updated.vessel_id) ?? ''));
    },
  });
}
