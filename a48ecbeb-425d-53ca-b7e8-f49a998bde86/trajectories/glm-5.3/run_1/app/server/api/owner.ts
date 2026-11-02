import { Router, type Response } from 'express';
import { withClient } from '../db.js';
import { databaseName } from '../env.js';
import { requireRole } from './session.js';
import { handleSession } from './accounts.js';
import { loadProvinces, pricingOf } from '../domain/quote.js';
import { FLAVOUR_ORDER } from '../domain/catalogue.js';
import { getObject, S3Unavailable } from '../services/s3.js';
import * as pb from '../services/pocketbase.js';
import * as emails from '../domain/emails.js';
import { serviceStatus } from './middleware.js';

const router = Router();
const OWNER = ['owner'];

function handleOwnerSession(e: unknown, res: Response): void {
  if ((e as { kind?: string }).kind === 'role') {
    res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
    return;
  }
  if ((e as { kind?: string }).kind === 'unauthenticated') {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
    return;
  }
  if ((e as { kind?: string }).kind === 'store') {
    res.status(503).json({ error: 'store_unavailable', message: "The shop can't update right now. Try again in a moment." });
    return;
  }
  handleSession(e, res);
}

router.get('/owner/settings', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const provinces = await loadProvinces();
    const drop = await withClient(async (client) => {
      const q = await client.query('select slug, can_price_cents, released from flavours where slug = $1', ['cacao-orange']);
      return q.rows[0] as { slug: string; can_price_cents: number; released: number | null };
    });
    res.json({
      provinces: provinces.map((p) => ({
        code: p.code,
        name: p.name,
        shipping_cents: p.shipping_cents,
        free_shipping_threshold_cents: p.free_shipping_threshold_cents,
        deposit_cents_per_can: p.deposit_cents_per_can,
        taxes: p.taxes.map((t) => ({ name: t.name, rate: (t.rate_milli / 1000).toFixed(3) })),
      })),
      drop: { flavour: 'cacao-orange', can_price_cents: drop.can_price_cents, released: drop.released },
    });
  } catch (e) {
    handleOwnerSession(e, res);
  }
});

router.put('/owner/provinces/:code', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const body = req.body as { shipping_cents?: unknown; free_shipping_threshold_cents?: unknown };
    if (
      typeof body.shipping_cents !== 'number' ||
      !Number.isInteger(body.shipping_cents) ||
      body.shipping_cents < 0 ||
      body.shipping_cents > 10000
    ) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { shipping_cents: 'Enter a shipping rate between 0 and 100 dollars.' } });
      return;
    }
    if (
      typeof body.free_shipping_threshold_cents !== 'number' ||
      !Number.isInteger(body.free_shipping_threshold_cents) ||
      body.free_shipping_threshold_cents < 0 ||
      body.free_shipping_threshold_cents > 100000
    ) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { free_shipping_threshold_cents: 'Enter a threshold between 0 and 1000 dollars.' } });
      return;
    }
    const provinces = await loadProvinces();
    const province = provinces.find((p) => p.code === req.params.code);
    if (!province) {
      res.status(404).json({ error: 'not_found', message: "We don't ship to that province yet." });
      return;
    }
    await withClient(async (client) => {
      await client.query(
        'update provinces set shipping_cents = $2, free_shipping_threshold_cents = $3 where code = $1',
        [province.code, body.shipping_cents as number, body.free_shipping_threshold_cents as number]
      );
    });
    const after = await loadProvinces();
    const updated = after.find((p) => p.code === province.code)!;
    res.json({
      province: {
        code: updated.code,
        name: updated.name,
        shipping_cents: updated.shipping_cents,
        free_shipping_threshold_cents: updated.free_shipping_threshold_cents,
        deposit_cents_per_can: updated.deposit_cents_per_can,
        taxes: updated.taxes.map((t) => ({ name: t.name, rate: (t.rate_milli / 1000).toFixed(3) })),
      },
    });
  } catch (e) {
    handleOwnerSession(e, res);
  }
});

