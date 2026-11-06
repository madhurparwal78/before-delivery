// The customer's account: only their own orders and subscriptions, everything else is not found.
import { money } from '../shared/money.js';
import { requireCustomer } from './auth.js';
import { email, object, oneOf, read, text } from './body.js';
import { nextNumber, pool, tx } from './db.js';
import { contactNotice } from './emails.js';
import { notFound } from './errors.js';
import { route } from './http.js';
import { loadOrder, orderJson } from './orders.js';
import { drain, enqueue } from './outbox.js';
import { TOPICS } from '../shared/catalog.js';

route('GET', '/api/account', async (ctx) => {
  const customer = await requireCustomer(ctx);
  const orders = (await pool.query<{ number: string; placed_at: Date; total_cents: number; status: string }>('SELECT number, placed_at, total_cents, status FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC',
    [customer.id],
  )).rows;
  const subscriptions = (await pool.query<{ number: string; state: string; scent: string; cadence: string; next_bill_date: string | null }>('SELECT number, state, scent, cadence, next_bill_date FROM subscriptions WHERE customer_id = $1 ORDER BY created_at DESC',
    [customer.id],
  )).rows;
  return {
    status: 200,
    body: {
      customer: { email: customer.email, locale: customer.locale },
      orders: orders.map((o) => ({ number: o.number, placed_at: o.placed_at.toISOString(), total: money(o.total_cents), status: o.status })),
      subscriptions,
    },
  };
});

route('GET', '/api/account/orders/{number}', async (ctx) => {
  const customer = await requireCustomer(ctx);
  const loaded = await loadOrder(pool, ctx.params.number ?? '');
  if (!loaded || loaded.order.customer_id !== customer.id) throw notFound(ctx.m);
  return { status: 200, body: orderJson(loaded) };
});

const contactBody = object({
  name: text((m) => m.fields.name, 1, 120),
  email: email(),
  topic: oneOf(
    TOPICS.map((t) => t.value),
    (m) => m.fields.topic,
  ),
  message: text((m) => m.fields.message, 10, 2000, true),
});

route('POST', '/api/contact', async (ctx) => {
  const body = read(contactBody, ctx.body, ctx.m);
  const reference = await tx(async (db) => {
    const number = await nextNumber(db, 'CT');
    await db.query('INSERT INTO contacts (number, name, email, topic, message, locale, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      number,
      body.name,
      body.email,
      body.topic,
      body.message,
      ctx.locale,
      ctx.now,
    ]);
    await enqueue(db, contactNotice(number, body.name, body.email, body.topic, ctx.locale), ctx.now);
    return number;
  });
  void drain();
  return { status: 201, body: { reference } };
});
