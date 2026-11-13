import { createHash } from 'node:crypto';
import { FIELD_COPY } from '../../shared/copy.js';
import type { LibraryJson, ReferenceJson, TrashJson } from '../../shared/types.js';
import { nowIso, nowMs, toIso } from '../domain/clock.js';
import { ApiError, firstByPrecedence, validationError } from '../domain/errors.js';
import { effectiveZoneAt } from '../domain/homeZone.js';
import {
  MAX_PHOTO_BYTES,
  MAX_UPRIGHT_PIXELS,
  MAX_UPRIGHT_SIDE,
  extensionFor,
  readPhotoHeader,
  sniffPhotoType,
  type PhotoHeader,
  type PhotoType,
} from '../domain/photo.js';
import {
  assertRestorable,
  assertStored,
  assertTrashable,
  isWithinRestoreWindow,
  purgeInstant,
  secondsLeft,
} from '../domain/states.js';
import { currentYearIn, startOfLocalDay } from '../domain/zones.js';
import {
  FieldCollector,
  validateCapture,
  validateFactsPatch,
  validateSwatchPoint,
  validateVersion,
  type RawFields,
  type SwatchPoint,
} from '../domain/validation.js';
import { newId, pool, withTransaction } from '../db/pool.js';
import {
  REFERENCE_COLUMNS,
  listStored,
  loadReference,
  toReferenceJson,
  type ReferenceRow,
} from '../db/references.js';
import { recordSearchUpdate } from '../db/searchQueue.js';
import { loadSettings } from '../db/settings.js';
import { UndecodablePhoto, analysePhoto } from '../services/imageWork.js';
import { searchUsable, storageUsable } from '../services/status.js';
import {
  StorageUnreachable,
  deleteObject,
  displayKey,
  getObject,
  originalKey,
  putObject,
} from '../services/storage.js';
import { confirmSearchUpdate } from '../workers/searchCatchUp.js';
import { purgeReference } from '../workers/purge.js';

/** Everything the API does with one reference. */

export async function currentYear(): Promise<number> {
  const settings = await loadSettings();
  const instant = nowMs();
  return currentYearIn(effectiveZoneAt(settings.history, instant), instant);
}

interface CheckedPhoto {
  bytes: Buffer;
  type: PhotoType;
  header: PhotoHeader;
}

/** The photo's own bytes and header decide its type and size, before anything is decoded. */
function checkPhoto(
  file: { bytes: Buffer } | null,
): { photo: CheckedPhoto } | { error: string } {
  if (!file || file.bytes.length === 0) return { error: FIELD_COPY.photoType };
  const type = sniffPhotoType(file.bytes);
  if (!type) return { error: FIELD_COPY.photoType };
  if (file.bytes.length > MAX_PHOTO_BYTES) return { error: FIELD_COPY.photoBytes };
  const header = readPhotoHeader(file.bytes, type);
  if (!header) return { error: FIELD_COPY.photoType };
  // The pixel limit is decided from the header's own dimensions, before anything else.
  if (
    header.width * header.height > MAX_UPRIGHT_PIXELS ||
    header.width > MAX_UPRIGHT_SIDE ||
    header.height > MAX_UPRIGHT_SIDE
  ) {
    return { error: FIELD_COPY.photoPixels };
  }
  if (!header.complete) return { error: FIELD_COPY.photoType };
  return { photo: { bytes: file.bytes, type, header } };
}

