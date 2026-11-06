import { config } from '../config';
import { db, lockTeam, tx } from '../db';
import { resolveAccess } from '../domain/access';
import { periodStateOf } from '../domain/meter';
import { amountMicro, exactUnits } from '../domain/money';
import { assetAccessFor, payloadVisibleTo, projectJob, projectJobs } from '../domain/projection';
import { estimatedUnitsMicro } from '../domain/units';
import { validateInput } from '../domain/validate';
import { cancelJob, reportSoftCap } from '../domain/lifecycle';
import { fail, fieldMessages } from '../errors';
import { Ctx, Reply, Router, created, csv, ok } from '../http/router';
import { noteStorageFailure, storageIsUp } from '../services/deps';
import { extensionFor, pixelSizeOf } from '../services/media';
import { checkUrl, fetchImage } from '../services/outbound';
import { StorageUnavailable, putObject } from '../services/s3';
import { assetById, insertAsset, isGone } from '../store/assets';
import { allModels, modelBySlug, rateAt, schemaOf } from '../store/catalogue';
import { findIdempotency, storeIdempotency } from '../store/idempotency';
import {
  activeJobsOfTeam,
  allJobsOfTeam,
  insertJob,
  jobById,
  jobsOfTeam,
  recordReplay,
  recordSubmissionAttempt,
} from '../store/jobs';
import { balancesOf, recordMovement } from '../store/ledger';
import { Team, teamById } from '../store/people';
import { noticeHardCap } from '../services/notices';
import { Caller, JobRecord, JsonObject, JsonValue, Policy, Priority } from '../types';
import { csvRow, policyNow, readLimit, requireTeamMember, resolveTeam, submissionFingerprint } from './support';

const VISIBLE_ASCII = /^[\x21-\x7e]{1,255}$/;
const PRIORITIES: readonly Priority[] = ['high', 'normal', 'low'];

function restrictStored(body: JsonObject, caller: Caller, policy: Policy): JsonObject {
  const job = body['job'];
  if (job === null || typeof job !== 'object' || Array.isArray(job)) return body;
  const stored = job as JsonObject;
  const submittedBy = stored['submitted_by'];
  const submitterId =
    submittedBy !== null && typeof submittedBy === 'object' && !Array.isArray(submittedBy)
      ? String((submittedBy as JsonObject)['id'])
      : '';
  const visible = payloadVisibleTo(
    { teamId: String(stored['team_id']), submittedBy: submitterId },
    caller.member,
    policy,
  );
  if (visible) return body;
  const { input: _input, input_assets: _inputAssets, ...rest } = stored;
  return { job: { ...rest, payload_visible: false } };
}

async function replyReplay(ctx: Ctx, teamId: string, record: { statusCode: number; responseBody: JsonObject; jobId: string }): Promise<Reply> {
  const policy = await policyNow();
  await tx(async (client) => {
    await recordReplay(client, teamId, record.jobId);
  });
  return {
    status: record.statusCode,
    json: restrictStored(record.responseBody, ctx.caller, policy),
    headers: { 'idempotent-replayed': 'true' },
  };
}

interface ResolvedMedia {
  field: string;
  assetId: string | null;
  url: string | null;
}

