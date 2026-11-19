import type { Ctx } from './apiRoutes.js';
import { ApiError, invalid, notFound } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { requireRole, loadVaults, visibleNow } from './handlersCore.js';
import { mapVaultRow } from './handlersPeople.js';
import { mapRuleRow, ruleView, vaultNameOf } from './handlersRules.js';
import { policyView, ruleInForceAt, type RuleRow } from './domain/rules.js';
import { credentialView } from './handlersCredentialsView.js';
import { officeDateString } from './officeTime.js';
import { randomUUID } from 'node:crypto';

export async function listVaults(ctx: Ctx): Promise<void> {
  if (!ctx.person) throw notFound();
  const vaults = await loadVaults(ctx);
  const visible = new Set(await visibleNow(ctx, ctx.person));
  const seesRuleSurfaces = ctx.person.role === 'office_manager' || ctx.person.role === 'managing_partner';
  const rulesRows = await ctx.store.pool.query('SELECT * FROM rules');
  const rules: RuleRow[] = rulesRows.rows.map(mapRuleRow);
  const today = officeDateString(ctx.store.clock.now());
  const views: Record<string, unknown>[] = [];
  for (const vault of vaults) {
    if (!visible.has(vault.id)) continue;
    const credentialCount = await ctx.store.pool.query('SELECT COUNT(*)::int AS n FROM credentials WHERE vault_id = $1', [vault.id]);
    views.push({
      id: vault.id,
      name: vault.name,
      formerly: vault.formerly,
      off_when_travelling: vault.off_when_travelling,
      rule_in_force: ruleInForceAt(rules, vault.id, today),
      pending_rules: seesRuleSurfaces
        ? rules
            .filter((rule) => rule.vault_id === vault.id && (rule.state === 'drafted' || rule.state === 'scheduled'))
            .map((rule) => ruleView(rule, ctx.store.clock.now(), today))
        : [],
      credential_count: Number(credentialCount.rows[0].n)
    });
  }
  jsonOk(ctx.res, 200, { vaults: views });
}

export async function getVault(ctx: Ctx): Promise<void> {
  if (!ctx.person) throw notFound();
  const rows = await ctx.store.pool.query('SELECT id, name, formerly, off_when_travelling, position FROM vaults WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const vault = mapVaultRow(rows.rows[0]);
  const visible = new Set(await visibleNow(ctx, ctx.person));
  if (!visible.has(vault.id)) throw notFound();
  const seesRuleSurfaces = ctx.person.role === 'office_manager' || ctx.person.role === 'managing_partner';
  const rulesRows = await ctx.store.pool.query('SELECT * FROM rules');
  const rules: RuleRow[] = rulesRows.rows.map(mapRuleRow);
  const today = officeDateString(ctx.store.clock.now());
  const credentialRows = await ctx.store.pool.query(
    `SELECT c.*, v.name AS vendor_name, v.domain AS vendor_domain, v.formerly AS vendor_formerly
     FROM credentials c JOIN vendors v ON v.id = c.vendor_id WHERE c.vault_id = $1 ORDER BY c.created_seq, c.id`,
    [vault.id]
  );
  const views = [];
  for (const row of credentialRows.rows) {
    const secretLength = ctx.store.secrets.decrypt(row.secret_enc as Buffer).length;
    views.push(await credentialView(ctx, row, secretLength));
  }
  jsonOk(ctx.res, 200, {
    vault: {
      id: vault.id,
      name: vault.name,
      formerly: vault.formerly,
      off_when_travelling: vault.off_when_travelling,
      rule_in_force: ruleInForceAt(rules, vault.id, today),
      pending_rules: seesRuleSurfaces
        ? rules
            .filter((rule) => rule.vault_id === vault.id && (rule.state === 'drafted' || rule.state === 'scheduled'))
            .map((rule) => ruleView(rule, ctx.store.clock.now(), today))
        : [],
      credential_count: views.length
    },
    credentials: views
  });
}

export async function createVault(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { name: { type: 'string', required: true }, off_when_travelling: { type: 'boolean', required: true } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const name = String(body.name ?? '');
  const off = body.off_when_travelling === true;
  if (name.length < 2 || name.length > 40) throw invalid({ name: 'Give a vault name of 2 to 40 characters.' });
  const taken = await ctx.store.pool.query('SELECT id FROM vaults WHERE lower(name) = lower($1)', [name]);
  if (taken.rows.length > 0) throw invalid({ name: 'This vault name is already on record.' });
  const id = randomUUID();
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  await ctx.store.transaction(async (client) => {
    const position = await client.query('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM vaults');
    await client.query(
      "INSERT INTO vaults (id, name, formerly, off_when_travelling, position, created_seq) VALUES ($1,$2,NULL,$3,$4,nextval('row_seq_seq'::regclass))",
      [id, name, off, Number(position.rows[0].pos)]
    );
    // a new vault takes the Vendor portals default rule: in force, minimum 12, effective office today
    await client.query(
      `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, created_seq, state_changed_at)
       VALUES ($1,$2,12,$3,'in_force',1,$4,NULL,nextval('row_seq_seq'::regclass),$5)`,
      [randomUUID(), id, today, ctx.person!.id, now]
    );
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'vault_create', subject: { kind: 'vault', id, name } }
    ]);
  });
  const rulesRows = await ctx.store.pool.query('SELECT * FROM rules');
  const rules: RuleRow[] = rulesRows.rows.map(mapRuleRow);
  jsonOk(ctx.res, 201, {
    id,
    name,
    formerly: null,
    off_when_travelling: off,
    rule_in_force: ruleInForceAt(rules, id, today),
    pending_rules: [],
    credential_count: 0
  });
}

