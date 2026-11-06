import { parseCookies } from '../api/pipeline.js';
import { withClient, withTransaction } from '../lib/db.js';
import { sha256Hex, numToBigInt, rawToDisplay, formatTsMinutes, DECIMALS } from '../lib/core.js';
import { verifyChain } from '../lib/audit.js';
import { applyExpiry } from '../lib/intents.js';
import { landingPage, pricingPage, contactPage, loginPage, notFoundPageHtml } from './public.js';
import {
  consoleOverview, walletPage, approvalsPage, intentsPage, policiesPage, policyPage,
  quorumsPage, auditPage, settingsPage, noAccess, notFoundPanel, consoleFrameHtml,
} from './console.js';

function send(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function viewerFromCookie(req) {
  const cookies = parseCookies(req);
  const token = cookies.corvo_session;
  if (!token) return null;
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT m.*, o.id AS org_id, o.name AS org_name, o.app_id
       FROM sessions s JOIN members m ON m.id = s.member_id
       JOIN organizations o ON o.id = m.organization_id
       WHERE s.token_hash = $1`, [sha256Hex(token)]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id, name: r.name, email: r.email, role: r.role,
      org: { id: r.org_id, name: r.org_name, app_id: r.app_id },
    };
  });
}

async function inboxCountFor(memberId, orgId) {
  const { rows } = await withClient(async (client) => {
    await applyExpiry(client, new Date(), orgId);
    return client.query(
      `SELECT count(*)::int AS n FROM intents i
       WHERE i.organization_id = $1 AND i.status = 'pending_approval'
         AND i.quorum_member_ids ? $2
         AND i.created_by <> $2
         AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.intent_id = i.id AND a.member_id = $2)`,
      [orgId, memberId]);
  });
  return rows[0].n;
}

function intentToView(row, extras) {
  return {
    id: row.id,
    wallet_id: row.wallet_id,
    wallet_name: extras.walletName,
    wallet_asset: extras.walletAsset,
    kind: row.kind,
    destination_address: row.destination_address,
    amount: rawToDisplay(numToBigInt(row.raw_amount), extras.walletAsset),
    memo: row.memo,
    status: row.status,
    created_by: row.created_by,
    initiator_name: extras.initiatorName,
    required_approvals: row.required_approvals,
    policy_decision: row.policy_decision,
    created_at: extras.created,
    expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    tx_hash: row.tx_hash,
    rejection_reason: row.rejection_reason,
    approvals: extras.approvals,
    items: extras.items,
  };
}

async function loadIntentViews(client, rows) {
  const views = [];
  for (const row of rows) {
    const { rows: [wallet] } = await client.query('SELECT name, asset FROM wallets WHERE id = $1', [row.wallet_id]);
    const { rows: approvals } = await client.query(
      `SELECT a.*, m.name AS name FROM approvals a JOIN members m ON m.id = a.member_id
       WHERE a.intent_id = $1 ORDER BY a.created_at`, [row.id]);
    const { rows: items } = row.kind === 'batch'
      ? await client.query('SELECT * FROM intent_items WHERE intent_id = $1 ORDER BY position', [row.id])
      : { rows: [] };
    const { rows: [initiator] } = await client.query('SELECT name FROM members WHERE id = $1', [row.created_by]);
    views.push(intentToView(row, {
      walletName: wallet ? wallet.name : row.wallet_id,
      walletAsset: wallet ? wallet.asset : 'usdc',
      initiatorName: initiator ? initiator.name : row.created_by,
      approvals: approvals.map((a) => ({
        member_id: a.member_id, decision: a.decision, reason: a.reason,
        name: a.name, created_at: a.created_at.toISOString(),
      })),
      items: items.map((it) => ({
        position: it.position, destination_address: it.destination_address,
        amount: rawToDisplay(numToBigInt(it.raw_amount), wallet ? wallet.asset : 'usdc'),
        memo: it.memo,
      })),
      created: row.created_at.toISOString(),
    }));
  }
  return views;
}

export async function renderPage(req, res, pathname, query) {
  // Public pages.
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/') return send(res, 200, landingPage());
    if (pathname === '/pricing') return send(res, 200, pricingPage());
    if (pathname === '/contact') return send(res, 200, contactPage());
    if (pathname === '/login') return send(res, 200, loginPage(query.get('next') || ''));
  }
  if (!pathname.startsWith('/console')) {
    send(res, 404, notFoundPageHtml());
    return;
  }
  const viewer = await viewerFromCookie(req);
  if (!viewer) {
    redirect(res, `/login?next=${encodeURIComponent(pathname)}`);
    return;
  }
  const org = viewer.org;
  const inboxCount = await inboxCountFor(viewer.id, org.id);
  const role = viewer.role;

  if (pathname === '/console') {
    const data = await withTransaction(async (client) => {
      await applyExpiry(client, new Date(), org.id);
      const { rows: wallets } = await client.query(
        `SELECT w.*, p.name AS policy_name, q.name AS quorum_name FROM wallets w
         LEFT JOIN policies p ON p.id = w.policy_id
         LEFT JOIN key_quorums q ON q.id = w.quorum_id
         WHERE w.organization_id = $1 ORDER BY w.name COLLATE "C"`, [org.id]);
      const { rows: pend } = await client.query(
        `SELECT count(*)::int AS n FROM intents WHERE organization_id = $1 AND status = 'pending_approval'`, [org.id]);
      const { rows: ex24 } = await client.query(
        `SELECT count(*)::int AS n FROM intents WHERE organization_id = $1 AND status = 'executed'
           AND executed_at > $2`, [org.id, new Date(Date.now() - 86400000)]);
      const { rows: policies } = await client.query('SELECT * FROM policies WHERE organization_id = $1', [org.id]);
      const { rows: quorums } = await client.query('SELECT * FROM key_quorums WHERE organization_id = $1', [org.id]);
      const { rows: reserved } = await client.query(
        `SELECT wallet_id, coalesce(sum(raw_amount),0)::text AS s FROM intents
         WHERE status = 'pending_approval' GROUP BY wallet_id`);
      const resv = new Map(reserved.map((r) => [r.wallet_id, numToBigInt(r.s)]));
      const walletViews = wallets.map((w) => ({
        id: w.id, name: w.name, chain: w.chain, asset: w.asset,
        balance: rawToDisplay(numToBigInt(w.balance_raw), w.asset),
        available: rawToDisplay(numToBigInt(w.balance_raw) - (resv.get(w.id) || 0n), w.asset),
        pending: rawToDisplay(resv.get(w.id) || 0n, w.asset),
        policy_name: w.policy_name, quorum_name: w.quorum_name, status: w.status,
      }));
      return {
        stats: {
          totalWallets: wallets.length,
          pendingIntents: pend[0].n,
          awaitingYou: inboxCount,
          executed24h: ex24[0].n,
        },
        wallets: { rows: walletViews, policies, quorums },
      };
    });
    send(res, 200, consoleOverview(viewer, org, data.stats, data.wallets));
    return;
  }

  const walletMatch = /^\/console\/wallets\/([a-z0-9_]+)$/.exec(pathname);
  if (walletMatch) {
    const walletId = walletMatch[1];
    const data = await withTransaction(async (client) => {
      await applyExpiry(client, new Date(), org.id);
      const { rows: [wallet] } = await client.query(
        `SELECT w.*, p.name AS policy_name, q.name AS quorum_name FROM wallets w
         LEFT JOIN policies p ON p.id = w.policy_id
         LEFT JOIN key_quorums q ON q.id = w.quorum_id
         WHERE w.id = $1 AND w.organization_id = $2`, [walletId, org.id]);
      if (!wallet) return null;
      const { rows: resv } = await client.query(
        `SELECT coalesce(sum(raw_amount),0)::text AS s FROM intents
         WHERE wallet_id = $1 AND status = 'pending_approval'`, [walletId]);
      const reserved = numToBigInt(resv[0].s);
      const balance = numToBigInt(wallet.balance_raw);
      const { rows: activity } = await client.query(
        `SELECT 'Deposit' AS type, reference AS detail, raw_amount::text AS raw, NULL AS status, created_at,
                'deposit' AS kind
         FROM deposits WHERE wallet_id = $1
         UNION ALL
         SELECT CASE WHEN kind = 'batch' THEN 'Batch' ELSE 'Transfer' END,
                coalesce(destination_address, kind || ' payout'),
                raw_amount::text, status, created_at, 'intent'
         FROM intents WHERE wallet_id = $1
         ORDER BY created_at DESC LIMIT 50`, [walletId]);
      return {
        wallet: {
          id: wallet.id, name: wallet.name, chain: wallet.chain, asset: wallet.asset,
          address: wallet.address,
          balance: rawToDisplay(balance, wallet.asset),
          available: rawToDisplay(balance - reserved, wallet.asset),
          reserved: rawToDisplay(reserved, wallet.asset),
          policy_name: wallet.policy_name, quorum_name: wallet.quorum_name,
          approval_floor: rawToDisplay(numToBigInt(wallet.approval_floor_raw), wallet.asset),
          status: wallet.status,
        },
        activity: activity.map((a) => ({
          type: a.kind === 'deposit' ? 'Deposit' : (a.status === 'pending_approval' ? 'Pending payout' : 'Payout'),
          detail: a.detail,
          amount: `${rawToDisplay(numToBigInt(a.raw), wallet.asset)} ${wallet.asset.toUpperCase()}`,
          status: a.status,
          when: formatTsMinutes(a.created_at),
        })),
      };
    });
    if (!data) {
      send(res, 404, notFoundFrame(viewer, org, inboxCount));
      return;
    }
    send(res, 200, walletPage(viewer, org, { ...data, inboxCount, members: [] }));
    return;
  }

  if (pathname === '/console/approvals') {
    const inbox = await withTransaction(async (client) => {
      await applyExpiry(client, new Date(), org.id);
      const { rows } = await client.query(
        `SELECT i.* FROM intents i
         WHERE i.organization_id = $1 AND i.status = 'pending_approval'
           AND i.quorum_member_ids ? $2
           AND i.created_by <> $2
           AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.intent_id = i.id AND a.member_id = $2)
         ORDER BY i.created_at DESC, i.id DESC LIMIT 100`, [org.id, viewer.id]);
      return loadIntentViews(client, rows);
    });
    send(res, 200, approvalsPage(viewer, org, inbox, inbox.length));
    return;
  }

  if (pathname === '/console/intents') {
    const status = query.get('status') || '';
    const data = await withTransaction(async (client) => {
      await applyExpiry(client, new Date(), org.id);
      const params = [org.id];
      let where = 'i.organization_id = $1';
      if (status) { params.push(status); where += ` AND i.status = $${params.length}`; }
      const { rows } = await client.query(
        `SELECT i.* FROM intents i WHERE ${where} ORDER BY i.created_at DESC, i.id DESC LIMIT 20`, params);
      return loadIntentViews(client, rows);
    });
    send(res, 200, intentsPage(viewer, org, data, null, status, inboxCount));
    return;
  }

  if (pathname === '/console/policies') {
    const { rows } = await withClient((client) => client.query(
      'SELECT * FROM policies WHERE organization_id = $1 ORDER BY name COLLATE "C"', [org.id]));
    send(res, 200, policiesPage(viewer, org, rows.map((p) => ({ ...p, rules: p.rules })), inboxCount));
    return;
  }

  const policyMatch = /^\/console\/policies\/([a-z0-9_]+)$/.exec(pathname);
  if (policyMatch) {
    const simulateQ = query.get('simulate') === '1' ? {
      wallet_id: query.get('wallet_id') || '',
      destination_address: query.get('destination_address') || '',
      amount: query.get('amount') || '',
    } : null;
    const data = await withClient(async (client) => {
      const { rows: [policy] } = await client.query(
        'SELECT * FROM policies WHERE id = $1 AND organization_id = $2', [policyMatch[1], org.id]);
      if (!policy) return null;
      const { rows: revisions } = await client.query(
        'SELECT * FROM policy_revisions WHERE policy_id = $1 ORDER BY revision', [policy.id]);
      const { rows: wallets } = await client.query(
        'SELECT * FROM wallets WHERE organization_id = $1 ORDER BY name COLLATE "C"', [org.id]);
      const { rows: aggs } = await client.query(
        'SELECT * FROM aggregations WHERE organization_id = $1', [org.id]);
      let simulateResult = null;
      if (simulateQ) {
        const { evaluatePolicy, aggregationValuesForPolicy, aggValuesByField } = await import('../lib/policy.js');
        const { checkAmount, getWallet, checkAddress } = await import('../lib/intents.js');
        try {
          const wallet = await getWallet(client, org.id, simulateQ.wallet_id);
          if (wallet) {
            const dest = checkAddress(simulateQ.destination_address, 'destination_address');
            const amount = checkAmount(simulateQ.amount, wallet.asset, 'amount');
            const now = new Date(Math.floor(Date.now() / 1000) * 1000);
            const values = await aggregationValuesForPolicy(client, org.id, policy.rules, wallet, dest, now,
              [{ destination: dest, amount }], 1);
            const result = evaluatePolicy(policy.rules, {
              method: query.get('method') === 'batch_payout' ? 'batch_payout' : 'transfer',
              source: { asset: wallet.asset, chain: wallet.chain, amount },
              destination: { address: dest },
              now: BigInt(Math.floor(now.getTime() / 1000)),
            }, aggValuesByField(values));
            const aggregations = {};
            for (const [id, v] of Object.entries(values)) aggregations[id] = v.toString();
            simulateResult = {
              action: result.action, rule: result.rule, policy_revision: policy.revision,
              aggregations,
              aggregation_names: Object.fromEntries(aggs.map((a) => [a.id, a.name])),
              trace: result.trace,
              wallet_id: wallet.id, destination_address: dest, amount: simulateQ.amount,
            };
          }
        } catch {
          simulateResult = null;
        }
      }
      return { policy, revisions, wallets, aggs, simulateResult };
    });
    if (!data) {
      send(res, 404, notFoundFrame(viewer, org, inboxCount));
      return;
    }
    send(res, 200, policyPage(viewer, org, data.policy, data.revisions, data.wallets, data.aggs, inboxCount, data.simulateResult));
    return;
  }

  if (pathname === '/console/quorums') {
    const data = await withClient(async (client) => {
      const { rows: quorums } = await client.query(
        'SELECT * FROM key_quorums WHERE organization_id = $1 ORDER BY name COLLATE "C"', [org.id]);
      const { rows: aggregations } = await client.query(
        'SELECT * FROM aggregations WHERE organization_id = $1 ORDER BY name COLLATE "C"', [org.id]);
      const { rows: wallets } = await client.query(
        'SELECT * FROM wallets WHERE organization_id = $1 ORDER BY name COLLATE "C"', [org.id]);
      const { rows: members } = await client.query(
        'SELECT * FROM members WHERE organization_id = $1 ORDER BY email', [org.id]);
      return { quorums, aggregations, wallets, members };
    });
    send(res, 200, quorumsPage(viewer, org, data.quorums, data.aggregations, data.wallets, data.members, inboxCount));
    return;
  }

  if (pathname === '/console/audit') {
    if (role !== 'owner' && role !== 'auditor') {
      send(res, 200, noAccessFrame(viewer, org, inboxCount));
      return;
    }
    const data = await withClient(async (client) => {
      const { rows: audit } = await client.query(
        'SELECT * FROM audit_events WHERE organization_id = $1 ORDER BY seq LIMIT 100', [org.id]);
      const { rows: events } = await client.query(
        'SELECT * FROM webhook_events WHERE organization_id = $1 ORDER BY seq LIMIT 100', [org.id]);
      const chain = await verifyChain(client, org.id);
      return { audit, events, chain };
    });
    send(res, 200, auditPage(viewer, org, data.audit, data.events, data.chain, inboxCount));
    return;
  }

  if (pathname === '/console/settings') {
    const data = await withClient(async (client) => {
      const { rows: members } = await client.query(
        'SELECT * FROM members WHERE organization_id = $1 ORDER BY email', [org.id]);
      const { rows: keys } = await client.query(
        `SELECT k.*, m.name AS creator_name FROM api_keys k
         JOIN members m ON m.id = k.created_by
         WHERE k.organization_id = $1 ORDER BY k.created_at`, [org.id]);
      return { members, keys };
    });
    send(res, 200, settingsPage(viewer, org, data.members, data.keys, inboxCount));
    return;
  }

  send(res, 404, notFoundFrame(viewer, org, inboxCount));
}



function noAccessFrame(viewer, org, inboxCount) {
  return consoleFrameHtml(viewer, org, inboxCount, 'No access', 'settings', noAccess());
}

function notFoundFrame(viewer, org, inboxCount) {
  return consoleFrameHtml(viewer, org, inboxCount, 'Not found', 'overview', notFoundPanel());
}
