import { fixed } from '../../shared/numbers.js';
import { newId, pool, withTransaction } from '../db.js';
import { lineCoveragePct } from '../domain/coverage.js';
import { infillGeometry } from '../domain/infill.js';
import { conflict, notFound, validation } from '../errors.js';
import { recordEvent } from '../events.js';
import { requireUser, sendJson, sendRaw, type Router } from '../http.js';
import { storageIsDown, reportStorageDown } from '../probes.js';
import {
  findMission,
  listHolidays,
  listLines,
  toLine,
  type HolidayRow,
  type LineRow,
  type MissionRow,
} from '../repo.js';
import { getObject, reportKey, StorageUnreachable } from '../storage.js';
import { holidayRecords, loadMissionState, missionTracks, nearestForHoliday } from '../state.js';
import { jsonObject } from '../http.js';
import { lockRecord, missionInScope, rolesOnly } from './guards.js';
import { storageUnavailable } from '../errors.js';

/** The mission name as a file-name slug, or the mission id when nothing is left. */
export function missionSlug(mission: MissionRow): string {
  const ascii = mission.name
    .normalize('NFKD')
    .split('')
    .filter((character) => character.codePointAt(0)! < 128)
    .join('');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : mission.id;
}

/** Quoted only when the field holds a comma, a double quote, CR or LF. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function coverageCsv(
  mission: MissionRow,
  lines: LineRow[],
  vesselNames: Map<string, string>,
  coveredByLine: Map<string, number>,
): Buffer {
  const rows = [['mission', 'line', 'kind', 'vessel', 'status', 'length_m', 'covered_m', 'coverage_pct']];
  for (const line of lines) {
    const covered = coveredByLine.get(line.id) ?? 0;
    rows.push([
      mission.name,
      line.label,
      line.kind,
      line.vessel_id ? vesselNames.get(line.vessel_id) ?? '' : '',
      line.status,
      fixed(line.length_m, 1),
      fixed(covered, 1),
      fixed(lineCoveragePct(covered, line.length_m), 1),
    ]);
  }
  return Buffer.from(
    rows.map((row) => `${row.map((field) => csvField(field)).join(',')}\r\n`).join(''),
    'utf8',
  );
}

function holidayOr404(holidays: HolidayRow[], holidayId: string): HolidayRow {
  const holiday = holidays.find((item) => item.id === holidayId);
  if (!holiday) throw notFound();
  return holiday;
}

export function registerCoverageRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId/coverage',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      await missionInScope(pool, user, ctx.params.missionId!);
      const state = await loadMissionState(pool, ctx.params.missionId!, ctx.now);
      if (!state) throw notFound();
      sendJson(ctx.res, 200, {
        cell_size_m: 5,
        origin: state.coverage.grid.origin,
        cols: state.coverage.grid.cols,
        rows: state.coverage.grid.rows,
        overlap: state.coverage.grid.overlap,
        counters: state.counters,
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId/coverage.csv',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const mission = await missionInScope(pool, user, ctx.params.missionId!);
      const state = await loadMissionState(pool, mission.id, ctx.now);
      if (!state) throw notFound();
      const body = coverageCsv(mission, state.lines, state.vesselNames, state.coverage.coveredByLine);
      sendRaw(ctx.res, 200, body, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${missionSlug(mission)}-coverage.csv"`,
        'cache-control': 'no-store',
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId/tracks',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      await missionInScope(pool, user, ctx.params.missionId!);
      const state = await loadMissionState(pool, ctx.params.missionId!, ctx.now);
      if (!state) throw notFound();
      sendJson(ctx.res, 200, { tracks: await missionTracks(pool, state) });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId/holidays',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      await missionInScope(pool, user, ctx.params.missionId!);
      const state = await loadMissionState(pool, ctx.params.missionId!, ctx.now);
      if (!state) throw notFound();
      sendJson(ctx.res, 200, holidayRecords(state, user.role));
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/missions/:missionId/holidays/:holidayId/infill',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      const holidayId = ctx.params.holidayId!;
      await missionInScope(pool, user, missionId);
      const holidays = await listHolidays(pool, missionId);
      holidayOr404(holidays, holidayId);
      rolesOnly(user, ['principal_surveyor']);

      const outcome = await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        await lockRecord(client, 'holiday', holidayId);
        const mission = await findMission(client, missionId);
        if (!mission) throw notFound();
        const stored = await listHolidays(client, missionId);
        const holiday = holidayOr404(stored, holidayId);

        if (holiday.status === 'Closed') {
          throw conflict('holiday_closed', `${holiday.label} has already closed`);
        }
        if (mission.status !== 'Surveying') {
          throw conflict(
            'mission_not_surveying',
            'Infill can be queued only while the mission is surveying',
          );
        }
        if (holiday.status === 'Queued' && holiday.infill_line_id) {
          return { status: 200, lineId: holiday.infill_line_id };
        }

        const state = await loadMissionState(client, missionId, ctx.now);
        if (!state) throw notFound();
        const nearest = nearestForHoliday(state, holiday.cells);
        if (!nearest) {
          throw conflict('no_eligible_vessel', `No eligible vessel for ${holiday.label}`);
        }
        const geometry = infillGeometry(
          mission.survey_area,
          mission.line_azimuth_deg,
          state.coverage.grid,
          holiday.cells,
        );
        if (!geometry) {
          throw conflict('no_eligible_vessel', `No eligible vessel for ${holiday.label}`);
        }

        const labelNum = mission.next_label_num;
        const label = `I${String(labelNum).padStart(2, '0')}`;
        const lineId = newId('l');
        const order = await client.query<{ next: number }>(
          `SELECT COALESCE(max(infill_order), 0) + 1 AS next FROM lines
           WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill' AND status = 'Assigned'`,
          [missionId, nearest.id],
        );
        await client.query(
          `INSERT INTO lines (id, mission_id, label, kind, status, vessel_id, start_e, start_n,
             end_e, end_n, length_m, holiday_id, label_num, infill_order)
           VALUES ($1,$2,$3,'infill','Assigned',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            lineId,
            missionId,
            label,
            nearest.id,
            geometry.start.easting,
            geometry.start.northing,
            geometry.end.easting,
            geometry.end.northing,
            geometry.length_m,
            holidayId,
            labelNum,
            order.rows[0]!.next,
          ],
        );
        await client.query(
          `UPDATE missions SET next_label_num = next_label_num + 1, version = version + 1
           WHERE id = $1`,
          [missionId],
        );
        await client.query(
          `UPDATE holidays SET status = 'Queued', infill_line_id = $2 WHERE id = $1`,
          [holidayId, lineId],
        );
        await recordEvent(
          client,
          missionId,
          'infill',
          user.name,
          `${label} queued to ${nearest.name}`,
          ctx.now,
        );
        return { status: 201, lineId };
      });

      const state = await loadMissionState(pool, missionId, ctx.now);
      if (!state) throw notFound();
      const line = state.lines.find((item) => item.id === outcome.lineId);
      if (!line) throw notFound();
      const holidayRow = (await listHolidays(pool, missionId)).find((item) => item.id === holidayId)!;
      const records = holidayRecords(state, user.role);
      sendJson(ctx.res, outcome.status, {
        line: toLine(
          line,
          line.vessel_id ? state.vesselNames.get(line.vessel_id) ?? null : null,
          state.coverage.coveredByLine.get(line.id) ?? 0,
        ),
        holiday: records.find((item) => item.id === holidayRow.id),
        counters: state.counters,
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId/vessels/:vesselId/infill-order',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      await missionInScope(pool, user, ctx.params.missionId!);
      rolesOnly(user, ['principal_surveyor', 'launch_technician']);
      sendJson(ctx.res, 200, {
        line_ids: await infillQueue(ctx.params.missionId!, ctx.params.vesselId!),
      });
    },
  });

  router.add({
    method: 'PUT',
    pattern: '/api/missions/:missionId/vessels/:vesselId/infill-order',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const missionId = ctx.params.missionId!;
      const vesselId = ctx.params.vesselId!;
      await missionInScope(pool, user, missionId);
      await infillQueue(missionId, vesselId);
      rolesOnly(user, ['principal_surveyor']);

      const raw = jsonObject(ctx).line_ids;
      if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
        throw validation({ line_ids: 'Send each infill line id once' });
      }
      const ids = raw as string[];
      if (new Set(ids).size !== ids.length) {
        throw validation({ line_ids: 'Send each infill line id once' });
      }

      const stored = await withTransaction(async (client) => {
        await lockRecord(client, 'mission', missionId);
        const lines = await listLines(client, missionId);
        for (const id of ids) {
          const line = lines.find((item) => item.id === id);
          if (!line || line.kind !== 'infill') throw notFound();
        }
        const current = lines
          .filter(
            (line) => line.kind === 'infill' && line.status === 'Assigned' && line.vessel_id === vesselId,
          )
          .sort((a, b) => (a.infill_order ?? 0) - (b.infill_order ?? 0))
          .map((line) => line.id);
        if (current.length !== ids.length || !current.every((id) => ids.includes(id))) {
          throw conflict(
            'stale_order',
            `The infill queue for ${await vesselName(vesselId)} has changed — showing the latest order`,
          );
        }
        for (const [index, id] of ids.entries()) {
          await client.query('UPDATE lines SET infill_order = $2 WHERE id = $1', [id, index + 1]);
        }
        return ids;
      });
      sendJson(ctx.res, 200, { line_ids: stored });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/missions/:missionId/report',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const mission = await missionInScope(pool, user, ctx.params.missionId!);
      // The report read checks storage right after the role check.
      if (await storageIsDown(pool)) throw storageUnavailable();
      if (mission.report_state !== 'Ready') {
        throw conflict('report_not_ready', 'That coverage report is not ready yet.');
      }
      let object: Awaited<ReturnType<typeof getObject>>;
      try {
        object = await getObject(reportKey(mission.id));
      } catch (error) {
        if (error instanceof StorageUnreachable) {
          await reportStorageDown();
          throw storageUnavailable();
        }
        throw error;
      }
      if (!object) throw storageUnavailable();
      const chunks: Buffer[] = [];
      const reader = object.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      sendRaw(ctx.res, 200, bytes, {
        'content-type': 'application/json',
        'x-content-sha256': mission.report_sha256 ?? '',
        'cache-control': 'no-store',
      });
    },
  });
}

async function vesselName(vesselId: string): Promise<string> {
  const result = await pool.query<{ name: string }>('SELECT name FROM vessels WHERE id = $1', [
    vesselId,
  ]);
  return result.rows[0]?.name ?? '';
}

/** A vessel's infill queue on a mission, in stored run order. 404 when it has no lines there. */
async function infillQueue(missionId: string, vesselId: string): Promise<string[]> {
  const any = await pool.query<{ one: number }>(
    'SELECT 1 AS one FROM lines WHERE mission_id = $1 AND vessel_id = $2 LIMIT 1',
    [missionId, vesselId],
  );
  if (any.rows.length === 0) throw notFound();
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM lines WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill'
       AND status = 'Assigned' ORDER BY infill_order, label_num`,
    [missionId, vesselId],
  );
  return result.rows.map((row) => row.id);
}
