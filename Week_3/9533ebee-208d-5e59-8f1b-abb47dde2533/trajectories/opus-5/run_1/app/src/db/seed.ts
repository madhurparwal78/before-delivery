/**
 * The seed: every member, asset, price post, pool and position the market
 * starts with, written as ordinary postings. Seed draws write no statements,
 * the seed queues no notices and emits no events, and its price posts are the
 * only posts without an evidence object.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { writeInstant } from './pool.ts';
import { INDEX_SCALE, type Asset } from '../domain/assets.ts';
import { insertPosting } from '../ledger/postings.ts';
import {
  CUSTODY,
  SUPPLY,
  collateralAccount,
  loanAccount,
  walletAccount,
} from '../ledger/accounts.ts';

type Role = 'risk_steward' | 'liquidity_provider' | 'borrower' | 'trader' | 'liquidator';

const ACTORS: ReadonlyArray<readonly [string, string, string, Role]> = [
  ['stw-ines', 'Ines Varga', 'ines.varga@quillmoor.example', 'risk_steward'],
  ['stw-odile', 'Odile Marchetti', 'odile.marchetti@quillmoor.example', 'risk_steward'],
  ['lp-rosa', 'Rosa Aldana', 'rosa.aldana@quillmoor.example', 'liquidity_provider'],
  ['lp-tomas', 'Tomas Ferreira', 'tomas.ferreira@quillmoor.example', 'liquidity_provider'],
  ['br-sanna', 'Sanna Lindqvist', 'sanna.lindqvist@quillmoor.example', 'borrower'],
  ['br-dele', 'Dele Oyelaran', 'dele.oyelaran@quillmoor.example', 'borrower'],
  ['br-mara', 'Mara Castell', 'mara.castell@quillmoor.example', 'borrower'],
  ['br-yusuf', 'Yusuf Brandt', 'yusuf.brandt@quillmoor.example', 'borrower'],
  ['br-ivo', 'Ivo Petrak', 'ivo.petrak@quillmoor.example', 'borrower'],
  ['tr-petra', 'Petra Novak', 'petra.novak@quillmoor.example', 'trader'],
  ['lq-kestrel', 'Kestrel Keepers', 'desk@kestrel-keepers.example', 'liquidator'],
  ['lq-vane', 'Vane Desk', 'ops@vane-desk.example', 'liquidator'],
];

interface SeedAsset {
  readonly asset: Asset;
  readonly price: bigint;
  readonly ltvBps: number;
  readonly thresholdBps: number;
  readonly bonusBps: number;
  readonly reserveFactorBps: number;
  readonly baseBps: number;
  readonly slope1Bps: number;
  readonly kinkBps: number;
  readonly slope2Bps: number;
}

/** All three assets share close factor 5,000 bps and swap fee 30 bps. */
const CLOSE_FACTOR_BPS = 5000;
const SWAP_FEE_BPS = 30;

const ASSETS: readonly SeedAsset[] = [
  {
    asset: 'QUSD',
    price: 100000000n,
    ltvBps: 8000,
    thresholdBps: 8500,
    bonusBps: 400,
    reserveFactorBps: 1000,
    baseBps: 0,
    slope1Bps: 400,
    kinkBps: 9000,
    slope2Bps: 6000,
  },
  {
    asset: 'MBTC',
    price: 6400000000000n,
    ltvBps: 7000,
    thresholdBps: 7500,
    bonusBps: 500,
    reserveFactorBps: 1000,
    baseBps: 0,
    slope1Bps: 400,
    kinkBps: 4500,
    slope2Bps: 30000,
  },
  {
    asset: 'METH',
    price: 320000000000n,
    ltvBps: 7500,
    thresholdBps: 8000,
    bonusBps: 500,
    reserveFactorBps: 1500,
    baseBps: 0,
    slope1Bps: 300,
    kinkBps: 8000,
    slope2Bps: 8000,
  },
];

/** Inbound transfers, in the order the desk recorded them. */
const TRANSFERS: ReadonlyArray<readonly [string, Asset, bigint]> = [
  ['lp-rosa', 'QUSD', 2100000000000n],
  ['lp-rosa', 'MBTC', 4000000000n],
  ['lp-tomas', 'METH', 610000000000000000000n],
  ['br-sanna', 'MBTC', 200000000n],
  ['br-dele', 'MBTC', 150000000n],
  ['br-mara', 'MBTC', 100000000n],
  ['br-yusuf', 'MBTC', 50000000n],
  ['br-ivo', 'METH', 10000000000000000000n],
  ['tr-petra', 'MBTC', 100000000n],
  ['tr-petra', 'QUSD', 50000000000n],
  ['tr-petra', 'METH', 5000000000000000000n],
  ['lq-kestrel', 'QUSD', 250000000000n],
  ['lq-vane', 'QUSD', 250000000000n],
];

/** Each pool's single supplier, whose supply equals the shares minted. */
const SUPPLIES: ReadonlyArray<readonly [string, Asset, bigint]> = [
  ['lp-rosa', 'QUSD', 2000000000000n],
  ['lp-rosa', 'MBTC', 4000000000n],
  ['lp-tomas', 'METH', 600000000000000000000n],
];

interface SeedPosition {
  readonly positionId: string;
  readonly borrowerId: string;
  readonly collateralAsset: Asset;
  readonly collateralAmount: bigint;
  readonly debtAsset: Asset;
  readonly debt: bigint;
}

