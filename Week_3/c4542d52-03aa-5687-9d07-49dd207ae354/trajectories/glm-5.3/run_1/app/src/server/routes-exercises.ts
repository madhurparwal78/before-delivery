import type { PoolClient } from 'pg';
import { route, withClient, type Ctx } from './api.js';
import { HttpError, notFound } from './errors.js';
import { emitFor } from './events.js';
import { writeLedgerEntry } from './ledger.js';
import { grantById, visibleGrant } from './routes-grants.js';
import { personById, grantFigures } from './register.js';
import { costCents, centsString } from './vesting.js';
import { VaultError, sealDocument } from './vault.js';
import { ProviderError, createPayment, fetchPayment, cancelPayment, type PaymentRecord } from './provider.js';
import { parseStrike } from './grantJson.js';

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

interface OrderRow {
  id: string;
  grant_id: string;
  holder_id: string;
  options: string;
  strike: string;
  cost_cents: string;
  idempotency_key: string;
  state: 'pending' | 'held' | 'issued' | 'cancelled';
  placed_at: Date;
  issued_at: Date | null;
  payment_id: string | null;
  payment_confirmed_at: Date | null;
}

async function orderById(client: PoolClient, id: string): Promise<OrderRow | null> {
  const r = await client.query('SELECT * FROM exercise_orders WHERE id = $1', [id]);
  const row = r.rows[0] as OrderRow | undefined;
  return row ?? null;
}

async function nextOrderId(client: PoolClient): Promise<string> {
  const r = await client.query<{ max: string | null }>(
    "SELECT max(substring(id from 5)::bigint)::text AS max FROM exercise_orders WHERE id LIKE 'EXO-%'",
  );
  return `EXO-${String(Number(r.rows[0]?.max ?? 0) + 1).padStart(6, '0')}`;
}

async function nextDocumentId(client: PoolClient): Promise<string> {
  const r = await client.query<{ max: string | null }>(
    "SELECT max(substring(id from 5)::bigint)::text AS max FROM documents WHERE id LIKE 'DOC-%'",
  );
  return `DOC-${String(Number(r.rows[0]?.max ?? 0) + 1).padStart(6, '0')}`;
}

function orderJson(order: OrderRow, notice: { document_id: string; status: string } | null, payment: {
  id: string; status: string; amount_cents: number; currency: string; reference: string; confirmed_at: string | null;
} | null): Record<string, unknown> {
  return {
    id: order.id,
    grant_id: order.grant_id,
    holder_id: order.holder_id,
    options: Number(order.options),
    strike: order.strike,
    cost: centsString(BigInt(order.cost_cents)),
    idempotency_key: order.idempotency_key,
    state: order.state,
    placed_at: order.placed_at.toISOString(),
    issued_at: order.issued_at ? order.issued_at.toISOString() : null,
    payment,
    notice,
  };
}

async function orderFullJson(client: PoolClient, order: OrderRow): Promise<Record<string, unknown>> {
  const notice = await client.query<{ document_id: string; status: string }>(
    'SELECT id AS document_id, status FROM documents WHERE order_id = $1 ORDER BY version DESC LIMIT 1',
    [order.id],
  );
  const payment = order.payment_id
    ? {
        id: order.payment_id,
        status: order.state === 'issued' ? 'confirmed' : order.state === 'cancelled' ? 'cancelled' : 'pending',
        amount_cents: Number(order.cost_cents),
        currency: 'USD',
        reference: order.id,
        confirmed_at: order.payment_confirmed_at ? order.payment_confirmed_at.toISOString() : null,
      }
    : null;
  return orderJson(order, notice.rows[0] ?? null, payment);
}

