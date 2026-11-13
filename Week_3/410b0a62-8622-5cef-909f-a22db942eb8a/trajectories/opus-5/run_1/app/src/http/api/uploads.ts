import { createHash, randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { pool, transaction } from '../../db/pool.js';
import { thresholdOn } from '../../db/records.js';
import { toWorkout } from '../../db/workouts.js';
import {
  activityExtension,
  checkChannels,
  checkSampleCount,
  contentTypeFor,
  fileTooLarge,
  isFileFailure,
  parseCsvActivity,
  parseJsonActivity,
  unsupportedType,
  type ActivitySamples,
  type FileFailure,
} from '../../domain/activityFile.js';
import { normalisedPower, normalisedSpeed } from '../../domain/stress.js';
import { instantToLocal, parseActivityStart } from '../../domain/time.js';
import { MESSAGES, Validator } from '../../domain/validation.js';
import { insertCompleted } from '../../services/completed.js';
import { seriesStartOf, thresholdOfSport } from '../../services/scoring.js';
import {
  activityObjectKey,
  deleteActivityObject,
  headActivityObject,
  putActivityObject,
  StorageUnavailableError,
} from '../../storage/s3.js';
import { fileField, parseMultipart, readBody, textField } from '../body.js';
import { visibleAthlete, type RequestContext } from '../context.js';
import { ApiError, uploadStorageUnavailable, ValidationError } from '../errors.js';
import { sendJson } from '../respond.js';
import { announceCompleted } from './workouts.js';

const REQUEST_OVERHEAD_BYTES = 65_536;

function raise(failure: FileFailure): never {
  if (failure.status === 422) throw new ValidationError({ [failure.field]: failure.message });
  throw new ApiError(failure.status, failure.error, failure.message);
}

export async function createUpload(ctx: RequestContext): Promise<void> {
  const athlete = await visibleAthlete(ctx, ctx.params.id as string);
  let body: Buffer;
  try {
    body = await readBody(ctx.req, config.activityMaxBytes + REQUEST_OVERHEAD_BYTES);
  } catch {
    raise(fileTooLarge(config.activityMaxBytes));
  }
  const fields = parseMultipart(body, ctx.req.headers['content-type']);
  const file = fileField(fields, 'file');

  if (file && file.data.length > config.activityMaxBytes) {
    raise(fileTooLarge(config.activityMaxBytes));
  }
  const extension = file ? activityExtension(file.filename as string) : null;
  if (!file || extension === null) raise(unsupportedType());

  const titlePart = textField(fields, 'title');
  const sportPart = textField(fields, 'sport');
  const datePart = textField(fields, 'date');
  const text = file.data.toString('utf8');

  const parsed: ActivitySamples | FileFailure =
    extension === 'csv'
      ? parseCsvActivity(text, sportPart === 'run' ? 'run' : 'bike')
      : parseJsonActivity(text);

  const validator = new Validator();
  if (extension === 'csv') validator.sport('sport', sportPart);
  const startInstant =
    extension === 'json' && !isFileFailure(parsed) && parsed.start !== null
      ? parseActivityStart(parsed.start, athlete.tz)
      : null;
  if (titlePart !== undefined) validator.title('title', titlePart);
  let date: string | null = null;
  let startLocal: string | null = null;
  if (startInstant) {
    const local = instantToLocal(startInstant, athlete.tz);
    date = local.date;
    startLocal = local.time;
  } else if (extension === 'csv' || !isFileFailure(parsed)) {
    date = validator.date('date', datePart);
  }
  if (date !== null) {
    if (date > ctx.today) validator.add('date', MESSAGES.dateFuture);
    else if (date < seriesStartOf(athlete, ctx.today)) {
      validator.add('date', MESSAGES.dateBeforeHistory);
    }
  }
  if (validator.failed) throw new ValidationError(validator.fields);

  if (isFileFailure(parsed)) raise(parsed);
  const channelFailure = checkChannels(parsed);
  if (channelFailure) raise(channelFailure);
  const countFailure = checkSampleCount(parsed, config.activityMaxSamples);
  if (countFailure) raise(countFailure);

  const samples =
    parsed.sport === 'bike'
      ? (parsed.power as number[])
      : (parsed.speed as number[]);
  const normalised =
    parsed.sport === 'bike' ? normalisedPower(samples) : normalisedSpeed(samples);

  const threshold = await thresholdOn(
    pool,
    athlete.id,
    thresholdOfSport(parsed.sport),
    date as string,
  );
  if (threshold === null) {
    throw new ValidationError({
      threshold: parsed.sport === 'bike' ? MESSAGES.noFtp : MESSAGES.noPace,
    });
  }

  const workoutId = randomUUID();
  const sha256 = createHash('sha256').update(file.data).digest('hex');
  const key = activityObjectKey(athlete.id, workoutId, extension);
  const contentType = contentTypeFor(extension);
  const filename = file.filename as string;
  const title = titlePart ?? (parsed.sport === 'bike' ? 'Ride' : 'Run');

  try {
    await putActivityObject({
      key,
      body: file.data,
      contentType,
      sha256,
      filename,
    });
    const head = await headActivityObject(key);
    if (head.size !== file.data.length || head.sha256 !== sha256) {
      throw new StorageUnavailableError('stored object does not match the upload');
    }
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw uploadStorageUnavailable();
    throw error;
  }

  try {
    const row = await transaction((client) =>
      insertCompleted(
        client,
        {
          id: workoutId,
          athlete,
          sport: parsed.sport,
          title,
          date: date as string,
          startLocal,
          startUtc: startInstant,
          durationS: samples.length,
          normalised,
          threshold,
          source: 'file',
          file: { name: filename, size: file.data.length, sha256, contentType },
        },
        ctx.today,
      ),
    );
    await announceCompleted(athlete.id, athlete.name, toWorkout(row));
    sendJson(ctx.res, 201, { workout: toWorkout(row) });
  } catch (error) {
    await deleteActivityObject(key).catch(() => undefined);
    throw error;
  }
}
