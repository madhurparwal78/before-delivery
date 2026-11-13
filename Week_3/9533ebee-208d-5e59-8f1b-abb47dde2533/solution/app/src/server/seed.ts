import type { Tx } from "./db.js";
import { account, post } from "./ledger.js";
import { randomUUID } from "node:crypto";
import { priceUnits } from "../shared/format.js";
import { serverNow } from "./time.js";

// The seed, written as ordinary postings: inbound transfers, supplies, locks and draws. Seed draws write no
// statements and the seed queues no notices. Every person and business here is invented.

const MEMBERS = [
  ["stw-ines", "Ines Varga", "ines.varga@quillmoor.example", "risk_steward"],
  ["stw-odile", "Odile Marchetti", "odile.marchetti@quillmoor.example", "risk_steward"],
  ["lp-rosa", "Rosa Aldana", "rosa.aldana@quillmoor.example", "liquidity_provider"],
  ["lp-tomas", "Tomas Ferreira", "tomas.ferreira@quillmoor.example", "liquidity_provider"],
  ["br-sanna", "Sanna Lindqvist", "sanna.lindqvist@quillmoor.example", "borrower"],
  ["br-dele", "Dele Oyelaran", "dele.oyelaran@quillmoor.example", "borrower"],
  ["br-mara", "Mara Castell", "mara.castell@quillmoor.example", "borrower"],
  ["br-yusuf", "Yusuf Brandt", "yusuf.brandt@quillmoor.example", "borrower"],
  ["br-ivo", "Ivo Petrak", "ivo.petrak@quillmoor.example", "borrower"],
  ["tr-petra", "Petra Novak", "petra.novak@quillmoor.example", "trader"],
  ["lq-kestrel", "Kestrel Keepers", "desk@kestrel-keepers.example", "liquidator"],
  ["lq-vane", "Vane Desk", "ops@vane-desk.example", "liquidator"],
] as const;

// asset, name, decimals, price (whole dollars), ltv, threshold, bonus, reserve factor, curve base, slope1, kink, slope2
const ASSETS = [
  ["QUSD", "Quill Dollar", 6, 1n, 8000, 8500, 400, 1000, 0, 400, 9000, 6000],
  ["MBTC", "Moor Bitcoin", 8, 64_000n, 7000, 7500, 500, 1000, 0, 400, 4500, 30000],
  ["METH", "Moor Ether", 18, 3_200n, 7500, 8000, 500, 1500, 0, 300, 8000, 8000],
] as const;

const BORROW_INDEX_START = 10n ** 27n;

// Pools at start: supplied by, amount (equal to the shares minted).
const SUPPLIES = [
  ["lp-rosa", "QUSD", 2_000_000_000_000n],
  ["lp-rosa", "MBTC", 4_000_000_000n],
  ["lp-tomas", "METH", 600_000_000_000_000_000_000n],
] as const;

// Free wallet balances at start, beyond what the supplies and positions use.
const WALLETS = [
  ["tr-petra", "MBTC", 100_000_000n],
  ["tr-petra", "QUSD", 50_000_000_000n],
  ["tr-petra", "METH", 5_000_000_000_000_000_000n],
  ["lq-kestrel", "QUSD", 250_000_000_000n],
  ["lq-vane", "QUSD", 250_000_000_000n],
  ["lp-rosa", "QUSD", 100_000_000_000n],
  ["lp-tomas", "METH", 10_000_000_000_000_000_000n],
] as const;

// Positions at start: borrower, collateral asset and amount, debt asset and amount.
const POSITIONS = [
  ["br-sanna", "MBTC", 200_000_000n, "QUSD", 60_000_000_000n],
  ["br-dele", "MBTC", 150_000_000n, "QUSD", 64_000_000_000n],
  ["br-mara", "MBTC", 100_000_000n, "QUSD", 40_000_000_000n],
  ["br-yusuf", "MBTC", 50_000_000n, "QUSD", 21_000_000_000n],
  ["br-ivo", "METH", 10_000_000_000_000_000_000n, "QUSD", 16_000_000_000n],
] as const;

