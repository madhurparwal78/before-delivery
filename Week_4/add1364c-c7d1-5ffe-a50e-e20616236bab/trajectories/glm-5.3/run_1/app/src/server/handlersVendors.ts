import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { requireRole, loadVaults, visibleNow } from './handlersCore.js';
import { mapVaultRow } from './handlersPeople.js';
import { mapPerson } from './people.js';
import { ruleInForceAt, type RuleRow } from './domain/rules.js';
import { mapRuleRow } from './handlersRules.js';
import { credentialView } from './handlersCredentialsView.js';
import { officeDateString, officeTimeString, offsetAbbreviation } from './officeTime.js';
import { randomUUID } from 'node:crypto';

export async function listVendors(ctx: Ctx): Promise<void> {
  const rows = await ctx.store.pool.query('SELECT * FROM vendors ORDER BY created_seq, id');
  const renames = await ctx.store.pool.query('SELECT * FROM vendor_renames ORDER BY at');
  const renamesByVendor = new Map<string, Array<{ old: string; new: string; by: string | null; at: string }>>();
  for (const row of renames.rows) {
    const vendorId = String(row.vendor_id);
    const list = renamesByVendor.get(vendorId) ?? [];
    list.push({
      old: String(row.old_name),
      new: String(row.new_name),
      by: row.by_person_id ? String(row.by_person_id) : null,
      at: new Date(row.at as string).toISOString()
    });
    renamesByVendor.set(vendorId, list);
  }
  jsonOk(ctx.res, 200, {
    vendors: rows.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      domain: String(row.domain),
      formerly: row.formerly ? String(row.formerly) : null,
      renames: renamesByVendor.get(String(row.id)) ?? []
    }))
  });
}

export async function createVendor(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { name: { type: 'string', required: true }, domain: { type: 'string', required: true } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const name = String(body.name ?? '');
  const domain = String(body.domain ?? '').toLowerCase();
  const fields: Record<string, string> = {};
  if (name.length < 2 || name.length > 60) fields.name = 'Give a vendor name of 2 to 60 characters.';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    fields.domain = 'Give the vendor domain as a host name.';
  } else {
    const taken = await ctx.store.pool.query('SELECT id FROM vendors WHERE lower(domain) = $1', [domain]);
    if (taken.rows.length > 0) fields.domain = 'This domain is already on record.';
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const id = randomUUID();
  await ctx.store.transaction(async (client) => {
    await client.query(
      'INSERT INTO vendors (id, name, domain, created_seq) VALUES ($1,$2,$3,nextval(\'row_seq_seq\'::regclass))',
      [id, name, domain]
    );
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'vendor_create', subject: { kind: 'vendor', id, name } }
    ]);
  });
  jsonOk(ctx.res, 201, { id, name, domain, formerly: null, renames: [] });
}

