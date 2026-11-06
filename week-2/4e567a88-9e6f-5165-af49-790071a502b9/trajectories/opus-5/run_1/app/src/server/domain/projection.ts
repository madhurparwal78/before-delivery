import { Queryable, big, db } from '../db';
import { signedGetUrl } from '../services/s3';
import { storageIsUp } from '../services/deps';
import { isGone } from '../store/assets';
import { AssetRecord, JobRecord, JsonObject, JsonValue, Member, Policy } from '../types';
import { exactUnits } from './money';
import { DISPATCH_ORDER } from '../store/jobs';

export function teamVisibility(policy: Policy, teamId: string): 'team' | 'restricted' {
  return policy.teams.find((team) => team.id === teamId)?.payload_visibility ?? 'team';
}

/** The one place payload visibility is decided. */
export function payloadVisibleTo(job: { teamId: string; submittedBy: string }, reader: Member, policy: Policy): boolean {
  if (reader.id === job.submittedBy) return true;
  if (teamVisibility(policy, job.teamId) === 'restricted') return false;
  if (reader.role === 'member') return reader.teamId === job.teamId;
  return true;
}

interface JobSideData {
  outputs: Map<string, string[]>;
  inputs: Map<string, string[]>;
  released: Map<string, bigint>;
  positions: Map<string, number>;
  people: Map<string, string>;
}

export async function peopleNames(
  ids: readonly string[],
  client: Queryable = db,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { rows } = await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM members WHERE id = ANY($1)',
    [[...new Set(ids)]],
  );
  for (const row of rows) names.set(row.id, row.name);
  return names;
}

