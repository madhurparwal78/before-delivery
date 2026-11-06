// Tenders: lifecycle, sealed bids, sign-in links, calendar invitations,
// levelling and award.

import { Router } from 'express';
import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { one, query, withTransaction } from '../lib/db.js';
import { ApiError, conflict, forbidden, illegalTransition, notFound, validationError, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import type { AuthedRequest } from '../lib/auth.js';
import { scopedProject } from '../lib/scope.js';
import { checkLength, checkOneLine, requireString, throwValidation, wrap } from './helpers.js';
import { formatUtcCompact, instantText, localToInstant } from '../lib/time.js';
import { buildIcs } from '../lib/files.js';
import { centsToWireDecimal, roundDivCents } from '../lib/money.js';
import type { Config } from '../lib/config.js';
import { STUDIO_ROLES } from '../lib/types.js';
import { queueMany } from '../lib/outbox.js';

const STUDIO_EDIT_ROLES = ['director', 'project_lead'];

interface TenderRow {
  id: string;
  project_id: string;
  title: string;
  scope: string;
  closes_at: Date | null;
  closes_at_local: string | null;
  status: 'draft' | 'open' | 'closed' | 'opened' | 'awarded';
  contingency_percent: string;
  ics_sequence: number;
  awarded_bid_id: string | null;
  award_reason: string | null;
}

async function tenderById(id: string): Promise<TenderRow | null> {
  return one<TenderRow>('SELECT * FROM tenders WHERE id = $1', [id]);
}

async function tenderProject(req: AuthedRequest, tender: TenderRow) {
  const project = await scopedProject(req, tender.project_id);
  return project;
}

function bidderReference(position: number): string {
  return `B-${position.toString().padStart(2, '0')}`;
}

export function tendersRouter(config: Config): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  // ---- Setup ----

  router.post('/api/projects/:id/tenders', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!STUDIO_EDIT_ROLES.includes(member.role)) throw forbidden();
    const project = await scopedProject(req, req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const title = requireString(body.title, 'title', 'Tender title', errors);
    checkLength(title, 'title', 'Tender title', 120, errors);
    checkOneLine(title, 'title', 'Tender title', errors);
    const scope = requireString(body.scope, 'scope', 'Scope', errors);
    checkLength(scope, 'scope', 'Scope', 4000, errors);
    const closesAtLocal = typeof body.closesAtLocal === 'string' && body.closesAtLocal ? body.closesAtLocal : null;
    if (closesAtLocal && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(closesAtLocal)) {
      errors.closesAtLocal = 'Choose a close time after now.';
    }
    const contingencyPercent = typeof body.contingencyPercent === 'string' ? body.contingencyPercent : null;
    let contingencyBasisPoints = 0;
    if (contingencyPercent !== null) {
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(contingencyPercent)) {
        errors.contingencyPercent = FIELD_ERRORS.range('Contingency percent', '0 and 25.00');
      } else {
        const value = parseFloat(contingencyPercent);
        if (value < 0 || value > 25) errors.contingencyPercent = FIELD_ERRORS.range('Contingency percent', '0 and 25.00');
        else contingencyBasisPoints = Math.round(value * 100);
      }
    }
    const bidders = Array.isArray(body.bidders) ? (body.bidders as Record<string, unknown>[]) : [];
    const bidderRows: { companyName: string; contactName: string; contactEmail: string }[] = [];
    bidders.forEach((bidder, index) => {
      const companyName = requireString(bidder.companyName, `bidders[${index}].companyName`, 'Company name', errors);
      if (companyName) {
        checkLength(companyName, `bidders[${index}].companyName`, 'Company name', 120, errors);
        checkOneLine(companyName, `bidders[${index}].companyName`, 'Company name', errors);
      }
      const contactName = requireString(bidder.contactName, `bidders[${index}].contactName`, 'Contact name', errors);
      if (contactName) {
        checkLength(contactName, `bidders[${index}].contactName`, 'Contact name', 120, errors);
        checkOneLine(contactName, `bidders[${index}].contactName`, 'Contact name', errors);
      }
      const contactEmail = requireString(bidder.contactEmail, `bidders[${index}].contactEmail`, 'Contact email', errors);
      if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        errors[`bidders[${index}].contactEmail`] = FIELD_ERRORS.badEmail('Contact email');
      }
      if (companyName && contactName && contactEmail) bidderRows.push({ companyName, contactName, contactEmail });
    });
    throwValidation(errors);
    // An email belonging to a non-contractor member is refused.
    for (const bidder of bidderRows) {
      const existing = await one<{ role: string }>('SELECT role FROM members WHERE lower(email) = $1', [bidder.contactEmail.toLowerCase()]);
      if (existing && existing.role !== 'contractor') {
        throw validationError({ [`bidders`]: FIELD_ERRORS.required('Contact email') });
      }
    }
    const id = randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tenders (id, project_id, title, scope, closes_at, closes_at_local, contingency_percent, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, project.id, title, scope, closesAtLocal ? localToInstant(closesAtLocal) : null, closesAtLocal, contingencyBasisPoints, member.id],
      );
      for (const [index, bidder] of bidderRows.entries()) {
        const contactMember = await ensureContractorMember(client, bidder.companyName, bidder.contactEmail);
        await client.query(
          'INSERT INTO bidders (id, tender_id, reference, company_name, contact_name, contact_email, member_id, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [randomUUID(), id, bidderReference(index + 1), bidder.companyName, bidder.contactName, bidder.contactEmail, contactMember, index + 1],
        );
      }
    });
    res.status(201).json({ tender: await studioTenderPayload(id) });
  }));

  router.get('/api/projects/:id/tenders', wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (STUDIO_ROLES.includes(member.role)) {
      const rows = await query('SELECT id FROM tenders WHERE project_id = $1 ORDER BY created_at', [project.id]);
      res.json({ tenders: await Promise.all(rows.map((r) => studioTenderPayload(r.id))) });
      return;
    }
    // Contractors see only tenders they are invited to that left draft.
    const rows = await query<{ id: string; status: string }>(
      `SELECT t.id, t.status FROM tenders t JOIN bidders bd ON bd.tender_id = t.id
       WHERE t.project_id = $1 AND bd.member_id = $2 AND t.status != 'draft'`,
      [project.id, member.id],
    );
    res.json({ tenders: rows.map((r) => ({ id: r.id, status: r.status })) });
  }));

  router.get('/api/tenders/:id', wrap(async (req, res) => {
    const member = req.member!;
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    if (STUDIO_ROLES.includes(member.role)) {
      res.json({ tender: await studioTenderPayload(tender.id) });
      return;
    }
    if (member.role !== 'contractor') throw notFound();
    const bidder = await one<{ id: string }>('SELECT id FROM bidders WHERE tender_id = $1 AND member_id = $2', [tender.id, member.id]);
    if (!bidder || tender.status === 'draft') throw notFound();
    const project = await one<{ id: string; reference: string; name: string; region: 'HK' | 'SG' | 'MO' }>(
      'SELECT id, reference, name, region FROM projects WHERE id = $1',
      [tender.project_id],
    );
    const bid = await bidPayload(tender.id, bidder.id);
    res.json({
      tender: {
        id: tender.id,
        title: tender.title,
        scope: tender.scope,
        project,
        closesAt: tender.closes_at?.toISOString() ?? null,
        closesAtLocal: tender.closes_at_local,
        timeZone: project!.region === 'SG' ? 'Asia/Singapore' : 'Asia/Hong_Kong',
        status: tender.status,
        myBid: bid,
      },
    });
  }));

  router.patch('/api/tenders/:id', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!STUDIO_EDIT_ROLES.includes(member.role)) throw forbidden();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    await tenderProject(req, tender);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (tender.status === 'draft') {
      // Any setup field.
      if (typeof body.title === 'string') {
        checkLength(body.title, 'title', 'Tender title', 120, errors);
        checkOneLine(body.title, 'title', 'Tender title', errors);
      }
      if (typeof body.scope === 'string') checkLength(body.scope, 'scope', 'Scope', 4000, errors);
      if (body.closesAtLocal !== undefined && typeof body.closesAtLocal === 'string' && body.closesAtLocal) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(body.closesAtLocal)) errors.closesAtLocal = 'Choose a close time after now.';
      }
      if (body.contingencyPercent !== undefined && typeof body.contingencyPercent === 'string') {
        if (!/^\d{1,2}(\.\d{1,2})?$/.test(body.contingencyPercent)) errors.contingencyPercent = FIELD_ERRORS.range('Contingency percent', '0 and 25.00');
        else if (parseFloat(body.contingencyPercent) > 25) errors.contingencyPercent = FIELD_ERRORS.range('Contingency percent', '0 and 25.00');
      }
    } else if (tender.status === 'open') {
      if (body.closesAtLocal === undefined || typeof body.closesAtLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(body.closesAtLocal)) {
        errors.closesAtLocal = 'Choose a close time after now.';
      }
      for (const key of Object.keys(body)) {
        if (key !== 'closesAtLocal') throw illegalTransition(tender.status, `change ${key}`);
      }
    } else if (tender.status === 'opened') {
      if (body.contingencyPercent === undefined) throw illegalTransition(tender.status, 'change');
    } else {
      throw illegalTransition(tender.status, 'change');
    }
    throwValidation(errors);
    // Move-close rules: only while open, only to a future instant.
    if (tender.status === 'open') {
      const closesAtLocal = body.closesAtLocal as string;
      const instant = localToInstant(closesAtLocal);
      if (instant.getTime() <= Date.now()) throw validationError({ closesAtLocal: 'Choose a close time after now.' });
      await withTransaction(async (client) => {
        await client.query('UPDATE tenders SET closes_at = $1, closes_at_local = $2, ics_sequence = ics_sequence + 1 WHERE id = $3', [instant, closesAtLocal, tender.id]);
      });
      await sendTenderInvitations(config, tender.id, true);
    } else if (tender.status === 'draft') {
      const updates: string[] = [];
      const params: unknown[] = [tender.id];
      if (typeof body.title === 'string') {
        params.push(body.title);
        updates.push(`title = $${params.length}`);
      }
      if (typeof body.scope === 'string') {
        params.push(body.scope);
        updates.push(`scope = $${params.length}`);
      }
      if (typeof body.closesAtLocal === 'string' && body.closesAtLocal) {
        params.push(localToInstant(body.closesAtLocal));
        updates.push(`closes_at = $${params.length}`);
        params.push(body.closesAtLocal);
        updates.push(`closes_at_local = $${params.length}`);
      }
      if (typeof body.contingencyPercent === 'string') {
        params.push(Math.round(parseFloat(body.contingencyPercent) * 100));
        updates.push(`contingency_percent = $${params.length}`);
      }
      await query(`UPDATE tenders SET ${updates.join(', ')} WHERE id = $1`, params);
    } else if (tender.status === 'opened') {
      await query('UPDATE tenders SET contingency_percent = $1 WHERE id = $2', [Math.round(parseFloat(body.contingencyPercent as string) * 100), tender.id]);
    }
    res.json({ tender: await studioTenderPayload(tender.id) });
  }));

  router.post('/api/tenders/:id/publish', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!STUDIO_EDIT_ROLES.includes(member.role)) throw forbidden();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    await tenderProject(req, tender);
    if (tender.status !== 'draft') throw illegalTransition(tender.status, 'publish');
    const bidders = await query<{ id: string }>('SELECT id FROM bidders WHERE tender_id = $1 ORDER BY position', [tender.id]);
    if (bidders.length < 1 || bidders.length > 12) {
      throw validationError({ bidders: FIELD_ERRORS.range('Bidders', '1 and 12') });
    }
    if (!tender.closes_at || tender.closes_at.getTime() <= Date.now()) {
      throw validationError({ closesAtLocal: 'Choose a close time after now.' });
    }
    await query("UPDATE tenders SET status = 'open' WHERE id = $1", [tender.id]);
    await sendTenderInvitations(config, tender.id, false);
    res.json({ tender: await studioTenderPayload(tender.id) });
  }));

  router.post('/api/tenders/:id/open-bids', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!STUDIO_EDIT_ROLES.includes(member.role)) throw forbidden();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    await tenderProject(req, tender);
    const closed = tender.closes_at !== null && Date.now() >= tender.closes_at.getTime();
    if (tender.status === 'open' && !closed) {
      throw new ApiError(409, { error: 'tender_still_open', closesAt: tender.closes_at?.toISOString() ?? new Date().toISOString() });
    }
    if (tender.status === 'draft') {
      throw new ApiError(409, { error: 'tender_still_open', closesAt: tender.closes_at?.toISOString() ?? new Date().toISOString() });
    }
    if (tender.status !== 'open') throw illegalTransition(tender.status, 'open_bids');
    await query("UPDATE tenders SET status = 'opened' WHERE id = $1", [tender.id]);
    res.json({ tender: await studioTenderPayload(tender.id) });
  }));

  // ---- Bids ----

  router.post('/api/tenders/:id/bid', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'contractor') throw notFound();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    const bidder = await one<{ id: string }>('SELECT id FROM bidders WHERE tender_id = $1 AND member_id = $2', [tender.id, member.id]);
    if (!bidder) throw notFound();
    const project = await one<{ contract_company: string | null }>('SELECT contract_company FROM projects WHERE id = $1', [tender.project_id]);
    void project;
    if (tender.status === 'draft') throw notFound();
    if (tender.closes_at && Date.now() >= tender.closes_at.getTime()) {
      throw new ApiError(409, { error: 'tender_closed', closedAt: tender.closes_at.toISOString() });
    }
    const existing = await one<{ id: string }>('SELECT id FROM bids WHERE tender_id = $1 AND bidder_id = $2', [tender.id, bidder.id]);
    if (existing) throw conflict('bid_exists');
    const bid = await saveBid(tender, bidder.id, req.body as Record<string, unknown>, false);
    res.status(201).json({ bid });
  }));

  router.put('/api/tenders/:id/bid', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'contractor') throw notFound();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    const bidder = await one<{ id: string }>('SELECT id FROM bidders WHERE tender_id = $1 AND member_id = $2', [tender.id, member.id]);
    if (!bidder) throw notFound();
    const existing = await one<{ id: string }>('SELECT id FROM bids WHERE tender_id = $1 AND bidder_id = $2', [tender.id, bidder.id]);
    if (!existing) throw notFound();
    if (tender.closes_at && Date.now() >= tender.closes_at.getTime()) {
      throw new ApiError(409, { error: 'tender_closed', closedAt: tender.closes_at.toISOString() });
    }
    const bid = await saveBid(tender, bidder.id, req.body as Record<string, unknown>, true);
    res.json({ bid });
  }));

  router.get('/api/tenders/:id/bid', wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'contractor') throw notFound();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    const bidder = await one<{ id: string }>('SELECT id FROM bidders WHERE tender_id = $1 AND member_id = $2', [tender.id, member.id]);
    if (!bidder) throw notFound();
    res.json({ bid: await bidPayload(tender.id, bidder.id) });
  }));

  // ---- Levelling ----

  router.get('/api/tenders/:id/levelling', wrap(async (req, res) => {
    const member = req.member!;
    if (!STUDIO_ROLES.includes(member.role)) throw notFound();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    await tenderProject(req, tender);
    if (tender.status !== 'opened' && tender.status !== 'awarded') {
      throw new ApiError(409, { error: 'tender_not_opened' });
    }
    res.json(await levellingPayload(tender));
  }));

  router.patch('/api/bids/:id/levelling', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!STUDIO_EDIT_ROLES.includes(member.role)) throw forbidden();
    const bid = await one<{ id: string; tender_id: string }>('SELECT id, tender_id FROM bids WHERE id = $1', [req.params.id]);
    if (!bid) throw notFound();
    const tender = await tenderById(bid.tender_id);
    if (!tender) throw notFound();
    await tenderProject(req, tender);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const allowances = Array.isArray(body.allowances) ? (body.allowances as Record<string, unknown>[]) : [];
    const exclusionPrices = Array.isArray(body.exclusionPrices) ? (body.exclusionPrices as Record<string, unknown>[]) : [];
    for (const [index, allowance] of allowances.entries()) {
      const label = requireString(allowance.label, `allowances[${index}].label`, 'Allowance label', errors);
      if (label) checkLength(label, `allowances[${index}].label`, 'Allowance label', 120, errors);
      const amount = allowance.amountCents;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 99_999_999_999) {
        errors[`allowances[${index}].amountCents`] = FIELD_ERRORS.range('Allowance amount', '1 and 99,999,999,999 cents');
      }
    }
    for (const [index, price] of exclusionPrices.entries()) {
      const amount = price.priceCents;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 99_999_999_999) {
        errors[`exclusionPrices[${index}].priceCents`] = FIELD_ERRORS.exclusionZero;
      }
    }
    throwValidation(errors);
    await withTransaction(async (client) => {
      await client.query('DELETE FROM bid_allowances WHERE bid_id = $1', [bid.id]);
      for (const allowance of allowances as { label: string; amountCents: number }[]) {
        await client.query('INSERT INTO bid_allowances (id, bid_id, label, amount_cents) VALUES ($1,$2,$3,$4)', [randomUUID(), bid.id, allowance.label, allowance.amountCents]);
      }
      for (const price of exclusionPrices as { exclusionId: string; priceCents: number }[]) {
        await client.query('UPDATE bid_exclusions SET price_cents = $1 WHERE id = $2 AND bid_id = $3', [price.priceCents, price.exclusionId, bid.id]);
      }
    });
    const levelling = await levellingPayload(tender);
    res.json({ bid: levelling.bids.find((b) => b.id === bid.id) });
  }));

  router.get('/api/tenders/:id/levelling.csv', wrap(async (req, res) => {
    const member = req.member!;
    if (!STUDIO_ROLES.includes(member.role)) throw notFound();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    await tenderProject(req, tender);
    if (tender.status !== 'opened' && tender.status !== 'awarded') throw new ApiError(409, { error: 'tender_not_opened' });
    const levelling = await levellingPayload(tender);
    const project = await one<{ region: 'HK' | 'SG' | 'MO' }>('SELECT region FROM projects WHERE id = $1', [tender.project_id]);
    const lines = ['rank,bidder_reference,company,base,provisional_sums,allowances,priced_exclusions,unpriced_exclusions,subtotal,contingency,levelled_total,final_submission,provisional_sum_labels,exclusion_labels'];
    for (const bid of levelling.bids) {
      lines.push(
        [
          bid.rank,
          bid.reference,
          bid.companyName,
          centsToWireDecimal(bid.baseCents),
          centsToWireDecimal(bid.provisionalSumsCents),
          centsToWireDecimal(bid.allowancesCents),
          centsToWireDecimal(bid.pricedExclusionsCents),
          bid.unpricedExclusions,
          centsToWireDecimal(bid.subtotalCents),
          centsToWireDecimal(bid.contingencyCents),
          centsToWireDecimal(bid.levelledTotalCents),
          instantText(new Date(bid.finalSubmittedAt), project!.region),
          bid.provisionalSums.map((p) => p.label).join('; '),
          bid.exclusions.map((e) => e.label).join('; '),
        ].map((cell) => (typeof cell === 'number' ? String(cell) : csvCell(String(cell)))).join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(lines.join('\r\n') + '\r\n');
  }));

  router.post('/api/tenders/:id/award', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!STUDIO_EDIT_ROLES.includes(member.role)) throw forbidden();
    const tender = await tenderById(req.params.id);
    if (!tender) throw notFound();
    const project = await tenderProject(req, tender);
    if (tender.status !== 'opened') throw illegalTransition(tender.status, 'award');
    if (project.contractCompany) throw conflict('contract_exists');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const bidId = typeof body.bidId === 'string' ? body.bidId : '';
    const reason = typeof body.reason === 'string' ? body.reason : '';
    const levelling = await levellingPayload(tender);
    const target = levelling.bids.find((b) => b.id === bidId);
    if (!target) throw notFound();
    const unpriced = levelling.bids.reduce((sum, b) => sum + b.unpricedExclusions, 0);
    if (unpriced > 0) throw new ApiError(409, { error: 'unpriced_exclusions', count: unpriced });
    if (target.rank !== 1 && !reason) throw validationError({ reason: FIELD_ERRORS.awardReasonMissing });
    const bidder = await one<{ company_name: string }>('SELECT company_name FROM bidders WHERE id = $1', [target.bidderId]);
    const company = await one<{ id: string }>('SELECT id FROM companies WHERE lower(name) = lower($1)', [bidder!.company_name]);
    let companyId = company?.id ?? null;
    if (!companyId) {
      const newId = randomUUID();
      await query('INSERT INTO companies (id, name) VALUES ($1,$2)', [newId, bidder!.company_name]);
      companyId = newId;
    }
    await withTransaction(async (client) => {
      await client.query("UPDATE tenders SET status = 'awarded', awarded_bid_id = $1, award_reason = $2 WHERE id = $3", [bidId, reason || null, tender.id]);
      await client.query('UPDATE projects SET contract_company = $1, contract_sum_cents = $2, contract_awarded_at = now() WHERE id = $3', [
        companyId,
        target.baseCents,
        tender.project_id,
      ]);
    });
    res.json({ tender: await studioTenderPayload(tender.id), contract: { companyName: bidder!.company_name, contractSumCents: target.baseCents } });
  }));

  return router;
}

