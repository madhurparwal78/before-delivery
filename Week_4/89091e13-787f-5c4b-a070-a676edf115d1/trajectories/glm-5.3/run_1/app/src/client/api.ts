// Browser API client and app state. The browser never decides time-dependent
// state; every status and completion time comes from the server.

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceRef {
  id: string;
  name: string;
  role: string;
}

export interface BlobBody {
  id: string;
  txId: string;
  namespace: string;
  namespaceName: string;
  size: number;
  shares: number;
  gas: number;
  feeUfern: string;
  status: string;
  statusText: string;
  height: number | null;
  positions: [number, number][];
  sender: string;
  senderName: string;
}

export interface TxBody {
  id: string;
  kind: string;
  sender: string;
  senderName: string;
  status: string;
  statusText: string;
  height: number | null;
  feeUfern: string;
  gas: number;
  submittedAt: string;
}

export interface BlockSummary {
  height: number;
  producedAt: string;
  blobs: number;
  squareWidth: number;
  status: string;
  dataRoot: string;
}

export interface RootRef {
  min: string;
  max: string;
  hash: string;
}

export interface BlockBody {
  height: number;
  producedAt: string;
  status: string;
  squareWidth: number;
  dataRoot: string;
  rowRoots: RootRef[];
  columnRoots: RootRef[];
  blobs: { id: string; namespace: string; positions: [number, number][] }[];
  rejection: {
    reason: string;
    nodeName?: string;
    row?: number;
    col?: number;
    axis?: string;
    index?: number;
  } | null;
}

export interface ShareBody {
  row: number;
  col: number;
  quadrant: string;
  namespace: string;
  kind: string;
  share: string | null;
}

export interface ProofNodeRef extends RootRef {
  span: number;
}

export interface RowProof {
  row: number;
  kind: "inclusion" | "absence" | "outside";
  start?: number;
  end?: number;
  shares?: string[];
  nodes?: ProofNodeRef[];
  nextLeaf?: { col: number; namespace: string; hash: string };
}

export interface FraudProofBody {
  height: number;
  axis: string;
  index: number;
  shares: { position: [number, number]; share: string; nodes: ProofNodeRef[]; verified: boolean }[];
  committedRoot: RootRef;
  recomputedRoot: RootRef;
  publishedAt: string;
}

export interface ValidatorBody {
  id: string;
  name: string;
  selfStakeUfern: string;
  stakeUfern: string;
  commission: string;
  shareOfBonded: string;
}

export interface StakingMe {
  balanceUfern: string;
  availableUfern: string;
  heldUfern: string;
  delegations: { validator: string; validatorName: string; amountUfern: string; pendingRewardsUfern: string }[];
  unbondings: { id: string; validator: string; validatorName: string; amountUfern: string; completesAt: string; status: string }[];
  redelegations: { from: string; fromName: string; to: string; toName: string; amountUfern: string; arrivedAt: string; movableAt: string }[];
}

export interface ProposalBody {
  number: number;
  title: string;
  description: string;
  status: string;
  statusText: string;
  depositUfern: string;
  minDepositUfern: string;
  depositEndsAt: string | null;
  votingEndsAt: string | null;
  tally: {
    votesUfern: string;
    totalBondedUfern: string;
    turnout: string;
    yesUfern: string;
    noUfern: string;
    noWithVetoUfern: string;
    abstainUfern: string;
    vetoShare: string;
    yesShare: string;
    result: string;
  };
  myVote: string | null;
}

export interface NodeBody {
  id: string;
  name: string;
  number: number;
  autoSample: boolean;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

export function getJson<T>(path: string): Promise<T> {
  return request(path) as Promise<T>;
}

export function postJson<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
  }) as Promise<T>;
}

export function putJson<T>(path: string, body: unknown): Promise<T> {
  return request(path, { method: "PUT", body: JSON.stringify(body) }) as Promise<T>;
}

export function patchJson<T>(path: string, body: unknown): Promise<T> {
  return request(path, { method: "PATCH", body: JSON.stringify(body) }) as Promise<T>;
}

export interface FieldErrors {
  errors: Record<string, string>;
}

export function fieldErrors(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.body && typeof error.body === "object" && "errors" in (error.body as object)) {
    return (error.body as FieldErrors).errors;
  }
  return {};
}

export function errorCopy(error: unknown): string | null {
  if (error instanceof ApiError && error.body && typeof error.body === "object" && "error" in (error.body as object)) {
    return String((error.body as { error: string }).error);
  }
  return null;
}
