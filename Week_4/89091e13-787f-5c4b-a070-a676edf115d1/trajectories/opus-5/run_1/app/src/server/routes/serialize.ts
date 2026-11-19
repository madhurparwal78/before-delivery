import { Queryable } from '../db.js';
import { formatPercent } from '../../shared/format.js';
import { TallyCounts, totalVotes } from '../../shared/governance.js';
import { ProposalRow, statusText, tallyOf } from '../domain/governance.js';
import { BlockRow, TransactionRow, transactionStatusText } from '../domain/types.js';

export function ufern(amount: bigint): number {
  return Number(amount);
}

export interface BlobView {
  id: string;
  txId: string;
  namespace: string;
  namespaceName: string;
  size: number;
  shares: number;
  gas: number;
  feeUfern: number;
  status: string;
  statusText: string;
  height: number | null;
  positions: [number, number][];
}

export async function blobView(
  tx: Queryable,
  workspaceId: string,
  blobId: string,
): Promise<BlobView | null> {
  const { rows } = await tx.query<{
    id: string;
    tx_id: string;
    namespace_hex: string;
    size: number;
    shares: number;
    gas: number;
    fee_ufern: string;
    status: string;
    height: number | null;
    rejection_reason: string | null;
    name: string | null;
  }>(
    `SELECT b.id, b.tx_id, b.namespace_hex, b.size, b.shares, t.gas, t.fee_ufern::text,
            t.status, t.height, t.rejection_reason, n.name
     FROM blobs b
       JOIN transactions t ON t.id = b.tx_id
       LEFT JOIN namespaces n ON n.hex = b.namespace_hex AND n.workspace_id = b.workspace_id
     WHERE b.workspace_id = $1 AND b.id = $2`,
    [workspaceId, blobId],
  );
  const row = rows[0];
  if (!row) return null;
  const positions: [number, number][] = [];
  if (row.height !== null) {
    const { rows: cells } = await tx.query<{ row: number; col: number }>(
      `SELECT row, col FROM block_shares
       WHERE workspace_id = $1 AND height = $2 AND blob_id = $3 ORDER BY row, col`,
      [workspaceId, row.height, blobId],
    );
    for (const cell of cells) positions.push([cell.row, cell.col]);
  }
  return {
    id: row.id,
    txId: row.tx_id,
    namespace: row.namespace_hex,
    namespaceName: row.name ?? row.namespace_hex,
    size: row.size,
    shares: row.shares,
    gas: row.gas,
    feeUfern: Number(row.fee_ufern),
    status: row.status,
    statusText: transactionStatusText(
      row.status as 'pending' | 'included' | 'rejected',
      row.height,
      row.rejection_reason,
    ),
    height: row.height,
    positions,
  };
}

export function transactionView(
  row: TransactionRow,
  senderName: string,
): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    sender: row.sender_id,
    senderName,
    status: row.status,
    statusText: transactionStatusText(row.status, row.height, row.rejection_reason),
    height: row.height,
    feeUfern: Number(row.fee_ufern),
    gas: row.gas,
    submittedAt: row.submitted_at.toISOString(),
  };
}

export function transactionWriteView(row: {
  id: string;
  kind: string;
  feeUfern: bigint;
  gas: number;
  submittedAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    status: 'pending',
    feeUfern: ufern(row.feeUfern),
    gas: row.gas,
    submittedAt: row.submittedAt.toISOString(),
  };
}

export function blockListView(block: BlockRow): Record<string, unknown> {
  return {
    height: block.height,
    producedAt: block.produced_at.toISOString(),
    blobs: block.blob_count,
    squareWidth: block.square_width,
    status: block.status,
    dataRoot: block.data_root,
  };
}

export function tallyView(counts: TallyCounts, bonded: bigint, result: string): Record<string, unknown> {
  const votes = totalVotes(counts);
  return {
    votesUfern: ufern(votes),
    totalBondedUfern: ufern(bonded),
    turnout: formatPercent(votes, bonded, 2),
    yesUfern: ufern(counts.yes),
    noUfern: ufern(counts.no),
    noWithVetoUfern: ufern(counts.noWithVeto),
    abstainUfern: ufern(counts.abstain),
    vetoShare: formatPercent(counts.noWithVeto, votes, 2),
    yesShare: formatPercent(counts.yes, votes - counts.abstain, 2),
    result,
  };
}

export async function proposalView(
  tx: Queryable,
  proposal: ProposalRow,
  personId: string,
  minDepositUfern: bigint,
): Promise<Record<string, unknown>> {
  const { counts, bonded, result } = await tallyOf(tx, proposal);
  const { rows } = await tx.query<{ option: string }>(
    'SELECT option FROM votes WHERE proposal_id = $1 AND person_id = $2',
    [proposal.id, personId],
  );
  return {
    number: proposal.number,
    title: proposal.title,
    description: proposal.description,
    status: proposal.status,
    statusText: statusText(proposal.status),
    depositUfern: Number(proposal.deposit_ufern),
    minDepositUfern: ufern(minDepositUfern),
    depositEndsAt: proposal.deposit_ends_at.toISOString(),
    votingEndsAt: proposal.voting_ends_at ? proposal.voting_ends_at.toISOString() : null,
    tally: tallyView(counts, bonded, statusText(result)),
    myVote: rows[0]?.option ?? null,
  };
}