function csvCell(value: string): string {
  // Neutralise text cells starting with a formula character, then quote per RFC 4180.
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized;
}

async function ensureContractorMember(client: import('pg').PoolClient, companyName: string, email: string): Promise<string> {
  const existing = (await client.query<{ id: string }>('SELECT id FROM members WHERE lower(email) = $1', [email.toLowerCase()])).rows[0];
  if (existing) return existing.id;
  const companyIdRow = (
    await client.query<{ id: string }>('SELECT id FROM companies WHERE lower(name) = lower($1)', [companyName])
  ).rows[0];
  let companyId = companyIdRow?.id ?? null;
  if (!companyId) {
    const newId = randomUUID();
    await client.query('INSERT INTO companies (id, name) VALUES ($1,$2)', [newId, companyName]);
    companyId = newId;
  }
  const memberId = randomUUID();
  await client.query(
    "INSERT INTO members (id, email, name, role, company_id) VALUES ($1,$2,$3,'contractor',$4)",
    [memberId, email.toLowerCase(), '', companyId],
  );
  return memberId;
}

async function saveBid(
  tender: TenderRow,
  bidderId: string,
  body: Record<string, unknown>,
  isAmendment: boolean,
): Promise<Record<string, unknown> | null> {
  const errors: Record<string, string> = {};
  const baseCents = body.baseCents;
  if (typeof baseCents !== 'number' || !Number.isInteger(baseCents) || baseCents < 1 || baseCents > 99_999_999_999) {
    errors.baseCents = FIELD_ERRORS.amountFormat('Base amount');
  }
  const provisionalSums = Array.isArray(body.provisionalSums) ? (body.provisionalSums as Record<string, unknown>[]) : [];
  if (provisionalSums.length > 50) errors.provisionalSums = FIELD_ERRORS.range('Provisional sums', '0 and 50');
  let provisionalTotal = 0;
  const provisionalRows: { label: string; amountCents: number }[] = [];
  provisionalSums.forEach((sum, index) => {
    const label = requireString(sum.label, `provisionalSums[${index}].label`, 'Provisional sum label', errors);
    if (label) checkLength(label, `provisionalSums[${index}].label`, 'Provisional sum label', 120, errors);
    const amount = sum.amountCents;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 99_999_999_999) {
      errors[`provisionalSums[${index}].amountCents`] = FIELD_ERRORS.amountFormat('Provisional sum amount');
    } else {
      provisionalTotal += amount;
      provisionalRows.push({ label, amountCents: amount });
    }
  });
  if (typeof baseCents === 'number' && provisionalTotal > baseCents) {
    errors.provisionalSums = FIELD_ERRORS.provisionalOverBase;
  }
  const exclusions = Array.isArray(body.exclusions) ? (body.exclusions as Record<string, unknown>[]) : [];
  if (exclusions.length > 50) errors.exclusions = FIELD_ERRORS.range('Exclusions', '0 and 50');
  const exclusionRows: { label: string }[] = [];
  exclusions.forEach((exclusion, index) => {
    const label = requireString(exclusion.label, `exclusions[${index}].label`, 'Exclusion', errors);
    if (label) checkLength(label, `exclusions[${index}].label`, 'Exclusion', 200, errors);
    if (label) exclusionRows.push({ label });
  });
  throwValidation(errors);
  await withTransaction(async (client) => {
    if (isAmendment) {
      await client.query(
        "UPDATE bids SET base_cents = $1, provisional_sums = $2, submitted_at = now() WHERE tender_id = $3 AND bidder_id = $4",
        [baseCents, JSON.stringify(provisionalRows), tender.id, bidderId],
      );
      await client.query('DELETE FROM bid_exclusions WHERE bid_id = (SELECT id FROM bids WHERE tender_id = $1 AND bidder_id = $2)', [tender.id, bidderId]);
    } else {
      await client.query(
        'INSERT INTO bids (id, tender_id, bidder_id, base_cents, provisional_sums, submitted_at) VALUES ($1,$2,$3,$4,$5,now())',
        [randomUUID(), tender.id, bidderId, baseCents, JSON.stringify(provisionalRows)],
      );
    }
    const bidRow = (
      await client.query<{ id: string }>('SELECT id FROM bids WHERE tender_id = $1 AND bidder_id = $2', [tender.id, bidderId])
    ).rows[0];
    for (const [index, exclusion] of exclusionRows.entries()) {
      await client.query('INSERT INTO bid_exclusions (id, bid_id, label, position) VALUES ($1,$2,$3,$4)', [randomUUID(), bidRow.id, exclusion.label, index + 1]);
    }
  });
  return bidPayload(tender.id, bidderId);
}