function mergeFieldErrors(photoError: string | null, run: () => void): void {
  let fields: Record<string, string> = {};
  try {
    run();
  } catch (error) {
    if (!(error instanceof ApiError) || !error.fields) throw error;
    fields = error.fields;
  }
  if (photoError) fields = { photo: photoError, ...fields };
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

/** Capture: checks first, then storage, then the row and its search document. */
export async function captureReference(
  fields: Record<string, string>,
  file: { bytes: Buffer } | null,
): Promise<ReferenceJson> {
  const checked = checkPhoto(file);
  const photoError = 'error' in checked ? checked.error : null;
  const year = await currentYear();
  let validated!: ReturnType<typeof validateCapture>;
  mergeFieldErrors(photoError, () => {
    validated = validateCapture(fields as RawFields, year);
  });
  const photo = (checked as { photo: CheckedPhoto }).photo;

  if (!storageUsable()) throw new ApiError('storage_unavailable');

  let analysis;
  try {
    analysis = await analysePhoto(photo.bytes, {
      point: validated.swatchPoint,
      wantDisplayCrop: true,
    });
  } catch (error) {
    if (error instanceof UndecodablePhoto) {
      throw validationError({ photo: FIELD_COPY.photoType });
    }
    throw error;
  }

  const id = newId('ref');
  const original = originalKey(id, extensionFor(photo.type));
  const display = displayKey(id);
  const sha256 = createHash('sha256').update(photo.bytes).digest('hex');

  try {
    await putObject(original, photo.bytes, photo.type);
    await putObject(display, analysis.display!, 'image/jpeg');
    const readBack = await getObject(original);
    if (
      !readBack ||
      readBack.length !== photo.bytes.length ||
      createHash('sha256').update(readBack).digest('hex') !== sha256
    ) {
      throw new StorageUnreachable('the stored original did not read back byte for byte');
    }

    const { row, seq } = await withTransaction(async (client) => {
      const inserted = await client.query<ReferenceRow>(
        `insert into reference (
           id, state, version, title, maker, year, materials, finish, colour_family,
           source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
           swatch, swatch_source, captured_at, photo_content_type, photo_bytes,
           photo_sha256, photo_width, photo_height, original_key, display_key)
         values ($1, 'stored', 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16::timestamptz, $17, $18, $19, $20, $21, $22, $23)
         returning ${REFERENCE_COLUMNS}`,
        [
          id,
          validated.facts.title,
          validated.facts.maker,
          validated.facts.year,
          validated.facts.materials,
          validated.facts.finish,
          validated.facts.colour_family,
          validated.facts.source_url,
          validated.facts.source_note,
          validated.facts.notes,
          validated.facts.size.width,
          validated.facts.size.height,
          validated.facts.size.depth,
          analysis.swatch,
          validated.swatchPoint ? 'eyedropper' : 'computed',
          nowIso(),
          photo.type,
          photo.bytes.length,
          sha256,
          analysis.width,
          analysis.height,
          original,
          display,
        ],
      );
      const seqValue = await recordSearchUpdate(client, id, 'upsert', nowIso());
      return { row: inserted.rows[0]!, seq: seqValue };
    });

    if (searchUsable()) await confirmSearchUpdate(seq).catch(() => undefined);
    return toReferenceJson(row);
  } catch (error) {
    await Promise.all([
      deleteObject(original).catch(() => undefined),
      deleteObject(display).catch(() => undefined),
    ]);
    await pool.query('delete from reference where id = $1', [id]).catch(() => undefined);
    if (error instanceof StorageUnreachable) throw new ApiError('storage_unavailable');
    throw error;
  }
}

export async function library(filters: {
  colour_family?: string;
  material?: string;
  finish?: string;
}): Promise<LibraryJson> {
  const settings = await loadSettings();
  const instant = nowMs();
  const zone = effectiveZoneAt(settings.history, instant);
  const todayStartsAt = startOfLocalDay(zone, instant);
  const rows = await listStored(filters);
  const savedToday: ReferenceJson[] = [];
  const earlier: ReferenceJson[] = [];
  for (const row of rows) {
    const captured = Date.parse(row.captured_at);
    (captured >= todayStartsAt ? savedToday : earlier).push(toReferenceJson(row));
  }
  return {
    zone,
    today_starts_at: toIso(todayStartsAt),
    saved_today: savedToday,
    earlier,
  };
}

async function requireReference(id: string): Promise<ReferenceRow> {
  const row = await loadReference(pool, id);
  if (!row || row.state === 'purged') throw new ApiError('not_found');
  return row;
}

export async function readReference(id: string): Promise<ReferenceJson> {
  return toReferenceJson(await requireReference(id));
}

export async function readOriginal(
  id: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const row = await requireReference(id);
  if (!storageUsable()) throw new ApiError('storage_unavailable');
  const bytes = await getObject(row.original_key).catch(() => {
    throw new ApiError('storage_unavailable');
  });
  if (!bytes) throw new ApiError('storage_unavailable');
  return { bytes, contentType: row.photo_content_type };
}

export async function readDisplay(id: string): Promise<Buffer> {
  const row = await requireReference(id);
  if (!storageUsable()) throw new ApiError('storage_unavailable');
  const bytes = await getObject(row.display_key).catch(() => {
    throw new ApiError('storage_unavailable');
  });
  if (!bytes) throw new ApiError('storage_unavailable');
  return bytes;
}

/** Collects everything wrong with a request and answers with the first by precedence. */
function refuseBy(candidates: Array<ApiError | null>): void {
  const refusal = firstByPrecedence(candidates.filter((error) => error !== null));
  if (refusal) throw refusal;
}

function caught(run: () => void): ApiError | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
}