route('POST', '/api/grants/:id/exercise-quote', ['option_holder', 'leaver'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const g = await visibleGrant(client, ctx.person, ctx.params.id!);
    const b = body(ctx);
    const options = b.options;
    if (typeof options !== 'number' || !Number.isInteger(options) || options < 1) {
      throw new HttpError(422, 'validation', 'Some fields need attention.', { options: 'Enter a whole number of options.' });
    }
    if (g.state !== 'accepted') {
      throw new HttpError(409, 'grant_not_exercisable', 'This grant is not accepted.');
    }
    const figures = await grantFigures(client, g, new Date());
    if (options > figures.exercisable) {
      throw new HttpError(422, 'validation', 'Some fields need attention.', {
        options: `Only ${figures.exercisable} vested options are available to exercise.`,
      });
    }
    const strike = parseStrike(g.strike);
    return { options, strike: g.strike, cost: centsString(costCents(options, strike)) };
  });
});

interface StoredResponse {
  status: number;
  body: unknown;
}

async function storedResponse(client: PoolClient, key: string): Promise<StoredResponse | null> {
  const r = await client.query<{ response_status: number; response_body: unknown }>(
    'SELECT response_status, response_body FROM idempotent_responses WHERE key = $1',
    [key],
  );
  const row = r.rows[0];
  return row ? { status: row.response_status, body: row.response_body } : null;
}

async function storeResponse(client: PoolClient, key: string, status: number, body: unknown): Promise<void> {
  await client.query(
    'INSERT INTO idempotent_responses (key, response_status, response_body) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING',
    [key, status, JSON.stringify(body)],
  );
}

/** Waits (bounded) for the stored response of an in-flight request with this key. */
async function waitForStoredResponse(key: string, timeoutMs = 12_000): Promise<StoredResponse | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stored = await withClient((c) => storedResponse(c, key));
    if (stored) return stored;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

