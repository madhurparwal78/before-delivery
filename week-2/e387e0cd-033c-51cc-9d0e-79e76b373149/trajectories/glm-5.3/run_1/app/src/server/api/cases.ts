import { query, withTransaction } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, parseJsonBody, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace, getWorkspace, type Workspace } from './auth.js';
import { serialiseCase, amountString } from '../domain/case-body.js';
import { formatInstant, isStr, invalid, OPEN_STATUSES } from './helpers.js';
import type { CaseRecord } from './helpers.js';
import { caseExtras } from './case-extras.js';
import { parseDecimal, rescaleHalfUp, toCentsHalfUp, multiplyCents, isGreaterThanZero } from '../../shared/decimal.js';
import { ASSET_DECIMALS } from '../../shared/util.js';
import { config } from '../config.js';
import { sendMail } from '../services/smtp.js';
import { newToken } from '../domain/crypto.js';
import { formatDateTime, formatAmount, maskAddress } from '../../shared/util.js';

const ADDRESS_RE = /^lnl1[0-9a-z]{30}$/;

async function nextReference(wsSlug: string, prefix: string): Promise<string> {
  const r = await query<{ case_sequence: string }>('UPDATE workspaces SET case_sequence = case_sequence + 1 WHERE slug = $1 RETURNING case_sequence', [wsSlug]);
  return `${prefix}${Number(r.rows[0].case_sequence).toString().padStart(6, '0')}`;
}

async function loadCaseView(ctx: Ctx, wsSlug: string): Promise<{ row: CaseRecord; role: string }> {
  const r = await query<CaseRecord>(`SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = $1 AND c.workspace_slug = $2`, [ctx.params.id, wsSlug]);
  if (r.rows.length === 0) throw errors.notFound();
  return { row: r.rows[0], role: ctx.session?.role ?? 'compliance_officer' };
}

export async function listCases(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const show = ctx.query.get('show') ?? 'open';
  if (!['open', 'closed', 'archived'].includes(show)) invalid({ show: 'Choose open, closed or archived.' });
  let sql = `SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.workspace_slug = $1`;
  const params: unknown[] = [ws.slug];
  if (show === 'archived') sql += ' AND c.archived = true';
  else if (show === 'closed') sql += ' AND c.archived = false AND c.outcome IS NOT NULL';
  else sql += ` AND c.archived = false AND c.status = ANY($2)`;
  if (show === 'open') params.push(OPEN_STATUSES);
  sql += ' ORDER BY c.created_at DESC, c.reference';
  const r = await query<CaseRecord>(sql, params);
  const role = ctx.session?.role ?? 'compliance_officer';
  const now = new Date();
  const cases = await Promise.all(r.rows.map(async (row) => {
    const extras = await caseExtras(row, now);
    return serialiseCase(row, { role, now, digests: extras.digests, requestPage: extras.requestPage, review: extras.review });
  }));
  return jsonOk({ cases });
}

export async function getCase(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const { row } = await loadCaseView(ctx, ws.slug);
  if (row.archived) {
    return jsonOk({ case: { id: row.id, reference: row.reference, archived: true, archivedAt: row.archived_at !== null ? formatInstant(row.archived_at) : null, closedAt: row.closed_at !== null ? formatInstant(row.closed_at) : null } });
  }
  const extras = await caseExtras(row);
  return jsonOk({ case: serialiseCase(row, { role: ctx.session?.role ?? 'compliance_officer', digests: extras.digests, requestPage: extras.requestPage, review: extras.review }) });
}

async function workspaceFromSlug(slug: string): Promise<Workspace> {
  const ws = await getWorkspace(slug);
  if (ws === null) throw errors.notFound();
  return ws;
}

interface CounterpartyView { id: string; legal_name: string; lei: string; jurisdiction_code: string; licence_number: string; due_diligence: string; network: string; contact_email: string | null; signing_value: string | null }

interface RuleSnapshot { thresholdCents: number | null; ruleSince: string | null; hasRule: boolean }

async function workspaceRuleAt(wsSlug: string, jurisdictionCode: string): Promise<RuleSnapshot> {
  const r = await query<{ threshold_cents: string | null; in_force_since: string | null }>('SELECT threshold_cents, in_force_since FROM workspace_rules WHERE workspace_slug = $1 AND jurisdiction_code = $2', [wsSlug, jurisdictionCode]);
  if (r.rows.length === 0) return { thresholdCents: null, ruleSince: null, hasRule: false };
  const row = r.rows[0];
  if (row.threshold_cents === null || row.in_force_since === null) return { thresholdCents: null, ruleSince: null, hasRule: false };
  return { thresholdCents: Number(row.threshold_cents), ruleSince: row.in_force_since, hasRule: true };
}

