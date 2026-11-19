/** Response shapes of the published API (plus the few fields marked "extra"). */

export type Role = "owner" | "developer" | "viewer";
export const NEXT_BLOCK_OPTIONS = [
  { value: "honest", label: "Honest" },
  { value: "withhold", label: "Withhold shares" },
  { value: "bad-encoding", label: "Bad encoding" },
] as const;
export type NextBlock = (typeof NEXT_BLOCK_OPTIONS)[number]["value"];
export type BlockStatus = "sampling" | "available" | "rejected";
export type TxStatus = "pending" | "included" | "rejected";

export interface RootJson {
  min: string;
  max: string;
  hash: string;
}

export interface Me {
  user: { id: string; name: string; email: string };
  workspaces: Array<{ id: string; name: string; role: Role }>;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  role: Role;
  height: number;
  clock: string;
  nextBlock: NextBlock;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface NamespaceInfo {
  id: string;
  name: string;
  hex: string;
  blobCount: number;
}

export interface FeeEstimate {
  size: number;
  shares: number;
  gas: number;
  feeUfern: number;
}

export interface BlobInfo {
  id: string;
  txId: string;
  namespace: string;
  namespaceName: string;
  size: number;
  shares: number;
  gas: number;
  feeUfern: number;
  status: TxStatus;
  statusText: string;
  height: number | null;
  positions: Array<[number, number]>;
}

export interface TransactionInfo {
  id: string;
  kind: string;
  sender: string;
  senderName: string;
  status: TxStatus;
  statusText: string;
  height: number | null;
  feeUfern: number;
  gas: number;
  submittedAt: string;
}

export interface Mempool {
  count: number;
  blobs: BlobInfo[];
}

export interface BlockSummary {
  height: number;
  producedAt: string;
  blobs: number;
  squareWidth: number;
  status: BlockStatus;
  dataRoot: string;
}

export type Rejection =
  | { reason: "withheld"; node: string; nodeName: string; row: number; col: number }
  | { reason: "bad-encoding"; axis: "row" | "column"; index: number };

export interface BlockDetail {
  height: number;
  producedAt: string;
  status: BlockStatus;
  squareWidth: number;
  dataRoot: string;
  rowRoots: RootJson[];
  columnRoots: RootJson[];
  /** extra: sender and senderName beside the published id, namespace and positions. */
  blobs: Array<{ id: string; namespace: string; positions: Array<[number, number]>; sender: string; senderName: string }>;
  rejection: Rejection | null;
}

export type ShareKind = "blob" | "padding" | "parity" | "withheld";
export type Quadrant = "Q0" | "Q1" | "Q2" | "Q3";

export interface ShareCell {
  row: number;
  col: number;
  quadrant: Quadrant;
  namespace: string;
  kind: ShareKind;
  share: string | null;
}

export interface BlockShares {
  k: number;
  rows: ShareCell[][];
}

export type RowProof =
  | { row: number; kind: "inclusion"; start: number; end: number; shares: string[]; nodes: RootJson[]; root: RootJson }
  | { row: number; kind: "absence"; nextLeaf: { col: number; namespace: string; hash: string }; nodes: RootJson[]; root: RootJson }
  | { row: number; kind: "outside" };

export interface NamespaceProofs {
  height: number;
  namespace: string;
  rows: RowProof[];
}

export interface FraudProof {
  height: number;
  axis: "row" | "column";
  index: number;
  shares: Array<{ position: number; share: string; nodes: RootJson[]; verified: boolean }>;
  committedRoot: RootJson;
  recomputedRoot: RootJson;
  publishedAt: string;
}

export interface LightNode {
  id: string;
  name: string;
  number: number;
  autoSample: boolean;
}

export interface Sample {
  index: number;
  row: number;
  col: number;
  served: boolean;
  confidence: string;
}

export interface NodeSamples {
  height: number;
  k: number;
  samples: Sample[];
  confidence: string;
  verdict: "sampling" | "available" | "unavailable";
}

export interface Validator {
  id: string;
  name: string;
  selfStakeUfern: number;
  stakeUfern: number;
  commission: string;
  shareOfBonded: string;
}

export interface StakingMe {
  balanceUfern: number;
  availableUfern: number;
  heldUfern: number;
  delegations: Array<{ validator: string; validatorName: string; amountUfern: number; pendingRewardsUfern: number }>;
  unbondings: Array<{
    validator: string;
    validatorName: string;
    amountUfern: number;
    completesAt: string;
    status: "unbonding" | "released";
  }>;
  redelegations: Array<{
    from: string;
    fromName: string;
    to: string;
    toName: string;
    amountUfern: number;
    arrivedAt: string;
    movableAt: string;
  }>;
}

export interface Tally {
  votesUfern: number;
  totalBondedUfern: number;
  turnout: string;
  yesUfern: number;
  noUfern: number;
  noWithVetoUfern: number;
  abstainUfern: number;
  vetoShare: string;
  yesShare: string;
  result: string;
}

export const VOTE_CHOICES = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "no_with_veto", label: "No with veto" },
  { value: "abstain", label: "Abstain" },
] as const;
export type VoteOption = (typeof VOTE_CHOICES)[number]["value"];
export type ProposalStatus = "deposit" | "voting" | "passed" | "rejected" | "rejected_veto" | "rejected_quorum" | "failed";

export interface Proposal {
  number: number;
  title: string;
  description: string;
  status: ProposalStatus;
  statusText: string;
  depositUfern: number;
  minDepositUfern: number;
  depositEndsAt: string;
  votingEndsAt: string | null;
  tally: Tally;
  myVote: VoteOption | null;
}

export interface LedgerEntry {
  id: string;
  pairId: string;
  account: string;
  counterAccount: string;
  kind: string;
  label: string;
  amountUfern: number;
  height: number;
  at: string;
}

export interface Ledger {
  account: string | null;
  balanceUfern: number;
  entries: LedgerEntry[];
}

export interface TransactionCreated {
  id: string;
  kind: string;
  status: "pending";
  feeUfern: number;
  gas: number;
  submittedAt: string;
  blobId?: string;
  size?: number;
  shares?: number;
}

/** What the server pushes on `/api/w/<id>/live`. The browser refetches what it shows. */
export interface SampleEvent {
  type: "sample";
  node: string;
  height: number;
  sample: Sample;
  verdict: NodeSamples["verdict"];
}

export type LiveEvent =
  | { type: "block"; height: number; blobs: number; squareWidth: number }
  | { type: "rejected"; height: number; rejection: Rejection }
  | SampleEvent
  | { type: "fraud"; height: number }
  | { type: "changed" };

/** Display settings injected into the HTML shell: the only configuration the browser receives. */
export interface DisplayConfig {
  squareRowRevealMs: number;
  timeZone: string;
}
