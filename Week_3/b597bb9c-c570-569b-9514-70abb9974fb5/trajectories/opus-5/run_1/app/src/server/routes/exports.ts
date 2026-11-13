import { ApiError } from '../../domain/api-error.js';
import { invalid } from '../../domain/validate.js';
import { allowance, giveBackMinutes, takeMinutes } from '../allowance.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { cancelExport, exportById, exportRecord, exportsOfProject, minutesFor, openExportFor } from '../exports.js';
import { jsonBody, notFound, sendJson, type Route } from '../http.js';
import { broadcastAllowance, broadcastExport } from '../live.js';
import { randomId } from '../ids.js';
import { loadRole } from '../repo/projects.js';
import { pool } from '../db.js';
import { publishExport, QueueDown } from '../services/queue.js';
import { presignGet, probeStorage, StorageKeys } from '../services/storage.js';
import { ANY_ROLE, OWNER_ONLY, projectAccess } from './guards.js';
import { requireSigned } from '../http.js';
import type { ExportSize } from '../../shared/types.js';

const SIZES: readonly number[] = [2160, 1080, 720];

export const exportRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/projects/{id}/exports',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, OWNER_ONLY);
      const body = jsonBody(context);
      const cutId = typeof body.cut_id === 'string' ? body.cut_id : '';
      const size = body.size;
      if (typeof size !== 'number' || !SIZES.includes(size)) throw invalid('size');
      const cut = await query<{ id: string; name: string; total_frames: number }>(
        `select id, name, total_frames from cuts where project_id = $1 and id = $2`,
        [access.projectId, cutId],
      );
      if (cut.length === 0) throw invalid('cut_id');

      const existing = await openExportFor(access.projectId, cutId, size as ExportSize);
      if (existing !== null) {
        sendJson(context.response, 200, exportRecord(existing));
        return;
      }
      if (!(await probeStorage())) throw ApiError.of('storage_unavailable', undefined);

      const project = await query<{ frame_rate: string }>(`select frame_rate from projects where id = $1`, [
        access.projectId,
      ]);
      const minutes = minutesFor(cut[0].total_frames, project[0].frame_rate as never);
      await takeMinutes(minutes);
      const id = randomId('exp');
      try {
        await query(
          `insert into exports (id, project_id, cut_id, size, state, progress, minutes, requested_by, requested_by_id)
           values ($1,$2,$3,$4,'queued',0,$5,$6,$7)`,
          [id, access.projectId, cutId, size, minutes, access.signed.person.name, access.signed.person.id],
        );
        await publishExport({
          export_id: id,
          project_id: access.projectId,
          cut_id: cutId,
          size,
          requested_by: access.signed.person.name,
        });
      } catch (error) {
        await query(`delete from exports where id = $1`, [id]);
        await giveBackMinutes(minutes, new Date().toISOString().slice(0, 7));
        if (error instanceof QueueDown) throw ApiError.of('queue_unavailable', undefined);
        throw error;
      }
      const row = await exportById(id);
      if (row === null) throw notFound();
      const record = exportRecord(row);
      broadcastExport(access.projectId, record);
      broadcastAllowance(await allowance());
      sendJson(context.response, 202, record);
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/exports',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      const rows = await exportsOfProject(access.projectId);
      sendJson(context.response, 200, { items: rows.map(exportRecord) });
    },
  },
  {
    method: 'GET',
    path: '/api/exports/{id}',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      const row = await exportById(context.params.id);
      if (row === null) throw notFound();
      if ((await loadRole(pool, row.project_id, signed.person.id)) === null) throw notFound();
      sendJson(context.response, 200, exportRecord(row));
    },
  },
  {
    method: 'POST',
    path: '/api/exports/{id}/cancel',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      const row = await exportById(context.params.id);
      if (row === null) throw notFound();
      const role = await loadRole(pool, row.project_id, signed.person.id);
      if (role === null) throw notFound();
      if (role !== 'owner') throw ApiError.of('forbidden', undefined);
      sendJson(context.response, 200, exportRecord(await cancelExport(row.id)));
    },
  },
  {
    method: 'GET',
    path: '/api/exports/{id}/manifest',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      const row = await exportById(context.params.id);
      if (row === null) throw notFound();
      if ((await loadRole(pool, row.project_id, signed.person.id)) === null) throw notFound();
      if (row.state !== 'done') throw ApiError.of('export_not_ready', undefined);
      const link = presignGet(StorageKeys.manifest(row.id), config.manifestLinkSeconds);
      context.response.writeHead(302, { location: link, 'cache-control': 'no-store' });
      context.response.end();
    },
  },
];