export async function patchVault(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const rows = await ctx.store.pool.query('SELECT * FROM vaults WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const vault = mapVaultRow(rows.rows[0]);
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { name: { type: 'string', required: false }, off_when_travelling: { type: 'boolean', required: false } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const newName = typeof body.name === 'string' ? body.name : vault.name;
  const newOff = typeof body.off_when_travelling === 'boolean' ? body.off_when_travelling : vault.off_when_travelling;
  const fields: Record<string, string> = {};
  if (newName.length < 2 || newName.length > 40) fields.name = 'Give a vault name of 2 to 40 characters.';
  if (newName !== vault.name) {
    const taken = await ctx.store.pool.query('SELECT id FROM vaults WHERE lower(name) = lower($1) AND id <> $2', [newName, vault.id]);
    if (taken.rows.length > 0) fields.name = 'This vault name is already on record.';
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const now = ctx.store.clock.now();
  await ctx.store.transaction(async (client) => {
    await client.query('UPDATE vaults SET name = $2, off_when_travelling = $3, formerly = $4 WHERE id = $1', [
      vault.id,
      newName,
      newOff,
      newName !== vault.name ? vault.name : vault.formerly
    ]);
    if (newName !== vault.name) {
      await client.query(
        'INSERT INTO vault_renames (id, vault_id, old_name, new_name, by_person_id, at) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), vault.id, vault.name, newName, ctx.person!.id, now]
      );
    }
    const drafts: Array<{ action: string; subject: { kind: string; id: string; name: string } }> = [];
    if (newName !== vault.name) {
      drafts.push({ action: 'vault_rename', subject: { kind: 'vault', id: vault.id, name: vault.name } });
    }
    if (newOff !== vault.off_when_travelling) {
      drafts.push({ action: 'vault_change', subject: { kind: 'vault', id: vault.id, name: newName } });
    }
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, drafts);
  });
  const rulesRows = await ctx.store.pool.query('SELECT * FROM rules');
  const rules: RuleRow[] = rulesRows.rows.map(mapRuleRow);
  const today = officeDateString(now);
  const credentialCount = await ctx.store.pool.query('SELECT COUNT(*)::int AS n FROM credentials WHERE vault_id = $1', [vault.id]);
  jsonOk(ctx.res, 200, {
    id: vault.id,
    name: newName,
    formerly: newName !== vault.name ? vault.name : vault.formerly,
    off_when_travelling: newOff,
    rule_in_force: ruleInForceAt(rules, vault.id, today),
    pending_rules: rules
      .filter((rule) => rule.vault_id === vault.id && (rule.state === 'drafted' || rule.state === 'scheduled'))
      .map((rule) => ruleView(rule, now, today)),
    credential_count: Number(credentialCount.rows[0].n)
  });
}

/** The name of a vault, for audit subjects. */
export { vaultNameOf };
