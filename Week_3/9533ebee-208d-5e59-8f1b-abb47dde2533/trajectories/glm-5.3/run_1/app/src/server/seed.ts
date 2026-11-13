import type { Pool } from './db.js';
import { ASSETS, SEED_CURVES, SEED_PARAMS } from '../shared/assets.js';
import type { AssetCode, Leg } from '../shared/types.js';
import { appendPosting, walletAccount, collateralAccount, loanAccount } from './ledger.js';
import { INDEX_SCALE } from './domain.js';

interface SeedMember {
  actor_id: string;
  name: string;
  email: string;
  role: 'risk_steward' | 'liquidity_provider' | 'borrower' | 'trader' | 'liquidator';
}

const MEMBERS: SeedMember[] = [
  { actor_id: 'stw-ines', name: 'Ines Varga', email: 'ines.varga@quillmoor.example', role: 'risk_steward' },
  { actor_id: 'stw-odile', name: 'Odile Marchetti', email: 'odile.marchetti@quillmoor.example', role: 'risk_steward' },
  { actor_id: 'lp-rosa', name: 'Rosa Aldana', email: 'rosa.aldana@quillmoor.example', role: 'liquidity_provider' },
  { actor_id: 'lp-tomas', name: 'Tomas Ferreira', email: 'tomas.ferreira@quillmoor.example', role: 'liquidity_provider' },
  { actor_id: 'br-sanna', name: 'Sanna Lindqvist', email: 'sanna.lindqvist@quillmoor.example', role: 'borrower' },
  { actor_id: 'br-dele', name: 'Dele Oyelaran', email: 'dele.oyelaran@quillmoor.example', role: 'borrower' },
  { actor_id: 'br-mara', name: 'Mara Castell', email: 'mara.castell@quillmoor.example', role: 'borrower' },
  { actor_id: 'br-yusuf', name: 'Yusuf Brandt', email: 'yusuf.brandt@quillmoor.example', role: 'borrower' },
  { actor_id: 'br-ivo', name: 'Ivo Petrak', email: 'ivo.petrak@quillmoor.example', role: 'borrower' },
  { actor_id: 'tr-petra', name: 'Petra Novak', email: 'petra.novak@quillmoor.example', role: 'trader' },
  { actor_id: 'lq-kestrel', name: 'Kestrel Keepers', email: 'desk@kestrel-keepers.example', role: 'liquidator' },
  { actor_id: 'lq-vane', name: 'Vane Desk', email: 'ops@vane-desk.example', role: 'liquidator' },
];

interface SeedPosition {
  position_id: string;
  borrower_id: string;
  collateral_asset: AssetCode;
  debt_asset: AssetCode;
  collateral_amount: bigint;
  debt: bigint;
  collateral_transfer: bigint;
}

const POSITIONS: SeedPosition[] = [
  { position_id: 'pos-0001', borrower_id: 'br-sanna', collateral_asset: 'MBTC', debt_asset: 'QUSD', collateral_amount: 200_000_000n, debt: 60_000_000_000n, collateral_transfer: 200_000_000n },
  { position_id: 'pos-0002', borrower_id: 'br-dele', collateral_asset: 'MBTC', debt_asset: 'QUSD', collateral_amount: 150_000_000n, debt: 64_000_000_000n, collateral_transfer: 150_000_000n },
  { position_id: 'pos-0003', borrower_id: 'br-mara', collateral_asset: 'MBTC', debt_asset: 'QUSD', collateral_amount: 100_000_000n, debt: 40_000_000_000n, collateral_transfer: 100_000_000n },
  { position_id: 'pos-0004', borrower_id: 'br-yusuf', collateral_asset: 'MBTC', debt_asset: 'QUSD', collateral_amount: 50_000_000n, debt: 21_000_000_000n, collateral_transfer: 50_000_000n },
  { position_id: 'pos-0005', borrower_id: 'br-ivo', collateral_asset: 'METH', debt_asset: 'QUSD', collateral_amount: 10_000_000_000_000_000_000n, debt: 16_000_000_000n, collateral_transfer: 10_000_000_000_000_000_000n },
];

const OTHER_WALLETS: Array<{ actor_id: string; asset: AssetCode; amount: bigint }> = [
  { actor_id: 'tr-petra', asset: 'MBTC', amount: 100_000_000n },
  { actor_id: 'tr-petra', asset: 'QUSD', amount: 50_000_000_000n },
  { actor_id: 'tr-petra', asset: 'METH', amount: 5_000_000_000_000_000_000n },
  { actor_id: 'lq-kestrel', asset: 'QUSD', amount: 250_000_000_000n },
  { actor_id: 'lq-vane', asset: 'QUSD', amount: 250_000_000_000n },
  { actor_id: 'lp-rosa', asset: 'QUSD', amount: 100_000_000_000n },
  { actor_id: 'lp-tomas', asset: 'METH', amount: 10_000_000_000_000_000_000n },
];

