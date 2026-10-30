import fs from 'node:fs';
import { hashPassword, nowSeconds, randomHex, toDate, txHash, walletAddress } from './lib/core.js';
import { fold } from './lib/validate.js';
import { tx } from './db.js';
import { record } from './services/audit.js';
import { ledgerPair } from './services/intents.js';

// The fixture password every seeded account uses (the brief's Seed data); stored only as a salted hash.
const PASSWORD = 'deku-demo-pw-2026';
const USDC = 10n ** 6n;
const ETH = 10n ** 18n;

const NORTHWIND = { id: 'org_northwind', name: 'Northwind Treasury', app_id: 'app_nw7k2m9q4x1z' };
const ACME = { id: 'org_acme', name: 'Acme Payroll', app_id: 'app_ac3p8r5t6v2w' };
const MEMBERS = [
  ['mem_nw_owner', NORTHWIND, 'Nadia Owens', 'nw.owner@example.com', 'owner'],
  ['mem_nw_operator', NORTHWIND, 'Omar Patel', 'nw.operator@example.com', 'operator'],
  ['mem_nw_approver1', NORTHWIND, 'Ada Byrne', 'nw.approver1@example.com', 'approver'],
  ['mem_nw_approver2', NORTHWIND, 'Ben Okoro', 'nw.approver2@example.com', 'approver'],
  ['mem_nw_auditor', NORTHWIND, 'Uma Diaz', 'nw.auditor@example.com', 'auditor'],
  ['mem_acme_owner', ACME, 'Jordan Lee', 'acme.owner@example.com', 'owner'],
];
const VENDORS = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333'];
const RULES = [
  { name: 'Block burn address', method: 'transfer', action: 'DENY', conditions: [
    { field_source: 'request_body', field: 'destination.address', operator: 'in',
      value: ['0x000000000000000000000000000000000000dead'] }] },
  { name: 'Vendors under daily cap', method: 'transfer', action: 'ALLOW', conditions: [
    { field_source: 'request_body', field: 'destination.address', operator: 'in', value: VENDORS },
    { field_source: 'reference', field: 'aggregation.agg_daily_outflow', operator: 'lte', value: '50000000000' }] },
  { name: 'Sweep to payroll', method: 'transfer', action: 'ALLOW', conditions: [
    { field_source: 'request_body', field: 'destination.address', operator: 'eq', value: walletAddress('wal_payroll') }] },
  { name: 'Payroll lines under 5000', method: 'batch_payout', action: 'ALLOW', conditions: [
    { field_source: 'request_body', field: 'source.amount', operator: 'lte', value: '5000000000' }] },
];
const QUORUM_MEMBERS = ['mem_nw_approver1', 'mem_nw_approver2', 'mem_nw_owner'];
const WALLETS = [
  ['wal_operating', NORTHWIND, 'Operating USDC', 'base', 'usdc', 253500n * USDC, 'pol_operating', 'kq_finance', 10000n * USDC],
  ['wal_payroll', NORTHWIND, 'Payroll USDC', 'base', 'usdc', 40000n * USDC, null, 'kq_finance', 25000n * USDC],
  ['wal_gas', NORTHWIND, 'Gas reserve', 'ethereum', 'eth', 125n * ETH / 10n, null, null, 0n],
  ['wal_acme_ops', ACME, 'Acme Operating', 'base', 'usdc', 9000n * USDC, null, null, 0n],
];
const DECISION = { action: 'ALLOW', rule: 'Vendors under daily cap', reason: 'matched_rule', policy_id: 'pol_operating',
  policy_revision: 1 };

async function migrate(client) {
  await client.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
}

// Applies the schema, then writes the seed into an empty database once. An advisory lock makes two
// processes booting at once seed exactly once; a later boot finds the organizations and writes nothing.
export async function prepareDatabase() {
  await tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(4173001)');
    await migrate(client);
    const done = await client.query('SELECT 1 FROM organizations LIMIT 1');
    if (!done.rows.length) await seed(client);
  });
}

