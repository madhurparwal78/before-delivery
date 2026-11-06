import { Queryable, db, lockTeam, tx } from '../db';
import { noticeSoftCap } from '../services/notices';
import { teamById } from '../store/people';
import { currentPolicy } from '../store/policy';
import { recordMovement } from '../store/ledger';
import { insertAsset, addEdge } from '../store/assets';
import {
  inputAssetIds,
  jobById,
  markCancelled,
  markFailed,
  markSucceeded,
} from '../store/jobs';
import { JobRecord, JobStatus } from '../types';
import { emitJobEvent, eventTypeFor } from './events';
import { amountMicro } from './money';
import { capStateOf, periodStateOf } from './meter';

const IN_FLIGHT: readonly JobStatus[] = ['queued', 'leased', 'running'];

async function reloadForUpdate(client: Queryable, jobId: string): Promise<JobRecord | null> {
  await client.query('SELECT id FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
  return jobById(jobId, client);
}

/** Releases a job's whole reservation and records the failure, if it is still in flight. */
export async function failJob(jobId: string, reason: string): Promise<JobRecord | null> {
  const finished = await tx(async (client) => {
    const job = await reloadForUpdate(client, jobId);
    if (!job || !IN_FLIGHT.includes(job.status)) return null;
    await lockTeam(client, job.teamId);
    await markFailed(client, jobId, reason);
    await recordMovement(client, {
      teamId: job.teamId,
      kind: 'release',
      minus: 'reserved',
      plus: 'available',
      amountMicro: job.reservedMicro,
      jobId: job.id,
    });
    return jobById(jobId, client);
  });
  if (!finished) return null;
  await emitFinalEvent(finished);
  return finished;
}

export type CancelOutcome =
  | { kind: 'cancelled'; job: JobRecord }
  | { kind: 'already_cancelled'; job: JobRecord }
  | { kind: 'not_cancellable'; status: JobStatus };

export async function cancelJob(jobId: string): Promise<CancelOutcome> {
  const outcome = await tx<CancelOutcome>(async (client) => {
    const job = await reloadForUpdate(client, jobId);
    if (!job) throw new Error(`Job ${jobId} vanished while cancelling`);
    if (job.status === 'cancelled') return { kind: 'already_cancelled', job };
    if (!IN_FLIGHT.includes(job.status)) return { kind: 'not_cancellable', status: job.status };
    await lockTeam(client, job.teamId);
    await markCancelled(client, jobId);
    await recordMovement(client, {
      teamId: job.teamId,
      kind: 'release',
      minus: 'reserved',
      plus: 'available',
      amountMicro: job.reservedMicro,
      jobId: job.id,
    });
    const updated = await jobById(jobId, client);
    return { kind: 'cancelled', job: updated! };
  });
  if (outcome.kind === 'cancelled') await emitFinalEvent(outcome.job);
  return outcome;
}

export interface StoredOutput {
  storageKey: string;
  mediaType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: number;
}

/**
 * Charges the job at its own rate, returns any unused reservation and records its outputs,
 * all in one transaction. Returns null when the job left `running` meanwhile.
 */
export async function settleJob(
  job: JobRecord,
  billedUnitsMicro: bigint,
  outputs: readonly StoredOutput[],
  expiresAt: Date,
  prompt: string | null,
): Promise<JobRecord | null> {
  const chargedMicro = amountMicro(billedUnitsMicro, job.rateMicroPerUnit);
  const settled = await tx(async (client) => {
    const current = await reloadForUpdate(client, job.id);
    if (!current || current.status !== 'running') return null;
    await lockTeam(client, job.teamId);
    await markSucceeded(client, job.id, billedUnitsMicro, chargedMicro);
    if (chargedMicro > 0n) {
      await recordMovement(client, {
        teamId: job.teamId,
        kind: 'settle',
        minus: 'reserved',
        plus: 'settled',
        amountMicro: chargedMicro,
        jobId: job.id,
      });
    }
    const unused = job.reservedMicro - chargedMicro;
    if (unused > 0n) {
      await recordMovement(client, {
        teamId: job.teamId,
        kind: 'release',
        minus: 'reserved',
        plus: 'available',
        amountMicro: unused,
        jobId: job.id,
      });
    }
    const inputs = await inputAssetIds(job.id, client);
    for (const [index, output] of outputs.entries()) {
      const asset = await insertAsset(client, {
        teamId: job.teamId,
        kind: 'output',
        mediaType: output.mediaType,
        jobId: job.id,
        modelSlug: job.modelSlug,
        width: output.width,
        height: output.height,
        durationSeconds: output.durationSeconds,
        bytes: output.bytes,
        expiresAt,
        storageKeyFor: () => output.storageKey,
        prompt,
        ownerMemberId: job.submittedBy,
        outputIndex: index + 1,
      });
      for (const inputId of inputs) await addEdge(client, inputId, asset.id);
    }
    return jobById(job.id, client);
  });
  if (!settled) return null;
  await emitFinalEvent(settled);
  await reportSoftCap(settled.teamId);
  return settled;
}

export async function emitFinalEvent(job: JobRecord): Promise<void> {
  const type = eventTypeFor(job.status);
  if (type) await emitJobEvent(job, type);
}

/** Sends the soft cap email the first time a team's period spend reaches its soft cap. */
export async function reportSoftCap(teamId: string): Promise<void> {
  const policy = await currentPolicy();
  const team = await teamById(teamId);
  if (!team) return;
  const state = await periodStateOf(db, teamId, policy, new Date());
  if (capStateOf(state, false) === 'under') return;
  await noticeSoftCap(team, state.period, state.spendMicro, state.softCapMicro);
}
