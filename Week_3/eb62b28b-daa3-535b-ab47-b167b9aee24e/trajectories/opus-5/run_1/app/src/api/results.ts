import { createHash } from 'node:crypto';
import {
  DrawRow,
  MemberRow,
  ResultRow,
  findDraw,
  findMember,
  findReport,
  findResult,
  listResults,
} from '../data';
import { newId, query, queryOne } from '../db';
import { conflict, invalid, notFound, reportStoreUnavailable } from '../http/errors';
import { Route, defineRoute, jsonBody, multipartParts, person } from '../http/kernel';
import { MARKERS, markerById } from '../shared/catalog';
import { copy } from '../shared/copy';
import { PRACTICE_ZONE, displayDate, instantToIso, localDate, parseDateOnly } from '../shared/time';
import { AGE_BANDS, SEXES, RangeRow, ageBandOn, flagFor } from '../domain/flags';
import { bandScale, rangeFor, rangesInForce } from '../domain/ranges';
import { ResultsFileError, readResultsFile } from '../domain/resultsFile';
import { atMarkerDecimals, parseDecimal } from '../domain/values';
import { Decimal } from '../shared/money';
import { objectExists, getObject, putObject, reportKey } from '../services/s3';
import { queueMail } from '../services/mailer';
import { config } from '../config';
import { FieldErrors, readString } from './validate';
import { requireMember } from './members';
import { requireDraw, drawViewOf } from './draws';

const PDF_MAGIC = Buffer.from('%PDF-');

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

async function savedValues(drawId: string): Promise<Map<string, string>> {
  const rows = await listResults(drawId);
  return new Map(rows.map((row) => [row.marker, row.value]));
}

function refuseUnlessCollected(draw: DrawRow): void {
  if (draw.state !== 'collected' && draw.state !== 'ready') {
    throw conflict('not_collected', copy.notCollected);
  }
}

async function markReadyWhenStored(draw: DrawRow): Promise<void> {
  const report = await findReport(draw.id);
  const results = await listResults(draw.id);
  if (!report || results.length === 0) return;
  if (!(await objectExists(report.object_key))) return;
  if (draw.state === 'collected') {
    await query("update draws set state = 'ready' where id = $1", [draw.id]);
  }
}

async function storeReport(draw: DrawRow, bytes: Buffer): Promise<void> {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const existing = await findReport(draw.id);
  if (existing) {
    if (existing.digest !== digest) throw conflict('report_exists', copy.reportExists);
    return;
  }
  const key = reportKey(draw.member_id, draw.id);
  await putObject(key, bytes, 'application/pdf');
  if (!(await objectExists(key))) throw reportStoreUnavailable();
  await query(
    `insert into reports (draw_id, object_key, byte_size, digest) values ($1, $2, $3, $4)
     on conflict (draw_id) do nothing`,
    [draw.id, key, bytes.length, digest],
  );
}

async function saveMatchedRows(
  draw: DrawRow,
  rows: { marker?: string; value?: string; status: string }[],
  byName: string,
): Promise<{ saved: number; unchanged: number }> {
  let saved = 0;
  let unchanged = 0;
  for (const row of rows) {
    if (row.status !== 'matched' || !row.marker || !row.value) continue;
    const existing = await queryOne<ResultRow>(
      'select * from results where draw_id = $1 and marker = $2',
      [draw.id, row.marker],
    );
    if (existing) {
      unchanged += 1;
      continue;
    }
    const id = newId();
    await query('insert into results (id, draw_id, marker, value) values ($1, $2, $3, $4)', [
      id,
      draw.id,
      row.marker,
      row.value,
    ]);
    await query(
      'insert into result_history (id, result_id, value, note, by_name) values ($1, $2, $3, null, $4)',
      [newId(), id, row.value, byName],
    );
    saved += 1;
  }
  return { saved, unchanged };
}

interface MarkerResultsView {
  marker: string;
  name: string;
  category: string;
  unit: string;
  decimals: number;
  scale: { min: string; max: string };
  draws: {
    drawId: string;
    collectedAt: string;
    resultId: string;
    value: string;
    flag: string;
    ageBand: string;
    range: {
      low: string;
      high: string;
      optimalLow: string;
      optimalHigh: string;
      effectiveFrom: string;
    };
    note: string | null;
    correctedBy: string | null;
    correctedAt: string | null;
  }[];
}

