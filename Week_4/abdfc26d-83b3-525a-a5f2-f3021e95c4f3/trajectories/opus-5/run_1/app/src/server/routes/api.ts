import { Router } from 'express';
import { requirePrincipal, requireRole } from '../auth/guard.js';
import { hasRole } from '../auth/identity.js';
import { isValidCallbackToken } from '../domain/billingToken.js';
import { ApiError } from '../errors.js';
import { asyncRoute, sendJson, sendNoContent } from '../http/respond.js';
import { withIdempotency, type HandlerResult } from '../http/idempotency.js';
import { handleBillingEvent } from '../services/billing.js';
import { uploadAsset } from '../services/assets.js';
import { orderDownload } from '../services/downloads.js';
import { buildEditions, buildGallery } from '../services/gallery.js';
import {
  buyOrder,
  currentOrderForPiece,
  getOrderFor,
  holdEdition,
  listOwnOrders,
  releaseHold,
  toOrder,
  ORDER_SELECT,
  type OrderRow,
} from '../services/orders.js';
import {
  describePiece,
  listOwnPieces,
  publishPiece,
  remixPiece,
  savePiece,
  withdrawPiece,
} from '../services/pieces.js';
import { loadPieceBySlug, requireVisible, toPiece } from '../services/pieceRows.js';
import {
  buyCreditPack,
  cancelPlan,
  choosePlan,
  getCreditPack,
  getCredits,
  getPlan,
} from '../services/plans.js';
import {
  acceptRender,
  cancelRender,
  getRenderForOwner,
  listPieceRenders,
  toRender,
  type RenderRow,
} from '../services/renders.js';
import { getSplits, issueRefund } from '../services/refunds.js';
import { closeStatementPeriod, getStatement } from '../services/statements.js';
import { serviceStatuses } from '../services/probes.js';
import { PdfRenderingUnavailable } from '../providers/gotenberg.js';
import { StorageUnavailable } from '../providers/storage.js';
import { query } from '../db/pool.js';
import { pathParam } from '../http/params.js';

export const apiRouter = Router();

/** Health never depends on providers. */
apiRouter.get('/health', (_req, res) => {
  sendJson(res, 200, { status: 'ok' });
});

apiRouter.get(
  '/me',
  asyncRoute(async (req, res) => {
    const principal = requirePrincipal(req);
    sendJson(res, 200, {
      id: principal.id,
      username: principal.username,
      display_name: principal.displayName,
      email: principal.email,
      roles: principal.roles,
    });
  }),
);

apiRouter.get(
  '/gallery',
  asyncRoute(async (req, res) => {
    const creator = typeof req.query.creator === 'string' ? req.query.creator : null;
    sendJson(res, 200, await buildGallery(creator));
  }),
);

apiRouter.get(
  '/pieces/:slug',
  asyncRoute(async (req, res) => {
    const viewer = req.principal
      ? { id: req.principal.id, isFounder: hasRole(req.principal, 'founder-operator') }
      : null;
    const row = requireVisible(await loadPieceBySlug(pathParam(req, 'slug')), viewer);
    res.setHeader('ETag', `"${row.version}"`);
    sendJson(res, 200, await toPiece(row, viewer?.id ?? null));
  }),
);

apiRouter.get(
  '/pieces/:slug/editions',
  asyncRoute(async (req, res) => {
    const viewer = req.principal
      ? { id: req.principal.id, isFounder: hasRole(req.principal, 'founder-operator') }
      : null;
    const row = requireVisible(await loadPieceBySlug(pathParam(req, 'slug')), viewer);
    if (row.edition_count === null) throw ApiError.notFound();
    sendJson(
      res,
      200,
      await buildEditions(
        { id: row.id, slug: row.slug, editionCount: row.edition_count },
        viewer?.id ?? null,
      ),
    );
  }),
);

apiRouter.post(
  '/pieces/describe',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 201, { piece: await describePiece(creator, req.jsonBody) });
  }),
);

apiRouter.put(
  '/pieces/:slug',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    const piece = await savePiece(creator, pathParam(req, 'slug'), req.headers['if-match'], req.jsonBody);
    res.setHeader('ETag', `"${piece.version}"`);
    sendJson(res, 200, piece);
  }),
);

apiRouter.post(
  '/pieces/:slug/assets',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 201, { asset: await uploadAsset(creator, pathParam(req, 'slug'), req.uploadBody) });
  }),
);

apiRouter.post(
  '/pieces/:slug/renders',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    const slug = pathParam(req, 'slug');
    const outcome = await withIdempotency(req, creator, async (): Promise<HandlerResult> => {
      return { status: 202, body: { render: await acceptRender(creator, slug, req.jsonBody) } };
    });
    if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
    sendJson(res, outcome.status, outcome.body);
  }),
);

apiRouter.get(
  '/pieces/:slug/renders',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, { renders: await listPieceRenders(creator, pathParam(req, 'slug')) });
  }),
);

