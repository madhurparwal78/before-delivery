import express from 'express';
import { isDatabaseReady } from '../db.js';
import { publicMember, signIn, signOut } from '../domain/auth.js';
import { notFound } from '../domain/errors.js';
import {
  assignTruck,
  decideRequest,
  dispatchBoard,
  listTrucks,
  releaseTruck,
  setTruckStatus
} from '../domain/fleet.js';
import { listMembers, setMemberRole } from '../domain/members.js';
import { createRequest, listRequests, loadActivity, loadRequest } from '../domain/requests.js';
import { canDispatch, isAdmin, requireRole } from '../domain/roles.js';
import { parseRequestListQuery, parseTruckStatusQuery } from '../domain/validation.js';
import {
  apiErrors,
  apiSession,
  asyncRoute,
  bearerToken,
  bodyErrors,
  jsonBody,
  requireJsonBody
} from './middleware.js';

const memberIdFromPath = (raw) => {
  if (!/^\d+$/.test(raw)) throw notFound();
  return Number.parseInt(raw, 10);
};

export function createApiRouter() {
  const api = express.Router();

  api.use(requireJsonBody, jsonBody, bodyErrors);

  api.get(
    '/health',
    asyncRoute(async (req, res) => {
      try {
        if (await isDatabaseReady()) return res.json({ status: 'ok' });
      } catch {
        // fall through to the unavailable answer below
      }
      return res.status(503).json({ status: 'unavailable' });
    })
  );

  api.post(
    '/auth/login',
    asyncRoute(async (req, res) => {
      const { token, user } = await signIn({ email: req.body?.email, password: req.body?.password });
      res.json({ token, user });
    })
  );

  api.use(apiSession);

  api.post(
    '/auth/logout',
    asyncRoute(async (req, res) => {
      await signOut(bearerToken(req));
      res.status(204).end();
    })
  );

  api.get('/auth/me', (req, res) => {
    res.json({ user: publicMember(req.member) });
  });

  api.get(
    '/requests',
    asyncRoute(async (req, res) => {
      const { status, q, limit, cursor } = parseRequestListQuery(req.query);
      const { items, nextCursor } = await listRequests({ member: req.member, status, q, limit, cursor });
      if (nextCursor) res.set('X-Next-Cursor', nextCursor);
      res.json(items);
    })
  );

  api.post(
    '/requests',
    asyncRoute(async (req, res) => {
      const { request, replayed } = await createRequest({ member: req.member, body: req.body });
      res.status(replayed ? 200 : 201).json(request);
    })
  );

  api.get(
    '/requests/:id',
    asyncRoute(async (req, res) => {
      res.json(await loadRequest({ member: req.member, id: req.params.id }));
    })
  );

  api.get(
    '/requests/:id/activity',
    asyncRoute(async (req, res) => {
      res.json(await loadActivity({ member: req.member, id: req.params.id }));
    })
  );

  api.post(
    '/requests/:id/assignments',
    asyncRoute(async (req, res) => {
      requireRole(req.member, canDispatch);
      const request = await assignTruck({ member: req.member, requestId: req.params.id, body: req.body });
      res.status(201).json(request);
    })
  );

  api.delete(
    '/requests/:id/assignments/:truckId',
    asyncRoute(async (req, res) => {
      requireRole(req.member, canDispatch);
      await releaseTruck({ member: req.member, requestId: req.params.id, truckId: req.params.truckId });
      res.status(204).end();
    })
  );

  api.post(
    '/requests/:id/decision',
    asyncRoute(async (req, res) => {
      requireRole(req.member, canDispatch);
      const request = await decideRequest({ member: req.member, requestId: req.params.id, body: req.body });
      res.json(request);
    })
  );

  api.get(
    '/dispatch',
    asyncRoute(async (req, res) => {
      requireRole(req.member, canDispatch);
      res.json(await dispatchBoard());
    })
  );

  api.get(
    '/trucks',
    asyncRoute(async (req, res) => {
      requireRole(req.member, canDispatch);
      res.json(await listTrucks({ status: parseTruckStatusQuery(req.query) }));
    })
  );

  api.patch(
    '/trucks/:id',
    asyncRoute(async (req, res) => {
      requireRole(req.member, isAdmin);
      res.json(await setTruckStatus({ truckId: req.params.id, body: req.body }));
    })
  );

  api.get(
    '/users',
    asyncRoute(async (req, res) => {
      requireRole(req.member, isAdmin);
      res.json(await listMembers());
    })
  );

  api.patch(
    '/users/:id',
    asyncRoute(async (req, res) => {
      requireRole(req.member, isAdmin);
      res.json(await setMemberRole({ memberId: memberIdFromPath(req.params.id), body: req.body }));
    })
  );

  api.use((req, res, next) => next(notFound()));
  api.use(apiErrors);

  return api;
}