export async function seed(tx: Tx): Promise<void> {
  const now = serverNow();
  const second = Math.floor(now.getTime() / 1000);
  for (const [actorId, name, email, role] of MEMBERS) {
    await tx.query("INSERT INTO members (actor_id, name, email, role, created_at) VALUES ($1, $2, $3, $4, $5)", [actorId, name, email, role, now]);
  }
  for (const [listing, [asset, name, decimals, dollars, ltv, threshold, bonus, reserve, base, slope1, kink, slope2]] of ASSETS.entries()) {
    await tx.query(
      `INSERT INTO assets (asset, name, decimals, listing, ltv_bps, liquidation_threshold_bps, liquidation_bonus_bps, reserve_factor_bps,
                           close_factor_bps, swap_fee_bps, warning_health_factor_bps, base_bps, slope1_bps, kink_bps, slope2_bps,
                           risk_version, borrow_index, index_second, total_shares)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 5000, 30, 11000, $9, $10, $11, $12, 0, $13, $14, 0)`,
      [asset, name, decimals, listing, ltv, threshold, bonus, reserve, base, slope1, kink, slope2, BORROW_INDEX_START.toString(), second],
    );
    const seq = listing + 1;
    await tx.query(
      `INSERT INTO price_posts (price_post_id, seq, asset, price, previous_price, posted_at, posted_by, source, oracle_round, positions_below_one, evidence_key)
       VALUES ($1, $2, $3, $4, NULL, $5, 'stw-ines', 'manual', NULL, 0, NULL)`,
      [randomUUID(), seq, asset, priceUnits(dollars.toString()).toString(), now],
    );
  }
  await tx.query("SELECT setval('price_post_seq', $1)", [ASSETS.length]);

  const transfer = (actorId: string, asset: string, amount: bigint) =>
    post(tx, "transfer_in", `seed-${actorId}`, now, [
      { account: account.custody, asset, amount: -amount },
      { account: account.wallet(actorId), asset, amount },
    ]);

  for (const [actorId, asset, amount] of SUPPLIES) {
    await transfer(actorId, asset, amount);
    await post(tx, "supply", `seed-${actorId}`, now, [
      { account: account.wallet(actorId), asset, amount: -amount },
      { account: account.supply, asset, amount },
    ]);
    await tx.query("INSERT INTO share_holdings (actor_id, asset, shares) VALUES ($1, $2, $3)", [actorId, asset, amount.toString()]);
    await tx.query("UPDATE assets SET total_shares = total_shares + $2 WHERE asset = $1", [asset, amount.toString()]);
  }
  for (const [actorId, asset, amount] of WALLETS) await transfer(actorId, asset, amount);

  for (const [index, [borrowerId, collateralAsset, collateral, debtAsset, debt]] of POSITIONS.entries()) {
    const seq = index + 1;
    const positionId = `pos-${String(seq).padStart(4, "0")}`;
    await tx.query(
      `INSERT INTO positions (position_id, seq, borrower_id, collateral_asset, debt_asset, state, grace_ends_at, after_fill, margin_armed, round,
                              principal, reference_index, event_seq, created_at)
       VALUES ($1, $2, $3, $4, $5, 'healthy', NULL, false, true, 0, $6, $7, 0, $8)`,
      [positionId, seq, borrowerId, collateralAsset, debtAsset, debt.toString(), BORROW_INDEX_START.toString(), now],
    );
    await transfer(borrowerId, collateralAsset, collateral);
    await post(tx, "lock", positionId, now, [
      { account: account.wallet(borrowerId), asset: collateralAsset, amount: -collateral },
      { account: account.collateral(positionId), asset: collateralAsset, amount: collateral },
    ]);
    await post(tx, "draw", positionId, now, [
      { account: account.loan(positionId), asset: debtAsset, amount: -debt },
      { account: account.wallet(borrowerId), asset: debtAsset, amount: debt },
    ]);
  }
  await tx.query("SELECT setval('position_seq', $1)", [POSITIONS.length]);
}
