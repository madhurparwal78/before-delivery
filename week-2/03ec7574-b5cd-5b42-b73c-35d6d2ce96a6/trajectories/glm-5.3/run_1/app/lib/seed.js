import { SCHEMA_SQL } from './schema.js';
import { advisoryLock } from './db.js';
import {
  newId, newSalt, hashPassword, newWebhookSecret, walletAddress, txHash,
} from './core.js';
import { auditAppend } from './audit.js';

const SEED_LOCK = 91732544101n;
export const SEED_PASSWORD = 'deku-demo-pw-2026';

export async function applySchema(client) {
  await client.query(SCHEMA_SQL);
}

function ledgerPair(client, orgId, movementId, kind, minusAccount, plusAccount, asset, rawAmount, intentId, depositId, at) {
  return Promise.all([
    client.query(
      `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [newId('evt'), orgId, movementId, kind, minusAccount, asset, (-rawAmount).toString(), intentId, depositId, at]
    ),
    client.query(
      `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [newId('evt'), orgId, movementId, kind, plusAccount, asset, rawAmount.toString(), intentId, depositId, at]
    ),
  ]);
}

export async function seed(client, now = new Date()) {
  await client.query('BEGIN');
  try {
    return await seedLocked(client, now);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.query('COMMIT').catch(() => {});
  }
}