apiRouter.get(
  '/renders/:id',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await getRenderForOwner(creator, pathParam(req, 'id')));
  }),
);

apiRouter.post(
  '/renders/:id/cancel',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await cancelRender(creator, pathParam(req, 'id')));
  }),
);

apiRouter.post(
  '/pieces/:slug/publish',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await publishPiece(creator, pathParam(req, 'slug'), req.jsonBody));
  }),
);

apiRouter.post(
  '/pieces/:slug/withdraw',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await withdrawPiece(creator, pathParam(req, 'slug')));
  }),
);

apiRouter.post(
  '/pieces/:slug/remix',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 201, { piece: await remixPiece(creator, pathParam(req, 'slug')) });
  }),
);

apiRouter.get(
  '/me/pieces',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, { pieces: await listOwnPieces(creator) });
  }),
);

apiRouter.get(
  '/me/credits',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await getCredits(creator));
  }),
);

apiRouter.get(
  '/me/plan',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await getPlan(creator));
  }),
);

apiRouter.post(
  '/me/plan',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 202, await choosePlan(creator, req.jsonBody));
  }),
);

apiRouter.post(
  '/me/plan/cancel',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await cancelPlan(creator));
  }),
);

apiRouter.post(
  '/me/credit-packs',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    const outcome = await withIdempotency(req, creator, async (): Promise<HandlerResult> => {
      return { status: 202, body: { purchase: await buyCreditPack(creator, req.jsonBody) } };
    });
    if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
    sendJson(res, outcome.status, outcome.body);
  }),
);

apiRouter.get(
  '/me/credit-packs/:id',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await getCreditPack(creator, pathParam(req, 'id')));
  }),
);

apiRouter.get(
  '/me/statements/:period',
  asyncRoute(async (req, res) => {
    const creator = requireRole(req, 'creator');
    sendJson(res, 200, await getStatement(creator.id, pathParam(req, 'period')));
  }),
);

apiRouter.post(
  '/pieces/:slug/editions/:n/holds',
  asyncRoute(async (req, res) => {
    const collector = requireRole(req, 'collector');
    const slug = pathParam(req, 'slug');
    const editionNumber = Number.parseInt(pathParam(req, 'n') ?? '', 10);
    const outcome = await withIdempotency(req, collector, async (): Promise<HandlerResult> => {
      const held = await holdEdition(collector, slug, editionNumber);
      return { status: held.status, body: { order: held.order } };
    });
    if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
    sendJson(res, outcome.status, outcome.body);
  }),
);

apiRouter.get(
  '/orders/current',
  asyncRoute(async (req, res) => {
    const collector = requireRole(req, 'collector');
    const slug = typeof req.query.piece === 'string' ? req.query.piece : '';
    if (slug === '') throw ApiError.notFound();
    sendJson(res, 200, await currentOrderForPiece(collector, slug));
  }),
);

apiRouter.delete(
  '/orders/:id/hold',
  asyncRoute(async (req, res) => {
    const collector = requireRole(req, 'collector');
    sendJson(res, 200, await releaseHold(collector, pathParam(req, 'id')));
  }),
);

apiRouter.post(
  '/orders/:id/buy',
  asyncRoute(async (req, res) => {
    const collector = requireRole(req, 'collector');
    const orderId = pathParam(req, 'id');
    const outcome = await withIdempotency(req, collector, async (): Promise<HandlerResult> => {
      return { status: 202, body: await buyOrder(collector, orderId, req.jsonBody) };
    });
    if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
    sendJson(res, outcome.status, outcome.body);
  }),
);

apiRouter.get(
  '/orders/:id',
  asyncRoute(async (req, res) => {
    const principal = requirePrincipal(req);
    sendJson(res, 200, await getOrderFor(principal, pathParam(req, 'id')));
  }),
);

apiRouter.get(
  '/me/orders',
  asyncRoute(async (req, res) => {
    const collector = requireRole(req, 'collector');
    sendJson(res, 200, { orders: await listOwnOrders(collector) });
  }),
);

apiRouter.get(
  '/orders/:id/export',
  asyncRoute(async (req, res) => {
    const principal = requirePrincipal(req);
    sendJson(res, 200, await orderDownload(principal, pathParam(req, 'id'), 'export'));
  }),
);

apiRouter.get(
  '/orders/:id/invoice',
  asyncRoute(async (req, res) => {
    const principal = requirePrincipal(req);
    sendJson(res, 200, await orderDownload(principal, pathParam(req, 'id'), 'invoice'));
  }),
);

