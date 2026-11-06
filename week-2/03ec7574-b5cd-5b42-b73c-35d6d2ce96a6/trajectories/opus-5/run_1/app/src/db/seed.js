import { walletAddress, txHash } from '../domain/address.js';
import { appendEvent } from '../domain/audit.js';
import { hashPassword } from '../domain/credentials.js';
import { newWebhookSecret } from '../domain/ids.js';
import { recordExternalCredit } from '../domain/treasury.js';
import { withTransaction } from './pool.js';

const SEED_PASSWORD = 'deku-demo-pw-2026';
const SEED_LOCK = 7726148391;
const PAID_AT = '2026-09-15T10:00:00Z';

const ORGANIZATIONS = [
  { id: 'org_northwind', name: 'Northwind Treasury', app_id: 'app_nw7k2m9q4x1z' },
  { id: 'org_acme', name: 'Acme Payroll', app_id: 'app_ac3p8r5t6v2w' }
];

const MEMBERS = [
  { id: 'mem_nw_owner', name: 'Nadia Owens', email: 'nw.owner@example.com', role: 'owner', organization_id: 'org_northwind' },
  { id: 'mem_nw_operator', name: 'Omar Patel', email: 'nw.operator@example.com', role: 'operator', organization_id: 'org_northwind' },
  { id: 'mem_nw_approver1', name: 'Ada Byrne', email: 'nw.approver1@example.com', role: 'approver', organization_id: 'org_northwind' },
  { id: 'mem_nw_approver2', name: 'Ben Okoro', email: 'nw.approver2@example.com', role: 'approver', organization_id: 'org_northwind' },
  { id: 'mem_nw_auditor', name: 'Uma Diaz', email: 'nw.auditor@example.com', role: 'auditor', organization_id: 'org_northwind' },
  { id: 'mem_acme_owner', name: 'Jordan Lee', email: 'acme.owner@example.com', role: 'owner', organization_id: 'org_acme' }
];

const VENDOR_ONE = '0x1111111111111111111111111111111111111111';
const VENDOR_TWO = '0x2222222222222222222222222222222222222222';
const VENDOR_THREE = '0x3333333333333333333333333333333333333333';
const BURN_ADDRESS = '0x000000000000000000000000000000000000dead';

function seedPolicyRules() {
  return [
    {
      name: 'Block burn address',
      method: 'transfer',
      conditions: [{ field_source: 'request_body', field: 'destination.address', operator: 'in', value: [BURN_ADDRESS] }],
      action: 'DENY'
    },
    {
      name: 'Vendors under daily cap',
      method: 'transfer',
      conditions: [
        { field_source: 'request_body', field: 'destination.address', operator: 'in', value: [VENDOR_ONE, VENDOR_TWO, VENDOR_THREE] },
        { field_source: 'reference', field: 'aggregation.agg_daily_outflow', operator: 'lte', value: 50000000000 }
      ],
      action: 'ALLOW'
    },
    {
      name: 'Sweep to payroll',
      method: 'transfer',
      conditions: [{ field_source: 'request_body', field: 'destination.address', operator: 'eq', value: walletAddress('wal_payroll') }],
      action: 'ALLOW'
    },
    {
      name: 'Payroll lines under 5000',
      method: 'batch_payout',
      conditions: [{ field_source: 'request_body', field: 'source.amount', operator: 'lte', value: 5000000000 }],
      action: 'ALLOW'
    }
  ];
}

const SEED_WALLETS = [
  {
    id: 'wal_operating',
    organization_id: 'org_northwind',
    name: 'Operating USDC',
    chain: 'base',
    asset: 'usdc',
    balance_raw: '250000000000',
    opening_raw: '253500000000',
    policy_id: 'pol_operating',
    quorum_id: 'kq_finance',
    approval_floor_raw: '10000000000'
  },
  {
    id: 'wal_payroll',
    organization_id: 'org_northwind',
    name: 'Payroll USDC',
    chain: 'base',
    asset: 'usdc',
    balance_raw: '40000000000',
    opening_raw: '40000000000',
    policy_id: null,
    quorum_id: 'kq_finance',
    approval_floor_raw: '25000000000'
  },
  {
    id: 'wal_gas',
    organization_id: 'org_northwind',
    name: 'Gas reserve',
    chain: 'ethereum',
    asset: 'eth',
    balance_raw: '12500000000000000000',
    opening_raw: '12500000000000000000',
    policy_id: null,
    quorum_id: null,
    approval_floor_raw: '0'
  },
  {
    id: 'wal_acme_ops',
    organization_id: 'org_acme',
    name: 'Acme Operating',
    chain: 'base',
    asset: 'usdc',
    balance_raw: '9000000000',
    opening_raw: '9000000000',
    policy_id: null,
    quorum_id: null,
    approval_floor_raw: '0'
  }
];