async function bidPayload(tenderId: string, bidderId: string): Promise<Record<string, unknown> | null> {
  const bid = await one<{ id: string; base_cents: string; provisional_sums: unknown; submitted_at: Date }>(
    'SELECT id, base_cents, provisional_sums, submitted_at FROM bids WHERE tender_id = $1 AND bidder_id = $2',
    [tenderId, bidderId],
  );
  if (!bid) return null;
  const exclusions = await query<{ id: string; label: string; price_cents: string | null }>(
    'SELECT id, label, price_cents FROM bid_exclusions WHERE bid_id = $1 ORDER BY position',
    [bid.id],
  );
  return {
    id: bid.id,
    baseCents: parseInt(bid.base_cents, 10),
    provisionalSums: bid.provisional_sums,
    exclusions: exclusions.map((e) => ({ id: e.id, label: e.label })),
    finalSubmittedAt: bid.submitted_at.toISOString(),
    amendments: 0,
  };
}

async function studioTenderPayload(id: string): Promise<Record<string, unknown> | null> {
  const tender = await tenderById(id);
  if (!tender) return null;
  const project = await one<{ id: string; reference: string; name: string; region: 'HK' | 'SG' | 'MO' }>(
    'SELECT id, reference, name, region FROM projects WHERE id = $1',
    [tender.project_id],
  );
  const bidders = await query<{ id: string; reference: string; company_name: string; contact_name: string; contact_email: string; member_id: string | null }>(
    'SELECT id, reference, company_name, contact_name, contact_email, member_id FROM bidders WHERE tender_id = $1 ORDER BY position',
    [id],
  );
  const bidderList = [];
  for (const bidder of bidders) {
    const bid = await one<{ submitted_at: Date }>('SELECT submitted_at FROM bids WHERE tender_id = $1 AND bidder_id = $2', [id, bidder.id]);
    bidderList.push({
      reference: bidder.reference,
      companyName: bidder.company_name,
      contactName: bidder.contact_name,
      contactEmail: bidder.contact_email,
      hasBid: bid !== null,
      finalSubmittedAt: bid?.submitted_at.toISOString() ?? null,
    });
  }
  return {
    id: tender.id,
    title: tender.title,
    scope: tender.scope,
    project: project,
    closesAt: tender.closes_at?.toISOString() ?? null,
    closesAtLocal: tender.closes_at_local,
    timeZone: project!.region === 'SG' ? 'Asia/Singapore' : 'Asia/Hong_Kong',
    status: tender.status,
    contingencyPercent: (parseInt(tender.contingency_percent, 10) / 100).toFixed(2),
    icsSequence: tender.ics_sequence,
    bidders: bidderList,
    awardedBidId: tender.awarded_bid_id,
  };
}

