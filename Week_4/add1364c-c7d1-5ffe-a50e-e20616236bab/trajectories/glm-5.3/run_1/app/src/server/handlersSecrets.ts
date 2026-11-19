import type { Ctx } from './apiRoutes.js';
import { ApiError, forbidden, invalid, notFound } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { requireRole, visibleNow } from './handlersCore.js';
import { policyView, ruleInForceAt, type RuleRow } from './domain/rules.js';
import { credentialView } from './handlersCredentialsView.js';
import { officeDateString, officeTimeString, offsetAbbreviation } from './officeTime.js';

async function loadCredentialForCaller(ctx: Ctx, credentialId: string): Promise<Record<string, unknown>> {
  const rows = await ctx.store.pool.query(
    `SELECT c.*, v.name AS vendor_name, v.domain AS vendor_domain, v.formerly AS vendor_formerly, vault.name AS vault_name
     FROM credentials c
     JOIN vendors v ON v.id = c.vendor_id
     JOIN vaults vault ON vault.id = c.vault_id
     WHERE c.id = $1`,
    [credentialId]
  );
  if (rows.rows.length === 0) throw notFound();
  const row = rows.rows[0];
  if (!ctx.person) throw notFound();
  const visible = new Set(await visibleNow(ctx, ctx.person));
  if (!visible.has(String(row.vault_id))) throw notFound();
  return row;
}

/** Save a new secret, checked against the rule in force at that instant. */
export async function putSecret(ctx: Ctx): Promise<void> {
  const credentialId = ctx.params.id;
  const credential = await loadCredentialForCaller(ctx, credentialId);
  const isOfficeManager = ctx.person!.role === 'office_manager';
  if (!isOfficeManager) {
    // staff accountants may turn logins in their own (visible) vaults; the visibility check above already refused others
    if (ctx.person!.role !== 'staff_accountant') throw forbidden();
  }
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { secret: { type: 'string', required: true } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const secret = String(body.secret ?? '');
  const rulesRows = await ctx.store.pool.query('SELECT * FROM rules');
  const rules: RuleRow[] = rulesRows.rows.map((row) => ({
    id: String(row.id),
    vault_id: String(row.vault_id),
    min_length: Number(row.min_length),
    effective_on: String(row.effective_on).slice(0, 10),
    state: row.state as RuleRow['state'],
    version: Number(row.version),
    drafted_by: String(row.drafted_by),
    signed_by: row.signed_by ? String(row.signed_by) : null
  }));
  const today = officeDateString(ctx.store.clock.now());
  const rule = ruleInForceAt(rules, String(credential.vault_id), today);
  const min = rule?.min_length ?? 12;
  if (secret.length < 1 || secret.length > 128 || secret.length < min) {
    throw invalid({ secret: `${vaultNameOf(credential)} needs at least ${min} characters.` });
  }
  const now = ctx.store.clock.now();
  await ctx.store.transaction(async (client) => {
    await client.query('UPDATE credentials SET secret_enc = $2, secret_fingerprint = $3, last_turned_on = $4, out_of_policy_since = NULL WHERE id = $1', [
      credentialId,
      ctx.store.secrets.encrypt(secret),
      ctx.store.secrets.fingerprint(secret),
      today
    ]);
    // Saving a new secret moves every due and overdue turn of that login to turned,
    // sets held_by to just the person who saved it, and sets last_turned_on to office today.
    const openTurns = await client.query(
      "SELECT id FROM turns WHERE credential_id = $1 AND state IN ('due','overdue')",
      [credentialId]
    );
    for (const turn of openTurns.rows) {
      await client.query("UPDATE turns SET state = 'turned', turned_at = $2 WHERE id = $1", [String(turn.id), now]);
    }
    await client.query('DELETE FROM credential_holders WHERE credential_id = $1', [credentialId]);
    await client.query('INSERT INTO credential_holders (credential_id, person_id, holder_left) VALUES ($1,$2,false)', [
      credentialId,
      ctx.person!.id
    ]);
    const drafts = [
      { action: 'secret_edit', subject: { kind: 'credential', id: credentialId, name: String(credential.label) } },
      ...openTurns.rows.map(() => ({ action: 'turn_done', subject: { kind: 'credential', id: credentialId, name: String(credential.label) } }))
    ];
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, drafts);
  });
  const fresh = await ctx.store.pool.query(
    `SELECT c.*, v.name AS vendor_name, v.domain AS vendor_domain, v.formerly AS vendor_formerly, vault.name AS vault_name
     FROM credentials c
     JOIN vendors v ON v.id = c.vendor_id
     JOIN vaults vault ON vault.id = c.vault_id
     WHERE c.id = $1`,
    [credentialId]
  );
  const view = await credentialView(ctx, fresh.rows[0], secret.length);
  jsonOk(ctx.res, 200, view);
}