export async function patchVendor(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const rows = await ctx.store.pool.query('SELECT * FROM vendors WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const vendor = rows.rows[0];
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { name: { type: 'string', required: false }, domain: { type: 'string', required: false } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const newName = typeof body.name === 'string' ? body.name : String(vendor.name);
  const newDomain = typeof body.domain === 'string' ? body.domain.toLowerCase() : String(vendor.domain).toLowerCase();
  const fields: Record<string, string> = {};
  if (newName.length < 2 || newName.length > 60) fields.name = 'Give a vendor name of 2 to 60 characters.';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(newDomain)) {
    fields.domain = 'Give the vendor domain as a host name.';
  } else if (newDomain !== String(vendor.domain).toLowerCase()) {
    const taken = await ctx.store.pool.query('SELECT id FROM vendors WHERE lower(domain) = $1 AND id <> $2', [newDomain, vendor.id]);
    if (taken.rows.length > 0) fields.domain = 'This domain is already on record.';
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const now = ctx.store.clock.now();
  const renamed = newName !== String(vendor.name);
  await ctx.store.transaction(async (client) => {
    await client.query('UPDATE vendors SET name = $2, domain = $3, formerly = $4 WHERE id = $1', [
      vendor.id,
      newName,
      newDomain,
      renamed ? String(vendor.name) : vendor.formerly ? String(vendor.formerly) : null
    ]);
    if (renamed) {
      await client.query(
        'INSERT INTO vendor_renames (id, vendor_id, old_name, new_name, by_person_id, at) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), String(vendor.id), String(vendor.name), newName, ctx.person!.id, now]
      );
    }
    const drafts: Array<{ action: string; subject: { kind: string; id: string; name: string } }> = [];
    if (renamed) drafts.push({ action: 'vendor_rename', subject: { kind: 'vendor', id: String(vendor.id), name: String(vendor.name) } });
    if (newDomain !== String(vendor.domain).toLowerCase()) {
      drafts.push({ action: 'vendor_change', subject: { kind: 'vendor', id: String(vendor.id), name: newName } });
    }
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, drafts);
  });
  const renames = await ctx.store.pool.query('SELECT * FROM vendor_renames WHERE vendor_id = $1 ORDER BY at', [String(vendor.id)]);
  jsonOk(ctx.res, 200, {
    id: String(vendor.id),
    name: newName,
    domain: newDomain,
    formerly: renamed ? String(vendor.name) : vendor.formerly ? String(vendor.formerly) : null,
    renames: renames.rows.map((row) => ({
      old: String(row.old_name),
      new: String(row.new_name),
      by: row.by_person_id ? String(row.by_person_id) : null,
      at: new Date(row.at as string).toISOString()
    }))
  });
}

async function loadCredentialForCaller(ctx: Ctx, credentialId: string): Promise<Record<string, unknown>> {
  const rows = await ctx.store.pool.query(
    `SELECT c.*, v.name AS vendor_name, v.domain AS vendor_domain, v.formerly AS vendor_formerly
     FROM credentials c JOIN vendors v ON v.id = c.vendor_id WHERE c.id = $1`,
    [credentialId]
  );
  if (rows.rows.length === 0) throw notFound();
  const row = rows.rows[0];
  if (!ctx.person) throw notFound();
  const visible = new Set(await visibleNow(ctx, ctx.person));
  if (!visible.has(String(row.vault_id))) throw notFound();
  return row;
}

export async function getCredential(ctx: Ctx): Promise<void> {
  const row = await loadCredentialForCaller(ctx, ctx.params.id);
  const secretLength = ctx.store.secrets.decrypt(row.secret_enc as Buffer).length;
  const view = await credentialView(ctx, row, secretLength);
  jsonOk(ctx.res, 200, view);
}

export async function createCredential(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = {
    vault_id: { type: 'string', required: true },
    vendor_id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    username: { type: 'string', required: true },
    secret: { type: 'string', required: true }
  };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const vaultId = String(body.vault_id ?? '');
  const vendorId = String(body.vendor_id ?? '');
  const label = String(body.label ?? '');
  const username = String(body.username ?? '');
  const secret = String(body.secret ?? '');
  const vaultRows = await ctx.store.pool.query('SELECT * FROM vaults WHERE id = $1', [vaultId]);
  if (vaultRows.rows.length === 0) throw invalid({ vault_id: 'Pick a vault that exists.' });
  const vendorRows = await ctx.store.pool.query('SELECT * FROM vendors WHERE id = $1', [vendorId]);
  if (vendorRows.rows.length === 0) throw invalid({ vendor_id: 'Pick a vendor that exists.' });
  const rulesRows = await ctx.store.pool.query('SELECT * FROM rules');
  const rules: RuleRow[] = rulesRows.rows.map(mapRuleRow);
  const today = officeDateString(ctx.store.clock.now());
  const rule = ruleInForceAt(rules, vaultId, today);
  const min = rule?.min_length ?? 12;
  const fields: Record<string, string> = {};
  if (label.length < 1 || label.length > 60) fields.label = 'Give a label of 1 to 60 characters.';
  if (username.length < 1 || username.length > 120) fields.username = 'Give a username of 1 to 120 characters.';
  if (secret.length < 1 || secret.length > 128) fields.secret = 'Give a password of 1 to 128 characters.';
  else if (secret.length < min) fields.secret = `${vaultName(ctx, vaultId)} needs at least ${min} characters.`;
  if (Object.keys(fields).length === 0) {
    const dup = await ctx.store.pool.query(
      'SELECT id FROM credentials WHERE vault_id = $1 AND vendor_id = $2 AND lower(username) = lower($3)',
      [vaultId, vendorId, username]
    );
    if (dup.rows.length > 0) {
      fields.secret = 'This login is already on file for the same vault, vendor and username.';
    }
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const id = randomUUID();
  await ctx.store.transaction(async (client) => {
    await client.query(
      `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_enc, secret_fingerprint, last_turned_on, created_seq)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,nextval('row_seq_seq'::regclass))`,
      [id, vaultId, vendorId, label, username, ctx.store.secrets.encrypt(secret), ctx.store.secrets.fingerprint(secret), today]
    );
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'credential_create', subject: { kind: 'credential', id, name: label } }
    ]);
  });
  const row = await ctx.store.pool.query(
    `SELECT c.*, v.name AS vendor_name, v.domain AS vendor_domain, v.formerly AS vendor_formerly
     FROM credentials c JOIN vendors v ON v.id = c.vendor_id WHERE c.id = $1`,
    [id]
  );
  const view = await credentialView(ctx, row.rows[0], secret.length);
  jsonOk(ctx.res, 201, view);
}

async function vaultName(ctx: Ctx, vaultId: string): Promise<string> {
  const rows = await ctx.store.pool.query('SELECT name FROM vaults WHERE id = $1', [vaultId]);
  return rows.rows.length > 0 ? String(rows.rows[0].name) : 'This vault';
}
