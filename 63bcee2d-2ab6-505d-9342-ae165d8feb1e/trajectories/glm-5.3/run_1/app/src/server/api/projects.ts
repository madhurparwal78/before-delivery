// Projects, contracts, overview and the stage gate with sign-off,
// the Kill Bill invoice and the receipt mail.

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { one, query, withTransaction } from '../lib/db.js';
import { ApiError, conflict, forbidden, illegalTransition, notFound, validationError, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import { scopedProject, memberRow } from '../lib/scope.js';
import { checkLength, requireString, throwValidation, wrap } from './helpers.js';
import { amountText } from '../lib/money.js';
import { instantText } from '../lib/time.js';
import type { Config } from '../lib/config.js';
import type { KillBill } from '../lib/killbill.js';
import { STUDIO_ROLES } from '../lib/types.js';

export const STAGE_KEYS = ['groundwork', 'scheme', 'detailing', 'tender_award', 'build', 'handover', 'aftercare'] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export const STAGE_NAMES: Record<StageKey, string> = {
  groundwork: 'Groundwork',
  scheme: 'Scheme',
  detailing: 'Detailing',
  tender_award: 'Tender & Award',
  build: 'Build',
  handover: 'Handover',
  aftercare: 'Aftercare',
};
const FEE_STAGES: StageKey[] = STAGE_KEYS.slice(0, 6) as StageKey[];

export interface ApiServices {
  killbill: KillBill;
}

interface ProjectBase {
  id: string;
  reference: string;
  name: string;
  brand_id: string;
  brand_name: string;
  region: 'HK' | 'SG' | 'MO';
  currency: 'HKD' | 'SGD';
}

export async function memberSummaryOf(id: string): Promise<{ id: string; name: string; role: string; organisation: string }> {
  const row = await memberRow(id);
  if (!row) return { id, name: 'Someone', role: 'designer', organisation: 'Marrow Hall Interiors' };
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    organisation:
      row.role === 'client_approver' ? row.brand_name ?? '' : row.role === 'contractor' ? row.company_name ?? '' : 'Marrow Hall Interiors',
  };
}

async function currentStageOf(projectId: string): Promise<string> {
  const rows = await query<{ key: string; state: string }>(
    "SELECT key, state FROM stages WHERE project_id = $1 ORDER BY position",
    [projectId],
  );
  for (const row of rows) {
    if (row.key !== 'aftercare' && row.state !== 'signed_off') return row.key;
  }
  return 'aftercare';
}

export async function projectsVisibleTo(member: {
  role: string;
  brandId: string | null;
  companyId: string | null;
}): Promise<ProjectBase[]> {
  const rows = await query<ProjectBase>(
    `SELECT p.id, p.reference, p.name, p.brand_id, b.name AS brand_name, p.region, p.currency
     FROM projects p JOIN brands b ON b.id = p.brand_id ORDER BY p.ref_seq`,
  );
  if (STUDIO_ROLES.includes(member.role as never)) return rows;
  if (member.role === 'client_approver') return rows.filter((r) => r.brand_id === member.brandId);
  if (member.role === 'contractor') {
    const held = await query<{ id: string }>('SELECT id FROM projects WHERE contract_company = $1', [member.companyId]);
    const ids = new Set(held.map((r) => r.id));
    return rows.filter((r) => ids.has(r.id));
  }
  return [];
}