async function resultsForMember(
  member: MemberRow,
  releasedOnly: boolean,
): Promise<MarkerResultsView[]> {
  const draws = await query<DrawRow>(
    `select * from draws where member_id = $1 and collected_at is not null
       and state in ('collected', 'ready', 'released')
       ${releasedOnly ? "and state = 'released'" : ''}
     order by collected_at`,
    [member.id],
  );
  const views: MarkerResultsView[] = [];
  for (const marker of MARKERS) {
    const entries: MarkerResultsView['draws'] = [];
    const values: string[] = [];
    const ranges: RangeRow[] = [];
    for (const draw of draws) {
      const result = await queryOne<ResultRow>(
        'select * from results where draw_id = $1 and marker = $2',
        [draw.id, marker.id],
      );
      if (!result) continue;
      const collectedAt = draw.collected_at as Date;
      const phoenixDate = localDate(collectedAt, PRACTICE_ZONE);
      const memberDate = parseDateOnly(localDate(collectedAt, member.time_zone));
      const birth = parseDateOnly(member.date_of_birth ?? '1900-01-01');
      if (!memberDate || !birth) continue;
      const ageBand = ageBandOn(birth, memberDate);
      const inForce = await rangeFor(
        marker.id,
        phoenixDate,
        member.sex ?? 'female',
        ageBand,
      );
      entries.push({
        drawId: draw.id,
        collectedAt: instantToIso(collectedAt),
        resultId: result.id,
        value: result.value,
        flag: flagFor(result.value, inForce.row),
        ageBand,
        range: {
          low: inForce.row.low,
          high: inForce.row.high,
          optimalLow: inForce.row.optimalLow,
          optimalHigh: inForce.row.optimalHigh,
          effectiveFrom: inForce.effectiveFrom,
        },
        note: result.note,
        correctedBy: result.corrected_by,
        correctedAt: result.corrected_at ? instantToIso(result.corrected_at) : null,
      });
      values.push(result.value);
      ranges.push(inForce.row);
    }
    if (entries.length === 0) continue;
    views.push({
      marker: marker.id,
      name: marker.name,
      category: marker.category,
      unit: marker.unit,
      decimals: marker.decimals,
      scale: bandScale(marker, values, ranges),
      draws: entries,
    });
  }
  return views;
}

export { resultsForMember };