export function registerJobRoutes(router: Router): void {
  router.add('POST', '/api/jobs', 'json', async (ctx) => submitJob(ctx));

  router.add('GET', '/api/jobs', 'none', async (ctx) => {
    const team = await resolveTeam(ctx, { required: false });
    const policy = await policyNow();
    const status = ctx.query.get('status');
    if (status !== null && !['queued', 'leased', 'running', 'succeeded', 'failed', 'cancelled'].includes(status)) {
      throw fail.validation({ status: 'Choose a status from the job state machine.' });
    }
    const limit = readLimit(ctx);
    const cursorRaw = ctx.query.get('cursor');
    if (cursorRaw !== null && !/^\d+$/.test(cursorRaw)) {
      throw fail.validation({ cursor: 'Use a cursor from a previous page.' });
    }
    const cursor = cursorRaw === null ? null : BigInt(cursorRaw);
    const jobs = await jobsOfTeam(team.id, status, limit + 1, cursor);
    const page = jobs.slice(0, limit);
    const next = jobs.length > limit ? page[page.length - 1]! : null;
    return ok({
      jobs: (await projectJobs(page, ctx.caller.member, policy)) as unknown as JsonValue,
      next_cursor: next === null ? null : next.num.toString(),
    });
  });

  router.add('GET', '/api/jobs.csv', 'none', async (ctx) => {
    const team = await resolveTeam(ctx, { required: false });
    const policy = await policyNow();
    const jobs = await allJobsOfTeam(team.id);
    const models = await allModels();
    const names = new Map(models.map((model) => [model.slug, model.name]));
    const projections = await projectJobs(jobs, ctx.caller.member, policy);
    const header = csvRow([
      'job_id',
      'team',
      'model',
      'status',
      'submitted_by',
      'submitted_at',
      'finished_at',
      'unit',
      'billed_units',
      'rate_micro_per_unit',
      'charged_micro',
      'prompt',
    ]);
    const rows = jobs.map((job, index) => {
      const projection = projections[index]!;
      const input = projection['input'];
      let prompt = '';
      if (input !== undefined && input !== null && typeof input === 'object' && !Array.isArray(input)) {
        const record = input as JsonObject;
        const value = record['prompt'] ?? record['text'];
        if (typeof value === 'string') prompt = value;
      }
      const submitter = projection['submitted_by'] as JsonObject;
      return csvRow([
        job.id,
        team.name,
        names.get(job.modelSlug) ?? job.modelSlug,
        job.status,
        String(submitter['name'] ?? ''),
        job.submittedAt.toISOString(),
        job.finishedAt === null ? '' : job.finishedAt.toISOString(),
        job.unit,
        job.billedUnitsMicro === null ? '' : exactUnits(job.billedUnitsMicro),
        job.rateMicroPerUnit.toString(),
        job.chargedMicro === null ? '' : job.chargedMicro.toString(),
        prompt,
      ]);
    });
    return csv([header, ...rows].join('\n') + '\n', `jobs-${team.id}.csv`);
  });

  router.add('GET', '/api/queue', 'none', async (ctx) => {
    const team = await resolveTeam(ctx, { required: ctx.caller.member.role !== 'member' });
    const policy = await policyNow();
    const jobs = await activeJobsOfTeam(team.id);
    const models = await allModels();
    const projections = await projectJobs(jobs, ctx.caller.member, policy);
    const lanes = models.map((model) => {
      const laneJobs = jobs
        .map((job, index) => ({ job, projection: projections[index]! }))
        .filter((entry) => entry.job.modelSlug === model.slug);
      return {
        model: model.slug,
        queued: laneJobs
          .filter((entry) => entry.job.status === 'queued')
          .sort((a, b) => Number(a.projection['queue_position']) - Number(b.projection['queue_position']))
          .map((entry) => entry.projection),
        running: laneJobs
          .filter((entry) => entry.job.status === 'leased' || entry.job.status === 'running')
          .map((entry) => entry.projection),
      };
    });
    return ok({ lanes: lanes as unknown as JsonValue });
  });

  router.add('GET', '/api/jobs/:id', 'none', async (ctx) => {
    const job = await readableJob(ctx, ctx.params['id']!);
    const policy = await policyNow();
    return ok({ job: await projectJob(job, ctx.caller.member, policy) });
  });

  router.add('POST', '/api/jobs/:id/cancel', 'none', async (ctx) => {
    const job = await readableJob(ctx, ctx.params['id']!);
    if (ctx.caller.member.role !== 'member' && ctx.caller.member.role !== 'admin') throw fail.forbidden();
    const policy = await policyNow();
    const outcome = await cancelJob(job.id);
    if (outcome.kind === 'not_cancellable') throw fail.jobNotCancellable(outcome.status);
    return ok({ job: await projectJob(outcome.job, ctx.caller.member, policy) });
  });
}

async function readableJob(ctx: Ctx, id: string): Promise<JobRecord> {
  const job = await jobById(id);
  if (!job) throw fail.notFound();
  if (ctx.caller.member.role === 'member' && ctx.caller.member.teamId !== job.teamId) throw fail.notFound();
  return job;
}

