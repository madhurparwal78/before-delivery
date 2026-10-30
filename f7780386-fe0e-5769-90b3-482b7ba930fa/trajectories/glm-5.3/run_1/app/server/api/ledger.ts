// The prepaid hours ledger, pack purchases, adjustments, reversals and
// invoices. Every movement of hours is one transaction of two entries that
// sum to zero; the balance never goes below zero.

import { Router } from 'express';
import { pool } from '../db.js';
import {
  ApiError,
  asRecord,
  conflict,
  notFound,
  readJsonBody,
  requireMember,
  requireOperator,
  requireString,
  requireUser,
  validationFailed,
} from '../http.js';
import { balanceMinutes, ledgerForMember, memberById, transactionById, writeTransaction } from '../domain.js';
import { PACKS } from '../../shared/seed.js';
import { billingUp } from '../services.js';
import { sendInvoiceNotice } from '../outbound.js';
import * as kb from '../killbill.js';

export const router = Router();

router.get('/ledger', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    let memberId: string;
    if (user.role === 'operator') {
      const param = typeof req.query['member_id'] === 'string' ? req.query['member_id'] : '';
      if (!param) throw validationFailed({ member_id: 'required' });
      const member = await memberById(param);
      if (!member) throw notFound();
      memberId = param;
    } else if (user.role === 'member') {
      memberId = user.member_id!;
    } else {
      throw new ApiError(403, 'forbidden');
    }
    const ledger = await ledgerForMember(memberId);
    res.json({ member_id: memberId, balance_minutes: ledger.balanceMinutes, transactions: ledger.transactions });
  } catch (err) {
    next(err);
  }
});

router.post('/packs/:packId/purchase', async (req, res, next) => {
  const client = await pool.connect().catch(() => null);
  if (!client) {
    next(new ApiError(503, 'database_unavailable'));
    return;
  }
  try {
    const user = requireMember(await requireUser(req));
    const pack = PACKS.find((p) => p.id === req.params['packId']);
    if (!pack) throw notFound();
    if (!billingUp()) throw new ApiError(503, 'billing_unavailable');
    const member = await memberById(user.member_id);
    if (!member) throw notFound();

    // Kill Bill records the charge and its payment first; only then do the
    // hours appear in the ledger.
    const priceCents = Math.round(Number(pack.price) * 100);
    let invoiceId: string;
    try {
      const accountId = await kb.ensureAccount(user.member_id, member.business_name, member.contact_email);
      invoiceId = await kb.chargeAndPay(accountId, pack.name, priceCents);
    } catch {
      throw new ApiError(503, 'billing_unavailable');
    }
    await sendInvoiceNotice(user.member_id, (priceCents / 100).toFixed(2), pack.name);

    await client.query('BEGIN');
    const tx = await writeTransaction(client, {
      memberId: user.member_id,
      kind: 'pack_purchase',
      minutes: pack.minutes,
      reason: pack.name,
    });
    await client.query('COMMIT');
    const balance = await balanceMinutes(user.member_id);
    res.status(201).json({ transaction: tx, balance_minutes: balance, invoice_id: invoiceId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
});

router.post('/ledger/adjustments', async (req, res, next) => {
  const client = await pool.connect().catch(() => null);
  if (!client) {
    next(new ApiError(503, 'database_unavailable'));
    return;
  }
  try {
    requireOperator(await requireUser(req));
    const body = asRecord(await readJsonBody(req));
    const memberId = requireString(body, 'member_id');
    const member = await memberById(memberId);
    if (!member) throw notFound();
    const minutes = body['minutes'];
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes === 0 || minutes % 15 !== 0 || Math.abs(minutes) > 6000) {
      throw validationFailed({ minutes: 'invalid' });
    }
    const reason = requireString(body, 'reason');
    if (reason.length < 1 || reason.length > 200) throw validationFailed({ reason: 'length' });

    await client.query('BEGIN');
    const balance = await balanceMinutes(memberId, client);
    if (balance + minutes < 0) {
      await client.query('ROLLBACK');
      throw conflict('insufficient_hours');
    }
    const tx = await writeTransaction(client, { memberId, kind: 'adjustment', minutes, reason });
    await client.query('COMMIT');
    res.status(201).json({ transaction: tx, balance_minutes: await balanceMinutes(memberId) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
});

router.post('/ledger/transactions/:id/reverse', async (req, res, next) => {
  const client = await pool.connect().catch(() => null);
  if (!client) {
    next(new ApiError(503, 'database_unavailable'));
    return;
  }
  try {
    requireOperator(await requireUser(req));
    const body = asRecord(await readJsonBody(req));
    const reason = requireString(body, 'reason');
    if (reason.length < 1 || reason.length > 200) throw validationFailed({ reason: 'length' });
    const found = await transactionById(req.params['id']!);
    if (!found) throw notFound();
    const { tx, memberId } = found;
    if (tx.kind !== 'adjustment' && tx.kind !== 'opening') throw conflict('not_reversible');
    if (tx.reversed_by) throw conflict('already_reversed');

    await client.query('BEGIN');
    const current = await transactionById(tx.id);
    if (!current || current.tx.reversed_by) {
      await client.query('ROLLBACK');
      throw conflict('already_reversed');
    }
    const balance = await balanceMinutes(memberId, client);
    if (balance - tx.member_minutes < 0) {
      await client.query('ROLLBACK');
      throw conflict('insufficient_hours');
    }
    const reversal = await writeTransaction(client, {
      memberId,
      kind: 'reversal',
      minutes: -tx.member_minutes,
      reverses: tx.id,
      reason,
    });
    await client.query(`UPDATE transactions SET reversed_by = $1 WHERE id = $2`, [reversal.id, tx.id]);
    await client.query('COMMIT');
    res.status(201).json({ transaction: reversal, balance_minutes: await balanceMinutes(memberId) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
});

router.get('/invoices', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    let memberId: string;
    if (user.role === 'operator') {
      const param = typeof req.query['member_id'] === 'string' ? req.query['member_id'] : '';
      if (!param) throw validationFailed({ member_id: 'required' });
      const member = await memberById(param);
      if (!member) throw notFound();
      memberId = param;
    } else if (user.role === 'member') {
      memberId = user.member_id!;
    } else {
      throw new ApiError(403, 'forbidden');
    }
    if (!billingUp()) throw new ApiError(503, 'billing_unavailable');
    const member = await memberById(memberId);
    const accountId = await kb.ensureAccount(memberId, member!.business_name, member!.contact_email);
    const invoices = await kb.listInvoices(accountId);
    res.json({ invoices });
  } catch (err) {
    next(err);
  }
});

router.get('/invoices/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    if (!billingUp()) throw new ApiError(503, 'billing_unavailable');
    const invoice = await kb.getInvoice(req.params['id']!);
    if (invoice === null) throw notFound();
    const members = await pool.query('SELECT id, business_name, contact_email FROM members');
    for (const m of members.rows as { id: string; business_name: string; contact_email: string }[]) {
      if (user.role !== 'operator' && m.id !== user.member_id) continue;
      const accountId = await kb.ensureAccount(m.id, m.business_name, m.contact_email);
      const invoices = await kb.listInvoices(accountId);
      if (invoices.some((inv) => inv.id === req.params['id'])) {
        res.json({ invoice });
        return;
      }
    }
    throw notFound();
  } catch (err) {
    next(err);
  }
});