export async function createCase(ctx: Ctx, partner: { label: string } | null = null): Promise<Response> {
  const ws = partner !== null && ctx.partnerKey !== null
    ? await workspaceFromSlug(ctx.partnerKey.workspaceSlug)
    : await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const fields: Record<string, string> = {};

  const asset = isStr(body.asset) ? body.asset : '';
  if (!Object.prototype.hasOwnProperty.call(ASSET_DECIMALS, asset)) fields.asset = 'Choose an asset.';
  const decimals = asset in ASSET_DECIMALS ? (ASSET_DECIMALS[asset as keyof typeof ASSET_DECIMALS] as number) : 0;
  let amount = null as null | ReturnType<typeof parseDecimal>;
  if (typeof body.amount === 'number') {
    fields.amount = 'Send the amount as a string.';
  } else if (isStr(body.amount)) {
    amount = parseDecimal(body.amount);
    if (amount === null || !isGreaterThanZero(amount) || (amount.scale > decimals && parseDecimal(body.amount)!.digits % 10n ** BigInt(amount.scale - decimals) !== 0n)) {
      fields.amount = `Enter an amount greater than zero with at most ${decimals} decimals.`;
    } else if (amount.scale > decimals) {
      fields.amount = `Enter an amount greater than zero with at most ${decimals} decimals.`;
    }
  } else {
    fields.amount = `Enter an amount greater than zero with at most ${decimals} decimals.`;
  }
  const destinationAddress = isStr(body.destinationAddress) ? body.destinationAddress : '';
  if (!ADDRESS_RE.test(destinationAddress)) fields.destinationAddress = 'Each address must be lnl1 followed by 30 lower-case letters or digits.';
  const customerId = isStr(body.customerId) ? body.customerId : '';
  if (customerId === '') fields.customerId = 'Choose a customer.';
  const beneficiaryName = isStr(body.beneficiaryName) ? body.beneficiaryName : '';
  if (codePointsOf(beneficiaryName) < 1 || codePointsOf(beneficiaryName) > 140) fields.beneficiaryName = "Enter the beneficiary's name.";
  if (Object.keys(fields).length > 0) invalid(fields);

  const customer = await query('SELECT id, name, identity_number, date_of_birth, deposit_address FROM customers WHERE id = $1 AND workspace_slug = $2', [customerId, ws.slug]);
  if (customer.rows.length === 0) invalid({ customerId: 'Choose a customer.' });
  const customerRow = customer.rows[0];

  // Fiat value: the exact product with the rate in force, rounded half up to the cent.
  const rateRow = await query<{ rate_cents: string }>('SELECT rate_cents FROM rates WHERE asset = $1 AND currency = $2', [asset, ws.currency]);
  const rateCents = BigInt(rateRow.rows[0].rate_cents);
  const scaled = rescaleHalfUp(amount!, decimals);
  const product = multiplyCents(scaled, rateCents);
  const fiatValueCents = toCentsHalfUp(product);

  // Path decision at creation, in order.
  const registry = await query<{ counterparty_id: string }>('SELECT counterparty_id FROM addresses WHERE workspace_slug = $1 AND address = $2', [ws.slug, destinationAddress]);
  let counterpartyId: string | null = null;
  if (registry.rows.length > 0) counterpartyId = registry.rows[0].counterparty_id;
  let counterparty: CounterpartyView | null = null;
  if (counterpartyId !== null) {
    const r = await query<CounterpartyView>('SELECT * FROM counterparties WHERE id = $1 AND workspace_slug = $2', [counterpartyId, ws.slug]);
    counterparty = r.rows[0] ?? null;
  }

  const now = new Date();

  if (counterparty !== null && counterparty.due_diligence === 'blocked') {
    throw errors.conflict('counterparty_blocked', 'This counterparty is Blocked. The withdrawal was not created.');
  }

  const confirmationLimit = BigInt(ws.confirmation_limit_cents);
  let path: string;
  let status: string;
  let ownershipRequired = false;
  let counterpartyRule: 'in_force' | 'no_rule' | null = null;
  let thresholdCents: number | null = null;
  let ruleSince: string | null = null;

  if (counterparty === null) {
    path = 'self_hosted';
    ownershipRequired = fiatValueCents > confirmationLimit;
    status = ownershipRequired ? 'awaiting_ownership' : 'cleared';
  } else if (counterparty.due_diligence === 'restricted') {
    path = 'review';
    status = 'in_review';
    counterpartyRule = await counterpartyHasRule(ws.slug, counterparty.jurisdiction_code as string) ? 'in_force' : 'no_rule';
    const snap = await workspaceRuleAt(ws.slug, counterparty.jurisdiction_code as string);
    thresholdCents = snap.thresholdCents;
    ruleSince = snap.ruleSince;
  } else {
    const snap = await workspaceRuleAt(ws.slug, ws.jurisdiction_code);
    thresholdCents = snap.thresholdCents;
    ruleSince = snap.ruleSince;
    if (snap.hasRule && fiatValueCents < snap.thresholdCents!) {
      path = 'below_threshold';
      status = 'cleared';
    } else {
      counterpartyRule = (await counterpartyHasRule(ws.slug, counterparty.jurisdiction_code as string)) ? 'in_force' : 'no_rule';
      if (counterpartyRule === 'no_rule') {
        path = 'sunrise';
        status = 'cleared';
      } else {
        path = 'counterparty';
        status = 'awaiting_answer';
      }
    }
  }

  const reference = await nextReference(ws.slug, ws.case_prefix);
  const id = `case-${newToken(10)}`;
  const dataSentAt = new Date(now.getTime());
  const counterpartyName = counterparty !== null ? counterparty.legal_name as string : null;
  const dataSentChannel = (path === 'counterparty' || path === 'sunrise') && counterparty !== null ? (counterparty.network === 'on_network' ? 'network' : 'request_page') : null;
  const actualDataSentAt = dataSentChannel !== null ? dataSentAt : null;
  const answerDueAt = path === 'counterparty' ? new Date(dataSentAt.getTime() + config.answerWindowSeconds * 1000) : null;

  await withTransaction(async (q) => {
    await q(
      `INSERT INTO cases (id, workspace_slug, reference, created_at, created_by_kind, created_by_name, asset, amount_digits, amount_scale, destination_address, sending_address, wallet,
        counterparty_id, counterparty_name_as_sent, counterparty_lei, counterparty_jurisdiction, counterparty_network, customer_id, originator_name, originator_identity, originator_dob,
        beneficiary_name, fiat_value_cents, currency, path, status, data_sent_channel, data_sent_at, answer_due_at, ownership_required, erased, erasure_status,
        decided_jurisdiction, decided_threshold_cents, decided_threshold_currency, decided_rule_since, decided_rate_cents, decided_confirmation_limit, decided_counterparty_name, decided_counterparty_rule)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,false,'not_due',$31,$32,$33,$34,$35,$36,$37,$38)`,
      [id, ws.slug, reference, now, partner !== null ? 'partner_key' : 'member', partner !== null ? partner.label : ctx.session!.name, asset,
       scaled.digits, scaled.scale, destinationAddress, ws.sending_address, counterparty === null ? 'self_hosted' : 'hosted',
       counterpartyId, counterpartyName, counterparty !== null ? counterparty.lei : null, counterparty !== null ? counterparty.jurisdiction_code : null,
       counterparty !== null ? counterparty.network : null, customerId, customerRow.name, customerRow.identity_number, customerRow.date_of_birth,
       beneficiaryName, fiatValueCents, ws.currency, path, status, dataSentChannel, actualDataSentAt, answerDueAt, ownershipRequired,
       ws.jurisdiction_code, thresholdCents === null ? null : BigInt(thresholdCents), thresholdCents === null ? null : ws.currency, ruleSince,
       rateCents, confirmationLimit, counterpartyName, counterpartyRule],
    );
    if (dataSentChannel === 'network') {
      await q('INSERT INTO metered_messages (id, workspace_slug, at, direction) VALUES ($1,$2,$3,$4)', [`m-${id}`, ws.slug, dataSentAt, 'sent']);
    }
  });

  if (dataSentChannel === 'request_page' && counterparty !== null) {
    await issueRequestPage(id, ws, counterparty.contact_email ?? '', dataSentAt, reference, asset, scaled, destinationAddress);
  }

  const view = await query<CaseRecord>(`SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = $1`, [id]);
  const createdExtras = await caseExtras(view.rows[0]);
  return jsonOk({ case: serialiseCase(view.rows[0], { role: ctx.session?.role ?? 'compliance_officer', digests: createdExtras.digests, requestPage: createdExtras.requestPage, review: createdExtras.review }) }, 201);
}