export const resultsRoutes: Route[] = [
  defineRoute({
    method: 'POST',
    path: '/api/draws/:drawId/results-file/preview',
    access: ['owner', 'coordinator', 'specialist'],
    bodyLimit: { limit: 1100000, message: copy.tooLargeRequest },
    partLimits: { file: { limit: 1000000, message: copy.tooLargeResultsFile } },
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (ctx, draw) => {
      const parts = multipartParts(ctx);
      const file = parts.parts.get('file');
      if (!file) throw invalid({ file: copy.resultsHeaderRow });
      refuseUnlessCollected(draw);
      try {
        const rows = readResultsFile(file.bytes, {
          kitCodes: await kitCodesOf(draw.id),
          savedValues: await savedValues(draw.id),
        });
        return { status: 200, json: { rows } };
      } catch (error) {
        if (error instanceof ResultsFileError) {
          throw invalid({
            file: error.reason === 'encoding' ? copy.resultsFileEncoding : copy.resultsHeaderRow,
          });
        }
        throw error;
      }
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/draws/:drawId/results-file',
    access: ['owner', 'coordinator', 'specialist'],
    bodyLimit: { limit: 11100000, message: copy.tooLargeRequest },
    partLimits: {
      file: { limit: 1000000, message: copy.tooLargeResultsFile },
      report: { limit: 10000000, message: copy.tooLargeReport },
    },
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (ctx, draw) => {
      const parts = multipartParts(ctx);
      const file = parts.parts.get('file');
      const report = parts.parts.get('report');
      const errors = new FieldErrors();
      if (!file) errors.add('file', copy.resultsHeaderRow);
      if (!report) errors.add('report', copy.reportRequired);
      else if (!isPdf(report.bytes)) errors.add('report', copy.reportNotPdf);
      errors.throwIfAny();
      refuseUnlessCollected(draw);
      let rows;
      try {
        rows = readResultsFile((file as { bytes: Buffer }).bytes, {
          kitCodes: await kitCodesOf(draw.id),
          savedValues: await savedValues(draw.id),
        });
      } catch (error) {
        if (error instanceof ResultsFileError) {
          throw invalid({
            file: error.reason === 'encoding' ? copy.resultsFileEncoding : copy.resultsHeaderRow,
          });
        }
        throw error;
      }
      await storeReport(draw, (report as { bytes: Buffer }).bytes);
      const counts = await saveMatchedRows(draw, rows, person(ctx).name);
      await markReadyWhenStored(draw);
      const saved = await findDraw(draw.id);
      return {
        status: counts.saved > 0 ? 201 : 200,
        json: {
          draw: await drawViewOf(saved as DrawRow, true),
          saved: counts.saved,
          unchanged: counts.unchanged,
        },
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/draws/:drawId/results',
    access: ['owner', 'coordinator', 'specialist'],
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (ctx, draw) => {
      const body = jsonBody<{ results?: unknown }>(ctx);
      const errors = new FieldErrors();
      const list = Array.isArray(body.results) ? body.results : [];
      const accepted: { marker: string; value: string }[] = [];
      list.forEach((entry, index) => {
        const raw = (entry ?? {}) as Record<string, unknown>;
        const marker = markerById(readString(raw.marker) ?? '');
        if (!marker) {
          errors.add(`results.${index}.marker`, copy.markerChoice);
          return;
        }
        const value = parseDecimal(readString(raw.value) ?? '');
        if (!value) {
          errors.add(`results.${index}.value`, copy.valueNotNumber);
          return;
        }
        accepted.push({ marker: marker.id, value: atMarkerDecimals(value, marker) });
      });
      errors.throwIfAny();
      refuseUnlessCollected(draw);
      await saveMatchedRows(
        draw,
        accepted.map((entry) => ({ ...entry, status: 'matched' })),
        person(ctx).name,
      );
      await markReadyWhenStored(draw);
      const saved = await findDraw(draw.id);
      return { status: 201, json: { draw: await drawViewOf(saved as DrawRow, true) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/draws/:drawId/report',
    access: ['owner', 'coordinator', 'specialist'],
    bodyLimit: { limit: 11100000, message: copy.tooLargeRequest },
    partLimits: { report: { limit: 10000000, message: copy.tooLargeReport } },
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (ctx, draw) => {
      const parts = multipartParts(ctx);
      const report = parts.parts.get('report');
      const errors = new FieldErrors();
      if (!report) errors.add('report', copy.reportRequired);
      else if (!isPdf(report.bytes)) errors.add('report', copy.reportNotPdf);
      errors.throwIfAny();
      refuseUnlessCollected(draw);
      await storeReport(draw, (report as { bytes: Buffer }).bytes);
      await markReadyWhenStored(draw);
      const saved = await findDraw(draw.id);
      return { status: 201, json: { draw: await drawViewOf(saved as DrawRow, true) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/draws/:drawId/report',
    access: 'any',
    resolve: async (ctx) => {
      const draw = await requireDraw(ctx.params.drawId as string);
      const who = ctx.session?.person;
      if (who?.role === 'member') {
        if (draw.member_id !== who.id || draw.state !== 'released') throw notFound();
      }
      const report = await findReport(draw.id);
      if (!report) throw notFound();
      return { draw, report };
    },
    handler: async (_ctx, { report }) => {
      const bytes = await getObject(report.object_key);
      if (!bytes) throw notFound();
      return { status: 200, bytes, contentType: 'application/pdf' };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/draws/:drawId/release',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => requireDraw(ctx.params.drawId as string),
    handler: async (ctx, draw) => {
      jsonBody<Record<string, unknown>>(ctx);
      if (draw.state !== 'ready') throw conflict('not_ready', copy.notReady);
      await query("update draws set state = 'released' where id = $1", [draw.id]);
      const member = await findMember(draw.member_id);
      if (member?.email) {
        await queueMail({
          to: member.email,
          memberId: member.id,
          subject: 'Your new results are ready',
          body: [
            'Your new results are ready.',
            `Read them on the marker band: ${config.publicUrl}/me/results`,
          ].join('\n'),
        });
      }
      const released = await findDraw(draw.id);
      return { status: 200, json: { draw: await drawViewOf(released as DrawRow, true) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me/results',
    access: ['member'],
    handler: async (ctx) => {
      const member = await requireMember(person(ctx).id);
      return { status: 200, json: { markers: await resultsForMember(member, true) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/members/:memberId/results',
    access: ['owner', 'specialist', 'coordinator'],
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      return member;
    },
    handler: async (_ctx, member) => ({
      status: 200,
      json: { markers: await resultsForMember(member, false) },
    }),
  }),
  defineRoute({
    method: 'PATCH',
    path: '/api/results/:resultId',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const result = await findResult(ctx.params.resultId as string);
      if (!result) throw notFound();
      const draw = await findDraw(result.draw_id);
      if (!draw) throw notFound();
      const member = await findMember(draw.member_id);
      if (!member || member.account_state === 'erased') throw notFound();
      return { result, draw };
    },
    handler: async (ctx, { result }) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const marker = markerById(result.marker);
      if (!marker) throw new Error(`Unknown marker ${result.marker}`);
      const value = parseDecimal(readString(body.value) ?? '');
      if (!value) errors.add('value', copy.valueNotNumber);
      errors.throwIfAny();
      const note = readString(body.note);
      const who = person(ctx);
      const nextValue = atMarkerDecimals(value as NonNullable<typeof value>, marker);
      await query(
        `update results set value = $2, note = coalesce($3, note), corrected_by = $4,
           corrected_at = now() where id = $1`,
        [result.id, nextValue, note, who.name],
      );
      await query(
        'insert into result_history (id, result_id, value, note, by_name) values ($1, $2, $3, $4, $5)',
        [newId(), result.id, nextValue, note, who.name],
      );
      const updated = await findResult(result.id);
      if (!updated) throw new Error('Result vanished after the correction');
      return {
        status: 200,
        json: {
          result: {
            id: updated.id,
            drawId: updated.draw_id,
            marker: updated.marker,
            value: updated.value,
            note: updated.note,
            correctedBy: updated.corrected_by,
            correctedAt: updated.corrected_at ? instantToIso(updated.corrected_at) : null,
          },
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/results/:resultId/history',
    access: ['owner', 'specialist', 'coordinator'],
    resolve: async (ctx) => {
      const result = await findResult(ctx.params.resultId as string);
      if (!result) throw notFound();
      return result;
    },
    handler: async (_ctx, result) => {
      const rows = await query<{
        value: string;
        note: string | null;
        by_name: string;
        at: Date;
      }>('select value, note, by_name, at from result_history where result_id = $1 order by at', [
        result.id,
      ]);
      return {
        status: 200,
        json: {
          history: rows.map((row) => ({
            value: row.value,
            note: row.note,
            by: row.by_name,
            at: instantToIso(row.at),
          })),
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/ranges',
    access: 'any',
    handler: async (ctx) => {
      const errors = new FieldErrors();
      const marker = markerById(ctx.query.get('marker') ?? '');
      if (!marker) errors.add('marker', copy.markerChoice);
      const onText = ctx.query.get('on') ?? localDate(new Date(), PRACTICE_ZONE);
      const on = parseDateOnly(onText);
      if (!on) errors.add('on', copy.fieldDateForm);
      errors.throwIfAny();
      const inForce = await rangesInForce((marker as { id: string }).id, onText);
      return {
        status: 200,
        json: {
          marker: (marker as { id: string }).id,
          effectiveFrom: inForce.effectiveFrom,
          ranges: inForce.rows,
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/range-changes',
    access: ['owner'],
    handler: async () => {
      const rows = await query<{
        id: string;
        marker: string;
        effective_from: string;
        created_by: string;
        created_at: Date;
      }>('select * from range_changes order by effective_from desc, marker');
      const changes = rows.map((row) => ({
        id: row.id,
        marker: row.marker,
        effectiveFrom: row.effective_from,
        createdBy: row.created_by,
        createdAt: instantToIso(row.created_at),
      }));
      return { status: 200, json: { changes } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/range-changes',
    access: ['owner'],
    handler: async (ctx) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const marker = markerById(readString(body.marker) ?? '');
      if (!marker) errors.add('marker', copy.markerChoice);
      const rawFrom = readString(body.effectiveFrom);
      const effectiveFrom = rawFrom ? parseDateOnly(rawFrom) : null;
      const today = localDate(new Date(), PRACTICE_ZONE);
      if (!effectiveFrom) errors.add('effectiveFrom', copy.fieldDateForm);
      else if ((rawFrom as string) < today) errors.add('effectiveFrom', copy.rangeEffectiveFrom);
      const rawRanges = Array.isArray(body.ranges) ? body.ranges : [];
      if (rawRanges.length !== 6) errors.add('ranges', copy.rangeAllRows);
      const rows: RangeRow[] = [];
      rawRanges.forEach((entry, index) => {
        const raw = (entry ?? {}) as Record<string, unknown>;
        const sex = readString(raw.sex);
        const ageBand = readString(raw.ageBand);
        if (!sex || !SEXES.includes(sex as 'female' | 'male')) {
          errors.add(`ranges.${index}`, copy.fieldChooseOption);
          return;
        }
        if (!ageBand || !AGE_BANDS.includes(ageBand as RangeRow['ageBand'])) {
          errors.add(`ranges.${index}`, copy.fieldChooseOption);
          return;
        }
        const bounds = ['low', 'high', 'optimalLow', 'optimalHigh'].map((key) =>
          parseDecimal(readString(raw[key]) ?? ''),
        );
        if (bounds.some((bound) => bound === null)) {
          errors.add(`ranges.${index}`, copy.valueNotNumber);
          return;
        }
        const [low, high, optimalLow, optimalHigh] = bounds.map((bound) =>
          bound as NonNullable<typeof bound>,
        ) as [Decimal, Decimal, Decimal, Decimal];
        if (
          !(
            low.lessThanOrEqualTo(optimalLow) &&
            optimalLow.lessThanOrEqualTo(optimalHigh) &&
            optimalHigh.lessThanOrEqualTo(high)
          )
        ) {
          errors.add(`ranges.${index}`, copy.rangeBounds);
          return;
        }
        rows.push({
          sex: sex as 'female' | 'male',
          ageBand: ageBand as RangeRow['ageBand'],
          low: readString(raw.low) as string,
          high: readString(raw.high) as string,
          optimalLow: readString(raw.optimalLow) as string,
          optimalHigh: readString(raw.optimalHigh) as string,
        });
      });
      errors.throwIfAny();
      const markerId = (marker as { id: string; name: string }).id;
      const existing = await queryOne<{ id: string }>(
        'select id from range_changes where marker = $1 and effective_from = $2',
        [markerId, rawFrom],
      );
      if (existing) {
        throw conflict(
          'ranges_already_change',
          copy.rangesAlreadyChange(
            (marker as { name: string }).name,
            displayDate(rawFrom as string),
          ),
        );
      }
      const id = newId();
      const who = person(ctx);
      await query(
        `insert into range_changes (id, marker, effective_from, created_by)
         values ($1, $2, $3, $4)`,
        [id, markerId, rawFrom, who.name],
      );
      for (const row of rows) {
        await query(
          `insert into range_rows (change_id, sex, age_band, low, high, optimal_low, optimal_high)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [id, row.sex, row.ageBand, row.low, row.high, row.optimalLow, row.optimalHigh],
        );
      }
      const created = await queryOne<{
        id: string;
        marker: string;
        effective_from: string;
        created_by: string;
        created_at: Date;
      }>('select * from range_changes where id = $1', [id]);
      if (!created) throw new Error('Range change vanished after create');
      return {
        status: 201,
        json: {
          change: {
            id: created.id,
            marker: created.marker,
            effectiveFrom: created.effective_from,
            createdBy: created.created_by,
            createdAt: instantToIso(created.created_at),
          },
        },
      };
    },
  }),
];

async function kitCodesOf(drawId: string): Promise<string[]> {
  const rows = await query<{ kit_code: string }>(
    'select kit_code from draw_kit_codes where draw_id = $1',
    [drawId],
  );
  return rows.map((row) => row.kit_code);
}