export async function patchFacts(
  id: string,
  body: Record<string, unknown>,
): Promise<ReferenceJson> {
  const row = await requireReference(id);
  const size = {
    width: row.width_tenths,
    height: row.height_tenths,
    depth: row.depth_tenths,
  };
  const year = await currentYear();
  let version = row.version;
  let patch: ReturnType<typeof validateFactsPatch> = {};
  refuseBy([
    caught(() => assertStored(row.state)),
    caught(() => {
      version = validateVersion(body.version as never, 'reference');
      if (version !== row.version) throw new ApiError('reference_version_conflict');
    }),
    caught(() => {
      patch = validateFactsPatch(body as RawFields, year, size);
    }),
  ]);

  const assignments: string[] = [];
  const parameters: unknown[] = [id, version];
  const set = (column: string, value: unknown, cast = ''): void => {
    parameters.push(value);
    assignments.push(`${column} = $${parameters.length}${cast}`);
  };
  if ('title' in patch) set('title', patch.title);
  if ('maker' in patch) set('maker', patch.maker);
  if ('year' in patch) set('year', patch.year, '::integer');
  if ('materials' in patch) set('materials', patch.materials, '::text[]');
  if ('finish' in patch) set('finish', patch.finish);
  if ('colour_family' in patch) set('colour_family', patch.colour_family);
  if ('source_url' in patch) set('source_url', patch.source_url);
  if ('source_note' in patch) set('source_note', patch.source_note);
  if ('notes' in patch) set('notes', patch.notes);
  if (patch.size) {
    set('width_tenths', patch.size.width, '::integer');
    set('height_tenths', patch.size.height, '::integer');
    set('depth_tenths', patch.size.depth, '::integer');
  }
  assignments.push('version = version + 1');

  const { updated, seq } = await withTransaction(async (client) => {
    const result = await client.query<ReferenceRow>(
      `update reference set ${assignments.join(', ')}
       where id = $1 and version = $2 and state = 'stored'
       returning ${REFERENCE_COLUMNS}`,
      parameters,
    );
    const changed = result.rows[0];
    if (!changed) throw new ApiError('reference_version_conflict');
    const seqValue = await recordSearchUpdate(client, id, 'upsert', nowIso());
    return { updated: changed, seq: seqValue };
  });

  if (searchUsable()) await confirmSearchUpdate(seq).catch(() => undefined);
  return toReferenceJson(updated);
}

async function changeSwatch(
  id: string,
  point: { x: number; y: number } | null,
): Promise<ReferenceJson> {
  const row = await requireReference(id);
  assertStored(row.state);
  if (!storageUsable()) throw new ApiError('storage_unavailable');
  const original = await getObject(row.original_key).catch(() => {
    throw new ApiError('storage_unavailable');
  });
  if (!original) throw new ApiError('storage_unavailable');
  const analysis = await analysePhoto(original, { point, wantDisplayCrop: false });

  const { updated, seq } = await withTransaction(async (client) => {
    const result = await client.query<ReferenceRow>(
      `update reference set swatch = $2, swatch_source = $3, version = version + 1
       where id = $1 and state = 'stored'
       returning ${REFERENCE_COLUMNS}`,
      [id, analysis.swatch, point ? 'eyedropper' : 'computed'],
    );
    const seqValue = await recordSearchUpdate(client, id, 'upsert', nowIso());
    return { updated: result.rows[0]!, seq: seqValue };
  });

  if (searchUsable()) await confirmSearchUpdate(seq).catch(() => undefined);
  return toReferenceJson(updated);
}

