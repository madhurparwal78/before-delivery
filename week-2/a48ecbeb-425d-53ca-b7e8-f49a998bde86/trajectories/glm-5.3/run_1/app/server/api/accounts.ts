import { Router, type Response } from 'express';
import { withClient } from '../db.js';
import { databaseName } from '../env.js';
import * as pb from '../services/pocketbase.js';
import { getObject, S3Unavailable } from '../services/s3.js';
import { RequireSessionError, requireUser, createSession, destroySession } from './session.js';
import { validationError, type ApiResult } from './respond.js';
import { loadProvinces } from '../domain/quote.js';
import { getFlavour } from '../domain/catalogue.js';
import { normalizePostalCode, postalCodeFieldMessage, postalCodeMatchesProvince } from '../domain/geo.js';
import { refundableCents, mergeRefundedSplits, type RefundSplit } from '../domain/refund.js';
import * as ordersDomain from '../domain/orders.js';
import type { OrderRow } from '../domain/orders.js';

const router = Router();

export function orderJson(order: OrderRow, publicUrl: string, refunds: unknown[] = []): Record<string, unknown> {
  const appliedPending = (refunds as { status?: string; split?: RefundSplit }[]).filter(
    (r) => r.status === 'pending_provider' || r.status === 'applied'
  );
  const merged = mergeRefundedSplits(appliedPending.map((r) => r.split as RefundSplit));
  return {
    number: order.number,
    status: order.status,
    refund_status: order.refund_status,
    placed_at: order.placed_at.toISOString(),
    province: order.province,
    subscription_id: order.subscription_id,
    lines: order.lines,
    goods_cents: order.goods_cents,
    discount_cents: order.discount_cents,
    discounted_goods_cents: order.discounted_goods_cents,
    shipping_cents: order.shipping_cents,
    deposit_cents: order.deposit_cents,
    taxes: order.taxes,
    total_cents: order.total_cents,
    refunded_cents: order.refunded_cents,
    refundable_cents: refundableCents(order, merged),
    ship_to: order.ship_to,
    refunds,
    thank_you_url: `/orders/${order.number}/thanks`,
    invoice_url: `${publicUrl}/api/orders/${order.number}/invoice.pdf`,
  };
}

export async function listRefunds(orderNumber: string): Promise<unknown[]> {
  return withClient(async (client) => {
    const q = await client.query('select * from refunds where order_number = $1 order by created_at', [orderNumber]);
    return q.rows.map((r) => ({
      id: (r as { id: string }).id,
      status: (r as { status: string }).status,
      amount_cents: (r as { amount_cents: number }).amount_cents,
      reason: (r as { reason: string }).reason,
      split: (r as { split: unknown }).split,
      created_at: ((r as { created_at: Date }).created_at as Date).toISOString(),
    }));
  });
}

router.post('/auth/sign-up', async (req, res) => {
  const body = req.body as { email?: unknown; password?: unknown; name?: unknown };
  const fields: Record<string, string> = {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter a valid email.';
  if (password.length < 10 || password.length > 128) fields.password = 'Enter a password of 10 to 128 characters.';
  if (name.length < 1 || name.length > 80) fields.name = 'Enter your name.';
  if (Object.keys(fields).length > 0) {
    res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields });
    return;
  }
  let user;
  try {
    user = await pb.createUser(email, password, name, 'customer');
  } catch (e) {
    if ((e as Error).message === 'email taken') {
      res.status(409).json({ error: 'email_taken', message: 'An account with that email already exists.' });
      return;
    }
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Sign-in is unavailable right now. Your crate is still held.' });
      return;
    }
    throw e;
  }
  const token = await createSession(user.id);
  res.cookie('ceibo_session', token, { httpOnly: true, sameSite: 'lax' });
  res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.post('/auth/sign-in', async (req, res) => {
  const body = req.body as { email?: unknown; password?: unknown };
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email === '' || password === '') {
    res.status(422).json({
      error: 'validation',
      message: 'Check the highlighted fields.',
      fields: { email: email === '' ? 'Enter your email.' : 'Enter a valid email.', password: 'Enter your password.' },
    });
    return;
  }
  let user;
  try {
    user = await pb.authUser(email, password);
  } catch (e) {
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Sign-in is unavailable right now. Your crate is still held.' });
      return;
    }
    if ((e as Error).message === 'invalid credentials') {
      res.status(401).json({ error: 'invalid_credentials', message: "That email and password don't match." });
      return;
    }
    throw e;
  }
  const token = await createSession(user.id);
  res.cookie('ceibo_session', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.post('/auth/sign-out', async (req, res) => {
  if (typeof req.cookies?.ceibo_session === 'string') {
    await destroySession(req.cookies.ceibo_session);
  }
  res.clearCookie('ceibo_session');
  res.status(204).end();
});

router.get('/me', async (req, res) => {
  try {
    const info = await requireUser(req);
    res.json({ user: { id: info.user.id, email: info.user.email, name: info.user.name, role: info.user.role } });
  } catch (e) {
    handleSession(e, res);
  }
});

export function handleSession(e: unknown, res: Response): void {
  if (e instanceof RequireSessionError) {
    if (e.kind === 'store') {
      res.status(503).json({ error: 'store_unavailable', message: "The shop can't update right now. Try again in a moment." });
    } else {
      res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
    }
    return;
  }
  throw e;
}

export function addressJson(a: pb.PbAddress): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    line1: a.line1,
    line2: a.line2 ?? '',
    city: a.city,
    province: a.province,
    postal_code: a.postal_code,
    is_default: a.is_default,
  };
}

