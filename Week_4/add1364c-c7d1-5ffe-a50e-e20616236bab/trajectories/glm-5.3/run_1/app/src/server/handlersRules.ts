import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { requireRole, visibleNow } from './handlersCore.js';
import { mapPerson } from './people.js';
import { draftStubText, inForceStubText, stubText, type RuleRow } from './domain/rules.js';
import { officeDateString } from './officeTime.js';
import { randomUUID } from 'node:crypto';

/** A rule's response view, including its `stub_text` by state. */
export function ruleView(rule: RuleRow, now: Date, today: string): Record<string, unknown> {
  void now;
  let stub: string | null = null;
  if (rule.state === 'drafted') {
    stub = draftStubText(rule);
  } else if (rule.state === 'scheduled') {
    stub = stubText(rule, today);
  } else if (rule.state === 'in_force' && rule.effective_on === today) {
    stub = inForceStubText(rule);
  }
  return {
    id: rule.id,
    vault_id: rule.vault_id,
    min_length: rule.min_length,
    effective_on: rule.effective_on,
    state: rule.state,
    version: rule.version,
    drafted_by: rule.drafted_by,
    signed_by: rule.signed_by,
    stub_text: stub
  };
}

export async function listRules(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const rows = await ctx.store.pool.query('SELECT * FROM rules ORDER BY effective_on, id');
  const today = officeDateString(ctx.store.clock.now());
  const vaultFilter = ctx.url.searchParams.get('vault_id');
  const all = rows.rows.map(mapRuleRow);
  const filtered = vaultFilter ? all.filter((rule) => rule.vault_id === vaultFilter) : all;
  jsonOk(ctx.res, 200, { rules: filtered.map((rule) => ruleView(rule, ctx.store.clock.now(), today)) });
}

export function mapRuleRow(row: Record<string, unknown>): RuleRow {
  return {
    id: String(row.id),
    vault_id: String(row.vault_id),
    min_length: Number(row.min_length),
    effective_on: String(row.effective_on).slice(0, 10),
    state: row.state as RuleRow['state'],
    version: Number(row.version),
    drafted_by: String(row.drafted_by),
    signed_by: row.signed_by ? String(row.signed_by) : null
  };
}

export async function createRule(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { vault_id: { type: 'string', required: true }, min_length: { type: 'number', required: true }, effective_on: { type: 'string', required: true } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const vaultId = String(body.vault_id ?? '');
  const minLength = Number(body.min_length);
  const effectiveOn = String(body.effective_on ?? '');
  const vaultRows = await ctx.store.pool.query('SELECT id, name FROM vaults WHERE id = $1', [vaultId]);
  if (vaultRows.rows.length === 0) throw invalid({ vault_id: 'Pick a vault that exists.' });
  const today = officeDateString(ctx.store.clock.now());
  const fields: Record<string, string> = {};
  if (!Number.isInteger(minLength) || minLength < 8 || minLength > 64) fields.min_length = 'Give a whole number from 8 to 64.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn) || !isRealDate(effectiveOn)) {
    fields.effective_on = 'Pick a date after today.';
  } else if (effectiveOn <= today) {
    fields.effective_on = 'Pick a date after today.';
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const id = randomUUID();
  await ctx.store.transaction(async (client) => {
    await client.query(
      `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, created_seq, state_changed_at)
       VALUES ($1,$2,$3,$4,'drafted',1,$5,NULL,nextval('row_seq_seq'::regclass),$6)`,
      [id, vaultId, minLength, effectiveOn, ctx.person!.id, ctx.store.clock.now()]
    );
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'rule_draft', subject: { kind: 'vault', id: vaultId, name: String(vaultRows.rows[0].name) } }
    ]);
  });
  const rows = await ctx.store.pool.query('SELECT * FROM rules WHERE id = $1', [id]);
  jsonOk(ctx.res, 201, ruleView(mapRuleRow(rows.rows[0]), ctx.store.clock.now(), today));
}

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

export async function getRule(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const rows = await ctx.store.pool.query('SELECT * FROM rules WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const today = officeDateString(ctx.store.clock.now());
  jsonOk(ctx.res, 200, ruleView(mapRuleRow(rows.rows[0]), ctx.store.clock.now(), today));
}

/** Version checks: a stale version answers rule_changed; a missing or non-whole version runs the remaining checks then 422s. */
function checkVersion(body: Record<string, unknown>, rule: RuleRow): { stale: boolean; missing: boolean } {
  const value = body.version;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { stale: false, missing: true };
  }
  return { stale: value !== rule.version, missing: false };
}

