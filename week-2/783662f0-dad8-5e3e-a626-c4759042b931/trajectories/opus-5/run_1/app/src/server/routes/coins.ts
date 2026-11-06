import { Router } from 'express';
import { lockKey, one, query, tx, withLock } from '../db/pool.js';
import { fail } from '../errors.js';
import { idempotencyKey, remember, replayed } from '../http/idempotency.js';
import { type SessionUser, requireUser } from '../http/session.js';
import { COPY, FIELD_COPY } from '../../shared/copy.js';
import { MAX_PURCHASES_PER_DAY, PACKS, PACK_IDS, type PackId } from '../../shared/domain.js';
import type { PurchaseObject } from '../../shared/types.js';
import { PAYMENT_TIMEOUT_MS, claimPendingPayment } from '../domain/billing.js';
import { requireOwnCharacter } from '../domain/characters.js';
import { HOUSE, walletOf, writeEntry } from '../domain/ledger.js';
import { requirePlayable, scopeByServerId, scopeBySlug } from '../domain/servers.js';
import { BillingUnreachable } from '../services/killbill.js';
import * as kb from '../services/killbill.js';
import { attemptMail, queueMail } from '../services/mail.js';
import { instant, money, newId, secondsUntilMidnight, zoneDate } from '../util.js';
import { FieldErrors, checkChoice, onlyFields } from '../validate.js';
import { body, created, ok, route } from './helpers.js';

export const coinRoutes = Router();

interface PurchaseRow {
  id: string;
  server_id: string;
  user_id: string;
  character_id: string;
  pack: PackId;
  coins: number;
  price: string;
  state: 'pending' | 'paid' | 'refunded';
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  created_at: Date;
}

async function purchaseObject(row: PurchaseRow): Promise<PurchaseObject> {
  const receipt = await one<{ state: 'held' | 'sent' }>(
    `SELECT state FROM mail WHERE dedupe_key = $1`,
    [row.state === 'refunded' ? `coin_refund:${row.id}` : `coin_receipt:${row.id}`],
  );
  return {
    id: row.id,
    character_id: row.character_id,
    pack: row.pack,
    coins: row.coins,
    price: money(row.price),
    state: row.state,
    receipt: receipt?.state === 'sent' ? 'sent' : 'held',
    created_at: instant(row.created_at),
  };
}