const POSITIONS: readonly SeedPosition[] = [
  {
    positionId: 'pos-0001',
    borrowerId: 'br-sanna',
    collateralAsset: 'MBTC',
    collateralAmount: 200000000n,
    debtAsset: 'QUSD',
    debt: 60000000000n,
  },
  {
    positionId: 'pos-0002',
    borrowerId: 'br-dele',
    collateralAsset: 'MBTC',
    collateralAmount: 150000000n,
    debtAsset: 'QUSD',
    debt: 64000000000n,
  },
  {
    positionId: 'pos-0003',
    borrowerId: 'br-mara',
    collateralAsset: 'MBTC',
    collateralAmount: 100000000n,
    debtAsset: 'QUSD',
    debt: 40000000000n,
  },
  {
    positionId: 'pos-0004',
    borrowerId: 'br-yusuf',
    collateralAsset: 'MBTC',
    collateralAmount: 50000000n,
    debtAsset: 'QUSD',
    debt: 21000000000n,
  },
  {
    positionId: 'pos-0005',
    borrowerId: 'br-ivo',
    collateralAsset: 'METH',
    collateralAmount: 10000000000000000000n,
    debtAsset: 'QUSD',
    debt: 16000000000n,
  },
];

export async function seed(client: PoolClient, nowMs: number): Promise<void> {
  const now = writeInstant(nowMs);

  for (const [actorId, name, email, role] of ACTORS) {
    await client.query(
      `INSERT INTO actors (actor_id, name, email, email_lower, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorId, name, email, email.toLowerCase(), role, now],
    );
  }

  for (const asset of ASSETS) {
    await client.query(
      `INSERT INTO assets (asset, ltv_bps, liquidation_threshold_bps, liquidation_bonus_bps,
                           reserve_factor_bps, close_factor_bps, swap_fee_bps,
                           base_bps, slope1_bps, kink_bps, slope2_bps,
                           borrow_index, index_updated_at, total_shares, risk_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, 1)`,
      [
        asset.asset,
        asset.ltvBps,
        asset.thresholdBps,
        asset.bonusBps,
        asset.reserveFactorBps,
        CLOSE_FACTOR_BPS,
        SWAP_FEE_BPS,
        asset.baseBps,
        asset.slope1Bps,
        asset.kinkBps,
        asset.slope2Bps,
        INDEX_SCALE.toString(),
        now,
      ],
    );

    // A manual post by the steward, with no evidence object.
    const pricePostId = randomUUID();
    await client.query(
      `INSERT INTO price_posts (price_post_id, asset, price, previous_price, posted_at,
                                posted_by, source, oracle_round, evidence_key, created_at)
       VALUES ($1, $2, $3, NULL, $4, 'stw-ines', 'manual', NULL, NULL, $4)`,
      [pricePostId, asset.asset, asset.price.toString(), now],
    );
    await client.query('UPDATE assets SET current_price_post_id = $1 WHERE asset = $2', [
      pricePostId,
      asset.asset,
    ]);
  }

  for (const [actorId, asset, amount] of TRANSFERS) {
    await insertPosting(client, {
      kind: 'transfer_in',
      ref: actorId,
      createdAtMs: nowMs,
      legs: [
        { account: CUSTODY, asset, amount: -amount },
        { account: walletAccount(actorId), asset, amount },
      ],
    });
  }

  for (const [actorId, asset, amount] of SUPPLIES) {
    await insertPosting(client, {
      kind: 'supply',
      ref: actorId,
      createdAtMs: nowMs,
      legs: [
        { account: walletAccount(actorId), asset, amount: -amount },
        { account: SUPPLY, asset, amount },
      ],
    });
    // The first supply into an empty pool mints one share per minor unit.
    await client.query(
      `INSERT INTO lp_shares (actor_id, asset, shares) VALUES ($1, $2, $3)
       ON CONFLICT (actor_id, asset) DO UPDATE SET shares = lp_shares.shares + $3`,
      [actorId, asset, amount.toString()],
    );
    await client.query('UPDATE assets SET total_shares = total_shares + $1 WHERE asset = $2', [
      amount.toString(),
      asset,
    ]);
  }

  for (const position of POSITIONS) {
    await client.query(
      `INSERT INTO positions (position_id, borrower_id, collateral_asset, debt_asset,
                              principal, reference_index, state, grace_ends_at,
                              after_fill_mark, margin_notice_armed, round, event_sequence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'healthy', NULL, false, true, 0, 0, $7)`,
      [
        position.positionId,
        position.borrowerId,
        position.collateralAsset,
        position.debtAsset,
        position.debt.toString(),
        INDEX_SCALE.toString(),
        now,
      ],
    );
    await insertPosting(client, {
      kind: 'lock',
      ref: position.positionId,
      createdAtMs: nowMs,
      legs: [
        {
          account: walletAccount(position.borrowerId),
          asset: position.collateralAsset,
          amount: -position.collateralAmount,
        },
        {
          account: collateralAccount(position.positionId),
          asset: position.collateralAsset,
          amount: position.collateralAmount,
        },
      ],
    });
    await insertPosting(client, {
      kind: 'draw',
      ref: position.positionId,
      createdAtMs: nowMs,
      legs: [
        {
          account: loanAccount(position.positionId),
          asset: position.debtAsset,
          amount: -position.debt,
        },
        {
          account: walletAccount(position.borrowerId),
          asset: position.debtAsset,
          amount: position.debt,
        },
      ],
    });
  }
}
