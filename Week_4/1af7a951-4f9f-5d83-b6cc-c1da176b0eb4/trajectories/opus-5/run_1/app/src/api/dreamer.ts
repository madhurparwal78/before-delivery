import { randomUUID } from 'node:crypto';
import { oneRow, pool, withTransaction } from '../db/pool.js';
import { apiError, notFound, validationError } from '../http/errors.js';
import { readBoolean, readInteger, readString, type JsonObject } from '../http/json.js';
import { isUuid, type ApiResponse, type RequestContext } from '../http/router.js';
import { standingOf, findCohort } from '../store/cohorts.js';
import {
  entryView,
  findEntry,
  listEntries,
  listSignsOfEntries,
  listSignsOfEntry,
  type EntryRow,
  type Technique,
} from '../store/entries.js';
import { constellationsOf, tallyRowsOf } from '../store/aggregates.js';
import {
  MESSAGES,
  codePointLength,
  hasNonSpace,
  isBedtime,
  type Validated,
} from '../domain/fields.js';
import { isAcceptedTimeZone, type DateKey } from '../domain/time.js';
import {
  NIGHTS_PER_COHORT,
  TECHNIQUE_UNLOCK_NIGHT,
  captureWindowOpen,
  nightHeld,
  wakeAlarm,
} from '../domain/night.js';
import { rangesOverlap, SIGN_CATEGORIES } from '../domain/signs.js';
import { dreamerOf, nightStatusOf } from './support.js';

const TECHNIQUES: readonly Technique[] = ['none', 'mild', 'ssild'];

export async function readNight(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const cohort = await findCohort(dreamer.cohort_id);
  if (cohort === null) throw notFound();
  const night = await nightStatusOf(dreamer, ctx.now);
  return {
    status: 200,
    json: {
      night_key: night.night_key,
      night_number: night.night_number,
      first_night: dreamer.first_night,
      capture_window: night.capture_window,
      bedtime: dreamer.bedtime,
      wake_alarm: wakeAlarm(dreamer.bedtime),
      home_tz: dreamer.home_tz,
      technique_unlocked: night.technique_unlocked,
      cohort_phase: standingOf(cohort, ctx.now).phase,
    },
  };
}