/** Apply the seed exactly once, even when several servers race on an empty database. */
export async function seedIfEmpty(db: Pool, now: Date): Promise<void> {
  await db.transaction(async (tx): Promise<void> => {
    const lock = await tx.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(918273645) AS locked');
    if (lock.rows[0].locked !== true) {
      await tx.query("SELECT pg_advisory_xact_lock(918273645)");
    }
    const check = await tx.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM members');
    if (BigInt(check.rows[0].count) > 0n) return;
    const nowSec = Math.floor(now.getTime() / 1000);
    for (const member of MEMBERS) {
      await tx.query(
        'INSERT INTO members (actor_id, name, email, email_lower, role) VALUES ($1, $2, $3, $4, $5)',
        [member.actor_id, member.name, member.email, member.email.toLowerCase(), member.role],
      );
    }
    for (const code of Object.keys(ASSETS) as AssetCode[]) {
      const asset = ASSETS[code];
      await tx.query('INSERT INTO assets (code, name, decimals) VALUES ($1, $2, $3)', [code, asset.name, asset.decimals]);
      const params = SEED_PARAMS[code];
      const curve = SEED_CURVES[code];
      await tx.query(
        `INSERT INTO pools (asset, total_shares, borrow_index, index_brought_to, ltv_bps, liquidation_threshold_bps,
          liquidation_bonus_bps, reserve_factor_bps, close_factor_bps, swap_fee_bps,
          curve_base_bps, curve_slope1_bps, curve_kink_bps, curve_slope2_bps, warning_hf_num)
         VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 11000)`,
        [code, INDEX_SCALE.toString(), nowSec, params.ltv_bps, params.liquidation_threshold_bps,
          params.liquidation_bonus_bps, params.reserve_factor_bps, params.close_factor_bps, params.swap_fee_bps,
          curve.base_bps, curve.slope1_bps, curve.kink_bps, curve.slope2_bps],
      );
    }
    const priceAt = new Date(nowSec * 1000);
    for (const code of Object.keys(ASSETS) as AssetCode[]) {
      const post = await tx.query<{ price_post_id: string }>(
        `INSERT INTO price_posts (price_post_id, asset, price, previous_price, posted_at, posted_by, source, oracle_round, evidence_key)
         VALUES (gen_random_uuid(), $1, $2, $2, $3, 'stw-ines', 'manual', NULL, NULL) RETURNING price_post_id`,
        [code, ASSETS[code].seedPrice.toString(), priceAt],
      );
      await tx.query('INSERT INTO current_prices (asset, price_post_id) VALUES ($1, $2)', [code, post.rows[0].price_post_id]);
      await tx.query('INSERT INTO oracle_status (asset, status) VALUES ($1, $2)', [code, 'unreachable']);
    }
  });
  await seedLedger(db, now);
}

async function seedLedger(db: Pool, now: Date): Promise<void> {
  await db.transaction(async (tx): Promise<void> => {
    await tx.query("SELECT pg_advisory_xact_lock(918273645)");
    const check = await tx.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM postings');
    if (BigInt(check.rows[0].count) > 0n) return;
    const at = new Date(Math.floor(now.getTime() / 1000) * 1000);
    const transfers: Array<{ actor_id: string; asset: AssetCode; amount: bigint }> = [];
    for (const position of POSITIONS) {
      transfers.push({ actor_id: position.borrower_id, asset: position.collateral_asset, amount: position.collateral_transfer });
    }
    transfers.push(...OTHER_WALLETS);
    for (const transfer of transfers) {
      await appendPosting(tx, 'transfer_in', [
        { account: 'custody', asset: transfer.asset, amount: -transfer.amount },
        { account: walletAccount(transfer.actor_id), asset: transfer.asset, amount: transfer.amount },
      ], transfer.actor_id, at);
    }
    // Supplies.
    const supplies: Array<{ asset: AssetCode; holder: string; amount: bigint }> = [];
    for (const code of Object.keys(ASSETS) as AssetCode[]) {
      const asset = ASSETS[code];
      supplies.push({ asset: code, holder: asset.poolSeedHolder, amount: asset.poolSeedSupply });
    }
    // Pool liquidity arrives by inbound transfer to the holder, who then supplies it,
    // so every wallet nets to the seed figures rather than going negative.
    for (const supply of supplies) {
      await appendPosting(tx, 'transfer_in', [
        { account: 'custody', asset: supply.asset, amount: -supply.amount },
        { account: walletAccount(supply.holder), asset: supply.asset, amount: supply.amount },
      ], supply.holder, at);
      await appendPosting(tx, 'supply', [
        { account: walletAccount(supply.holder), asset: supply.asset, amount: -supply.amount },
        { account: 'supply', asset: supply.asset, amount: supply.amount },
      ], supply.holder, at);
      await tx.query(
        `INSERT INTO shares (actor_id, asset, shares) VALUES ($1, $2, $3)
         ON CONFLICT (actor_id, asset) DO UPDATE SET shares = EXCLUDED.shares`,
        [supply.holder, supply.asset, supply.amount.toString()],
      );
      await tx.query('UPDATE pools SET total_shares = $1 WHERE asset = $2', [supply.amount.toString(), supply.asset]);
    }
    // Positions: lock collateral and draw debt.
    for (const position of POSITIONS) {
      await tx.query(
        `INSERT INTO positions (position_id, borrower_id, collateral_asset, debt_asset, collateral_amount, debt, posted_debt,
          principal, reference_index, state, grace_ends_at, after_fill_mark, margin_armed, round)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $6, $7, 'healthy', NULL, false, true, 0)`,
        [position.position_id, position.borrower_id, position.collateral_asset, position.debt_asset,
          position.collateral_amount.toString(), position.debt.toString(), INDEX_SCALE.toString()],
      );
      await appendPosting(tx, 'lock', [
        { account: walletAccount(position.borrower_id), asset: position.collateral_asset, amount: -position.collateral_amount },
        { account: collateralAccount(position.position_id), asset: position.collateral_asset, amount: position.collateral_amount },
      ], position.position_id, at);
      await appendPosting(tx, 'draw', [
        { account: loanAccount(position.position_id), asset: position.debt_asset, amount: -position.debt },
        { account: walletAccount(position.borrower_id), asset: position.debt_asset, amount: position.debt },
      ], position.position_id, at);
    }
  });
}

export type { Leg };
