export type Role = 'owner' | 'developer' | 'viewer';
export type ProducerBehaviour = 'honest' | 'withhold' | 'bad-encoding';
export type BlockStatus = 'sampling' | 'available' | 'rejected';
export type TransactionStatus = 'pending' | 'included' | 'rejected';

export type TransactionKind =
  | 'blob'
  | 'delegate'
  | 'undelegate'
  | 'redelegate'
  | 'claim'
  | 'proposal'
  | 'deposit'
  | 'vote';

export interface WorkspaceRow {
  id: string;
  name: string;
  next_block: ProducerBehaviour;
}

export interface PersonRow {
  id: string;
  name: string;
  email: string;
}

export interface ValidatorRow {
  id: string;
  workspace_id: string;
  name: string;
  commission_numerator: string;
  commission_denominator: string;
  position: number;
}

export interface LightNodeRow {
  id: string;
  workspace_id: string;
  name: string;
  number: number;
  auto_sample: boolean;
  auto_sample_since: Date | null;
}

export interface BlockRow {
  workspace_id: string;
  height: number;
  produced_at: Date;
  status: BlockStatus;
  square_width: number;
  data_root: string;
  row_roots: NmtNodeJson[];
  column_roots: NmtNodeJson[];
  behaviour: ProducerBehaviour;
  blob_count: number;
  rejection: RejectionJson | null;
  fraud_checked_at: Date | null;
  snapshot_stored: boolean;
}

export interface NmtNodeJson {
  min: string;
  max: string;
  hash: string;
}

export type RejectionJson =
  | { reason: 'withheld'; node: string; nodeName: string; row: number; col: number }
  | { reason: 'bad-encoding'; axis: 'row' | 'column'; index: number };

export interface TransactionRow {
  id: string;
  workspace_id: string;
  kind: TransactionKind;
  sender_id: string;
  status: TransactionStatus;
  height: number | null;
  fee_ufern: string;
  gas: number;
  held_ufern: string;
  payload: TransactionPayload;
  rejection_reason: string | null;
  submitted_at: Date;
}

export interface BlobPayload {
  blobId: string;
  namespace: string;
  size: number;
  shares: number;
}

export interface DelegatePayload {
  validatorId: string;
  amountUfern: string;
}

export interface RedelegatePayload {
  fromValidatorId: string;
  toValidatorId: string;
  amountUfern: string;
}

export interface ProposalPayload {
  title: string;
  description: string;
  initialDepositUfern: string;
}

export interface DepositPayload {
  proposalNumber: number;
  amountUfern: string;
}

export interface VotePayload {
  proposalNumber: number;
  option: 'yes' | 'no' | 'no_with_veto' | 'abstain';
}

export type TransactionPayload =
  | BlobPayload
  | DelegatePayload
  | RedelegatePayload
  | ProposalPayload
  | DepositPayload
  | VotePayload
  | Record<string, never>;

export function transactionStatusText(
  status: TransactionStatus,
  height: number | null,
  rejectionReason: string | null,
): string {
  if (status === 'pending') return 'Pending';
  if (status === 'included') return `Included in block ${height}`;
  return `Rejected — ${rejectionReason}`;
}