export async function saveSettings(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const errors: Record<string, string> = {};
  const homeTz = readString(ctx.body, 'home_tz');
  const bedtime = readString(ctx.body, 'bedtime');
  if ('home_tz' in ctx.body && (homeTz === undefined || !isAcceptedTimeZone(homeTz))) {
    errors['home_tz'] = MESSAGES.homeTz;
  }
  if ('bedtime' in ctx.body && (bedtime === undefined || !isBedtime(bedtime))) {
    errors['bedtime'] = MESSAGES.bedtime;
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  await pool.query(
    'update enrollments set home_tz = coalesce($2, home_tz), bedtime = coalesce($3, bedtime) where id = $1',
    [dreamer.id, homeTz ?? null, bedtime ?? null],
  );
  const updated = { ...dreamer, home_tz: homeTz ?? dreamer.home_tz, bedtime: bedtime ?? dreamer.bedtime };
  const night = await nightStatusOf(updated, ctx.now);
  return {
    status: 200,
    json: {
      home_tz: updated.home_tz,
      bedtime: updated.bedtime,
      wake_alarm: wakeAlarm(updated.bedtime),
      night_key: night.night_key,
      night_number: night.night_number,
      night_held: nightHeld(night.settings, ctx.now, night.night_key),
    },
  };
}

export async function readEntries(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const entries = await listEntries(dreamer.id);
  const signs = await listSignsOfEntries(entries.map((entry) => entry.id));
  return {
    status: 200,
    json: { entries: entries.map((entry) => entryView(entry, signs, dreamer.first_night)) },
  };
}

interface EntryFields {
  readonly title: string | undefined;
  readonly text: string | undefined;
  readonly dreams_recalled: number | undefined;
  readonly lucid: boolean | undefined;
  readonly wbtb: boolean | undefined;
  readonly technique: string | undefined;
  readonly technique_minutes: number | undefined;
}

function entryFields(body: JsonObject): EntryFields {
  return {
    title: readString(body, 'title'),
    text: readString(body, 'text'),
    dreams_recalled: readInteger(body, 'dreams_recalled'),
    lucid: readBoolean(body, 'lucid'),
    wbtb: readBoolean(body, 'wbtb'),
    technique: readString(body, 'technique'),
    technique_minutes: readInteger(body, 'technique_minutes'),
  };
}

function sameEntryBody(stored: EntryRow, fields: EntryFields): boolean {
  return (
    stored.title === fields.title &&
    stored.text === fields.text &&
    stored.dreams_recalled === fields.dreams_recalled &&
    stored.lucid === fields.lucid &&
    stored.wbtb === fields.wbtb &&
    stored.technique === fields.technique &&
    stored.technique_minutes === fields.technique_minutes
  );
}

interface EntryValues {
  readonly title: string;
  readonly text: string;
  readonly dreamsRecalled: number;
  readonly lucid: boolean;
  readonly wbtb: boolean;
  readonly technique: Technique;
  readonly techniqueMinutes: number;
}

function entryInput(
  fields: EntryFields,
  idIsUuid: boolean,
  currentNightNumber: number,
): Validated<EntryValues> {
  const errors: Record<string, string> = {};
  if (!idIsUuid) errors['id'] = MESSAGES.entryId;
  if (fields.title === undefined || codePointLength(fields.title) > 120) {
    errors['title'] = MESSAGES.title;
  }
  if (fields.text === undefined || !hasNonSpace(fields.text)) {
    errors['text'] = MESSAGES.textEmpty;
  } else if (codePointLength(fields.text) > 20_000) {
    errors['text'] = MESSAGES.textTooLong;
  }
  if (
    fields.dreams_recalled === undefined ||
    fields.dreams_recalled < 0 ||
    fields.dreams_recalled > 20
  ) {
    errors['dreams_recalled'] = MESSAGES.dreamsRecalled;
  }
  if (fields.lucid === undefined) errors['lucid'] = MESSAGES.boolean;
  if (fields.wbtb === undefined) errors['wbtb'] = MESSAGES.boolean;
  const technique = TECHNIQUES.find((candidate) => candidate === fields.technique);
  if (technique === undefined) errors['technique'] = MESSAGES.technique;
  if (
    fields.technique_minutes === undefined ||
    fields.technique_minutes < 0 ||
    fields.technique_minutes > 180
  ) {
    errors['technique_minutes'] = MESSAGES.techniqueMinutes;
  }
  const reportsPractice =
    fields.wbtb === true ||
    (technique !== undefined && technique !== 'none') ||
    (fields.technique_minutes !== undefined && fields.technique_minutes > 0);
  if (
    currentNightNumber < TECHNIQUE_UNLOCK_NIGHT &&
    reportsPractice &&
    technique !== undefined
  ) {
    errors['technique'] = MESSAGES.techniqueLocked;
  }
  if (
    fields.title === undefined ||
    fields.text === undefined ||
    fields.dreams_recalled === undefined ||
    fields.lucid === undefined ||
    fields.wbtb === undefined ||
    technique === undefined ||
    fields.technique_minutes === undefined ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      title: fields.title,
      text: fields.text,
      dreamsRecalled: fields.dreams_recalled,
      lucid: fields.lucid,
      wbtb: fields.wbtb,
      technique,
      techniqueMinutes: fields.technique_minutes,
    },
  };
}

async function viewOfEntry(entry: EntryRow, firstNight: DateKey | null): Promise<unknown> {
  const signs = await listSignsOfEntry(entry.id);
  return entryView(entry, signs, firstNight);
}