coinRoutes.post(
  '/servers/:slug/coin-purchases',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    requirePlayable(scope.server);
    onlyFields(body(req), ['character_id', 'pack']);
    const key = idempotencyKey(req);
    const stored = await replayed(user.id, 'coin-purchases', key, body(req));
    if (stored !== null) {
      res
        .status(stored.status)
        .type('application/json; charset=utf-8')
        .send(JSON.stringify(stored.body));
      return;
    }

    const errors = new FieldErrors();
    const pack = checkChoice(errors, 'pack', body(req).pack, PACK_IDS, FIELD_COPY.coinPackRequired);
    errors.throwIfAny();
    if (pack === null) throw fail('validation', { fields: { pack: FIELD_COPY.coinPackRequired } });

    const character = await requireOwnCharacter(
      scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );

    const today = zoneDate(new Date(), scope.server.time_zone);
    const purchaseId = newId();

    /* The day's count and the insert happen under one per-user lock, so that
       parallel attempts never pass the daily limit. */
    const answer = await withLock(lockKey(`coins:${scope.server.id}:${user.id}`), async () => {
      const made = await one<{ count: string }>(
        `SELECT count(*) AS count FROM coin_purchases
          WHERE server_id = $1 AND user_id = $2 AND local_day = $3`,
        [scope.server.id, user.id, today],
      );
      if (Number(made?.count ?? 0) >= MAX_PURCHASES_PER_DAY) {
        throw fail('daily_limit_reached', {
          message: COPY.dailyLimitReached,
          retryAfterSeconds: secondsUntilMidnight(new Date(), scope.server.time_zone),
        });
      }

      let accountId: string;
      let invoiceId: string;
      try {
        accountId = await kb.ensureAccount(
          `plotwright-${scope.server.id}-${user.handle}`,
          `${user.displayName} on ${scope.server.name}`,
        );
        await kb.ensureAutoPayOff(accountId);
        invoiceId = await kb.addExternalCharge(
          accountId,
          PACKS[pack].price,
          `${PACKS[pack].name} of coins`,
        );
      } catch (error) {
        if (error instanceof BillingUnreachable) {
          throw fail('billing_unavailable', { message: COPY.coinsOutage });
        }
        throw error;
      }

      await query(
        `INSERT INTO coin_purchases (id, server_id, user_id, character_id, pack, coins, price,
                                     state, kb_account_id, kb_invoice_id, local_day)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10)`,
        [
          purchaseId,
          scope.server.id,
          user.id,
          character.id,
          pack,
          PACKS[pack].coins,
          PACKS[pack].price,
          accountId,
          invoiceId,
          today,
        ],
      );

      const externalKey = `pw-coins-${purchaseId}`;
      await claimPendingPayment(
        scope.server.id,
        'coins',
        externalKey,
        accountId,
        Number(PACKS[pack].price),
        purchaseId,
      );

      let slow = false;
      try {
        await kb.payInvoice(
          accountId,
          invoiceId,
          Number(PACKS[pack].price),
          externalKey,
          PAYMENT_TIMEOUT_MS,
        );
      } catch {
        slow = true;
      }

      if (!slow) {
        const payment = await kb.paymentByExternalKey(externalKey).catch(() => null);
        if (payment !== null && kb.paymentSucceeded(payment)) {
          await creditPurchase(purchaseId, payment.paymentId);
        } else {
          slow = true;
        }
      }

      const row = await one<PurchaseRow>('SELECT * FROM coin_purchases WHERE id = $1', [
        purchaseId,
      ]);
      if (row === null) throw fail('internal');
      const payload = await purchaseObject(row);
      const status = row.state === 'paid' ? 201 : 202;
      await remember(user.id, 'coin-purchases', key, body(req), status, payload);
      return { status, payload };
    });
    res
      .status(answer.status)
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(answer.payload));
  }),
);

/**
 * Coins are credited only once Kill Bill shows the payment succeeded, in the
 * same transaction that marks the purchase paid and queues the receipt.
 */
export async function creditPurchase(purchaseId: string, paymentId: string): Promise<boolean> {
  const queued = await tx(async (client) => {
    const locked = await client.query<PurchaseRow>(
      'SELECT * FROM coin_purchases WHERE id = $1 FOR UPDATE',
      [purchaseId],
    );
    const row = locked.rows[0];
    if (row === undefined || row.state !== 'pending') return null;

    await writeEntry(client, {
      serverId: row.server_id,
      kind: 'top_up',
      purchaseId: row.id,
      lines: [
        { account: HOUSE, amount: -row.coins },
        { account: row.character_id, amount: row.coins },
      ],
    });
    await client.query(
      `UPDATE coin_purchases SET state = 'paid', kb_payment_id = $2 WHERE id = $1`,
      [row.id, paymentId],
    );
    await client.query(`UPDATE pending_payments SET state = 'done' WHERE purchase_id = $1`, [
      row.id,
    ]);
    return row;
  });
  if (queued === null) return false;

  const details = await one<{
    handle: string;
    email: string;
    name: string;
    server_name: string;
  }>(
    `SELECT u.handle, u.email, c.name, sv.name AS server_name
       FROM coin_purchases p JOIN users u ON u.id = p.user_id
       JOIN characters c ON c.id = p.character_id
       JOIN servers sv ON sv.id = p.server_id
      WHERE p.id = $1`,
    [purchaseId],
  );
  if (details !== null) {
    const mailId = await queueMail({
      serverId: queued.server_id,
      kind: 'coin_receipt',
      toHandle: details.handle,
      toEmail: details.email,
      subject: `Coins added on ${details.server_name}`,
      lines: [
        `${details.name} received ${queued.coins} coins for ${money(queued.price)} USD.`,
      ],
      dedupeKey: `coin_receipt:${purchaseId}`,
    });
    if (mailId !== null) await attemptMail(mailId);
  }
  return true;
}