export async function validateAddressBody(body: Record<string, unknown>): Promise<{
  name: string; line1: string; line2: string; city: string; province: string; postal_code: string; is_default: boolean;
}> {
  const provinces = await loadProvinces();
  const fields: Record<string, string> = {};
  const provinceName = (code: string) => provinces.find((p) => p.code === code)?.name ?? 'your province';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const line1 = typeof body.line1 === 'string' ? body.line1.trim() : '';
  const line2 = typeof body.line2 === 'string' ? body.line2.trim() : '';
  const city = typeof body.city === 'string' ? body.city.trim() : '';
  const province = typeof body.province === 'string' ? body.province : '';
  const postal = typeof body.postal_code === 'string' ? body.postal_code : '';
  if (name.length < 1) fields.name = 'Enter your full name.';
  if (line1.length < 1) fields.line1 = 'Enter your street address.';
  if (city.length < 1) fields.city = 'Enter your city.';
  if (!provinces.some((p) => p.code === province)) fields.province = "We don't ship to that province yet.";
  const normalized = normalizePostalCode(postal);
  if (!normalized) {
    fields.postal_code = postalCodeFieldMessage(provinceName(province));
  } else if (!postalCodeMatchesProvince(normalized, province)) {
    fields.postal_code = postalCodeFieldMessage(provinceName(province));
  }
  if (Object.keys(fields).length > 0) {
    throw Object.assign(new Error('validation'), { result: validationError(422, 'validation', 'Check the highlighted fields.', fields) });
  }
  return {
    name,
    line1,
    line2,
    city,
    province,
    postal_code: normalized as string,
    is_default: body.is_default === true,
  };
}

router.get('/addresses', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const addresses = await pb.listAddresses(info.user.id);
    res.json({ addresses: addresses.map(addressJson) });
  } catch (e) {
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Accounts are unreachable right now.' });
      return;
    }
    handleSession(e, res);
  }
});

router.post('/addresses', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const data = await validateAddressBody(req.body as Record<string, unknown>);
    const created = await pb.createAddress({
      user: info.user.id,
      name: data.name,
      line1: data.line1,
      line2: data.line2,
      city: data.city,
      province: data.province,
      postal_code: data.postal_code,
      is_default: data.is_default,
      id: '',
      created: '',
    } as unknown as pb.PbAddress);
    res.status(201).json({ address: addressJson(created) });
  } catch (e) {
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Accounts are unreachable right now.' });
      return;
    }
    if ((e as { result?: ApiResult }).result) {
      const result = (e as { result: ApiResult }).result;
      res.status(result.status).json(result.body);
      return;
    }
    handleSession(e, res);
  }
});

