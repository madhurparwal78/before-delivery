// Certificates, retention and the per-store split.

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { one, query, withTransaction } from '../lib/db.js';
import { ApiError, conflict, forbidden, illegalTransition, notFound, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import { scopedProject } from '../lib/scope.js';
import { requireString, throwValidation, wrap } from './helpers.js';
import { fivePercentOfCents, halfOfCents, splitByWeight, tenPercentOfCents } from '../lib/money.js';
import { defectsEndOn, hkToday } from '../lib/time.js';
import type { Config } from '../lib/config.js';

interface CertificateRow {
  id: string;
  project_id: string;
  number: string;
  kind: 'interim' | 'retention_release_half' | 'retention_release_final';
  period_ending: string | null;
  gross_valuation_cents: string | null;
  valuation_this_period_cents: string;
  retention_this_period_cents: string;
  retention_held_cents: string;
  amount_due_cents: string;
  issued_by: string;
  issued_at: Date;
  store_split: { storeCode: string; storeName: string; weight: number; amountCents: number }[];
}

async function certificatePayload(row: CertificateRow, currency: string): Promise<Record<string, unknown>> {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    periodEnding: row.period_ending,
    grossValuationCents: row.gross_valuation_cents === null ? null : parseInt(row.gross_valuation_cents, 10),
    valuationThisPeriodCents: parseInt(row.valuation_this_period_cents, 10),
    retentionThisPeriodCents: parseInt(row.retention_this_period_cents, 10),
    retentionHeldCents: parseInt(row.retention_held_cents, 10),
    amountDueCents: parseInt(row.amount_due_cents, 10),
    currency,
    storeSplit: row.store_split,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at.toISOString(),
  };
}

async function retentionHeldCents(projectId: string): Promise<number> {
  const row = await one<{ total: string }>(
    `SELECT COALESCE(SUM(CASE WHEN e.account = 'retention_held' AND e.side = 'credit' THEN e.amount_cents ELSE -e.amount_cents END), 0)::text AS total
     FROM retention_entries e JOIN retention_movements m ON m.id = e.movement_id WHERE m.project_id = $1`,
    [projectId],
  );
  return parseInt(row?.total ?? '0', 10);
}

/** Post one balanced debit/credit pair for a retention movement. */
async function postRetentionPair(
  client: PoolClient,
  projectId: string,
  certificateId: string,
  kind: 'hold' | 'release_half' | 'release_final',
  amountCents: number,
): Promise<void> {
  if (amountCents === 0) return;
  const movementId = randomUUID();
  await client.query(
    'INSERT INTO retention_movements (id, project_id, certificate_id, kind, amount_cents) VALUES ($1,$2,$3,$4,$5)',
    [movementId, projectId, certificateId, kind, amountCents],
  );
  const entries: { account: 'contractor_payable' | 'retention_held'; side: 'debit' | 'credit' }[] =
    kind === 'hold'
      ? [
          { account: 'contractor_payable', side: 'debit' },
          { account: 'retention_held', side: 'credit' },
        ]
      : [
          { account: 'retention_held', side: 'debit' },
          { account: 'contractor_payable', side: 'credit' },
        ];
  for (const entry of entries) {
    await client.query('INSERT INTO retention_entries (id, movement_id, account, side, amount_cents) VALUES ($1,$2,$3,$4,$5)', [
      randomUUID(),
      movementId,
      entry.account,
      entry.side,
      amountCents,
    ]);
  }
}

async function nextCertificateNumber(client: PoolClient, projectId: string, kind: 'interim' | 'release'): Promise<string> {
  const prefix = kind === 'interim' ? 'PC' : 'RR';
  const name = `certificate_seq_${prefix}_${projectId}`;
  const seqRow = await client.query<Record<'value', string>>(
    `INSERT INTO counter_state (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = counter_state.value + 1 RETURNING value`,
    [name],
  );
  return `${prefix}-${parseInt(seqRow.rows[0].value, 10).toString().padStart(2, '0')}`;
}