router.put('/owner/drop', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const body = req.body as { can_price_cents?: unknown; released?: unknown };
    if (
      body.can_price_cents !== undefined &&
      (typeof body.can_price_cents !== 'number' || !Number.isInteger(body.can_price_cents) || body.can_price_cents < 1 || body.can_price_cents > 2000)
    ) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { can_price_cents: 'Enter a can price between 1 and 2000 cents.' } });
      return;
    }
    if (body.released !== undefined && (typeof body.released !== 'number' || !Number.isInteger(body.released) || body.released < 0)) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { released: 'Enter a released quantity of 0 or more.' } });
      return;
    }
    if (body.released !== undefined) {
      const ledger = (await withClient(async (client) => {
        const q = await client.query("select kind, qty from stock_ledger where flavour = 'cacao-orange'");
        return q.rows as { kind: string; qty: number }[];
      }));
      let committed = 0;
      for (const row of ledger) {
        if (row.kind === 'reserved') committed += row.qty;
        if (row.kind === 'released') committed -= row.qty;
        if (row.kind === 'sold') committed += row.qty;
      }
      if ((body.released as number) < committed) {
        res.status(409).json({
          error: 'below_committed',
          message: `${committed} cans are already held or sold, so the release can't go below that.`,
          committed,
        });
        return;
      }
      const received = await withClient(async (client) => {
        const q = await client.query('select received from flavours where slug = $1', ['cacao-orange']);
        return q.rows[0].received as number;
      });
      if ((body.released as number) > received) {
        res.status(422).json({
          error: 'validation',
          message: 'Check the highlighted fields.',
          fields: { released: 'The release can\u2019t go above the cans received.' },
        });
        return;
      }
    }
    await withClient(async (client) => {
      if (body.can_price_cents !== undefined) {
        await client.query("update flavours set can_price_cents = $1 where slug = 'cacao-orange'", [body.can_price_cents as number]);
      }
      if (body.released !== undefined) {
        await client.query("update flavours set released = $1 where slug = 'cacao-orange'", [body.released as number]);
      }
    });
    const after = await withClient(async (client) => {
      const q = await client.query('select can_price_cents, released from flavours where slug = $1', ['cacao-orange']);
      return q.rows[0] as { can_price_cents: number; released: number | null };
    });
    res.json({ drop: { flavour: 'cacao-orange', can_price_cents: after.can_price_cents, released: after.released } });
  } catch (e) {
    handleOwnerSession(e, res);
  }
});

router.get('/owner/dashboard', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const dunning = await withClient(async (client) => {
      const q = await client.query<{ step: string; status: string; subscription_id: string }>(
        `select step, status, subscription_id from dunning_steps
         where due_at > now() - interval '30 days'`
      );
      return q.rows;
    });
    const subsSeen = new Map<string, { recovered: boolean; cancelled: boolean }>();
    for (const row of dunning) {
      const entry = subsSeen.get(row.subscription_id) ?? { recovered: false, cancelled: false };
      if (row.step === 'cancel' && row.status === 'done') entry.cancelled = true;
      if (row.status === 'dropped') entry.recovered = true;
      subsSeen.set(row.subscription_id, entry);
    }
    let recovered = 0;
    let cancelled = 0;
    let inProgress = 0;
    const active = await withClient(async (client) => {
      const q = await client.query<{ subscription_id: string }>(
        "select distinct subscription_id from dunning_steps where status = 'pending'"
      );
      return q.rows.map((r) => r.subscription_id);
    });
    for (const [, entry] of subsSeen) {
      if (entry.recovered) recovered++;
      if (entry.cancelled) cancelled++;
    }
    inProgress = active.length;
    const refunds = await withClient(async (client) => {
      const q = await client.query<{ count: string; total: number }>(
        `select count(*)::text as count, coalesce(sum(amount_cents),0)::int as total
         from refunds where status = 'applied' and created_at > now() - interval '30 days'`
      );
      return { count: Number(q.rows[0].count), total_cents: q.rows[0].total };
    });
    res.json({
      dunning: { entered: subsSeen.size, recovered, cancelled, in_progress: inProgress },
      refunds,
      services: serviceStatus,
    });
  } catch (e) {
    handleOwnerSession(e, res);
  }
});