router.patch('/addresses/:id', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const existing = await pb.getAddress(req.params.id);
    if (!existing || existing.user !== info.user.id) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that address." });
      return;
    }
    const body = {
      name: existing.name,
      line1: existing.line1,
      line2: existing.line2 ?? '',
      city: existing.city,
      province: existing.province,
      postal_code: existing.postal_code,
      is_default: existing.is_default,
      ...(req.body as Record<string, unknown>),
    } as Record<string, unknown>;
    const data = await validateAddressBody(body);
    const updated = await pb.updateAddress(req.params.id, {
      name: data.name,
      line1: data.line1,
      line2: data.line2,
      city: data.city,
      province: data.province,
      postal_code: data.postal_code,
      is_default: data.is_default,
    });
    res.json({ address: addressJson(updated) });
  } catch (e) {
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Accounts are unreachable right now.' });
      return;
    }
    if ((e as { result?: ApiResult }).result) {
      const result = (e as { result: ApiResult }).result;
      res.status(result.status).json(result.body);
      return;
    }
    handleSession(e, res);
  }
});

router.get('/orders', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const orders = await ordersDomain.listOrdersForUser(info.user.id);
    const out = [];
    for (const order of orders) {
      out.push(orderJson(order, '', await listRefunds(order.number)));
    }
    res.json({ orders: out });
  } catch (e) {
    handleSession(e, res);
  }
});

router.get('/orders/:number', async (req, res) => {
  try {
    const info = await requireUser(req);
    const order = await ordersDomain.getOrder(req.params.number);
    if (!order || order.user_id !== info.user.id) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    res.json({ order: orderJson(order, '', await listRefunds(order.number)) });
  } catch (e) {
    handleSession(e, res);
  }
});

router.get('/orders/:number/invoice.pdf', async (req, res) => {
  try {
    const info = await requireUser(req);
    const order = await ordersDomain.getOrder(req.params.number);
    const isStaff = (info.user.role ?? 'customer') !== 'customer';
    if (!order || (order.user_id !== info.user.id && !isStaff)) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    if (order.status === 'pending_payment') {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    const obj = await getObject(`orders/${order.number}/invoice.pdf`);
    if (!obj) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that order." });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.send(obj.data);
  } catch (e) {
    if (e instanceof S3Unavailable) {
      res.status(503).json({ error: 'files_unavailable', message: "File storage is unreachable right now." });
      return;
    }
    handleSession(e, res);
  }
});

router.post('/flavours/:slug/reviews', async (req, res) => {
  try {
    const info = await requireUser(req);
    if (info.user.role !== 'customer') {
      res.status(403).json({ error: 'forbidden', message: "Your role can't do that." });
      return;
    }
    const flavour = await getFlavour(req.params.slug);
    if (!flavour) {
      res.status(404).json({ error: 'not_found', message: "We couldn't find that flavour." });
      return;
    }
    const body = req.body as { rating?: unknown; body?: unknown };
    if (typeof body.rating !== 'number' || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { rating: 'Pick a rating from 1 to 5.' } });
      return;
    }
    if (typeof body.body !== 'string' || body.body.trim().length < 10 || body.body.trim().length > 1000) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { body: 'Write a review of 10 to 1000 characters.' } });
      return;
    }
    const existingReviews = await pb.listReviews(databaseName(), flavour.slug);
    if (existingReviews.some((r) => r.user === info.user.id)) {
      res.status(409).json({ error: 'already_reviewed', message: "You've already reviewed this flavour." });
      return;
    }
    const bought = await withClient(async (client) => {
      const q = await client.query(
        `select count(*)::int as n from orders where user_id = $1 and status in ('paid','picking','packed','shipped')
         and lines::text like $2`,
        [info.user.id, `%"flavour":"${flavour.slug}"%`]
      );
      return (q.rows[0]?.n ?? 0) > 0;
    });
    if (!bought) {
      res.status(403).json({ error: 'not_a_buyer', message: 'Only customers who bought this flavour can review it.' });
      return;
    }
    const review = await pb.createReview({
      scope: databaseName(),
      flavour: flavour.slug,
      user: info.user.id,
      rating: body.rating,
      body: body.body.trim(),
      status: 'pending',
      id: '',
      created: '',
    } as unknown as pb.PbReview);
    res.status(201).json({ review: { id: review.id, status: 'pending' } });
  } catch (e) {
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Accounts are unreachable right now.' });
      return;
    }
    handleSession(e, res);
  }
});

export { router as accountsRouter };
