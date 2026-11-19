import { maybeOne, rows, type Db } from "./db.ts";
import { balanceOf, heldOf, memberAccount } from "./ledger.ts";
import { totalBonded, validatorsOf, delegationsOf } from "./staking.ts";
import { splitSquare, isWithheld } from "./square.ts";
import { PARITY_NAMESPACE, TAIL_PADDING_NAMESPACE } from "../shared/namespace.ts";
import { percent } from "../shared/units.ts";
import { toHex } from "../shared/bytes.ts";
import { NAMESPACE_SIZE } from "../shared/share.ts";
import type {
  BlobInfo, BlockDetail, BlockShares, BlockSummary, LedgerEntry, Quadrant, Rejection, ShareCell, StakingMe, TransactionInfo, Validator,
} from "../shared/api.ts";

function statusText(status: string, height: number | null, reason: string | null): string {
  if (status === "pending") return "Pending";
  return status === "included" ? `Included in block ${height}` : `Rejected — ${reason}`;
}

const BLOB_SELECT = `
  SELECT b.id, t.id AS "txId", b.namespace, COALESCE(n.name, b.namespace) AS "namespaceName", b.size, b.shares, t.gas,
         t.fee_ufern AS "feeUfern", t.status, t.reason, t.height,
         COALESCE((SELECT bl.positions -> b.id::text FROM blocks bl WHERE bl.workspace_id = t.workspace_id AND bl.height = t.height), '[]'::jsonb) AS positions
  FROM blobs b JOIN transactions t ON t.id = b.tx_id LEFT JOIN namespaces n ON n.hex = b.namespace AND n.workspace_id = b.workspace_id`;

type BlobRow = Omit<BlobInfo, "statusText"> & { reason: string | null };

function blobInfo({ reason, ...blob }: BlobRow): BlobInfo {
  return { ...blob, statusText: statusText(blob.status, blob.height, reason) };
}

export async function blobsOf(db: Db, workspaceId: string, filter: { mineOf?: string; pending?: boolean; id?: string } = {}): Promise<BlobInfo[]> {
  const found = await rows<BlobRow>(
    db,
    `${BLOB_SELECT} WHERE b.workspace_id = $1 AND ($2::uuid IS NULL OR t.sender = $2) AND (NOT $3 OR t.status = 'pending') AND ($4::uuid IS NULL OR b.id = $4)
     ORDER BY t.seq`,
    [workspaceId, filter.mineOf ?? null, filter.pending ?? false, filter.id ?? null],
  );
  return found.map(blobInfo);
}

export async function transactionsOf(db: Db, workspaceId: string, filter: { mineOf?: string; id?: string } = {}): Promise<TransactionInfo[]> {
  const found = await rows<Omit<TransactionInfo, "statusText"> & { reason: string | null; submittedAt: Date }>(
    db,
    `SELECT t.id, t.kind, t.sender, u.name AS "senderName", t.status, t.reason, t.height, t.fee_ufern AS "feeUfern", t.gas, t.submitted_at AS "submittedAt"
     FROM transactions t JOIN users u ON u.id = t.sender
     WHERE t.workspace_id = $1 AND ($2::uuid IS NULL OR t.sender = $2) AND ($3::uuid IS NULL OR t.id = $3) ORDER BY t.seq`,
    [workspaceId, filter.mineOf ?? null, filter.id ?? null],
  );
  return found.map(({ reason, submittedAt, ...tx }) => ({ ...tx, statusText: statusText(tx.status, tx.height, reason), submittedAt: submittedAt.toISOString() }));
}

interface BlockRow {
  height: number;
  producedAt: Date;
  k: number;
  status: BlockSummary["status"];
  blobCount: number;
  withheld: boolean;
  dataRoot: string;
  rowRoots: BlockDetail["rowRoots"];
  columnRoots: BlockDetail["columnRoots"];
  positions: Record<string, Array<[number, number]>>;
  square: Buffer;
  rejection: Rejection | null;
}

const BLOCK_COLUMNS = `height, produced_at AS "producedAt", k, status, blob_count AS "blobCount", withheld, data_root AS "dataRoot",
  row_roots AS "rowRoots", column_roots AS "columnRoots", positions, square, rejection`;

export async function blockOf(db: Db, workspaceId: string, height: number): Promise<BlockRow | undefined> {
  if (!Number.isSafeInteger(height) || height < 1) return undefined;
  return maybeOne<BlockRow>(db, `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE workspace_id = $1 AND height = $2`, [workspaceId, height]);
}

export async function blockSummaries(db: Db, workspaceId: string): Promise<BlockSummary[]> {
  const found = await rows<{ height: number; producedAt: Date; blobs: number; squareWidth: number; status: BlockSummary["status"]; dataRoot: string }>(
    db,
    `SELECT height, produced_at AS "producedAt", blob_count AS blobs, k AS "squareWidth", status, data_root AS "dataRoot"
     FROM blocks WHERE workspace_id = $1 ORDER BY height DESC`,
    [workspaceId],
  );
  return found.map((block) => ({ ...block, producedAt: block.producedAt.toISOString() }));
}

export async function blockDetail(db: Db, workspaceId: string, block: BlockRow): Promise<BlockDetail> {
  const blobs = await rows<{ id: string; namespace: string; sender: string; senderName: string }>(
    db,
    `SELECT b.id, b.namespace, t.sender, u.name AS "senderName" FROM blobs b JOIN transactions t ON t.id = b.tx_id JOIN users u ON u.id = t.sender
     WHERE b.workspace_id = $1 AND t.height = $2 ORDER BY t.seq`,
    [workspaceId, block.height],
  );
  return {
    height: block.height,
    producedAt: block.producedAt.toISOString(),
    status: block.status,
    squareWidth: block.k,
    dataRoot: block.dataRoot,
    rowRoots: block.rowRoots,
    columnRoots: block.columnRoots,
    blobs: blobs.map((blob) => ({ ...blob, positions: block.positions[blob.id] ?? [] })),
    rejection: block.rejection,
  };
}