route('POST', '/api/grants/:id/exercises', ['option_holder', 'leaver'], async (ctx: Ctx) => {
  const key = ctx.req.header('Idempotency-Key') ?? '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
    throw new HttpError(422, 'validation', 'Some fields need attention.', {
      idempotency_key: 'Send an Idempotency-Key of 8 to 64 letters, digits, hyphens or underscores.',
    });
  }
  const b = body(ctx);
  const options = b.options;
  if (typeof options !== 'number' || !Number.isInteger(options) || options < 1) {
    throw new HttpError(422, 'validation', 'Some fields need attention.', { options: 'Enter a whole number of options.' });
  }
  const requestHash = JSON.stringify({ grant: ctx.params.id, options });

  // Replay before any other check except authentication.
  const stored = await withClient((c) => storedResponse(c, key));
  if (stored) {
    const priorGrant = typeof (stored.body as { grant_id?: string })?.grant_id === 'string'
      ? (stored.body as { grant_id: string }).grant_id
      : null;
    if (priorGrant !== ctx.params.id || !sameBody(stored.body, options)) {
      throw new HttpError(409, 'idempotency_key_reused', 'That idempotency key was used for a different order.');
    }
    ctx.res.status(stored.status);
    return stored.body;
  }

  return withClient(async (client) => {
    await client.query('BEGIN');
    let created: OrderRow | null = null;
    try {
      // Serialize orders for one grant.
      const g = await visibleGrant(client, ctx.person, ctx.params.id!);
      const lock = await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`exercise:${g.id}`]);
      void lock;

      // Re-check replay under the lock. When the key is already used by a
      // request still in flight, wait for its stored response and return it.
      const existing = await client.query('SELECT id FROM exercise_orders WHERE idempotency_key = $1', [key]);
      const prior = existing.rows[0] as { id: string } | undefined;
      if (prior) {
        const priorOrder = await orderById(client, prior.id);
        if (!priorOrder || priorOrder.grant_id !== g.id || Number(priorOrder.options) !== options) {
          throw new HttpError(409, 'idempotency_key_reused', 'That idempotency key was used for a different order.');
        }
        await client.query('COMMIT');
        const storedNow = await waitForStoredResponse(key);
        if (storedNow) {
          ctx.res.status(storedNow.status);
          return storedNow.body;
        }
        return orderFullJson(client, priorOrder);
      }

      if (g.state !== 'accepted') {
        throw new HttpError(409, 'grant_not_exercisable', 'This grant is not accepted.');
      }
      const holder = await personById(client, ctx.person.id);
      if (holder?.window_ends_at && new Date() >= holder.window_ends_at) {
        throw new HttpError(409, 'exercise_window_closed', 'Your exercise window closed before this order arrived.');
      }
      const at = new Date();
      const figures = await grantFigures(client, g, at);
      if (options > figures.exercisable) {
        throw new HttpError(422, 'validation', 'Some fields need attention.', {
          options: `Only ${figures.exercisable} vested options are available to exercise.`,
        });
      }
      const strike = parseStrike(g.strike);
      const cost = costCents(options, strike);
      const id = await nextOrderId(client);
      await client.query(
        `INSERT INTO exercise_orders (id, grant_id, holder_id, options, strike, cost_cents, idempotency_key, state, idempotent_request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
        [id, g.id, ctx.person.id, options, g.strike, cost, key, requestHash],
      );
      created = await orderById(client, id);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    // Outside the transaction: talk to the provider.
    const order = created!;
    let payment: PaymentRecord | null = null;
    let providerFailed = false;
    try {
      payment = await createPayment({
        idempotencyKey: key,
        amountCents: Number(cost_cents(order)),
        reference: order.id,
        description: `Exercise of ${order.options} options under ${order.grant_id}`,
      });
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      providerFailed = true;
    }

    return withClient(async (client) => {
      await client.query('BEGIN');
      try {
        if (providerFailed) {
          const cur = await orderById(client, order.id);
          if (cur && cur.state === 'pending') {
            await client.query("UPDATE exercise_orders SET state = 'held' WHERE id = $1", [order.id]);
          }
        } else if (payment) {
          await client.query('UPDATE exercise_orders SET payment_id = $1 WHERE id = $2', [payment.id, order.id]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }

      const finalOrder = await orderById(client, order.id);
      if (!finalOrder) throw notFound();

      if (providerFailed) {
        const bodyOut = await orderFullJson(client, finalOrder);
        await withClient((c) => storeResponse(c, key, 503, bodyOut));
        const err = new HttpError(
          503, 'provider_unavailable',
          `The payment provider can't be reached. Order ${finalOrder.id} is held under key ${key}. Nothing has been issued.`,
          undefined, { order: bodyOut },
        );
        // store the 503 for replay
        await withClient((c) => storeResponse(c, key, 503, { error: { code: 'provider_unavailable', message: err.message }, order: bodyOut }));
        throw err;
      }

      // The payment request answered 201; wait at most 5 more seconds for a confirmed record.
      let confirmed: PaymentRecord | null = null;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          const record = await fetchPayment(payment!.id);
          if (record.status === 'confirmed' && record.amount_cents === Number(finalOrder.cost_cents) && record.reference === finalOrder.id) {
            confirmed = record;
            break;
          }
          if (record.status === 'failed') break;
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (confirmed) {
        const issued = await issueOrder(order.id, confirmed);
        const bodyOut = await orderFullJson(client, issued);
        await withClient((c) => storeResponse(c, key, 201, bodyOut));
        return { __status: 201, body: bodyOut };
      }

      // Still pending: leave the order pending; it issues later when polled.
      scheduleConfirmationPoll(order.id, payment!.id);
      const bodyOut = await orderFullJson(client, finalOrder);
      await withClient((c) => storeResponse(c, key, 201, bodyOut));
      return { __status: 201, body: bodyOut };
    });
  });
});

function cost_cents(order: OrderRow): string {
  return order.cost_cents;
}

function sameBody(stored: unknown, options: number): boolean {
  const b = stored as { options?: unknown };
  return b?.options === options;
}

