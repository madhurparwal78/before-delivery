import { RowProof } from '../shared/proofs.js';

export interface ApiResult<T> {
  status: number;
  body: T;
}

export const UNREACHABLE = 'Fernsquare can\u2019t reach the server. Your last action was not sent.';

export class ServerUnreachable extends Error {}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ServerUnreachable(UNREACHABLE);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body: body as T };
}

export async function get<T>(path: string): Promise<T> {
  const result = await request<T>(path);
  if (result.status >= 400) throw new ApiFailure(result.status, result.body);
  return result.body;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`request failed with ${status}`);
  }
}

export interface ErrorBody {
  error?: string;
  errors?: Record<string, string>;
}

export interface Identity {
  user: { id: string; name: string; email: string };
  workspaces: { id: string; name: string; role: Role }[];
}

export type Role = 'owner' | 'developer' | 'viewer';

export interface Workspace {
  id: string;
  name: string;
  role: Role;
  height: number;
  clock: string;
  nextBlock: 'honest' | 'withhold' | 'bad-encoding';
}

export interface Stats {
  height: number;
  squareWidth: number;
  includedToday: number;
  nodes: { id: string; height: number | null; confidence: string }[];
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Namespace {
  id: string;
  name: string;
  hex: string;
  blobCount: number;
}

export interface Blob {
  id: string;
  txId: string;
  namespace: string;
  namespaceName: string;
  size: number;
  shares: number;
  gas: number;
  feeUfern: number;
  status: 'pending' | 'included' | 'rejected';
  statusText: string;
  height: number | null;
  positions: [number, number][];
}

export interface Transaction {
  id: string;
  kind: string;
  sender: string;
  senderName: string;
  status: string;
  statusText: string;
  height: number | null;
  feeUfern: number;
  gas: number;
  submittedAt: string;
}

export interface BlockSummary {
  height: number;
  producedAt: string;
  blobs: number;
  squareWidth: number;
  status: 'sampling' | 'available' | 'rejected';
  dataRoot: string;
}

export interface NmtNode {
  min: string;
  max: string;
  hash: string;
}

export type Rejection =
  | { reason: 'withheld'; node: string; nodeName: string; row: number; col: number }
  | { reason: 'bad-encoding'; axis: 'row' | 'column'; index: number };

export interface BlockDetail {
  height: number;
  producedAt: string;
  status: 'sampling' | 'available' | 'rejected';
  squareWidth: number;
  dataRoot: string;
  rowRoots: NmtNode[];
  columnRoots: NmtNode[];
  blobs: { id: string; namespace: string; positions: [number, number][] }[];
  rejection: Rejection | null;
}

export interface ShareCell {
  row: number;
  col: number;
  quadrant: 'Q0' | 'Q1' | 'Q2' | 'Q3';
  namespace: string;
  kind: 'blob' | 'padding' | 'parity' | 'withheld';
  share: string | null;
}

export interface SharesResponse {
  k: number;
  rows: ShareCell[][];
}

export interface ProofsResponse {
  height: number;
  namespace: string;
  rows: RowProof[];
}

export interface FraudProof {
  height: number;
  axis: 'row' | 'column';
  index: number;
  shares: { position: [number, number]; share: string; nodes: NmtNode[]; verified: boolean }[];
  committedRoot: NmtNode;
  recomputedRoot: NmtNode;
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

export interface SamplesResponse {
  height: number;
  k: number;
  samples: Sample[];
  confidence: string;
  verdict: 'sampling' | 'available' | 'unavailable';
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
  delegations: {
    validator: string;
    validatorName: string;
    amountUfern: number;
    pendingRewardsUfern: number;
  }[];
  unbondings: {
    validator: string;
    validatorName: string;
    amountUfern: number;
    completesAt: string;
    status: 'unbonding' | 'released';
  }[];
  redelegations: {
    from: string;
    fromName: string;
    to: string;
    toName: string;
    amountUfern: number;
    arrivedAt: string;
    movableAt: string;
  }[];
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

export interface Proposal {
  number: number;
  title: string;
  description: string;
  status: string;
  statusText: string;
  depositUfern: number;
  minDepositUfern: number;
  depositEndsAt: string;
  votingEndsAt: string | null;
  tally: Tally;
  myVote: string | null;
}

export interface LedgerEntry {
  id: string;
  pairId: string;
  account: string;
  counterAccount: string;
  kind: string;
  label: string;
  amountUfern: number;
  height: number | null;
  at: string;
}

export interface LedgerResponse {
  account: string | null;
  balanceUfern: number;
  entries: LedgerEntry[];
}

export interface FeeEstimate {
  size: number;
  shares: number;
  gas: number;
  feeUfern: number;
}

export interface MempoolResponse {
  count: number;
  blobs: Blob[];
}

export interface InviteSummary {
  workspaceName: string;
  email: string;
  role: Role;
  existingAccount: boolean;
}