/** Any request carrying the right token answers 204, applied or not. */
apiRouter.post(
  '/billing/killbill-events',
  asyncRoute(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;
    if (!isValidCallbackToken(token)) throw ApiError.unauthenticated();

    const body = (req.jsonBody ?? {}) as Record<string, unknown>;
    const metaData = body.metaData;
    let paymentId = '';
    if (typeof metaData === 'string') {
      try {
        const parsed = JSON.parse(metaData) as { paymentId?: unknown };
        if (typeof parsed.paymentId === 'string') paymentId = parsed.paymentId;
      } catch {
        paymentId = '';
      }
    } else if (typeof metaData === 'object' && metaData !== null) {
      const parsed = metaData as { paymentId?: unknown };
      if (typeof parsed.paymentId === 'string') paymentId = parsed.paymentId;
    }

    await handleBillingEvent({
      eventType: typeof body.eventType === 'string' ? body.eventType : '',
      objectId: typeof body.objectId === 'string' ? body.objectId : '',
      accountId: typeof body.accountId === 'string' ? body.accountId : '',
      paymentId,
    }).catch((error: unknown) => {
      process.stderr.write(`billing event failed: ${String(error)}\n`);
    });

    sendNoContent(res, 204);
  }),
);

apiRouter.get(
  '/admin/orders',
  asyncRoute(async (req, res) => {
    requireRole(req, 'founder-operator');
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const result = await query<OrderRow>(
      `${ORDER_SELECT}
       WHERE ($1::text IS NULL OR o.state = $1)
       ORDER BY o.created_at DESC`,
      [state],
    );
    sendJson(res, 200, { orders: result.rows.map((row) => toOrder(row)) });
  }),
);

apiRouter.get(
  '/admin/orders/:id/splits',
  asyncRoute(async (req, res) => {
    requireRole(req, 'founder-operator');
    sendJson(res, 200, await getSplits(pathParam(req, 'id')));
  }),
);

apiRouter.post(
  '/admin/orders/:id/refunds',
  asyncRoute(async (req, res) => {
    const founder = requireRole(req, 'founder-operator');
    const orderId = pathParam(req, 'id');
    const outcome = await withIdempotency(req, founder, async (): Promise<HandlerResult> => {
      return { status: 201, body: await issueRefund(orderId, req.jsonBody) };
    });
    if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
    sendJson(res, outcome.status, outcome.body);
  }),
);

apiRouter.get(
  '/admin/credit-ledger',
  asyncRoute(async (req, res) => {
    requireRole(req, 'founder-operator');
    const accounts = await query<{ account: string; balance: number }>(
      `SELECT account, SUM(amount)::int AS balance FROM credit_rows
       GROUP BY account ORDER BY account`,
    );
    const entries = await query<{
      id: string;
      kind: string;
      render_id: string | null;
      created_at: Date;
      rows: { account: string; amount: number }[];
    }>(
      `SELECT e.id, e.kind, e.render_id, e.created_at,
              COALESCE(json_agg(json_build_object('account', r.account, 'amount', r.amount)
                                ORDER BY r.id), '[]'::json) AS rows
       FROM credit_entries e
       JOIN credit_rows r ON r.entry_id = e.id
       GROUP BY e.id, e.kind, e.render_id, e.created_at
       ORDER BY e.created_at DESC, e.id`,
    );
    sendJson(res, 200, {
      accounts: accounts.rows,
      entries: entries.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        render_id: row.render_id,
        created_at: row.created_at.toISOString(),
        rows: row.rows,
      })),
    });
  }),
);

apiRouter.get(
  '/admin/renders',
  asyncRoute(async (req, res) => {
    requireRole(req, 'founder-operator');
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const result = await query<RenderRow>(
      `SELECT r.id, r.piece_id, r.creator_id, r.state, r.failure_reason, r.cost_credits, r.attempts,
              r.format, r.resolution, r.duration_s, r.aspect, r.sha256, r.object_key, r.history,
              r.credits_settled, r.created_at,
              p.slug AS piece_slug, p.title AS piece_title, u.email AS creator_email
       FROM render_jobs r
       JOIN pieces p ON p.id = r.piece_id
       JOIN app_users u ON u.id = r.creator_id
       WHERE ($1::text IS NULL OR r.state = $1)
       ORDER BY r.created_at DESC`,
      [state],
    );
    sendJson(res, 200, { renders: result.rows.map(toRender) });
  }),
);

apiRouter.post(
  '/admin/statements',
  asyncRoute(async (req, res) => {
    requireRole(req, 'founder-operator');
    try {
      sendJson(res, 201, await closeStatementPeriod(req.jsonBody));
    } catch (error) {
      // Nothing is recorded when a statement PDF cannot be rendered or stored,
      // so the month stays closable once the service is back.
      if (error instanceof PdfRenderingUnavailable) throw ApiError.providerUnavailable();
      if (error instanceof StorageUnavailable) throw ApiError.storageUnavailable();
      throw error;
    }
  }),
);

apiRouter.get(
  '/admin/services',
  asyncRoute(async (req, res) => {
    requireRole(req, 'founder-operator');
    sendJson(res, 200, { services: serviceStatuses() });
  }),
);

apiRouter.use((_req, _res, next) => {
  next(ApiError.notFound());
});