async function seedLocked(client, now) {
  await advisoryLock(client, SEED_LOCK);
  const { rows } = await client.query('SELECT count(*)::int AS n FROM organizations');
  if (rows[0].n > 0) return false;

  const ts = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const nw = 'org_northwind';
  const ac = 'org_acme';
  const secrets = { [nw]: newWebhookSecret(), [ac]: newWebhookSecret() };

  await client.query(
    `INSERT INTO organizations (id, name, app_id, webhook_secret, created_at, audit_seq, webhook_seq, seeded)
     VALUES ($1,$2,$3,$4,$5,0,0,true), ($6,$7,$8,$9,$10,0,0,true)`,
    [nw, 'Northwind Treasury', 'app_nw7k2m9q4x1z', secrets[nw], ts,
      ac, 'Acme Payroll', 'app_ac3p8r5t6v2w', secrets[ac], ts]
  );

  const pwSalt = newSalt();
  const passwordHash = `corvo1:${pwSalt}:${hashPassword(SEED_PASSWORD, pwSalt)}`;
  const members = [
    ['mem_nw_owner', nw, 'Nadia Owens', 'nw.owner@example.com', 'owner'],
    ['mem_nw_operator', nw, 'Omar Patel', 'nw.operator@example.com', 'operator'],
    ['mem_nw_approver1', nw, 'Ada Byrne', 'nw.approver1@example.com', 'approver'],
    ['mem_nw_approver2', nw, 'Ben Okoro', 'nw.approver2@example.com', 'approver'],
    ['mem_nw_auditor', nw, 'Uma Diaz', 'nw.auditor@example.com', 'auditor'],
    ['mem_acme_owner', ac, 'Jordan Lee', 'acme.owner@example.com', 'owner'],
  ];
  for (const [id, orgId, name, email, role] of members) {
    await client.query(
      `INSERT INTO members (id, organization_id, name, email, role, password_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, orgId, name, email, role, passwordHash, ts]
    );
  }

  await client.query(
    `INSERT INTO aggregations (id, organization_id, name, metric, window_seconds, asset, group_by, created_at)
     VALUES ('agg_daily_outflow',$1,'Daily outflow','sum_amount',86400,'usdc','wallet',$2)`,
    [nw, ts]
  );

  const financeMembers = ['mem_nw_approver1', 'mem_nw_approver2', 'mem_nw_owner'];
  await client.query(
    `INSERT INTO key_quorums (id, organization_id, name, member_ids, authorization_threshold, expiry_seconds, created_at)
     VALUES ('kq_finance',$1,'Finance quorum',$2,2,604800,$3)`,
    [nw, JSON.stringify(financeMembers), ts]
  );

  const payrollAddr = walletAddress('wal_payroll');
  const vendor = (hex) => `0x${hex}`;
  const seedRules = [
    { name: 'Block burn address', method: 'transfer', action: 'DENY', conditions: [
      { field_source: 'request_body', field: 'destination.address', operator: 'in',
        value: [vendor('000000000000000000000000000000000000dead')] }] },
    { name: 'Vendors under daily cap', method: 'transfer', action: 'ALLOW', conditions: [
      { field_source: 'request_body', field: 'destination.address', operator: 'in',
        value: [vendor('1111111111111111111111111111111111111111'), vendor('2222222222222222222222222222222222222222'), vendor('3333333333333333333333333333333333333333')] },
      { field_source: 'reference', field: 'aggregation.agg_daily_outflow', operator: 'lte', value: '50000000000' }] },
    { name: 'Sweep to payroll', method: 'transfer', action: 'ALLOW', conditions: [
      { field_source: 'request_body', field: 'destination.address', operator: 'eq', value: payrollAddr }] },
    { name: 'Payroll lines under 5000', method: 'batch_payout', action: 'ALLOW', conditions: [
      { field_source: 'request_body', field: 'source.amount', operator: 'lte', value: '5000000000' }] },
  ];
  const rulesJson = JSON.stringify(seedRules);
  await client.query(
    `INSERT INTO policies (id, organization_id, version, name, chain_type, rules, revision, created_at, updated_at)
     VALUES ('pol_operating',$1,'1.0','Operating limits','ethereum',$2,1,$3,$4)`,
    [nw, rulesJson, ts, ts]
  );
  await client.query(
    `INSERT INTO policy_revisions (policy_id, revision, name, rules, created_at)
     VALUES ('pol_operating',1,'Operating limits',$1,$2)`,
    [rulesJson, ts]
  );

  const paidAmount = 3500000000n;
  const wallets = [
    { id: 'wal_operating', org: nw, name: 'Operating USDC', chain: 'base', asset: 'usdc', bal: 250000000000n, policy: 'pol_operating', quorum: 'kq_finance', floor: 10000000000n },
    { id: 'wal_payroll', org: nw, name: 'Payroll USDC', chain: 'base', asset: 'usdc', bal: 40000000000n, policy: null, quorum: 'kq_finance', floor: 25000000000n },
    { id: 'wal_gas', org: nw, name: 'Gas reserve', chain: 'ethereum', asset: 'eth', bal: 12500000000000000000n, policy: null, quorum: null, floor: 0n },
    { id: 'wal_acme_ops', org: ac, name: 'Acme Operating', chain: 'base', asset: 'usdc', bal: 9000000000n, policy: null, quorum: null, floor: 0n },
  ];
  for (const w of wallets) {
    await client.query(
      `INSERT INTO wallets (id, organization_id, name, chain, asset, address, balance_raw, policy_id, quorum_id, approval_floor_raw, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)`,
      [w.id, w.org, w.name, w.chain, w.asset, walletAddress(w.id), w.bal.toString(), w.policy, w.quorum, w.floor.toString(), ts]
    );
    // The opening pair books the balance the wallet holds after its seeded
    // transfer pairs; wal_operating opens at 253500 and int_seed_paid's
    // transfer pair then reduces it to 250000.
    const open = w.id === 'wal_operating' ? w.bal + paidAmount : w.bal;
    await ledgerPair(client, w.org, newId('evt'), 'opening', 'external', w.id, w.asset, open, null, null, ts);
  }

  // int_seed_paid
  const paidAt = new Date('2026-09-15T10:00:00Z');
  const paidDecision = { action: 'ALLOW', rule: 'Vendors under daily cap', reason: 'matched_rule', policy_id: 'pol_operating', policy_revision: 1 };
  await client.query(
    `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status, created_by,
      required_approvals, quorum_member_ids, policy_decision, created_at, expires_at, decided_at, executed_at, tx_hash, rejection_reason)
     VALUES ('int_seed_paid',$1,'wal_operating','transfer','0x1111111111111111111111111111111111111111',$2,
      'September tooling','executed','mem_nw_operator',0,'[]'::jsonb,$3,$4,NULL,$4,$4,$5,NULL)`,
    [nw, paidAmount.toString(), JSON.stringify(paidDecision), paidAt, txHash('int_seed_paid')]
  );
  await ledgerPair(client, nw, newId('evt'), 'transfer', 'wal_operating', 'external', 'usdc', paidAmount, 'int_seed_paid', null, paidAt);

  // int_seed_pending
  const pendingAmount = 12000000000n;
  const pendingDecision = { ...paidDecision };
  const expiresAt = new Date(ts.getTime() + 604800000);
  await client.query(
    `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status, created_by,
      required_approvals, quorum_member_ids, policy_decision, created_at, expires_at, decided_at, executed_at, tx_hash, rejection_reason)
     VALUES ('int_seed_pending',$1,'wal_operating','transfer','0x2222222222222222222222222222222222222222',$2,
      'Q4 logistics invoice','pending_approval','mem_nw_operator',2,$3,$4,$5,$6,NULL,NULL,NULL,NULL)`,
    [nw, pendingAmount.toString(), JSON.stringify(financeMembers), JSON.stringify(pendingDecision), ts, expiresAt]
  );
  await client.query(
    `INSERT INTO approvals (intent_id, member_id, decision, reason, created_at)
     VALUES ('int_seed_pending','mem_nw_approver1','approve',NULL,$1)`,
    [ts]
  );

  const audit = [];
  for (const m of members.filter((x) => x[1] === nw)) {
    audit.push(['member.added', m[0], { member_id: m[0], name: m[2], email: m[3], role: m[4] }]);
  }
  audit.push(['aggregation.created', 'agg_daily_outflow', { aggregation_id: 'agg_daily_outflow', name: 'Daily outflow', metric: 'sum_amount', window_seconds: 86400, asset: 'usdc', group_by: 'wallet' }]);
  audit.push(['quorum.created', 'kq_finance', { quorum_id: 'kq_finance', name: 'Finance quorum', member_ids: financeMembers, authorization_threshold: 2, expiry_seconds: 604800 }]);
  audit.push(['policy.created', 'pol_operating', { policy_id: 'pol_operating', name: 'Operating limits', revision: 1, rule_count: seedRules.length }]);
  for (const w of wallets.filter((x) => x.org === nw)) {
    audit.push(['wallet.created', w.id, { wallet_id: w.id, name: w.name, chain: w.chain, asset: w.asset, balance_raw: w.bal.toString() }]);
  }
  audit.push(['intent.created', 'int_seed_paid', { intent_id: 'int_seed_paid', wallet_id: 'wal_operating', kind: 'transfer', raw_amount: '3500000000', status: 'executed' }]);
  audit.push(['intent.executed', 'int_seed_paid', { intent_id: 'int_seed_paid', wallet_id: 'wal_operating', kind: 'transfer', raw_amount: '3500000000', status: 'executed' }]);
  audit.push(['intent.created', 'int_seed_pending', { intent_id: 'int_seed_pending', wallet_id: 'wal_operating', kind: 'transfer', raw_amount: '12000000000', status: 'pending_approval' }]);
  audit.push(['intent.approved', 'int_seed_pending', { intent_id: 'int_seed_pending', wallet_id: 'wal_operating', kind: 'transfer', raw_amount: '12000000000', status: 'pending_approval' }]);
  for (const [type, subject, data] of audit) {
    await auditAppend(client, nw, type, 'system', subject, ts, data, { signed: type.startsWith('intent.') });
  }
  await auditAppend(client, ac, 'member.added', 'system', 'mem_acme_owner', ts,
    { member_id: 'mem_acme_owner', name: 'Jordan Lee', email: 'acme.owner@example.com', role: 'owner' }, { signed: false });
  await auditAppend(client, ac, 'wallet.created', 'system', 'wal_acme_ops', ts,
    { wallet_id: 'wal_acme_ops', name: 'Acme Operating', chain: 'base', asset: 'usdc', balance_raw: '9000000000' }, { signed: false });

  return true;
}