export function certificatesRouter(config: Config): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  router.get('/api/projects/:id/certificates', wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (member.role === 'client_approver' && member.brandId !== project.brandId) throw notFound();
    const rows = await query<CertificateRow>(
      'SELECT * FROM certificates WHERE project_id = $1 ORDER BY issued_at',
      [project.id],
    );
    res.json({ certificates: await Promise.all(rows.map((row) => certificatePayload(row, project.currency))) });
  }));

  router.post('/api/projects/:id/certificates', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director' && member.role !== 'project_lead') throw forbidden();
    const project = await scopedProject(req, req.params.id);
    if (!project.contractCompany) throw conflict('no_contract');
    const contractSumCents = project.contractSumCents!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const periodEnding = requireString(body.periodEnding, 'periodEnding', 'Period ending', errors);
    if (periodEnding && !/^\d{4}-\d{2}-\d{2}$/.test(periodEnding)) errors.periodEnding = 'Period ending must be a date.';
    const gross = body.grossValuationCents;
    if (typeof gross !== 'number' || !Number.isInteger(gross) || gross < 0 || gross > 99_999_999_999) {
      errors.grossValuationCents = FIELD_ERRORS.amountFormat('Gross valuation to date');
    }
    const previous = await one<{ period_ending: string; gross_valuation_cents: string }>(
      "SELECT period_ending, gross_valuation_cents FROM certificates WHERE project_id = $1 AND kind = 'interim' ORDER BY issued_at DESC LIMIT 1",
      [project.id],
    );
    if (previous && periodEnding && periodEnding <= previous.period_ending) {
      errors.periodEnding = FIELD_ERRORS.periodNotAfter(previous.period_ending);
    }
    if (previous && typeof gross === 'number' && gross < parseInt(previous.gross_valuation_cents, 10)) {
      errors.grossValuationCents = FIELD_ERRORS.grossLower;
    }
    throwValidation(errors);
    const grossCents = gross as number;
    const issued = await withTransaction(async (client) => {
      const number = await nextCertificateNumber(client, project.id, 'interim');
      const previousGross = previous ? parseInt(previous.gross_valuation_cents, 10) : 0;
      const valuationThisPeriod = grossCents - previousGross;
      const held = await retentionHeldCents(project.id);
      const cap = fivePercentOfCents(contractSumCents);
      // Retention this period: the smaller of 10% of the period valuation (rounded)
      // and the cap minus retention already held. No holds after practical completion.
      let retentionThisPeriod = project.practicalCompletionOn
        ? 0
        : Math.min(tenPercentOfCents(valuationThisPeriod), Math.max(0, cap - held));
      const amountDue = valuationThisPeriod - retentionThisPeriod;
      const stores = (
        await client.query<{ code: string; name: string; weight: number }>('SELECT code, name, weight FROM stores WHERE project_id = $1 ORDER BY code', [project.id])
      ).rows;
      const storeSplit = splitByWeight(amountDue, stores.map((s) => ({ storeCode: s.code, storeName: s.name, weight: s.weight })));
      const id = randomUUID();
      await client.query(
        `INSERT INTO certificates (id, project_id, number, kind, period_ending, gross_valuation_cents, valuation_this_period_cents,
           retention_this_period_cents, retention_held_cents, amount_due_cents, issued_by, store_split)
         VALUES ($1,$2,$3,'interim',$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, project.id, number, periodEnding, grossCents, valuationThisPeriod, retentionThisPeriod, held + retentionThisPeriod, amountDue, member.id, JSON.stringify(storeSplit)],
      );
      await postRetentionPair(client, project.id, id, 'hold', retentionThisPeriod);
      return id;
    });
    const row = await one<CertificateRow>('SELECT * FROM certificates WHERE id = $1', [issued]);
    res.status(201).json({ certificate: await certificatePayload(row!, project.currency) });
  }));

  router.get('/api/certificates/:id', wrap(async (req, res) => {
    const row = await one<CertificateRow>('SELECT * FROM certificates WHERE id = $1', [req.params.id]);
    if (!row) throw notFound();
    const project = await scopedProject(req, row.project_id);
    res.json({ certificate: await certificatePayload(row, project.currency) });
  }));

  router.get('/api/certificates/:id/split.csv', wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'finance'].includes(member.role)) throw forbidden();
    const row = await one<CertificateRow>('SELECT * FROM certificates WHERE id = $1', [req.params.id]);
    if (!row) throw notFound();
    const project = await scopedProject(req, row.project_id);
    void project;
    const lines = ['store_code,store_name,weight,amount'];
    for (const part of row.store_split) {
      lines.push(`${part.storeCode},${part.storeName},${part.weight},${(part.amountCents / 100).toFixed(2)}`);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(lines.join('\r\n') + '\r\n');
  }));

  router.post('/api/projects/:id/practical-completion', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director' && member.role !== 'project_lead') throw forbidden();
    const project = await scopedProject(req, req.params.id);
    if (!project.contractCompany) throw conflict('no_contract');
    if (project.practicalCompletionOn) throw illegalTransition('practically_complete', 'record_practical_completion');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const date = requireString(body.date, 'date', 'Practical completion date', errors);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = 'Practical completion must be a date.';
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date > hkToday()) errors.date = FIELD_ERRORS.futureDate('Practical completion date');
    throwValidation(errors);
    const issued = await withTransaction(async (client) => {
      const defectsEnd = defectsEndOn(date, project.defectsPeriodMonths);
      await client.query('UPDATE projects SET practical_completion_on = $1, defects_end_on = $2 WHERE id = $3', [date, defectsEnd, project.id]);
      // Half release: half of the retention held, rounded.
      const held = await retentionHeldCents(project.id);
      const release = halfOfCents(held);
      const number = await nextCertificateNumber(client, project.id, 'release');
      const stores = (
        await client.query<{ code: string; name: string; weight: number }>('SELECT code, name, weight FROM stores WHERE project_id = $1 ORDER BY code', [project.id])
      ).rows;
      const storeSplit = splitByWeight(release, stores.map((s) => ({ storeCode: s.code, storeName: s.name, weight: s.weight })));
      const id = randomUUID();
      await client.query(
        `INSERT INTO certificates (id, project_id, number, kind, valuation_this_period_cents, retention_this_period_cents,
           retention_held_cents, amount_due_cents, issued_by, store_split)
         VALUES ($1,$2,$3,'retention_release_half',0,0,$4,$5,$6,$7)`,
        [id, project.id, number, held - release, release, member.id, JSON.stringify(storeSplit)],
      );
      await postRetentionPair(client, project.id, id, 'release_half', release);
      return id;
    });
    const row = await one<CertificateRow>('SELECT * FROM certificates WHERE id = $1', [issued]);
    res.status(201).json({ certificate: await certificatePayload(row!, project.currency) });
  }));

  router.post('/api/projects/:id/retention/final-release', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director' && member.role !== 'project_lead') throw forbidden();
    const project = await scopedProject(req, req.params.id);
    if (!project.contractCompany) throw conflict('no_contract');
    if (!project.practicalCompletionOn) throw illegalTransition('not_practically_complete', 'release_final_retention');
    const existing = await one<{ id: string }>(
      "SELECT id FROM certificates WHERE project_id = $1 AND kind = 'retention_release_final'",
      [project.id],
    );
    if (existing) throw illegalTransition('already_released', 'release_final_retention');
    const today = hkToday();
    // Allowed from the day after the defects end date.
    if (!project.defectsEndOn || today <= project.defectsEndOn) {
      throw new ApiError(409, { error: 'defects_period_running', defectsEndOn: project.defectsEndOn ?? today });
    }
    const issued = await withTransaction(async (client) => {
      const held = await retentionHeldCents(project.id);
      const number = await nextCertificateNumber(client, project.id, 'release');
      const stores = (
        await client.query<{ code: string; name: string; weight: number }>('SELECT code, name, weight FROM stores WHERE project_id = $1 ORDER BY code', [project.id])
      ).rows;
      const storeSplit = splitByWeight(held, stores.map((s) => ({ storeCode: s.code, storeName: s.name, weight: s.weight })));
      const id = randomUUID();
      await client.query(
        `INSERT INTO certificates (id, project_id, number, kind, valuation_this_period_cents, retention_this_period_cents,
           retention_held_cents, amount_due_cents, issued_by, store_split)
         VALUES ($1,$2,$3,'retention_release_final',0,0,0,$4,$5,$6)`,
        [id, project.id, number, held, member.id, JSON.stringify(storeSplit)],
      );
      await postRetentionPair(client, project.id, id, 'release_final', held);
      return id;
    });
    const row = await one<CertificateRow>('SELECT * FROM certificates WHERE id = $1', [issued]);
    res.status(201).json({ certificate: await certificatePayload(row!, project.currency) });
  }));

  router.get('/api/projects/:id/retention-ledger', wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'finance'].includes(member.role)) throw forbidden();
    const project = await scopedProject(req, req.params.id);
    const rows = await query<{
      id: string; movement_id: string; certificate_number: string; kind: string; account: string; side: string; amount_cents: string; posted_at: Date;
    }>(
      `SELECT e.id, e.movement_id, c.number AS certificate_number, m.kind, e.account, e.side, e.amount_cents, e.posted_at
       FROM retention_entries e
       JOIN retention_movements m ON m.id = e.movement_id
       JOIN certificates c ON c.id = m.certificate_id
       WHERE m.project_id = $1 ORDER BY e.posted_at, e.id`,
      [project.id],
    );
    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        movementId: row.movement_id,
        certificateNumber: row.certificate_number,
        kind: row.kind,
        account: row.account,
        side: row.side,
        amountCents: parseInt(row.amount_cents, 10),
        postedAt: row.posted_at.toISOString(),
      })),
      retentionHeldCents: await retentionHeldCents(project.id),
    });
  }));

  return router;
}