function quadrantOf(k: number, row: number, col: number): Quadrant {
  if (row < k) return col < k ? "Q0" : "Q1";
  return col < k ? "Q2" : "Q3";
}

/** The shares a block serves: every share except a withheld block's bottom-right region. */
export function blockShares(block: BlockRow): BlockShares {
  const shares = splitSquare(block.square);
  const width = 2 * block.k;
  const rowsOut: ShareCell[][] = [];
  for (let row = 0; row < width; row++) {
    const cells: ShareCell[] = [];
    for (let col = 0; col < width; col++) {
      const share = shares[row * width + col] as Uint8Array;
      const quadrant = quadrantOf(block.k, row, col);
      const namespace = quadrant === "Q0" ? toHex(share.subarray(0, NAMESPACE_SIZE)) : PARITY_NAMESPACE;
      const held = block.withheld && isWithheld(block.k, row, col);
      const kind = held ? "withheld" : quadrant !== "Q0" ? "parity" : namespace === TAIL_PADDING_NAMESPACE ? "padding" : "blob";
      cells.push({ row, col, quadrant, namespace, kind, share: held ? null : toHex(share) });
    }
    rowsOut.push(cells);
  }
  return { k: block.k, rows: rowsOut };
}

const commissionText = (basisPoints: number) => {
  const fraction = String(basisPoints % 10_000).padStart(4, "0").replace(/0+$/, "");
  return fraction ? `${Math.floor(basisPoints / 10_000)}.${fraction}` : String(Math.floor(basisPoints / 10_000));
};

export async function validatorViews(db: Db, workspaceId: string): Promise<Validator[]> {
  const total = await totalBonded(db, workspaceId);
  return (await validatorsOf(db, workspaceId)).map((v) => ({
    id: v.id,
    name: v.name,
    selfStakeUfern: v.selfStake,
    stakeUfern: v.stake,
    commission: commissionText(v.commissionBasisPoints),
    shareOfBonded: percent(v.stake, total, 2),
  }));
}

export async function stakingMe(db: Db, workspaceId: string, userId: string): Promise<StakingMe> {
  const balanceUfern = await balanceOf(db, workspaceId, memberAccount(userId));
  const held = await heldOf(db, workspaceId, userId);
  const unbondings = await rows<{ validator: string; validatorName: string; amountUfern: number; completesAt: Date; releasedAt: Date | null }>(
    db,
    `SELECT u.validator_id AS validator, v.name AS "validatorName", u.amount_ufern AS "amountUfern", u.completes_at AS "completesAt", u.released_at AS "releasedAt"
     FROM unbondings u JOIN validators v ON v.id = u.validator_id WHERE u.workspace_id = $1 AND u.user_id = $2 ORDER BY u.id`,
    [workspaceId, userId],
  );
  const redelegations = await rows<{ from: string; fromName: string; to: string; toName: string; amountUfern: number; arrivedAt: Date; movableAt: Date }>(
    db,
    `SELECT r.from_validator AS "from", f.name AS "fromName", r.to_validator AS "to", t.name AS "toName", r.amount_ufern AS "amountUfern",
            r.arrived_at AS "arrivedAt", r.movable_at AS "movableAt"
     FROM redelegations r JOIN validators f ON f.id = r.from_validator JOIN validators t ON t.id = r.to_validator
     WHERE r.workspace_id = $1 AND r.user_id = $2 ORDER BY r.id`,
    [workspaceId, userId],
  );
  return {
    balanceUfern,
    availableUfern: balanceUfern - held,
    heldUfern: held,
    delegations: (await delegationsOf(db, workspaceId, userId)).map((d) => ({
      validator: d.validatorId, validatorName: d.validatorName, amountUfern: d.amount, pendingRewardsUfern: d.pending,
    })),
    unbondings: unbondings.map(({ completesAt, releasedAt, ...u }) => ({
      ...u, completesAt: completesAt.toISOString(), status: releasedAt ? ("released" as const) : ("unbonding" as const),
    })),
    redelegations: redelegations.map((r) => ({ ...r, arrivedAt: r.arrivedAt.toISOString(), movableAt: r.movableAt.toISOString() })),
  };
}

export async function ledgerEntries(db: Db, workspaceId: string, account: string | null): Promise<LedgerEntry[]> {
  const found = await rows<Omit<LedgerEntry, "at" | "id"> & { id: number; at: Date }>(
    db,
    `SELECT id, pair_id AS "pairId", account, counter_account AS "counterAccount", kind, label, amount_ufern AS "amountUfern", height, at
     FROM ledger_entries WHERE workspace_id = $1 AND ($2::text IS NULL OR account = $2) ORDER BY id DESC`,
    [workspaceId, account],
  );
  return found.map((entry) => ({ ...entry, id: String(entry.id), at: entry.at.toISOString() }));
}

/** Blobs taken by a block (or, with null, waiting in the mempool), in submission order. */
export async function blobsInHeight(db: Db, workspaceId: string, height: number | null): Promise<Array<{ id: string; txId: string; namespace: string; size: number }>> {
  return rows(
    db,
    `SELECT b.id, t.id AS "txId", b.namespace, b.size FROM blobs b JOIN transactions t ON t.id = b.tx_id
     WHERE b.workspace_id = $1 AND (t.height = $2 OR ($2::int IS NULL AND t.status = 'pending')) ORDER BY t.seq`,
    [workspaceId, height],
  );
}