/** The one place the levelled total is computed. */
export interface LevelledBidView {
  id: string;
  bidderId: string;
  reference: string;
  companyName: string;
  baseCents: number;
  provisionalSums: { label: string; amountCents: number }[];
  provisionalSumsCents: number;
  allowances: { label: string; amountCents: number }[];
  allowancesCents: number;
  exclusions: { id: string; label: string; priceCents: number | null }[];
  pricedExclusionsCents: number;
  unpricedExclusions: number;
  subtotalCents: number;
  contingencyCents: number;
  levelledTotalCents: number;
  finalSubmittedAt: string;
  rank: number;
}

export async function levellingPayload(tender: TenderRow): Promise<{
  contingencyPercent: string;
  currency: string;
  bids: LevelledBidView[];
}> {
  const project = await one<{ currency: string; region: string }>('SELECT currency, region FROM projects WHERE id = $1', [tender.project_id]);
  const bids = await query<{ id: string; bidder_id: string; base_cents: string; provisional_sums: { label: string; amountCents: number }[]; submitted_at: Date }>(
    'SELECT id, bidder_id, base_cents, provisional_sums, submitted_at FROM bids WHERE tender_id = $1',
    [tender.id],
  );
  const contingencyBasisPoints = parseInt(tender.contingency_percent, 10);
  interface LevelledBid {
    id: string;
    bidderId: string;
    reference: string;
    companyName: string;
    baseCents: number;
    provisionalSums: { label: string; amountCents: number }[];
    provisionalSumsCents: number;
    allowances: { label: string; amountCents: number }[];
    allowancesCents: number;
    exclusions: { id: string; label: string; priceCents: number | null }[];
    pricedExclusionsCents: number;
    unpricedExclusions: number;
    subtotalCents: number;
    contingencyCents: number;
    levelledTotalCents: number;
    finalSubmittedAt: string;
    rank: number;
  }
  const rows: LevelledBid[] = [];
  for (const bid of bids) {
    const bidder = await one<{ reference: string; company_name: string }>('SELECT reference, company_name FROM bidders WHERE id = $1', [bid.bidder_id]);
    const allowances = await query<{ label: string; amount_cents: string }>('SELECT label, amount_cents FROM bid_allowances WHERE bid_id = $1', [bid.id]);
    const exclusions = await query<{ id: string; label: string; price_cents: string | null }>('SELECT id, label, price_cents FROM bid_exclusions WHERE bid_id = $1 ORDER BY position', [bid.id]);
    const base = parseInt(bid.base_cents, 10);
    const provisionalSums = Array.isArray(bid.provisional_sums) ? bid.provisional_sums : [];
    const provisionalCents = provisionalSums.reduce((sum, p) => sum + (typeof p.amountCents === 'number' ? p.amountCents : parseInt(String(p.amountCents), 10)), 0);
    const allowanceCents = allowances.reduce((sum, a) => sum + parseInt(a.amount_cents, 10), 0);
    const pricedExclusionCents = exclusions.reduce((sum, e) => sum + (e.price_cents === null ? 0 : parseInt(e.price_cents, 10)), 0);
    const unpriced = exclusions.filter((e) => e.price_cents === null).length;
    const subtotal = base - provisionalCents + allowanceCents + pricedExclusionCents;
    const contingency = roundDivCents(BigInt(subtotal) * BigInt(contingencyBasisPoints), 10000n);
    const levelledTotal = subtotal + contingency;
    rows.push({
      id: bid.id,
      bidderId: bid.bidder_id,
      reference: bidder!.reference,
      companyName: bidder!.company_name,
      baseCents: base,
      provisionalSums,
      provisionalSumsCents: provisionalCents,
      allowances: allowances.map((a) => ({ label: a.label, amountCents: parseInt(a.amount_cents, 10) })),
      allowancesCents: allowanceCents,
      exclusions: exclusions.map((e) => ({ id: e.id, label: e.label, priceCents: e.price_cents === null ? null : parseInt(e.price_cents, 10) })),
      pricedExclusionsCents: pricedExclusionCents,
      unpricedExclusions: unpriced,
      subtotalCents: subtotal,
      contingencyCents: contingency,
      levelledTotalCents: levelledTotal,
      finalSubmittedAt: bid.submitted_at.toISOString(),
      rank: 0,
    });
  }
  // Rank: levelled total asc, ties to earlier submission, then lower bidder reference.
  rows.sort((a, b) => {
    const totalDiff = a.levelledTotalCents - b.levelledTotalCents;
    if (totalDiff !== 0) return totalDiff;
    const timeDiff = Date.parse(a.finalSubmittedAt) - Date.parse(b.finalSubmittedAt);
    if (timeDiff !== 0) return timeDiff;
    return a.reference < b.reference ? -1 : 1;
  });
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });
  return { contingencyPercent: (contingencyBasisPoints / 100).toFixed(2), currency: project!.currency, bids: rows };
}