/** Issues shares after the provider confirms. Never issues twice. */
async function issueOrder(orderId: string, payment: PaymentRecord): Promise<OrderRow> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const lock = await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`issue:${orderId}`]);
      void lock;
      const order = await orderById(client, orderId);
      if (!order) throw notFound();
      if (order.state === 'issued' || order.state === 'cancelled') {
        if (order.state === 'cancelled') {
          // Cancel wins: cancel the payment at the provider.
          try {
            if (order.payment_id) await cancelPayment(order.payment_id);
          } catch {
            // provider already gone; nothing further to do
          }
        }
        await client.query('COMMIT');
        return order;
      }
      const holder = await personById(client, order.holder_id);
      const grant = await grantById(client, order.grant_id);
      if (!grant || !holder) throw notFound();
      const at = new Date();
      await client.query(
        "UPDATE exercise_orders SET state = 'issued', issued_at = $1, payment_id = $2, payment_confirmed_at = $3 WHERE id = $4",
        [at, payment.id, payment.confirmed_at ? new Date(payment.confirmed_at) : at, orderId],
      );
      await client.query(
        'INSERT INTO share_holdings (person_id, class, shares) VALUES ($1, $2, $3) ON CONFLICT (person_id, class) DO UPDATE SET shares = share_holdings.shares + $3',
        [order.holder_id, 'Common', Number(order.options)],
      );
      await writeLedgerEntry(client, {
        holder_id: order.holder_id, holder_name: holder.name, kind: 'exercise_issued', class: 'Common',
        shares_delta: Number(order.options), options_delta: -Number(order.options), reference: order.id,
      });
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'order_state', { order_id: orderId, state: 'issued' });
      await emitFor(client, order.holder_id, 'order_state', { order_id: orderId, state: 'issued' });
      await emitFor(client, order.holder_id, 'cap_table_changed', {});
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    // Seal the exercise notice in the vault, under the same transaction boundary as a document insert.
    await sealExerciseNotice(orderId).catch(() => undefined);
    const issued = await withClient((c) => orderById(c, orderId));
    return issued!;
  });
}

async function sealExerciseNotice(orderId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const order = await orderById(client, orderId);
      if (!order || order.state !== 'issued') return;
      const existing = await client.query('SELECT id FROM documents WHERE order_id = $1', [orderId]);
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return;
      }
      const holder = await personById(client, order.holder_id);
      const docId = await nextDocumentId(client);
      const vaultKey = `exercise-notices/${orderId}.txt`;
      const text = [
        'Tidecraft Robotics, Inc. — Notice of Exercise',
        `Order: ${orderId}`,
        `Grant: ${order.grant_id}`,
        `Holder: ${holder?.name ?? ''}`,
        `Options exercised: ${Number(order.options)}`,
        `Strike price: $${order.strike}`,
        `Exercise cost: $${centsString(BigInt(order.cost_cents))}`,
        `Payment reference: ${order.payment_id ?? ''}`,
        `Issued at: ${order.issued_at ? order.issued_at.toISOString() : new Date().toISOString()}`,
        '',
      ].join('\n');
      await client.query('COMMIT');
      const sha = await sealDocument(vaultKey, Buffer.from(text, 'utf8'));
      await withClient(async (c2) => {
        await c2.query('BEGIN');
        try {
          await c2.query(
            `INSERT INTO documents (id, kind, title, owner_id, order_id, status, vault_key, sha256, version)
             VALUES ($1,'exercise_notice',$2,$3,$4,'sealed',$5,$6,1)`,
            [docId, `Exercise notice — ${orderId}`, order.holder_id, orderId, vaultKey, sha],
          );
          await c2.query('COMMIT');
          await withClient(async (c3) => {
            await emitFor(c3, order.holder_id, 'notice_sealed', { order_id: orderId, document_id: docId });
            const admins = await c3.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
            for (const a of admins.rows) await emitFor(c3, a.id, 'notice_sealed', { order_id: orderId, document_id: docId });
          });
        } catch (e) {
          await c2.query('ROLLBACK');
          throw e;
        }
      });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // transaction already ended
      }
      if (e instanceof VaultError) {
        // notice stays pending; shares are issued
        await withClient(async (c2) => {
          await c2.query('BEGIN');
          const docId = await nextDocumentId(c2);
          await c2.query(
            `INSERT INTO documents (id, kind, title, owner_id, order_id, status, vault_key, version)
             VALUES ($1,'exercise_notice',$2,$3,$4,'pending',$5,1) ON CONFLICT (id) DO NOTHING`,
            [docId, `Exercise notice — ${orderId}`, orderId, `exercise-notices/${orderId}.txt`],
          );
          await c2.query('COMMIT');
        }).catch(() => undefined);
        return;
      }
      throw e;
    }
  });
}