/** The vault's name for turn messages: `<vault> needs at least <n> characters.` */
function vaultNameOf(credential: Record<string, unknown>): string {
  return String(credential.vault_name ?? 'This vault');
}

/** Reveal and copy share this check and response shape. */
async function revealOrCopy(ctx: Ctx, action: 'reveal' | 'copy'): Promise<void> {
  const credentialId = ctx.params.id;
  const credential = await loadCredentialForCaller(ctx, credentialId);
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  const rulesRows = await ctx.store.pool.query('SELECT * FROM rules');
  const rules: RuleRow[] = rulesRows.rows.map((row) => ({
    id: String(row.id),
    vault_id: String(row.vault_id),
    min_length: Number(row.min_length),
    effective_on: String(row.effective_on).slice(0, 10),
    state: row.state as RuleRow['state'],
    version: Number(row.version),
    drafted_by: String(row.drafted_by),
    signed_by: row.signed_by ? String(row.signed_by) : null
  }));
  const rule = ruleInForceAt(rules, String(credential.vault_id), today);
  const secret = ctx.store.secrets.decrypt(credential.secret_enc as Buffer);
  const policy = policyView(rule, secret.length, String(credential.last_turned_on ?? '').slice(0, 10) || null, credential.out_of_policy_since ? String(credential.out_of_policy_since).slice(0, 10) : null, today);
  if (policy.leeway_ends_at && now.getTime() >= policy.leeway_ends_at.getTime()) {
    throw new ApiError(423, 'turn_required', COPY.turnRequired);
  }
  const auditRows = await ctx.store.transaction(async (client) => {
    const auditId = await writeAuditForId(ctx, client, action, credentialId, credential, rule?.id ?? null);
    return auditId;
  });
  jsonOk(ctx.res, 200, {
    credential_id: credentialId,
    secret,
    rule_id: rule?.id ?? null,
    audit_id: auditRows
  });
}

/** The audit entry id for a reveal or copy, written with the rule in force. */
async function writeAuditForId(
  ctx: Ctx,
  client: import('pg').PoolClient,
  action: 'reveal' | 'copy',
  credentialId: string,
  credential: Record<string, unknown>,
  ruleId: string | null
): Promise<string> {
  const id = `${action}-${credentialId}-${Date.now()}`;
  void id;
  const rows = await client.query(
    `INSERT INTO audit_entries (id, seq, at, office_day, office_time, offset_abbrev, actor_kind, actor_person_id, actor_name, action, subject_kind, subject_id, subject_name, details)
     VALUES ($1, (SELECT last_seq + 1 FROM audit_seq_state WHERE id = true), $2, $3, $4, $5, 'person', $6, $7, $8, 'credential', $9, $10, $11)
     RETURNING id`,
    [
      `${action}-${credentialId}-${ctx.store.clock.nowMs()}`,
      ctx.store.clock.now(),
      officeDateString(ctx.store.clock.now()),
      officeTimeString(ctx.store.clock.now()),
      offsetAbbreviationNow(ctx),
      ctx.person!.id,
      ctx.person!.full_name,
      action,
      credentialId,
      String(credential.label),
      JSON.stringify({ rule_id: ruleId })
    ]
  );
  await client.query('UPDATE audit_seq_state SET last_seq = last_seq + 1 WHERE id = true');
  return String(rows.rows[0].id);
}

function offsetAbbreviationNow(ctx: Ctx): string {
  return offsetAbbreviation(ctx.store.clock.now());
}

export async function revealCredential(ctx: Ctx): Promise<void> {
  await revealOrCopy(ctx, 'reveal');
}

export async function copyCredential(ctx: Ctx): Promise<void> {
  await revealOrCopy(ctx, 'copy');
}