/** Publish or move-close: one invitation per bidder with a sign-in link and an ICS. */
async function sendTenderInvitations(config: Config, tenderId: string, isMove: boolean): Promise<void> {
  const tender = await tenderById(tenderId);
  if (!tender || !tender.closes_at) return;
  const project = await one<{ reference: string; name: string; region: 'HK' | 'SG' | 'MO' }>(
    'SELECT reference, name, region FROM projects WHERE id = $1',
    [tender.project_id],
  );
  const bidders = await query<{ id: string; company_name: string; contact_name: string; contact_email: string }>(
    'SELECT id, company_name, contact_name, contact_email FROM bidders WHERE tender_id = $1 ORDER BY position',
    [tenderId],
  );
  const ics = buildIcs(
    `tender-${tenderId}@plumbline`,
    tender.ics_sequence,
    formatUtcCompact(tender.closes_at),
    `Tender closes: ${tender.title}`,
  );
  const closeText = instantText(tender.closes_at, project!.region);
  const messages: { to: string; subject: string; body: string; ics: string }[] = [];
  for (const bidder of bidders) {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + config.timing.tenderLinkTtl * 1000);
    await query('INSERT INTO tender_links (token, tender_id, bidder_id, expires_at) VALUES ($1,$2,$3,$4)', [token, tenderId, bidder.id, expiresAt]);
    if (isMove) {
      messages.push({
        to: bidder.contact_email,
        subject: `Tender close moved: ${tender.title}`,
        body: [
          `The tender ${tender.title} for ${project!.name} now closes at ${closeText}.`,
          `Continue here: ${config.baseUrl}/tender-sign-in/${token}`,
        ].join('\n'),
        ics,
      });
    } else {
      messages.push({
        to: bidder.contact_email,
        subject: `Invitation to tender: ${tender.title} for ${bidder.company_name}`,
        body: [
          `You are invited to tender: ${tender.title} for ${project!.reference}.`,
          `Project: ${project!.name}`,
          `Scope: ${tender.scope}`,
          `Close: ${closeText}`,
          `Sign in here (link works once, for ${Math.round(config.timing.tenderLinkTtl / 60)} minutes): ${config.baseUrl}/tender-sign-in/${token}`,
        ].join('\n'),
        ics,
      });
    }
  }
  await queueMany(messages);
}