async function sideDataFor(jobs: readonly JobRecord[], client: Queryable): Promise<JobSideData> {
  const ids = jobs.map((job) => job.id);
  const outputs = new Map<string, string[]>();
  const inputs = new Map<string, string[]>();
  const released = new Map<string, bigint>();
  const positions = new Map<string, number>();
  const people = await peopleNames(jobs.map((job) => job.submittedBy), client);
  if (ids.length === 0) return { outputs, inputs, released, positions, people };

  const outputRows = await client.query<{ job_id: string; id: string }>(
    `SELECT job_id, id FROM assets WHERE job_id = ANY($1) AND kind = 'output' ORDER BY output_index`,
    [ids],
  );
  for (const row of outputRows.rows) {
    const list = outputs.get(row.job_id) ?? [];
    list.push(row.id);
    outputs.set(row.job_id, list);
  }

  const inputRows = await client.query<{ job_id: string; asset_id: string }>(
    'SELECT job_id, asset_id FROM job_input_assets WHERE job_id = ANY($1) ORDER BY position',
    [ids],
  );
  for (const row of inputRows.rows) {
    const list = inputs.get(row.job_id) ?? [];
    list.push(row.asset_id);
    inputs.set(row.job_id, list);
  }

  const releaseRows = await client.query<{ job_id: string; total: string }>(
    `SELECT m.job_id, SUM(e.amount_micro)::text AS total
       FROM movements m JOIN entries e ON e.movement_id = m.id
      WHERE m.job_id = ANY($1) AND m.kind = 'release' AND e.account = 'available'
      GROUP BY m.job_id`,
    [ids],
  );
  for (const row of releaseRows.rows) released.set(row.job_id, big(row.total));

  const queuedTeams = [...new Set(jobs.filter((job) => job.status === 'queued').map((job) => job.teamId))];
  for (const teamId of queuedTeams) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM jobs WHERE team_id = $1 AND status = 'queued' ORDER BY ${DISPATCH_ORDER}`,
      [teamId],
    );
    rows.forEach((row, index) => positions.set(row.id, index + 1));
  }

  return { outputs, inputs, released, positions, people };
}

function projectWith(job: JobRecord, reader: Member, policy: Policy, side: JobSideData): JsonObject {
  const visible = payloadVisibleTo(job, reader, policy);
  const base: JsonObject = {
    id: job.id,
    team_id: job.teamId,
    model: job.modelSlug,
    status: job.status,
    priority: job.priority,
    submitted_by: { id: job.submittedBy, name: side.people.get(job.submittedBy) ?? '' },
    submitted_at: job.submittedAt.toISOString(),
    started_at: job.startedAt === null ? null : job.startedAt.toISOString(),
    finished_at: job.finishedAt === null ? null : job.finishedAt.toISOString(),
    attempts: job.attempts,
    failure_reason: job.failureReason,
    waiting_reason: job.status === 'queued' && !storageIsUp() ? 'storage_unavailable' : null,
    queue_position: job.status === 'queued' ? side.positions.get(job.id) ?? null : null,
    rate: { id: job.rateId, micro_per_unit: Number(job.rateMicroPerUnit) },
    unit: job.unit,
    estimated_units: exactUnits(job.estimatedUnitsMicro),
    billed_units: job.billedUnitsMicro === null ? null : exactUnits(job.billedUnitsMicro),
    reserved_micro: Number(job.reservedMicro),
    charged_micro: job.chargedMicro === null ? null : Number(job.chargedMicro),
    released_micro: Number(side.released.get(job.id) ?? 0n),
    outputs: (side.outputs.get(job.id) ?? []) as JsonValue,
    payload_visible: visible,
  };
  if (!visible) return base;
  return {
    ...base,
    input: job.input as JsonObject,
    input_assets: (side.inputs.get(job.id) ?? []) as JsonValue,
  };
}

export async function projectJobs(
  jobs: readonly JobRecord[],
  reader: Member,
  policy: Policy,
  client: Queryable = db,
): Promise<JsonObject[]> {
  const side = await sideDataFor(jobs, client);
  return jobs.map((job) => projectWith(job, reader, policy, side));
}

export async function projectJob(
  job: JobRecord,
  reader: Member,
  policy: Policy,
  client: Queryable = db,
): Promise<JsonObject> {
  const [projected] = await projectJobs([job], reader, policy, client);
  return projected!;
}

export type AssetAccess = 'full' | 'no_url' | 'hidden';

/** How much of an asset a reader may see, following Payload visibility. */
export function assetAccessFor(asset: AssetRecord, reader: Member, policy: Policy): AssetAccess {
  if (asset.kind === 'upload') {
    if (asset.ownerMemberId === reader.id) return 'full';
    if (teamVisibility(policy, asset.teamId) === 'restricted') {
      return reader.role === 'admin' || reader.role === 'compliance' ? 'no_url' : 'hidden';
    }
    if (reader.role === 'member') return reader.teamId === asset.teamId ? 'full' : 'hidden';
    return 'full';
  }
  return 'full';
}

export function assetPayloadVisible(asset: AssetRecord, reader: Member, policy: Policy, submittedBy: string): boolean {
  return payloadVisibleTo({ teamId: asset.teamId, submittedBy }, reader, policy);
}

export interface AssetProjectionInput {
  asset: AssetRecord;
  access: AssetAccess;
  payloadVisible: boolean;
  derivedFrom: readonly string[];
}

export function projectAsset(input: AssetProjectionInput): JsonObject {
  const { asset } = input;
  const projection: JsonObject = {
    id: asset.id,
    team_id: asset.teamId,
    kind: asset.kind,
    media_type: asset.mediaType,
    job_id: asset.jobId,
    model: asset.modelSlug,
    width: asset.width,
    height: asset.height,
    duration_seconds: asset.durationSeconds,
    bytes: Number(asset.bytes),
    created_at: asset.createdAt.toISOString(),
    expires_at: asset.expiresAt.toISOString(),
    url: input.access === 'full' ? signedGetUrl(asset.storageKey) : null,
  };
  if (input.payloadVisible) {
    projection['prompt'] = asset.prompt;
    projection['derived_from'] = [...input.derivedFrom];
  }
  return projection;
}

export function assetIsLive(asset: AssetRecord, now: Date): boolean {
  return !isGone(asset, now).gone;
}