coinRoutes.get(
  '/coin-purchases/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const row = await locatePurchase(req.params.id, user);
    ok(res, await purchaseObject(row));
  }),
);

coinRoutes.get(
  '/servers/:slug/coin-purchases',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const rows = await query<PurchaseRow>(
      `SELECT * FROM coin_purchases
        WHERE server_id = $1 AND ($2 = true OR user_id = $3)
        ORDER BY created_at DESC`,
      [scope.server.id, scope.isOwner, user.id],
    );
    const purchases = [];
    for (const row of rows) purchases.push(await purchaseObject(row));
    ok(res, { purchases });
  }),
);

coinRoutes.post(
  '/coin-purchases/:id/refund',
  route(async (req, res) => {
    const user = await requireUser(req);
    const row = await locatePurchase(req.params.id, user);
    const scope = await scopeByServerId(row.server_id, user);
    if (!scope.isOwner) throw fail('forbidden');
    requirePlayable(scope.server);
    onlyFields(body(req), []);

    if (row.state === 'refunded') throw fail('already_refunded');
    if (row.state !== 'paid') throw fail('not_paid');

    const wallet = await walletOf(row.character_id);
    if (wallet.available < row.coins) throw fail('coins_spent', { message: COPY.coinsSpent });
    if (row.kb_payment_id === null) throw fail('not_paid');

    try {
      await kb.refundPayment(row.kb_payment_id, money(row.price), `pw-refund-${row.id}`);
    } catch (error) {
      if (error instanceof BillingUnreachable) {
        throw fail('billing_unavailable', { message: COPY.coinsOutage });
      }
      throw error;
    }

    await tx(async (client) => {
      const locked = await client.query<PurchaseRow>(
        'SELECT * FROM coin_purchases WHERE id = $1 FOR UPDATE',
        [row.id],
      );
      const current = locked.rows[0];
      if (current === undefined || current.state !== 'paid') throw fail('already_refunded');
      await writeEntry(client, {
        serverId: current.server_id,
        kind: 'refund',
        purchaseId: current.id,
        lines: [
          { account: current.character_id, amount: -current.coins },
          { account: HOUSE, amount: current.coins },
        ],
      });
      await client.query(`UPDATE coin_purchases SET state = 'refunded' WHERE id = $1`, [
        current.id,
      ]);
    });

    const details = await one<{
      handle: string;
      email: string;
      name: string;
      server_name: string;
    }>(
      `SELECT u.handle, u.email, c.name, sv.name AS server_name
         FROM coin_purchases p JOIN users u ON u.id = p.user_id
         JOIN characters c ON c.id = p.character_id
         JOIN servers sv ON sv.id = p.server_id
        WHERE p.id = $1`,
      [row.id],
    );
    if (details !== null) {
      const mailId = await queueMail({
        serverId: row.server_id,
        kind: 'coin_refund',
        toHandle: details.handle,
        toEmail: details.email,
        subject: `Coin purchase refunded on ${details.server_name}`,
        lines: [
          `${row.coins} coins were removed from ${details.name} and ${money(row.price)} USD was refunded.`,
        ],
        dedupeKey: `coin_refund:${row.id}`,
      });
      if (mailId !== null) await attemptMail(mailId);
    }

    const updated = await one<PurchaseRow>('SELECT * FROM coin_purchases WHERE id = $1', [row.id]);
    if (updated === null) throw fail('not_found');
    ok(res, await purchaseObject(updated));
  }),
);

async function locatePurchase(id: string, user: SessionUser): Promise<PurchaseRow> {
  const row = await one<PurchaseRow>('SELECT * FROM coin_purchases WHERE id = $1', [id]);
  if (row === null) throw fail('not_found');
  const scope = await scopeByServerId(row.server_id, user);
  if (row.user_id !== user.id && !scope.isOwner) throw fail('forbidden');
  return row;
}