const pollTimers = new Map<string, NodeJS.Timeout>();

/** Polls the provider every 2 seconds until the record confirms, then issues. */
export function scheduleConfirmationPoll(orderId: string, paymentId: string): void {
  if (pollTimers.has(orderId)) return;
  const timer = setInterval(async () => {
    try {
      const record = await fetchPayment(paymentId);
      if (record.status === 'confirmed' && record.reference === orderId) {
        clearInterval(pollTimers.get(orderId));
        pollTimers.delete(orderId);
        await issueOrder(orderId, record);
      } else if (record.status === 'failed' || record.status === 'cancelled') {
        clearInterval(pollTimers.get(orderId));
        pollTimers.delete(orderId);
      }
    } catch {
      // keep trying while the order is pending
    }
  }, 2_000);
  pollTimers.set(orderId, timer);
}

route('GET', '/api/exercises', ['option_holder', 'leaver', 'founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const rows = ctx.person.role === 'founder_admin'
      ? await client.query('SELECT id FROM exercise_orders ORDER BY placed_at DESC, id DESC')
      : await client.query('SELECT id FROM exercise_orders WHERE holder_id = $1 ORDER BY placed_at DESC, id DESC', [ctx.person.id]);
    const orders = [];
    for (const r of rows.rows as Array<{ id: string }>) {
      const o = await orderById(client, r.id);
      if (o) orders.push(await orderFullJson(client, o));
    }
    return { orders };
  });
});

route('GET', '/api/exercises/:id', ['option_holder', 'leaver', 'founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const o = await orderById(client, ctx.params.id!);
    if (!o) throw notFound();
    if (ctx.person.role !== 'founder_admin' && o.holder_id !== ctx.person.id) throw notFound();
    return orderFullJson(client, o);
  });
});

route('POST', '/api/exercises/:id/retry', ['option_holder', 'leaver'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const o = await orderById(client, ctx.params.id!);
    if (!o) throw notFound();
    if (o.holder_id !== ctx.person.id) throw notFound();

    if (o.state === 'issued') {
      // Notice pending: seal it instead.
      const notice = await client.query<{ id: string; status: string; vault_key: string }>(
        'SELECT id, status, vault_key FROM documents WHERE order_id = $1 ORDER BY version DESC LIMIT 1',
        [o.id],
      );
      if (notice.rows.length === 0 || notice.rows[0]!.status === 'sealed') {
        throw new HttpError(409, 'nothing_to_retry', 'There is nothing to retry on this order.');
      }
      // reseal the same document under the same key
      return retryNotice(o);
    }
    if (o.state === 'held' || o.state === 'pending') {
      let payment: PaymentRecord | null = null;
      try {
        if (o.payment_id) {
          payment = await fetchPayment(o.payment_id);
        } else {
          payment = await createPayment({
            idempotencyKey: o.idempotency_key,
            amountCents: Number(o.cost_cents),
            reference: o.id,
            description: `Exercise of ${Number(o.options)} options under ${o.grant_id}`,
          });
        }
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        throw new HttpError(503, 'provider_unavailable', "The payment provider can't be reached.", undefined, {
          order: await orderFullJson(client, o),
        });
      }
      if (payment.status === 'confirmed' && payment.reference === o.id) {
        const issued = await issueOrder(o.id, payment);
        return orderFullJson(client, issued);
      }
      if (payment.status === 'pending') {
        scheduleConfirmationPoll(o.id, payment.id);
        await withClient((c) =>
          c.query("UPDATE exercise_orders SET payment_id = $1, state = 'pending' WHERE id = $2", [payment!.id, o.id]),
        );
        const updated = await orderById(client, o.id);
        return orderFullJson(client, updated!);
      }
      const updated = await orderById(client, o.id);
      return orderFullJson(client, updated!);
    }
    throw new HttpError(409, 'nothing_to_retry', 'There is nothing to retry on this order.');
  });
});