async function resolveMediaInputs(
  ctx: Ctx,
  team: Team,
  media: readonly ResolvedMedia[],
  policy: Policy,
): Promise<string[]> {
  const assetIds: string[] = [];
  for (const reference of media) {
    if (reference.assetId !== null) {
      assetIds.push(reference.assetId);
      continue;
    }
    if (!storageIsUp()) throw fail.storageUnavailable();
    const fetched = await fetchImage(reference.url!);
    if (fetched.kind === 'refused_address') throw fail.validation({ [reference.field]: fieldMessages.refusedAddress });
    if (fetched.kind === 'not_an_image') throw fail.validation({ [reference.field]: fieldMessages.notAnImage });
    if (fetched.kind === 'too_large') throw fail.validation({ [reference.field]: fieldMessages.imageTooLarge });
    if (fetched.kind === 'unfetchable') throw fail.validation({ [reference.field]: fieldMessages.unfetchableImage });
    const size = pixelSizeOf(fetched.mediaType, fetched.bytes);
    const extension = extensionFor(fetched.mediaType);
    const expiresAt = new Date(Date.now() + policy.retention_days * config.retentionDaySeconds * 1000);
    const asset = await tx(async (client) =>
      insertAsset(client, {
        teamId: team.id,
        kind: 'upload',
        mediaType: fetched.mediaType,
        jobId: null,
        modelSlug: null,
        width: size?.width ?? null,
        height: size?.height ?? null,
        durationSeconds: null,
        bytes: fetched.bytes.length,
        expiresAt,
        storageKeyFor: (assetId) => `uploads/${team.id}/${assetId}.${extension}`,
        prompt: null,
        ownerMemberId: ctx.caller.member.id,
        outputIndex: null,
      }),
    );
    try {
      await putObject(asset.storageKey, fetched.bytes, fetched.mediaType);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        noteStorageFailure();
        throw fail.storageUnavailable();
      }
      throw error;
    }
    assetIds.push(asset.id);
  }
  return assetIds;
}