async function seed(client) {
  const now = nowSeconds();
  const at = toDate(now);
  const event = (org, type, subjectId, data) => record(client, org.id, { type, actor: 'system', subjectId, data, at: now });

  for (const org of [NORTHWIND, ACME]) {
    await client.query('INSERT INTO organizations (id, name, app_id, webhook_secret, created_at) VALUES ($1, $2, $3, $4, $5)',
      [org.id, org.name, org.app_id, `whsec_${randomHex(16)}`, at]);
  }
  for (const [id, org, name, email, role] of MEMBERS) {
    await client.query(
      'INSERT INTO members (id, organization_id, name, email, role, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, org.id, name, email, role, hashPassword(PASSWORD), at]);
    await event(org, 'member.added', id, { member_id: id, email, role });
  }

  await client.query(
    `INSERT INTO aggregations (id, organization_id, name, metric, window_seconds, asset, group_by, created_at)
     VALUES ('agg_daily_outflow', $1, 'Daily outflow', 'sum_amount', 86400, 'usdc', 'wallet', $2)`, [NORTHWIND.id, at]);
  await event(NORTHWIND, 'aggregation.created', 'agg_daily_outflow',
    { name: 'Daily outflow', metric: 'sum_amount', window_seconds: 86400, asset: 'usdc', group_by: 'wallet' });
  await client.query(
    `INSERT INTO key_quorums (id, organization_id, name, member_ids, authorization_threshold, expiry_seconds, created_at)
     VALUES ('kq_finance', $1, 'Finance quorum', $2, 2, 604800, $3)`, [NORTHWIND.id, JSON.stringify(QUORUM_MEMBERS), at]);
  await event(NORTHWIND, 'quorum.created', 'kq_finance',
    { name: 'Finance quorum', member_ids: QUORUM_MEMBERS, authorization_threshold: 2, expiry_seconds: 604800 });
  await client.query(
    `INSERT INTO policies (id, organization_id, version, name, chain_type, rules, revision, created_at, updated_at)
     VALUES ('pol_operating', $1, '1.0', 'Operating limits', 'ethereum', $2, 1, $3, $3)`,
    [NORTHWIND.id, JSON.stringify(RULES), at]);
  await client.query(
    "INSERT INTO policy_revisions (policy_id, revision, name, rules, created_at) VALUES ('pol_operating', 1, 'Operating limits', $1, $2)",
    [JSON.stringify(RULES), at]);
  await event(NORTHWIND, 'policy.created', 'pol_operating', { name: 'Operating limits', revision: 1 });

  for (const [id, org, name, chain, asset, opening, policyId, quorumId, floor] of WALLETS) {
    await client.query(
      `INSERT INTO wallets (id, organization_id, name, name_key, chain, asset, address, balance_raw, policy_id, quorum_id,
                            approval_floor_raw, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, org.id, name, fold(name), chain, asset, walletAddress(id), opening.toString(), policyId, quorumId, floor.toString(), at]);
    await ledgerPair(client, { orgId: org.id, kind: 'opening', asset, from: 'external', to: id, rawAmount: opening, at: now });
    await event(org, 'wallet.created', id,
      { name, chain, asset, policy_id: policyId, quorum_id: quorumId, approval_floor_raw: floor.toString() });
  }

  const data = (id, raw, status) => ({ intent_id: id, wallet_id: 'wal_operating', kind: 'transfer', raw_amount: raw.toString(), status });
  const paidRaw = 3500n * USDC;
  const paidAt = new Date('2026-09-15T10:00:00Z');
  await client.query(
    `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status, created_by,
                          required_approvals, quorum_member_ids, policy_decision, created_at, decided_at, executed_at, tx_hash)
     VALUES ('int_seed_paid', $1, 'wal_operating', 'transfer', $2, $3, 'September tooling', 'executed', 'mem_nw_operator',
             0, '[]', $4, $5, $5, $5, $6)`,
    [NORTHWIND.id, VENDORS[0], paidRaw.toString(), JSON.stringify(DECISION), paidAt, txHash('int_seed_paid')]);
  await client.query("UPDATE wallets SET balance_raw = balance_raw - $1 WHERE id = 'wal_operating'", [paidRaw.toString()]);
  await ledgerPair(client, { orgId: NORTHWIND.id, kind: 'transfer', asset: 'usdc', from: 'wal_operating', to: 'external',
    rawAmount: paidRaw, intentId: 'int_seed_paid', at: Math.floor(paidAt.getTime() / 1000) });
  await event(NORTHWIND, 'intent.created', 'int_seed_paid', data('int_seed_paid', paidRaw, 'executed'));
  await event(NORTHWIND, 'intent.executed', 'int_seed_paid', data('int_seed_paid', paidRaw, 'executed'));

  const pendingRaw = 12000n * USDC;
  await client.query(
    `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status, created_by,
                          required_approvals, quorum_member_ids, policy_decision, created_at, expires_at)
     VALUES ('int_seed_pending', $1, 'wal_operating', 'transfer', $2, $3, 'Q4 logistics invoice', 'pending_approval',
             'mem_nw_operator', 2, $4, $5, $6, $7)`,
    [NORTHWIND.id, VENDORS[1], pendingRaw.toString(), JSON.stringify(QUORUM_MEMBERS), JSON.stringify(DECISION), at,
      toDate(now + 604800)]);
  await event(NORTHWIND, 'intent.created', 'int_seed_pending', data('int_seed_pending', pendingRaw, 'pending_approval'));
  await client.query(
    "INSERT INTO approvals (intent_id, member_id, decision, reason, created_at) VALUES ('int_seed_pending', 'mem_nw_approver1', 'approve', NULL, $1)",
    [at]);
  await event(NORTHWIND, 'intent.approved', 'int_seed_pending', data('int_seed_pending', pendingRaw, 'pending_approval'));
}