export async function patchRule(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const rows = await ctx.store.pool.query('SELECT * FROM rules WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const rule = mapRuleRow(rows.rows[0]);
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { version: { type: 'number', required: true }, min_length: { type: 'number', required: false }, effective_on: { type: 'string', required: false } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  // 409s in the published order
  if (rule.state === 'in_force') throw conflict('rule_in_force', 'This rule is in force. Make the change as a new rule.');
  if (rule.state === 'superseded') throw conflict('rule_superseded', 'This rule was superseded. Make the change as a new rule.');
  const versionCheck = checkVersion(body, rule);
  if (versionCheck.stale) throw conflict('rule_changed', COPY.ruleChanged);
  const newMin = typeof body.min_length === 'number' ? body.min_length : rule.min_length;
  const newOn = typeof body.effective_on === 'string' ? body.effective_on : rule.effective_on;
  const fields: Record<string, string> = {};
  if (!Number.isInteger(newMin) || newMin < 8 || newMin > 64) fields.min_length = 'Give a whole number from 8 to 64.';
  const today = officeDateString(ctx.store.clock.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newOn) || !isRealDate(newOn) || newOn <= today) {
    fields.effective_on = 'Pick a date after today.';
  }
  if (versionCheck.missing) fields.version = 'Send the rule version you opened.';
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const now = ctx.store.clock.now();
  const vaultName = await vaultNameOf(ctx, rule.vault_id);
  await ctx.store.transaction(async (client) => {
    const bumped = rule.version + 1;
    await client.query(
      `UPDATE rules SET min_length = $2, effective_on = $3, version = $4, state = 'drafted', signed_by = NULL, state_changed_at = $5 WHERE id = $1`,
      [rule.id, newMin, newOn, bumped, now]
    );
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'rule_edit', subject: { kind: 'vault', id: rule.vault_id, name: vaultName } }
    ]);
  });
  const fresh = await ctx.store.pool.query('SELECT * FROM rules WHERE id = $1', [rule.id]);
  jsonOk(ctx.res, 200, ruleView(mapRuleRow(fresh.rows[0]), now, today));
}

/** Audit subject names for rule changes carry the vault name. */
export async function vaultNameOf(ctx: Ctx, vaultId: string): Promise<string> {
  const rows = await ctx.store.pool.query('SELECT name FROM vaults WHERE id = $1', [vaultId]);
  return rows.rows.length > 0 ? String(rows.rows[0].name) : '';
}

export async function signRule(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'managing_partner');
  const rows = await ctx.store.pool.query('SELECT * FROM rules WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const rule = mapRuleRow(rows.rows[0]);
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { version: { type: 'number', required: true } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  if (rule.state === 'in_force') throw conflict('rule_in_force', COPY.cantSignNow);
  if (rule.state === 'superseded') throw conflict('rule_superseded', COPY.cantSignNow);
  if (rule.state === 'scheduled') throw conflict('not_a_draft', COPY.cantSignNow);
  const versionCheck = checkVersion(body, rule);
  if (versionCheck.stale) throw conflict('rule_changed', COPY.ruleChanged);
  const today = officeDateString(ctx.store.clock.now());
  if (rule.effective_on <= today) {
    throw conflict('effective_date_passed', COPY.cantSignNow);
  }
  const sameDate = await ctx.store.pool.query(
    "SELECT id FROM rules WHERE vault_id = $1 AND state = 'scheduled' AND effective_on = $2 AND id <> $3",
    [rule.vault_id, rule.effective_on, rule.id]
  );
  if (sameDate.rows.length > 0) throw conflict('rule_date_taken', COPY.cantSignNow);
  if (versionCheck.missing) throw invalid({ version: 'Send the rule version you opened.' });
  const now = ctx.store.clock.now();
  const vaultName = await vaultNameOf(ctx, rule.vault_id);
  await ctx.store.transaction(async (client) => {
    await client.query(
      "UPDATE rules SET state = 'scheduled', signed_by = $2, version = version + 1, state_changed_at = $3 WHERE id = $1",
      [rule.id, ctx.person!.id, now]
    );
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'rule_sign', subject: { kind: 'vault', id: rule.vault_id, name: vaultName } }
    ]);
  });
  const fresh = await ctx.store.pool.query('SELECT * FROM rules WHERE id = $1', [rule.id]);
  jsonOk(ctx.res, 200, ruleView(mapRuleRow(fresh.rows[0]), now, today));
}