const SEED_DECISION = {
  action: 'ALLOW',
  rule: 'Vendors under daily cap',
  reason: 'matched_rule',
  policy_id: 'pol_operating',
  policy_revision: 1
};

function intentData(intent, status) {
  return { intent_id: intent.id, wallet_id: intent.wallet_id, kind: 'transfer', raw_amount: intent.raw_amount, status };
}

/** Writes the pinned seed into an empty database, once, under an advisory lock. */
export async function seedDatabase() {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    const existing = await client.query('SELECT 1 FROM organizations LIMIT 1');
    if (existing.rows.length) return;

    const nowResult = await client.query('SELECT date_trunc(\'second\', now()) AS now');
    const now = nowResult.rows[0].now;
    const passwordHash = hashPassword(SEED_PASSWORD);

    const organizations = new Map();
    for (const organization of ORGANIZATIONS) {
      const secret = newWebhookSecret();
      await client.query(
        'INSERT INTO organizations (id, name, app_id, webhook_secret, created_at) VALUES ($1, $2, $3, $4, $5)',
        [organization.id, organization.name, organization.app_id, secret, now]
      );
      organizations.set(organization.id, { id: organization.id, webhook_secret: secret, now });
    }

    for (const member of MEMBERS) {
      await client.query(
        `INSERT INTO members (id, organization_id, name, email, role, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [member.id, member.organization_id, member.name, member.email, member.role, passwordHash, now]
      );
    }

    await client.query(
      `INSERT INTO aggregations (id, organization_id, name, metric, window_seconds, asset, group_by, created_at)
       VALUES ('agg_daily_outflow', 'org_northwind', 'Daily outflow', 'sum_amount', 86400, 'usdc', 'wallet', $1)`,
      [now]
    );
    await client.query(
      `INSERT INTO key_quorums (id, organization_id, name, member_ids, authorization_threshold, expiry_seconds, created_at)
       VALUES ('kq_finance', 'org_northwind', 'Finance quorum', $1, 2, 604800, $2)`,
      [JSON.stringify(['mem_nw_approver1', 'mem_nw_approver2', 'mem_nw_owner']), now]
    );
    const rules = JSON.stringify(seedPolicyRules());
    await client.query(
      `INSERT INTO policies (id, organization_id, version, name, chain_type, rules, revision, created_at, updated_at)
       VALUES ('pol_operating', 'org_northwind', '1.0', 'Operating limits', 'ethereum', $1, 1, $2, $2)`,
      [rules, now]
    );
    await client.query(
      `INSERT INTO policy_revisions (policy_id, revision, name, rules, created_at)
       VALUES ('pol_operating', 1, 'Operating limits', $1, $2)`,
      [rules, now]
    );

    for (const wallet of SEED_WALLETS) {
      await client.query(
        `INSERT INTO wallets (id, organization_id, name, chain, asset, address, balance_raw, policy_id, quorum_id, approval_floor_raw, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)`,
        [
          wallet.id, wallet.organization_id, wallet.name, wallet.chain, wallet.asset, walletAddress(wallet.id),
          wallet.balance_raw, wallet.policy_id, wallet.quorum_id, wallet.approval_floor_raw, now
        ]
      );
      await recordExternalCredit(client, {
        organizationId: wallet.organization_id,
        kind: 'opening',
        asset: wallet.asset,
        account: wallet.id,
        rawAmount: BigInt(wallet.opening_raw),
        now
      });
    }

    const paid = {
      id: 'int_seed_paid',
      wallet_id: 'wal_operating',
      raw_amount: '3500000000',
      destination_address: VENDOR_ONE,
      memo: 'September tooling'
    };
    await client.query(
      `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status, created_by,
         required_approvals, quorum_member_ids, policy_decision, created_at, expires_at, decided_at, executed_at, tx_hash, rejection_reason)
       VALUES ($1, 'org_northwind', 'wal_operating', 'transfer', $2, $3, $4, 'executed', 'mem_nw_operator', 0, '[]', $5, $6, NULL, $6, $6, $7, NULL)`,
      [paid.id, paid.destination_address, paid.raw_amount, paid.memo, JSON.stringify(SEED_DECISION), PAID_AT, txHash(paid.id)]
    );
    await client.query(
      `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
       VALUES ('led_seedpaidsourceentry1', 'org_northwind', 'mov_seedpaidmovement0001', 'transfer', 'wal_operating', 'usdc', $1, $2, NULL, $3),
              ('led_seedpaidexternentry1', 'org_northwind', 'mov_seedpaidmovement0001', 'transfer', 'external', 'usdc', $4, $2, NULL, $3)`,
      [`-${paid.raw_amount}`, paid.id, PAID_AT, paid.raw_amount]
    );

    const pending = {
      id: 'int_seed_pending',
      wallet_id: 'wal_operating',
      raw_amount: '12000000000',
      destination_address: VENDOR_TWO,
      memo: 'Q4 logistics invoice'
    };
    await client.query(
      `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status, created_by,
         required_approvals, quorum_member_ids, policy_decision, created_at, expires_at, decided_at, executed_at, tx_hash, rejection_reason)
       VALUES ($1, 'org_northwind', 'wal_operating', 'transfer', $2, $3, $4, 'pending_approval', 'mem_nw_operator', 2, $5, $6, $7,
         $7::timestamptz + make_interval(secs => 604800), NULL, NULL, NULL, NULL)`,
      [
        pending.id, pending.destination_address, pending.raw_amount, pending.memo,
        JSON.stringify(['mem_nw_approver1', 'mem_nw_approver2', 'mem_nw_owner']), JSON.stringify(SEED_DECISION), now
      ]
    );
    await client.query(
      'INSERT INTO approvals (intent_id, member_id, decision, reason, created_at) VALUES ($1, $2, $3, NULL, $4)',
      [pending.id, 'mem_nw_approver1', 'approve', now]
    );

    const northwind = organizations.get('org_northwind');
    const acme = organizations.get('org_acme');
    const event = (organization, type, subjectId, data) => appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type,
      actor: 'system',
      subjectId,
      at: now,
      data
    });

    for (const member of MEMBERS.filter((entry) => entry.organization_id === 'org_northwind')) {
      await event(northwind, 'member.added', member.id, {
        member_id: member.id,
        name: member.name,
        email: member.email,
        role: member.role
      });
    }
    await event(northwind, 'aggregation.created', 'agg_daily_outflow', {
      aggregation_id: 'agg_daily_outflow',
      name: 'Daily outflow',
      metric: 'sum_amount',
      window_seconds: 86400,
      asset: 'usdc',
      group_by: 'wallet'
    });
    await event(northwind, 'quorum.created', 'kq_finance', {
      quorum_id: 'kq_finance',
      name: 'Finance quorum',
      member_ids: ['mem_nw_approver1', 'mem_nw_approver2', 'mem_nw_owner'],
      authorization_threshold: 2,
      expiry_seconds: 604800
    });
    await event(northwind, 'policy.created', 'pol_operating', {
      policy_id: 'pol_operating',
      name: 'Operating limits',
      revision: 1
    });
    for (const wallet of SEED_WALLETS.filter((entry) => entry.organization_id === 'org_northwind')) {
      await event(northwind, 'wallet.created', wallet.id, {
        wallet_id: wallet.id,
        name: wallet.name,
        chain: wallet.chain,
        asset: wallet.asset,
        address: walletAddress(wallet.id),
        policy_id: wallet.policy_id,
        quorum_id: wallet.quorum_id,
        approval_floor_raw: wallet.approval_floor_raw
      });
    }
    await event(northwind, 'intent.created', paid.id, intentData(paid, 'executed'));
    await event(northwind, 'intent.executed', paid.id, intentData(paid, 'executed'));
    await event(northwind, 'intent.created', pending.id, intentData(pending, 'pending_approval'));
    await event(northwind, 'intent.approved', pending.id, intentData(pending, 'pending_approval'));

    const acmeOwner = MEMBERS.find((entry) => entry.id === 'mem_acme_owner');
    await event(acme, 'member.added', acmeOwner.id, {
      member_id: acmeOwner.id,
      name: acmeOwner.name,
      email: acmeOwner.email,
      role: acmeOwner.role
    });
    const acmeWallet = SEED_WALLETS.find((entry) => entry.id === 'wal_acme_ops');
    await event(acme, 'wallet.created', acmeWallet.id, {
      wallet_id: acmeWallet.id,
      name: acmeWallet.name,
      chain: acmeWallet.chain,
      asset: acmeWallet.asset,
      address: walletAddress(acmeWallet.id),
      policy_id: acmeWallet.policy_id,
      quorum_id: acmeWallet.quorum_id,
      approval_floor_raw: acmeWallet.approval_floor_raw
    });
  });
}