export function tenderLinksPublicRouter(config: Config): Router {
  const router = Router();
  router.post('/api/tender-links/consume', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token : '';
    const link = await one<{ tender_id: string; bidder_id: string; expires_at: Date; used_at: Date | null }>(
      'SELECT * FROM tender_links WHERE token = $1',
      [token],
    );
    if (!link || link.used_at || Date.now() > link.expires_at.getTime()) throw notFound();
    const tender = await tenderById(link.tender_id);
    if (!tender || tender.status === 'draft') throw notFound();
    const bidder = await one<{ member_id: string | null }>('SELECT member_id FROM bidders WHERE id = $1', [link.bidder_id]);
    if (!bidder?.member_id) throw notFound();
    const claimed = await query('UPDATE tender_links SET used_at = now() WHERE token = $1 AND used_at IS NULL RETURNING token', [token]);
    if (claimed.length === 0) throw notFound();
    const tokenValue = randomBytes(32).toString('base64url');
    await query('INSERT INTO sessions (token, member_id) VALUES ($1,$2)', [tokenValue, bidder.member_id]);
    res.setHeader('Set-Cookie', `plumbline_session=${tokenValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.timing.sessionIdleTimeout}`);
    res.json({ tenderId: link.tender_id });
  }));
  return router;
}