export async function saveEntry(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const entryId = ctx.params['entryId'] ?? '';
  const idIsUuid = isUuid(entryId);
  const fields = entryFields(ctx.body);

  const stored = idIsUuid ? await findEntry(entryId) : null;
  if (stored !== null && stored.enrollment_id !== dreamer.id) throw notFound();
  if (stored !== null) {
    if (sameEntryBody(stored, fields)) {
      return { status: 200, json: { entry: await viewOfEntry(stored, dreamer.first_night) } };
    }
    throw apiError(409, 'entry_id_conflict');
  }

  const cohort = await findCohort(dreamer.cohort_id);
  if (cohort === null) throw notFound();
  const night = await nightStatusOf(dreamer, ctx.now);
  if (night.night_number < 1) throw apiError(409, 'cohort_not_started');
  if (
    night.night_number > NIGHTS_PER_COHORT ||
    standingOf(cohort, ctx.now).phase === 'closed'
  ) {
    throw apiError(409, 'cohort_closed');
  }

  const input = entryInput(fields, idIsUuid, night.night_number);
  if (!input.ok) throw validationError(input.errors);
  const values = input.value;

  const lateRecall = !captureWindowOpen(night.night_key, night.settings, ctx.now);
  const inserted = await oneRow<{ id: string }>(
    `insert into entries
       (id, enrollment_id, night_key, title, text, dreams_recalled, lucid, wbtb, technique,
        technique_minutes, late_recall, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (id) do nothing
     returning id`,
    [
      entryId,
      dreamer.id,
      night.night_key,
      values.title,
      values.text,
      values.dreamsRecalled,
      values.lucid,
      values.wbtb,
      values.technique,
      values.techniqueMinutes,
      lateRecall,
      ctx.now,
    ],
  );
  const saved = await findEntry(entryId);
  if (saved === null) throw notFound();
  if (inserted === null) {
    if (saved.enrollment_id !== dreamer.id) throw notFound();
    if (!sameEntryBody(saved, fields)) throw apiError(409, 'entry_id_conflict');
    return { status: 200, json: { entry: await viewOfEntry(saved, dreamer.first_night) } };
  }
  return { status: 201, json: { entry: await viewOfEntry(saved, dreamer.first_night) } };
}

export async function shareEntry(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const entry = await findEntry(ctx.params['entryId'] ?? '');
  if (entry === null || entry.enrollment_id !== dreamer.id) throw notFound();
  const shared = readBoolean(ctx.body, 'shared');
  if (shared === undefined) throw validationError({ shared: MESSAGES.boolean });
  await pool.query('update entries set shared = $2 where id = $1', [entry.id, shared]);
  const updated = await findEntry(entry.id);
  if (updated === null) throw notFound();
  return { status: 200, json: { entry: await viewOfEntry(updated, dreamer.first_night) } };
}