async function retryNotice(o: OrderRow): Promise<Record<string, unknown>> {
  return withClient(async (client) => {
    const doc = await client.query<{ id: string; vault_key: string }>(
      'SELECT id, vault_key FROM documents WHERE order_id = $1 AND status = $2 ORDER BY version DESC LIMIT 1',
      [o.id, 'pending'],
    );
    if (doc.rows.length === 0) {
      throw new HttpError(409, 'nothing_to_retry', 'There is nothing to retry on this order.');
    }
    const text = [
      'Tidecraft Robotics, Inc. — Notice of Exercise',
      `Order: ${o.id}`,
      `Grant: ${o.grant_id}`,
      `Holder: ${(await personById(client, o.holder_id))?.name ?? ''}`,
      `Options exercised: ${Number(o.options)}`,
      `Strike price: $${o.strike}`,
      `Exercise cost: $${centsString(BigInt(o.cost_cents))}`,
      `Payment reference: ${o.payment_id ?? ''}`,
      `Issued at: ${o.issued_at ? o.issued_at.toISOString() : new Date().toISOString()}`,
      '',
    ].join('\n');
    let sha: string;
    try {
      sha = await sealDocument(doc.rows[0]!.vault_key, Buffer.from(text, 'utf8'));
    } catch (e) {
      if (e instanceof VaultError) {
        throw new HttpError(503, 'vault_unavailable', "The document vault can't be reached.", undefined, {
          order: await orderFullJson(client, o),
        });
      }
      throw e;
    }
    await client.query('BEGIN');
    try {
      await client.query('UPDATE documents SET status = $1, sha256 = $2 WHERE id = $3', ['sealed', sha, doc.rows[0]!.id]);
      await emitFor(client, o.holder_id, 'notice_sealed', { order_id: o.id, document_id: doc.rows[0]!.id });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    const updated = await orderById(client, o.id);
    return orderFullJson(client, updated!);
  });
}

route('POST', '/api/exercises/:id/cancel', ['option_holder', 'leaver'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    let cancelledPaymentId: string | null = null;
    try {
      const lock = await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`issue:${ctx.params.id}`]);
      void lock;
      const o = await orderById(client, ctx.params.id!);
      if (!o) throw notFound();
      if (o.holder_id !== ctx.person.id) throw notFound();
      if (o.state !== 'pending' && o.state !== 'held') {
        throw new HttpError(409, 'order_not_cancellable', `Order ${o.id} was already issued and can't be cancelled.`);
      }
      await client.query("UPDATE exercise_orders SET state = 'cancelled' WHERE id = $1", [o.id]);
      cancelledPaymentId = o.payment_id;
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'order_state', { order_id: o.id, state: 'cancelled' });
      await emitFor(client, o.holder_id, 'order_state', { order_id: o.id, state: 'cancelled' });
      await emitFor(client, o.holder_id, 'cap_table_changed', {});
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    if (cancelledPaymentId) {
      try {
        await cancelPayment(cancelledPaymentId);
      } catch {
        // provider unreachable; the order stays cancelled and nothing is issued
      }
    }
    const updated = await withClient((c) => orderById(c, ctx.params.id!));
    return orderFullJson(client, updated!);
  });
});

export { orderById, orderFullJson, orderJson };