export async function setSwatchFromPoint(
  id: string,
  body: Record<string, unknown>,
): Promise<ReferenceJson> {
  const row = await requireReference(id);
  let point: SwatchPoint | null = null;
  refuseBy([
    caught(() => assertStored(row.state)),
    caught(() => {
      const errors = new FieldCollector();
      point = validateSwatchPoint(errors, body.x as never, body.y as never, 'x', 'y', true);
      errors.throwIfAny();
    }),
  ]);
  return changeSwatch(id, point);
}

export async function resetSwatch(id: string): Promise<ReferenceJson> {
  return changeSwatch(id, null);
}

export async function trashReference(id: string): Promise<ReferenceJson> {
  const row = await requireReference(id);
  assertTrashable(row.state);
  const trashedAt = nowMs();
  const { updated, seq } = await withTransaction(async (client) => {
    const result = await client.query<ReferenceRow>(
      `update reference set state = 'trashed', trashed_at = $2::timestamptz,
              purge_at = $3::timestamptz, version = version + 1
       where id = $1 and state = 'stored'
       returning ${REFERENCE_COLUMNS}`,
      [id, toIso(trashedAt), toIso(purgeInstant(trashedAt))],
    );
    const changed = result.rows[0];
    if (!changed) throw new ApiError('already_trashed');
    const seqValue = await recordSearchUpdate(client, id, 'delete', nowIso());
    return { updated: changed, seq: seqValue };
  });
  if (searchUsable()) await confirmSearchUpdate(seq).catch(() => undefined);
  return toReferenceJson(updated);
}

export async function restoreReference(id: string): Promise<ReferenceJson> {
  const row = await loadReference(pool, id);
  if (!row) throw new ApiError('not_found');
  if (row.state === 'purged') throw new ApiError('restore_window_closed');
  assertRestorable(row.state);
  const purgeAt = Number(row.purge_at_epoch) * 1000;
  if (!isWithinRestoreWindow(purgeAt, nowMs())) {
    await purgeReference(id);
    throw new ApiError('restore_window_closed');
  }

  const { updated, seq } = await withTransaction(async (client) => {
    const result = await client.query<ReferenceRow>(
      `update reference set state = 'stored', trashed_at = null, purge_at = null,
              version = version + 1
       where id = $1 and state = 'trashed'
       returning ${REFERENCE_COLUMNS}`,
      [id],
    );
    const changed = result.rows[0];
    if (!changed) throw new ApiError('not_trashed');
    const seqValue = await recordSearchUpdate(client, id, 'upsert', nowIso());
    return { updated: changed, seq: seqValue };
  });
  if (searchUsable()) await confirmSearchUpdate(seq).catch(() => undefined);
  return toReferenceJson(updated);
}

export async function trashList(): Promise<TrashJson> {
  const instant = nowMs();
  const result = await pool.query<{
    id: string;
    title: string;
    maker: string | null;
    trashed_at: string;
    purge_at: string;
    purge_at_epoch: string;
  }>(
    `select id, title, maker,
            to_char(trashed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as trashed_at,
            to_char(purge_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as purge_at,
            extract(epoch from purge_at)::text as purge_at_epoch
     from reference where state = 'trashed' order by trashed_at desc, id desc`,
  );
  return {
    server_now: toIso(instant),
    items: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      maker: row.maker,
      trashed_at: row.trashed_at,
      purge_at: row.purge_at,
      seconds_left: secondsLeft(Number(row.purge_at_epoch) * 1000, instant),
    })),
  };
}