export async function tagSign(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const entry = await findEntry(ctx.params['entryId'] ?? '');
  if (entry === null || entry.enrollment_id !== dreamer.id) throw notFound();
  const start = readInteger(ctx.body, 'start');
  const end = readInteger(ctx.body, 'end');
  const category = readString(ctx.body, 'category');

  return withTransaction(async (client) => {
    await client.query('select id from entries where id = $1 for update', [entry.id]);
    const signs = await listSignsOfEntry(entry.id, client);
    if (start !== undefined && end !== undefined) {
      const identical = signs.find(
        (sign) => sign.start_offset === start && sign.end_offset === end,
      );
      if (identical !== undefined) {
        if (identical.category !== category) throw apiError(409, 'sign_conflict');
        const { tallies } = await tallyRowsOf(dreamer.id, client);
        return {
          status: 200,
          json: {
            sign: {
              id: identical.id,
              entry_id: identical.entry_id,
              start: identical.start_offset,
              end: identical.end_offset,
              phrase: identical.phrase,
              category: identical.category,
              night_key: identical.night_key,
            },
            tallies,
          },
        };
      }
      const overlapping = signs.find((sign) =>
        rangesOverlap({ start, end }, { start: sign.start_offset, end: sign.end_offset }),
      );
      if (overlapping !== undefined) {
        throw apiError(409, 'sign_overlap', { sign_id: overlapping.id });
      }
    }

    const errors: Record<string, string> = {};
    const phrase = start !== undefined && end !== undefined ? entry.text.slice(start, end) : '';
    const rangeValid =
      start !== undefined &&
      end !== undefined &&
      start >= 0 &&
      end - start >= 1 &&
      end - start <= 200 &&
      end <= entry.text.length &&
      hasNonSpace(phrase);
    if (!rangeValid) errors['range'] = MESSAGES.signRange;
    const chosen = SIGN_CATEGORIES.find((candidate) => candidate === category);
    if (chosen === undefined) errors['category'] = MESSAGES.signCategory;
    if (start === undefined || end === undefined || chosen === undefined || !rangeValid) {
      throw validationError(errors);
    }

    const id = randomUUID();
    await client.query(
      `insert into signs (id, entry_id, enrollment_id, start_offset, end_offset, phrase, category, night_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, entry.id, dreamer.id, start, end, phrase, chosen, entry.night_key],
    );
    const { tallies } = await tallyRowsOf(dreamer.id, client);
    return {
      status: 201,
      json: {
        sign: {
          id,
          entry_id: entry.id,
          start,
          end,
          phrase,
          category: chosen,
          night_key: entry.night_key,
        },
        tallies,
      },
    };
  });
}

export async function readDreamscape(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const { constellations, target } = await constellationsOf(dreamer.id);
  return {
    status: 200,
    json: {
      constellations: SIGN_CATEGORIES.map((category) => {
        const found = constellations.find((item) => item.category === category);
        return {
          category,
          stars: found?.stars ?? 0,
          tagged_nights: found?.taggedNights ?? 0,
          halo_px: found?.halo_px ?? 12,
        };
      }),
      target_category: target,
    },
  };
}

interface RealityCheckRow {
  readonly id: string;
  readonly enrollment_id: string;
  readonly category: string;
  readonly night_key: DateKey;
}

async function nightCheckCount(enrollmentId: string, nightKey: DateKey): Promise<number> {
  const found = await oneRow<{ total: number }>(
    'select count(*)::int as total from reality_checks where enrollment_id = $1 and night_key = $2',
    [enrollmentId, nightKey],
  );
  return found?.total ?? 0;
}

export async function logRealityCheck(ctx: RequestContext): Promise<ApiResponse> {
  const dreamer = await dreamerOf(ctx);
  const id = readString(ctx.body, 'id');
  const category = readString(ctx.body, 'category');

  if (id !== undefined && isUuid(id)) {
    const existing = await oneRow<RealityCheckRow>(
      'select id, enrollment_id, category, night_key::text as night_key from reality_checks where id = $1',
      [id],
    );
    if (existing !== null) {
      if (existing.enrollment_id !== dreamer.id) throw notFound();
      if (existing.category !== category) throw apiError(409, 'reality_check_id_conflict');
      return {
        status: 200,
        json: {
          reality_check: {
            id: existing.id,
            category: existing.category,
            night_key: existing.night_key,
          },
          night_count: await nightCheckCount(dreamer.id, existing.night_key),
        },
      };
    }
  }

  const errors: Record<string, string> = {};
  if (id === undefined || !isUuid(id)) errors['id'] = MESSAGES.checkId;
  const chosen = SIGN_CATEGORIES.find((candidate) => candidate === category);
  if (chosen === undefined) errors['category'] = MESSAGES.signCategory;
  if (id === undefined || !isUuid(id) || chosen === undefined) throw validationError(errors);

  const night = await nightStatusOf(dreamer, ctx.now);
  await pool.query(
    `insert into reality_checks (id, enrollment_id, category, night_key)
     values ($1, $2, $3, $4) on conflict (id) do nothing`,
    [id, dreamer.id, chosen, night.night_key],
  );
  const stored = await oneRow<RealityCheckRow>(
    'select id, enrollment_id, category, night_key::text as night_key from reality_checks where id = $1',
    [id],
  );
  if (stored === null) throw notFound();
  if (stored.enrollment_id !== dreamer.id) throw notFound();
  if (stored.category !== chosen) throw apiError(409, 'reality_check_id_conflict');
  return {
    status: 201,
    json: {
      reality_check: { id: stored.id, category: stored.category, night_key: stored.night_key },
      night_count: await nightCheckCount(dreamer.id, stored.night_key),
    },
  };
}
