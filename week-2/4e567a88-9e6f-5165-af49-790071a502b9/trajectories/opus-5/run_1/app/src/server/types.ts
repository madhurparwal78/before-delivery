export type Role = 'member' | 'admin' | 'finance' | 'compliance';
export type Context = 'api' | 'playground';
export type AccessValue = 'allowed' | 'blocked';
export type TeamAccessValue = AccessValue | 'inherit';
export type PayloadVisibility = 'team' | 'restricted';
export type JobStatus = 'queued' | 'leased' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type Priority = 'high' | 'normal' | 'low';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
}

export interface Caller {
  member: Member;
  context: Context;
}

export interface TeamPolicy {
  id: string;
  name: string;
  concurrency: number;
  payload_visibility: PayloadVisibility;
  soft_cap_credits: number;
  hard_cap_credits: number;
  context_defaults: Record<Context, TeamAccessValue>;
  model_access: Record<string, Record<Context, TeamAccessValue>>;
}

export interface Policy {
  version: number;
  timezone: string;
  retention_days: number;
  org_model_access: Record<string, Record<Context, AccessValue>>;
  teams: TeamPolicy[];
}

export interface ModelRow {
  slug: string;
  name: string;
  modality: string;
  unit: string;
  unitLabel: string;
  inputSchema: unknown;
  position: number;
}

export interface RateRow {
  id: string;
  modelSlug: string;
  microPerUnit: bigint;
  effectiveAt: Date;
  createdBy: string;
}

export interface JobRecord {
  id: string;
  num: bigint;
  teamId: string;
  modelSlug: string;
  status: JobStatus;
  priority: Priority;
  context: Context;
  submittedBy: string;
  submittedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  attempts: number;
  lapses: number;
  failureReason: string | null;
  input: Record<string, unknown>;
  rateId: string;
  rateMicroPerUnit: bigint;
  unit: string;
  estimatedUnitsMicro: bigint;
  billedUnitsMicro: bigint | null;
  reservedMicro: bigint;
  chargedMicro: bigint | null;
  periodStart: Date;
}

export interface AssetRecord {
  id: string;
  num: bigint;
  teamId: string;
  kind: 'upload' | 'output';
  mediaType: string;
  jobId: string | null;
  modelSlug: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: bigint;
  createdAt: Date;
  expiresAt: Date;
  storageKey: string;
  prompt: string | null;
  ownerMemberId: string;
  removedAt: Date | null;
  removedReason: 'deleted' | 'expired' | null;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
