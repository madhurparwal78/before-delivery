/**
 * Rider test-ride routes. A rider can open only their own rides.
 */

import type { Router } from 'express';

import { cancelRide, confirmRide, holdSlot, listRides, readRide } from '../../services/rides.js';
import { asyncRoute, requireUser } from '../context.js';

export function registerRideRoutes(api: Router): void {
  api.post(
    '/test-rides/holds',
    asyncRoute(async (req, res) => {
      const user = await requireUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.status(201).json(await holdSlot(user.id, body.slotId));
    }),
  );

  api.get(
    '/test-rides',
    asyncRoute(async (req, res) => {
      const user = await requireUser(req);
      res.status(200).json({ rides: await listRides(user.id) });
    }),
  );

  api.get(
    '/test-rides/:id',
    asyncRoute<{ id: string }>(async (req, res) => {
      const user = await requireUser(req);
      res.status(200).json(await readRide(user.id, req.params.id));
    }),
  );

  api.post(
    '/test-rides/:id/confirm',
    asyncRoute<{ id: string }>(async (req, res) => {
      const user = await requireUser(req);
      res.status(200).json(await confirmRide(user.id, req.params.id));
    }),
  );

  api.post(
    '/test-rides/:id/cancel',
    asyncRoute<{ id: string }>(async (req, res) => {
      const user = await requireUser(req);
      res.status(200).json(await cancelRide(user.id, req.params.id));
    }),
  );
}