export function projectsRouter(config: Config, services: ApiServices): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  router.get('/api/overview', wrap(async (req, res) => {
    const member = req.member!;
    const projects = await projectsVisibleTo(member);
    const rows: Record<string, unknown>[] = [];
    for (const project of projects) {
      const currentStage = await currentStageOf(project.id);
      const base = {
        id: project.id,
        reference: project.reference,
        name: project.name,
        brand: { id: project.brand_id, name: project.brand_name },
        region: project.region,
        currentStage,
      };
      if (STUDIO_ROLES.includes(member.role)) {
        const stages = await query<{ key: string; state: string; fee_cents: string | null }>(
          "SELECT key, state, fee_cents FROM stages WHERE project_id = $1 AND key != 'aftercare' ORDER BY position",
          [project.id],
        );
        const signedOff = stages.filter((s) => s.state === 'signed_off').reduce((sum, s) => sum + parseInt(s.fee_cents ?? '0', 10), 0);
        const requested = stages.filter((s) => s.state === 'requested').reduce((sum, s) => sum + parseInt(s.fee_cents ?? '0', 10), 0);
        const notYet = stages.filter((s) => s.state === 'not_started' || s.state === 'returned').reduce((sum, s) => sum + parseInt(s.fee_cents ?? '0', 10), 0);
        const retention = await one<{ total: string }>(
          `SELECT COALESCE(SUM(CASE WHEN e.account = 'retention_held' AND e.side = 'credit' THEN e.amount_cents ELSE -e.amount_cents END), 0)::text AS total
           FROM retention_entries e JOIN retention_movements m ON m.id = e.movement_id WHERE m.project_id = $1`,
          [project.id],
        );
        rows.push({
          ...base,
          currency: project.currency,
          fees: { signedOffCents: signedOff, requestedCents: requested, notYetRequestedCents: notYet },
          retentionHeldCents: parseInt(retention?.total ?? '0', 10),
        });
      } else {
        rows.push(base);
      }
    }
    res.json({ projects: rows });
  }));

  router.post('/api/projects', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director' && member.role !== 'project_lead') throw forbidden();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const name = requireString(body.name, 'name', 'Name', errors);
    checkLength(name, 'name', 'Name', 120, errors);
    const brandId = requireString(body.brandId, 'brandId', 'Brand', errors);
    const region = typeof body.region === 'string' ? body.region : '';
    if (!['HK', 'SG', 'MO'].includes(region)) errors.region = FIELD_ERRORS.required('Region');
    const currency = typeof body.currency === 'string' ? body.currency : '';
    const expectedCurrency = region === 'SG' ? 'SGD' : 'HKD';
    if (currency !== expectedCurrency) errors.currency = FIELD_ERRORS.currencyMismatch;
    const stageFees = (body.stageFees ?? {}) as Record<string, unknown>;
    const defectsPeriodMonths =
      typeof body.defectsPeriodMonths === 'number' && Number.isInteger(body.defectsPeriodMonths) ? body.defectsPeriodMonths : 12;
    if (defectsPeriodMonths < 1 || defectsPeriodMonths > 24) errors.defectsPeriodMonths = FIELD_ERRORS.range('Defects period', '1 and 24 months');
    const fees: Partial<Record<StageKey, number>> = {};
    for (const key of FEE_STAGES) {
      const fee = stageFees[key];
      if (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 1 || fee > 99_999_999_999) {
        errors[`stageFees.${key}`] = FIELD_ERRORS.range('Stage fee', '1 and 99,999,999,999 cents');
      } else {
        fees[key] = fee;
      }
    }
    const stores = Array.isArray(body.stores) ? (body.stores as Record<string, unknown>[]) : [];
    if (stores.length < 1 || stores.length > 60) errors.stores = FIELD_ERRORS.range('Stores', '1 and 60');
    const seenCodes = new Set<string>();
    const storeRows: { code: string; name: string; weight: number }[] = [];
    stores.forEach((store, index) => {
      const code = typeof store.code === 'string' ? store.code : '';
      const storeName = typeof store.name === 'string' ? store.name : '';
      const weight = typeof store.weight === 'number' && Number.isInteger(store.weight) ? store.weight : NaN;
      if (!/^[A-Z0-9-]{1,16}$/.test(code) || seenCodes.has(code)) errors[`stores[${index}].code`] = FIELD_ERRORS.required('Store code');
      seenCodes.add(code);
      if (!storeName) errors[`stores[${index}].name`] = FIELD_ERRORS.required('Store name');
      if (!(weight >= 1 && weight <= 1_000_000)) errors[`stores[${index}].weight`] = FIELD_ERRORS.range('Store weight', '1 and 1,000,000');
      storeRows.push({ code, name: storeName, weight: Number.isFinite(weight) ? weight : 0 });
    });
    if (brandId) {
      const brand = await one('SELECT id FROM brands WHERE id = $1', [brandId]);
      if (!brand) throw notFound();
    }
    throwValidation(errors);
    const created = await withTransaction(async (client) => {
      const seqRow = await client.query<Record<'value', string>>(
        "INSERT INTO counter_state (name, value) VALUES ('project_seq', 2601) ON CONFLICT (name) DO UPDATE SET value = counter_state.value + 1 RETURNING value",
      );
      const seq = parseInt(seqRow.rows[0].value, 10);
      const reference = `MH-${seq.toString().padStart(4, '0')}`;
      const id = randomUUID();
      await client.query(
        `INSERT INTO projects (id, reference, name, brand_id, region, currency, ref_seq, defects_period_months)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, reference, name, brandId, region, expectedCurrency, seq, defectsPeriodMonths],
      );
      for (const store of storeRows) {
        await client.query('INSERT INTO stores (id, project_id, code, name, weight) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, store.code, store.name, store.weight]);
      }
      let position = 1;
      for (const key of STAGE_KEYS) {
        await client.query(
          'INSERT INTO stages (project_id, key, position, fee_cents) VALUES ($1,$2,$3,$4)',
          [id, key, position, key === 'aftercare' ? null : fees[key] ?? 0],
        );
        position += 1;
      }
      return id;
    });
    res.status(201).json({ project: await projectPayload(created) });
  }));

  router.get('/api/projects/:id', wrap(async (req, res) => {
    const project = await scopedProject(req, req.params.id);
    res.json({ project: await projectPayload(project.id) });
  }));

  router.post('/api/projects/:id/contract', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director' && member.role !== 'project_lead') throw forbidden();
    const project = await scopedProject(req, req.params.id);
    if (project.contractCompany) throw conflict('contract_exists');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const companyId = requireString(body.companyId, 'companyId', 'Company', errors);
    const contractSumCents = body.contractSumCents;
    if (typeof contractSumCents !== 'number' || !Number.isInteger(contractSumCents) || contractSumCents < 1 || contractSumCents > 99_999_999_999) {
      errors.contractSumCents = FIELD_ERRORS.amountFormat('Contract sum');
    }
    if (companyId) {
      const company = await one('SELECT id FROM companies WHERE id = $1', [companyId]);
      if (!company) throw notFound();
    }
    throwValidation(errors);
    await query(
      'UPDATE projects SET contract_company = $1, contract_sum_cents = $2, contract_awarded_at = now() WHERE id = $3',
      [companyId, contractSumCents, project.id],
    );
    res.status(201).json({ contract: await contractPayload(project.id) });
  }));

  // ---- Stages ----

  router.get('/api/projects/:id/stages', wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (member.role === 'contractor') throw forbidden();
    const rows = await query<{
      key: StageKey; fee_cents: string | null; state: string;
      requested_at: Date | null; requested_by: string | null;
      signed_off_at: Date | null; signed_off_by: string | null; returned_reason: string | null;
      internal_note: string | null; killbill_invoice_id: string | null; invoice_number: string | null; invoice_amount_cents: string | null;
    }>('SELECT * FROM stages WHERE project_id = $1 ORDER BY position', [project.id]);
    const stages = [];
    for (const row of rows) {
      const entry: Record<string, unknown> = {
        key: row.key,
        name: STAGE_NAMES[row.key],
        feeCents: row.fee_cents === null ? null : parseInt(row.fee_cents, 10),
        currency: project.currency,
        state: row.state,
        requestedAt: row.requested_at?.toISOString() ?? null,
        requestedBy: row.requested_by ? await memberSummaryOf(row.requested_by) : null,
        signedOffAt: row.signed_off_at?.toISOString() ?? null,
        signedOffBy: row.signed_off_by ? await memberSummaryOf(row.signed_off_by) : null,
        returnedReason: row.returned_reason,
        invoice: row.killbill_invoice_id
          ? {
              killbillInvoiceId: row.killbill_invoice_id,
              invoiceNumber: row.invoice_number,
              amountCents: parseInt(row.invoice_amount_cents ?? '0', 10),
              currency: project.currency,
            }
          : null,
      };
      if (STUDIO_ROLES.includes(member.role)) entry.internalNote = row.internal_note;
      stages.push(entry);
    }
    res.json({ stages });
  }));

  router.patch('/api/projects/:id/stages/:key', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director' && member.role !== 'project_lead') throw forbidden();
    const project = await scopedProject(req, req.params.id);
    const key = req.params.key as StageKey;
    if (!STAGE_KEYS.includes(key)) throw notFound();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const note = typeof body.internalNote === 'string' ? body.internalNote : '';
    if ([...note].length > 1000) throw validationError({ internalNote: FIELD_ERRORS.tooLong('Internal note', 1000) });
    await query('UPDATE stages SET internal_note = $1 WHERE project_id = $2 AND key = $3', [note, project.id, key]);
    res.json({ stage: await stagePayload(project, key) });
  }));

  router.post('/api/projects/:id/stages/:key/request', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director' && member.role !== 'project_lead') throw forbidden();
    const project = await scopedProject(req, req.params.id);
    const key = req.params.key as StageKey;
    if (!STAGE_KEYS.includes(key) || key === 'aftercare') throw notFound();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message : '';
    if ([...message].length > 1000) throw validationError({ message: FIELD_ERRORS.tooLong('Message to approvers', 1000) });
    await withTransaction(async (client) => {
      const row = (
        await client.query('SELECT state FROM stages WHERE project_id = $1 AND key = $2 FOR UPDATE', [project.id, key])
      ).rows[0] as { state: string } | undefined;
      if (!row) throw notFound();
      if (row.state !== 'not_started' && row.state !== 'returned') throw illegalTransition(row.state, 'request');
      for (const earlier of FEE_STAGES) {
        if (earlier === key) break;
        const earlierRow = (
          await client.query('SELECT state FROM stages WHERE project_id = $1 AND key = $2', [project.id, earlier])
        ).rows[0] as { state: string } | undefined;
        if (earlierRow && earlierRow.state !== 'signed_off') {
          throw new ApiError(409, { error: 'previous_stage_open', stage: earlier });
        }
      }
      await client.query(
        "UPDATE stages SET state = 'requested', requested_at = now(), requested_by = $1, requested_message = $2 WHERE project_id = $3 AND key = $4",
        [member.id, message, project.id, key],
      );
    });
    res.json({ stage: await stagePayload(project, key) });
  }));

  router.post('/api/projects/:id/stages/:key/sign-off', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (member.role !== 'client_approver' || member.brandId !== project.brandId) throw forbidden();
    const key = req.params.key as StageKey;
    if (!STAGE_KEYS.includes(key) || key === 'aftercare') throw notFound();
    await signOffStage(services, project, key, member);
    res.json({ stage: await stagePayload(project, key) });
  }));

  router.post('/api/projects/:id/stages/:key/return', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (member.role !== 'client_approver' || member.brandId !== project.brandId) throw forbidden();
    const key = req.params.key as StageKey;
    if (!STAGE_KEYS.includes(key) || key === 'aftercare') throw notFound();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const reason = requireString(body.reason, 'reason', 'Reason', errors);
    if (reason) checkLength(reason, 'reason', 'Reason', 1000, errors);
    throwValidation(errors);
    await withTransaction(async (client) => {
      const row = (
        await client.query('SELECT state FROM stages WHERE project_id = $1 AND key = $2 FOR UPDATE', [project.id, key])
      ).rows[0] as { state: string } | undefined;
      if (!row) throw notFound();
      if (row.state !== 'requested') throw illegalTransition(row.state, 'return');
      await client.query(
        "UPDATE stages SET state = 'returned', returned_reason = $1 WHERE project_id = $2 AND key = $3",
        [reason, project.id, key],
      );
    });
    res.json({ stage: await stagePayload(project, key) });
  }));

  return router;
}

/** The sign-off unit: lock, invoice, record, receipt — all or nothing. */
export async function signOffStage(
  services: ApiServices,
  project: { id: string; reference: string; name: string; brandName: string; region: 'HK' | 'SG' | 'MO'; currency: 'HKD' | 'SGD' },
  key: StageKey,
  member: { id: string; name: string; email: string },
): Promise<void> {
  await withTransaction(async (client) => {
    const row = (
      await client.query('SELECT state, fee_cents FROM stages WHERE project_id = $1 AND key = $2 FOR UPDATE', [project.id, key])
    ).rows[0] as { state: string; fee_cents: string | null } | undefined;
    if (!row) throw notFound();
    if (row.state === 'signed_off') {
      const winner = await one<{ name: string; signed_off_at: Date }>(
        'SELECT m.name, s.signed_off_at FROM stages s JOIN members m ON m.id = s.signed_off_by WHERE s.project_id = $1 AND s.key = $2',
        [project.id, key],
      );
      throw new ApiError(409, {
        error: 'already_signed_off',
        by: winner?.name ?? 'Someone',
        at: winner?.signed_off_at?.toISOString() ?? new Date().toISOString(),
      });
    }
    if (row.state !== 'requested') throw illegalTransition(row.state, 'sign_off');
    const feeCents = parseInt(row.fee_cents ?? '0', 10);
    const externalKey = `plumbline-${project.reference}`;
    const stored = (
      await client.query<{ kb_account_id: string | null }>('SELECT kb_account_id FROM projects WHERE id = $1', [project.id])
    ).rows[0] as { kb_account_id: string | null };
    let accountId = stored?.kb_account_id ?? null;
    if (!accountId) {
      const account = await services.killbill.findAccount(externalKey);
      accountId = account
        ? account.accountId
        : await services.killbill.createAccount(externalKey, `${project.brandName} - ${project.name}`, project.currency);
      await client.query('UPDATE projects SET kb_account_id = $1 WHERE id = $2', [accountId, project.id]);
    }
    // Raise the invoice before recording; if Kill Bill fails the stage stays requested (503).
    const invoice = await services.killbill.raiseStageInvoice(
      accountId,
      `${project.reference} ${STAGE_NAMES[key]} stage fee`,
      feeCents,
      project.currency,
    );
    try {
      const now = new Date();
      await client.query(
        "UPDATE stages SET state = 'signed_off', signed_off_at = now(), signed_off_by = $1, killbill_invoice_id = $2, invoice_number = $3, invoice_amount_cents = $4 WHERE project_id = $5 AND key = $6",
        [member.id, invoice.killbillInvoiceId, invoice.invoiceNumber, feeCents, project.id, key],
      );
      await client.query('INSERT INTO outbox (id, to_email, subject, body) VALUES ($1,$2,$3,$4)', [
        randomUUID(),
        member.email,
        `Signed off: ${project.reference} ${STAGE_NAMES[key]}`,
        [
          `You signed off the ${STAGE_NAMES[key]} stage of ${project.name}.`,
          `Stage fee: ${amountText(project.currency, feeCents)}`,
          `Invoice: ${invoice.invoiceNumber}`,
          `Signed by ${member.name} at ${instantText(now, project.region)}.`,
        ].join('\n'),
      ]);
    } catch (error) {
      await services.killbill.voidInvoice(invoice.killbillInvoiceId);
      throw error;
    }
  });
}

export async function stagePayload(
  project: { id: string; currency: string },
  key: StageKey,
): Promise<Record<string, unknown> | null> {
  const row = await one<{
    key: StageKey; fee_cents: string | null; state: string;
    requested_at: Date | null; requested_by: string | null; requested_message: string | null;
    signed_off_at: Date | null; signed_off_by: string | null; returned_reason: string | null;
    internal_note: string | null; killbill_invoice_id: string | null; invoice_number: string | null; invoice_amount_cents: string | null;
  }>('SELECT * FROM stages WHERE project_id = $1 AND key = $2', [project.id, key]);
  if (!row) return null;
  return {
    key: row.key,
    name: STAGE_NAMES[row.key],
    feeCents: row.fee_cents === null ? null : parseInt(row.fee_cents, 10),
    currency: project.currency,
    state: row.state,
    requestedAt: row.requested_at?.toISOString() ?? null,
    requestedBy: row.requested_by ? await memberSummaryOf(row.requested_by) : null,
    signedOffAt: row.signed_off_at?.toISOString() ?? null,
    signedOffBy: row.signed_off_by ? await memberSummaryOf(row.signed_off_by) : null,
    returnedReason: row.returned_reason,
    internalNote: row.internal_note,
    invoice: row.killbill_invoice_id
      ? {
          killbillInvoiceId: row.killbill_invoice_id,
          invoiceNumber: row.invoice_number,
          amountCents: parseInt(row.invoice_amount_cents ?? '0', 10),
          currency: project.currency,
        }
      : null,
  };
}

export async function projectPayload(id: string): Promise<Record<string, unknown> | null> {
  const row = await one<{
    id: string; reference: string; name: string; brand_id: string; brand_name: string; region: 'HK' | 'SG' | 'MO';
    currency: 'HKD' | 'SGD'; defects_period_months: number; practical_completion_on: string | null; defects_end_on: string | null;
    contract_company: string | null; contract_sum_cents: string | null; contract_company_name: string | null;
  }>(
    `SELECT p.*, b.name AS brand_name, c.name AS contract_company_name
     FROM projects p JOIN brands b ON b.id = p.brand_id LEFT JOIN companies c ON c.id = p.contract_company WHERE p.id = $1`,
    [id],
  );
  if (!row) return null;
  const stores = await query<{ id: string; code: string; name: string; weight: number }>(
    'SELECT id, code, name, weight FROM stores WHERE project_id = $1 ORDER BY code',
    [id],
  );
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    brand: { id: row.brand_id, name: row.brand_name },
    region: row.region,
    currency: row.currency,
    timeZone: row.region === 'SG' ? 'Asia/Singapore' : 'Asia/Hong_Kong',
    defectsPeriodMonths: row.defects_period_months,
    practicalCompletionOn: row.practical_completion_on,
    defectsEndOn: row.defects_end_on,
    stores: stores.map((store) => ({ id: store.id, code: store.code, name: store.name, weight: store.weight })),
    contract: row.contract_company
      ? { companyName: row.contract_company_name, contractSumCents: parseInt(row.contract_sum_cents ?? '0', 10) }
      : null,
  };
}

export async function contractPayload(id: string): Promise<Record<string, unknown> | null> {
  const row = await one<{ contract_company: string | null; contract_sum_cents: string | null; contract_company_name: string | null }>(
    `SELECT p.contract_company, p.contract_sum_cents, c.name AS contract_company_name
     FROM projects p LEFT JOIN companies c ON c.id = p.contract_company WHERE p.id = $1`,
    [id],
  );
  if (!row?.contract_company) return null;
  return { companyName: row.contract_company_name, contractSumCents: parseInt(row.contract_sum_cents ?? '0', 10) };
}

export { FEE_STAGES };
export type { PoolClient };