router.get('/owner/applications', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const status = req.query.status;
    const rows = await withClient(async (client) => {
      const q = status
        ? await client.query('select * from applications where status = $1 order by submitted_at', [String(status)])
        : await client.query('select * from applications order by submitted_at');
      return q.rows;
    });
    res.json({
      applications: rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        business_name: r.business_name,
        contact_name: r.contact_name,
        email: r.email,
        province: r.province,
        status: r.status,
        submitted_at: (r.submitted_at as Date).toISOString(),
      })),
    });
  } catch (e) {
    handleOwnerSession(e, res);
  }
});

router.get('/owner/applications/:id/licence', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const row = await withClient(async (client) => {
      const q = await client.query('select * from applications where id = $1', [req.params.id]);
      return q.rows[0];
    });
    if (!row) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that application." });
      return;
    }
    const obj = await getObject(row.licence_object as string);
    if (!obj) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that licence." });
      return;
    }
    res.setHeader('Content-Type', row.licence_type as string);
    res.send(obj.data);
  } catch (e) {
    if (e instanceof S3Unavailable) {
      res.status(503).json({ error: 'files_unavailable', message: 'File storage is unreachable right now.' });
      return;
    }
    handleOwnerSession(e, res);
  }
});

router.post('/owner/applications/:id/decision', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const decision = (req.body as { decision?: unknown }).decision;
    if (decision !== 'approved' && decision !== 'declined') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { decision: 'Pick approved or declined.' } });
      return;
    }
    const row = await withClient(async (client) => {
      await client.query('begin');
      const q = await client.query('select * from applications where id = $1 for update', [req.params.id]);
      const current = q.rows[0];
      if (!current) {
        await client.query('rollback');
        return { notFound: true as const };
      }
      if (current.status !== 'submitted') {
        await client.query('rollback');
        return { decided: true as const };
      }
      await client.query('update applications set status = $2 where id = $1', [req.params.id, decision]);
      await client.query('commit');
      return { ok: true as const, email: current.email as string, business_name: current.business_name as string };
    });
    if ('notFound' in row) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that application." });
      return;
    }
    if ('decided' in row) {
      res.status(409).json({ error: 'already_decided', message: 'This application was already decided.' });
      return;
    }
    await emails.queueApplicationDecision(row.email, decision === 'approved', row.business_name);
    const after = await withClient(async (client) => {
      const q = await client.query('select * from applications where id = $1', [req.params.id]);
      return q.rows[0];
    });
    res.json({
      application: {
        id: after.id,
        status: after.status,
        business_name: after.business_name,
        submitted_at: (after.submitted_at as Date).toISOString(),
      },
    });
  } catch (e) {
    handleOwnerSession(e, res);
  }
});

router.get('/owner/reviews', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const reviews = await pb.listPendingReviews(databaseName());
    const out = [];
    for (const review of reviews) {
      out.push({
        id: review.id,
        flavour: review.flavour,
        rating: review.rating,
        body: review.body,
        author_first_name: await pb.userFirstName(review.user),
        created_at: review.created,
      });
    }
    res.json({ reviews: out });
  } catch (e) {
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Accounts are unreachable right now.' });
      return;
    }
    handleOwnerSession(e, res);
  }
});

router.post('/owner/reviews/:id/decision', async (req, res) => {
  try {
    await requireRole(req, OWNER);
    const decision = (req.body as { decision?: unknown }).decision;
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { decision: 'Pick approved or rejected.' } });
      return;
    }
    const review = await pb.getReview(req.params.id);
    if (!review) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that review." });
      return;
    }
    if (review.status !== 'pending') {
      res.status(409).json({ error: 'already_decided', message: 'This review was already decided.' });
      return;
    }
    await pb.decideReview(req.params.id, decision);
    res.json({ review: { id: req.params.id, status: decision } });
  } catch (e) {
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Accounts are unreachable right now.' });
      return;
    }
    handleOwnerSession(e, res);
  }
});

export { router as ownerRouter, pricingOf, FLAVOUR_ORDER };