async function counterpartyHasRule(wsSlug: string, jurisdictionCode: string): Promise<boolean> {
  const snap = await workspaceRuleAt(wsSlug, jurisdictionCode);
  return snap.hasRule;
}

async function issueRequestPage(caseId: string, ws: Workspace, contactEmail: string, sentAt: Date, reference: string, asset: string, amount: { digits: bigint; scale: number }, destinationAddress: string): Promise<void> {
  const token = newToken(24);
  const endsAt = new Date(sentAt.getTime() + config.dataRequestPageSeconds * 1000);
  const pageId = `rp-${newToken(8).toLowerCase()}`;
  await query('UPDATE request_pages SET status = $1 WHERE case_id = $2 AND status = $3', ['ended', caseId, 'live']);
  await query(`INSERT INTO request_pages (id, case_id, workspace_slug, token, status, sent_at, ends_at, contact_email) VALUES ($1,$2,$3,$4,'live',$5,$6,$7)`,
    [pageId, caseId, ws.slug, token, sentAt, endsAt, contactEmail]);
  const amountText = formatAmount(asset, amountString(amount.digits, amount.scale));
  const workspaceName = ws.name;
  const workspaceLegal = ws.legal_name;
  const city = ws.city;
  const timeZone = ws.time_zone;
  await sendMail({
    to: contactEmail,
    subject: `Travel Rule data request ${reference} from ${workspaceName}`,
    textBody: [
      `${config.publicUrl}/r/${token}`,
      '',
      `Case reference: ${reference}`,
      `Asset and amount: ${amountText}`,
      `From address: ${maskAddress(ws.sending_address)}`,
      `To address: ${maskAddress(destinationAddress)}`,
      `Requesting exchange: ${workspaceLegal}`,
      `This page ends at ${formatDateTime(endsAt, timeZone, city)}.`,
    ].join('\n'),
  });
}

function codePointsOf(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}
