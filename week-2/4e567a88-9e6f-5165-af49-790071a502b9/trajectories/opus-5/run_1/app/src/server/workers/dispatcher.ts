import { config } from '../config';
import { lockTeam, tx } from '../db';
import { resolveAccess } from '../domain/access';
import { StoredOutput, failJob, settleJob } from '../domain/lifecycle';
import { billedUnitsMicro, outputPlan } from '../domain/units';
import { validateInput } from '../domain/validate';
import { extensionFor, placeholderPng, placeholderWav, placeholderWebm } from '../services/media';
import { StorageUnavailable, putObject } from '../services/s3';
import { noteStorageFailure, storageIsUp } from '../services/deps';
import { assetById, isGone } from '../store/assets';
import { modelBySlug, schemaOf } from '../store/catalogue';
import {
  claimNextQueued,
  inputAssetIds,
  jobById,
  lapsedLeases,
  markFailed,
  markLeased,
  markRequeued,
  markRunning,
  renewLease,
  runningCount,
} from '../store/jobs';
import { recordMovement } from '../store/ledger';
import { allTeams } from '../store/people';
import { currentPolicy, teamPolicyOf } from '../store/policy';
import { JobRecord, JsonObject } from '../types';
import { emitFinalEvent } from '../domain/lifecycle';

const MAX_LAPSES = 3;
const running = new Set<string>();

function leaseUntil(): Date {
  return new Date(Date.now() + config.leaseSeconds * 1000);
}

function promptOf(input: JsonObject): string | null {
  const prompt = input['prompt'];
  if (typeof prompt === 'string') return prompt;
  const text = input['text'];
  return typeof text === 'string' ? text : null;
}

async function requeueLapsedLeases(): Promise<void> {
  for (const job of await lapsedLeases()) {
    if (running.has(job.id)) continue;
    if (job.lapses + 1 >= MAX_LAPSES) {
      await failJob(job.id, 'lease_expired');
      continue;
    }
    await tx(async (client) => {
      const current = await jobById(job.id, client);
      if (!current || (current.status !== 'leased' && current.status !== 'running')) return;
      await markRequeued(client, job.id);
    });
  }
}

async function writeOutputs(job: JobRecord, billedUnits: bigint): Promise<StoredOutput[]> {
  const model = await modelBySlug(job.modelSlug);
  if (!model) throw new Error(`Job ${job.id} names unknown model ${job.modelSlug}`);
  const { values } = validateInput(schemaOf(model), job.input as JsonObject);
  const plan = outputPlan(job.modelSlug, values, billedUnits);
  const stored: StoredOutput[] = [];
  for (const [index, output] of plan.entries()) {
    const key = `outputs/${job.teamId}/${job.id}/${index + 1}.${extensionFor(output.mediaType)}`;
    const seed = `${job.id}:${index + 1}`;
    let bytes: Buffer;
    if (output.mediaType === 'image/png') {
      bytes = placeholderPng(output.width ?? 1024, output.height ?? 1024, seed);
    } else if (output.mediaType === 'video/webm') {
      bytes = placeholderWebm(output.width ?? 1280, output.height ?? 720, output.durationSeconds ?? 0, seed);
    } else {
      bytes = placeholderWav(output.durationSeconds ?? 0, seed);
    }
    await putObject(key, bytes, output.mediaType);
    stored.push({
      storageKey: key,
      mediaType: output.mediaType,
      width: output.width,
      height: output.height,
      durationSeconds: output.durationSeconds,
      bytes: bytes.length,
    });
  }
  return stored;
}

async function inputAssetsAreLive(job: JobRecord): Promise<boolean> {
  const now = new Date();
  for (const id of await inputAssetIds(job.id)) {
    const asset = await assetById(id);
    if (!asset || isGone(asset, now).gone) return false;
  }
  return true;
}

async function runJob(job: JobRecord): Promise<void> {
  running.add(job.id);
  const renewal = setInterval(() => {
    void renewLease(job.id, leaseUntil());
  }, Math.max(1000, Math.floor((config.leaseSeconds * 1000) / 3)));
  try {
    if (!(await inputAssetsAreLive(job))) {
      await failJob(job.id, 'input_deleted');
      return;
    }
    await markRunning(job.id, leaseUntil());
    await new Promise((resolve) => setTimeout(resolve, config.jobRunSeconds * 1000));
    const current = await jobById(job.id);
    if (!current || current.status !== 'running') return;
    const model = await modelBySlug(job.modelSlug);
    if (!model) throw new Error(`Job ${job.id} names unknown model ${job.modelSlug}`);
    const { values } = validateInput(schemaOf(model), job.input as JsonObject);
    const billedUnits = billedUnitsMicro(job.modelSlug, values, job.estimatedUnitsMicro);
    let outputs: StoredOutput[];
    try {
      outputs = await writeOutputs(current, billedUnits);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        noteStorageFailure();
        await failJob(job.id, 'storage_unavailable');
        return;
      }
      throw error;
    }
    const policy = await currentPolicy();
    const expiresAt = new Date(Date.now() + policy.retention_days * config.retentionDaySeconds * 1000);
    await settleJob(current, billedUnits, outputs, expiresAt, promptOf(job.input as JsonObject));
  } finally {
    clearInterval(renewal);
    running.delete(job.id);
  }
}

async function dispatchTeam(teamId: string): Promise<void> {
  const policy = await currentPolicy();
  const concurrency = teamPolicyOf(policy, teamId).concurrency;
  for (;;) {
    const claimed = await tx(async (client) => {
      await lockTeam(client, teamId);
      if ((await runningCount(client, teamId)) >= concurrency) return null;
      const job = await claimNextQueued(client, teamId);
      if (!job) return null;
      if (resolveAccess(policy, teamId, job.modelSlug, job.context) === 'blocked') {
        await markFailed(client, job.id, 'model_blocked');
        await recordMovement(client, {
          teamId,
          kind: 'release',
          minus: 'reserved',
          plus: 'available',
          amountMicro: job.reservedMicro,
          jobId: job.id,
        });
        return { job, blocked: true };
      }
      await markLeased(client, job.id, leaseUntil());
      return { job, blocked: false };
    });
    if (!claimed) return;
    if (claimed.blocked) {
      const failed = await jobById(claimed.job.id);
      if (failed) await emitFinalEvent(failed);
      continue;
    }
    void runJob(claimed.job).catch((error: unknown) => {
      console.error('job run failed', { job: claimed.job.id, error: String(error) });
    });
  }
}

async function tick(): Promise<void> {
  await requeueLapsedLeases();
  if (!storageIsUp()) return;
  for (const team of await allTeams()) await dispatchTeam(team.id);
}

/** Fills a free slot within two seconds, and never while storage is unreachable. */
export function startDispatcher(): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    tick()
      .catch((error: unknown) => console.error('dispatch tick failed', error))
      .finally(() => {
        busy = false;
      });
  }, 500).unref();
}