async function submitJob(ctx: Ctx): Promise<Reply> {
  const keyHeader = ctx.headers['idempotency-key'];
  const key = typeof keyHeader === 'string' && keyHeader.length > 0 ? keyHeader : null;
  if (ctx.caller.context === 'api' && (key === null || !VISIBLE_ASCII.test(key))) {
    throw fail.idempotencyKeyRequired();
  }
  if (key !== null && !VISIBLE_ASCII.test(key)) throw fail.idempotencyKeyRequired();

  const teamId = requireTeamMember(ctx.caller);
  const team = await teamById(teamId);
  if (!team) throw fail.notFound();

  const modelValue = ctx.body['model'];
  const inputValue = ctx.body['input'];
  const priorityValue = ctx.body['priority'] ?? 'normal';
  const fingerprint = submissionFingerprint(
    modelValue ?? null,
    (inputValue ?? null) as JsonValue,
    typeof priorityValue === 'string' ? priorityValue : '',
  );

  if (key !== null) {
    const stored = await findIdempotency(teamId, key);
    if (stored) {
      if (stored.bodyHash !== fingerprint) throw fail.idempotencyKeyReused();
      return replyReplay(ctx, teamId, stored);
    }
  }

  const policy = await policyNow();
  const errors: Record<string, string> = {};
  if (typeof priorityValue !== 'string' || !PRIORITIES.includes(priorityValue as Priority)) {
    errors['priority'] = 'Choose high, normal or low.';
  }
  if (typeof modelValue !== 'string') errors['model'] = 'Name a model from the catalogue.';
  const model = typeof modelValue === 'string' ? await modelBySlug(modelValue) : null;
  if (typeof modelValue === 'string' && !model) errors['model'] = 'Name a model from the catalogue.';
  if (inputValue === undefined || inputValue === null || typeof inputValue !== 'object' || Array.isArray(inputValue)) {
    errors['input'] = 'Send the model input as an object.';
  }
  if (Object.keys(errors).length > 0) throw fail.validation(errors);

  const chosenModel = model!;
  if (resolveAccess(policy, teamId, chosenModel.slug, ctx.caller.context) === 'blocked') {
    const contextWord = ctx.caller.context === 'playground' ? 'playground' : 'API';
    throw fail.modelBlocked(`${chosenModel.name} is blocked for ${contextWord} runs in ${team.name}.`);
  }

  const outcome = validateInput(schemaOf(chosenModel), inputValue as JsonObject);
  const media: ResolvedMedia[] = [];
  for (const reference of outcome.media) {
    if (reference.raw.startsWith('asset:')) {
      const assetId = reference.raw.slice('asset:'.length);
      const asset = await assetById(assetId);
      if (!asset || isGone(asset, new Date()).gone) {
        outcome.errors[reference.field] = 'That asset is not available.';
        continue;
      }
      if (assetAccessFor(asset, ctx.caller.member, policy) !== 'full') {
        outcome.errors[reference.field] = 'That asset is not available.';
        continue;
      }
      if (!asset.mediaType.startsWith('image/')) {
        outcome.errors[reference.field] = 'That asset is not an image.';
        continue;
      }
      media.push({ field: reference.field, assetId, url: null });
      continue;
    }
    const check = await checkUrl(reference.raw);
    if (check.kind === 'refused') {
      outcome.errors[reference.field] = fieldMessages.refusedAddress;
      continue;
    }
    media.push({ field: reference.field, assetId: null, url: reference.raw });
  }
  if (Object.keys(outcome.errors).length > 0) throw fail.validation(outcome.errors);

  const submittedAt = new Date();
  const rate = await rateAt(db, chosenModel.slug, submittedAt);
  if (!rate) throw fail.validation({ model: 'This model has no rate in effect.' });
  const estimatedUnits = estimatedUnitsMicro(chosenModel.slug, outcome.values);
  const reservedMicro = amountMicro(estimatedUnits, rate.microPerUnit);

  const balances = await balancesOf(db, teamId);
  if (reservedMicro > balances.availableMicro) {
    throw fail.insufficientCredits(reservedMicro, balances.availableMicro);
  }
  const periodState = await periodStateOf(db, teamId, policy, submittedAt);
  if (periodState.spendMicro + reservedMicro > periodState.hardCapMicro) {
    await tx(async (client) => {
      await recordSubmissionAttempt(client, teamId, periodState.period.startsAt, true);
    });
    await noticeHardCap(team, periodState.period, policy.timezone);
    throw fail.budgetHardCap(periodState.period.endsAt.toISOString());
  }

  const assetIds = await resolveMediaInputs(ctx, team, media, policy);

  const result = await tx(async (client) => {
    await lockTeam(client, teamId);
    if (key !== null) {
      const stored = await findIdempotency(teamId, key, client);
      if (stored) {
        if (stored.bodyHash !== fingerprint) throw fail.idempotencyKeyReused();
        return { kind: 'replay' as const, stored };
      }
    }
    const nowBalances = await balancesOf(client, teamId);
    if (reservedMicro > nowBalances.availableMicro) {
      throw fail.insufficientCredits(reservedMicro, nowBalances.availableMicro);
    }
    const state = await periodStateOf(client, teamId, policy, submittedAt);
    if (state.spendMicro + reservedMicro > state.hardCapMicro) {
      throw fail.budgetHardCap(state.period.endsAt.toISOString());
    }
    const job = await insertJob(client, {
      teamId,
      modelSlug: chosenModel.slug,
      priority: priorityValue as Priority,
      context: ctx.caller.context,
      submittedBy: ctx.caller.member.id,
      input: inputValue as JsonObject,
      rateId: rate.id,
      rateMicroPerUnit: rate.microPerUnit,
      unit: chosenModel.unit,
      estimatedUnitsMicro: estimatedUnits,
      reservedMicro,
      periodStart: state.period.startsAt,
      inputAssetIds: assetIds,
    });
    await recordMovement(client, {
      teamId,
      kind: 'reserve',
      minus: 'available',
      plus: 'reserved',
      amountMicro: reservedMicro,
      jobId: job.id,
    });
    await recordSubmissionAttempt(client, teamId, state.period.startsAt, false);
    const projection = await projectJob(job, ctx.caller.member, policy, client);
    const body: JsonObject = { job: projection };
    if (key !== null) {
      await storeIdempotency(client, teamId, {
        key,
        bodyHash: fingerprint,
        jobId: job.id,
        statusCode: 201,
        responseBody: body,
      });
    }
    return { kind: 'created' as const, body };
  });

  if (result.kind === 'replay') return replyReplay(ctx, teamId, result.stored);
  await reportSoftCap(teamId);
  return created(result.body);
}
