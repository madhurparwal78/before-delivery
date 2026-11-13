import { exactRate } from '../../domain/rate.js';
import { parseSrt, writeSrt, type SrtFormat } from '../../domain/srt.js';
import { pool, query } from '../db.js';
import { notFound, sendJson, type Route } from '../http.js';
import { broadcastOp } from '../live.js';
import { performOp } from '../repo/ops.js';
import { loadProject } from '../repo/projects.js';
import { loadMediaInfo } from '../repo/media.js';
import { randomId } from '../ids.js';
import { EDITORS, loadedProjectAccess, projectAccess, ANY_ROLE } from './guards.js';

async function formatOf(rowId: string): Promise<SrtFormat> {
  const rows = await query<{ line_ending: 'LF' | 'CRLF'; byte_order_mark: boolean }>(
    `select line_ending, byte_order_mark from caption_formats where row_id = $1`,
    [rowId],
  );
  return rows.length > 0
    ? { line_ending: rows[0].line_ending, byte_order_mark: rows[0].byte_order_mark }
    : { line_ending: 'LF', byte_order_mark: false };
}

export const captionRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/projects/{id}/rows/{row_id}/captions/import',
    auth: 'session',
    body: 'srt',
    handle: async (context) => {
      const access = await loadedProjectAccess(context, EDITORS);
      const rowId = context.params.row_id;
      const row = access.loaded.state.rows.find((candidate) => candidate.id === rowId);
      if (!row) throw notFound();
      const rate = exactRate(access.loaded.row.frame_rate);
      const parsed = parseSrt(context.body, rate);
      const outcome = await performOp({
        projectId: access.projectId,
        author: { id: access.signed.person.id, name: access.signed.person.name },
        role: access.role,
        opId: randomId('import'),
        baseVersion: access.loaded.row.version,
        type: 'caption_import',
        body: { row_id: rowId, cues: parsed.cues, format: parsed.format },
      });
      await query(
        `insert into caption_formats (row_id, line_ending, byte_order_mark) values ($1,$2,$3)
         on conflict (row_id) do update set line_ending = excluded.line_ending, byte_order_mark = excluded.byte_order_mark`,
        [rowId, parsed.format.line_ending, parsed.format.byte_order_mark],
      );
      broadcastOp(access.projectId, {
        version: outcome.result.version,
        author: outcome.author,
        op: { type: 'caption_import', row_id: rowId },
        changes: outcome.result.changes,
        removed: outcome.result.removed,
      });
      sendJson(context.response, 200, { cues: parsed.cues.length, version: outcome.result.version });
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/rows/{row_id}/captions/export',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      const media = await loadMediaInfo();
      const loaded = await loadProject(pool, access.projectId, media);
      if (loaded === null) throw notFound();
      const rowId = context.params.row_id;
      const row = loaded.state.rows.find((candidate) => candidate.id === rowId);
      if (!row || row.kind !== 'caption') throw notFound();
      const rate = exactRate(loaded.row.frame_rate);
      const body = writeSrt(
        loaded.state.captions.filter((caption) => caption.row_id === rowId),
        await formatOf(rowId),
        rate,
      );
      context.response.writeHead(200, {
        'content-type': 'application/x-subrip',
        'content-length': body.length,
        'content-disposition': `attachment; filename="${access.projectId}-${rowId}.srt"`,
        'cache-control': 'no-store',
      });
      context.response.end(body);
    },
  },
];

