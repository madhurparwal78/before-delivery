import { Router } from 'express';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth } from './sessions';
import { respond } from './routes-session';
import { memberRole } from './routes-projects';
import { loadTimeline } from './timeline';
import { parseSrt, writeSrt, cueTextProblem, srtProblemText, type ExportCue } from './srt';
import { srtMsToFrames } from '../shared/frames';
import { newHex } from './util';
import { SRT_BYTES } from '../shared/errors';

/** Captions: SRT import as one op, SRT export byte for byte. */
export function captionRoutes(ctx: AppCtx): Router {
  const r = Router();

  r.post('/projects/:id/rows/:rowId/captions/import', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const rowId = req.params.rowId!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role === 'commenter') throw new ApiError('forbidden');
      const timeline = await loadTimeline(ctx.db, projectId);
      if (timeline === null) throw new ApiError('not_found');
      const row = timeline.rows.find((rw) => rw.id === rowId);
      if (row === undefined || row.kind !== 'caption') {
        throw ApiError.validation({ srt: { key: 'other' } });
      }
      if (row.locked) throw new ApiError('row_locked', { row: row.name });
      const bytes = req.body instanceof Buffer ? new Uint8Array(req.body) : new Uint8Array();
      if (bytes.length > SRT_BYTES) {
        throw new ApiError('too_large', { limit: SRT_BYTES });
      }
      const parsed = parseSrt(bytes, timeline.meta.frame_rate);
      if (!parsed.ok) {
        throw ApiError.validation({ srt: { key: 'srt', params: { text: srtProblemText(parsed.problem) } } });
      }
      const cues = parsed.parsed.cues.map((cue) => ({
        index: cue.index,
        startMs: cue.startMs,
        endMs: cue.endMs,
        lines: cue.lines,
        startFrame: srtMsToFrames(cue.startMs, timeline.meta.frame_rate),
        endFrame: srtMsToFrames(cue.endMs, timeline.meta.frame_rate),
      }));
      const result = await importReplace(ctx, projectId, rowId, cues, parsed.parsed.layout, person, timeline.meta.version);
      ctx.live.publishOp(projectId, {
        type: 'op',
        version: result.version,
        author: { id: person.id, name: person.name },
        op: { type: 'caption_import' },
        changes: { clips: [], captions: [], comments: [], rows: [] },
        removed: [],
        stopped: null,
      });
      res.json({ cues: cues.length, version: result.version });
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/rows/:rowId/captions/export', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const rowId = req.params.rowId!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role === 'commenter') throw new ApiError('forbidden');
      const timeline = await loadTimeline(ctx.db, projectId);
      if (timeline === null) throw new ApiError('not_found');
      const caps = await ctx.db.query(
        'SELECT id, start_frame, end_frame, text, original_start_ms, original_end_ms, srt_bom, srt_crlf FROM captions WHERE row_id = $1 ORDER BY start_frame',
        [rowId],
      );
      const cues: ExportCue[] = caps.rows.map((c: Record<string, unknown>) => ({
        start_frame: Number(c.start_frame),
        end_frame: Number(c.end_frame),
        text: String(c.text),
        originalStartMs: c.original_start_ms === null ? null : Number(c.original_start_ms),
        originalEndMs: c.original_end_ms === null ? null : Number(c.original_end_ms),
      }));
      const out = writeSrt(cues, timeline.meta.frame_rate, {
        bom: caps.rows[0]?.srt_bom === true,
        crlf: caps.rows[0]?.srt_crlf === true,
      });
      res.setHeader('Content-Type', 'application/x-subrip');
      res.setHeader('Content-Disposition', `attachment; filename="${projectId}-${rowId}.srt"`);
      res.send(Buffer.from(out));
    })().catch((err) => respond(res, err));
  });

  return r;
}

/** The typed-cue validation shared by the op and the browser counter. */
export function cueProblem(text: string): 'empty' | 'lines' | 'length' | null {
  return cueTextProblem(text);
}

async function importReplace(
  ctx: AppCtx,
  projectId: string,
  rowId: string,
  cues: { index: string; startMs: number; endMs: number; lines: string[]; startFrame: number; endFrame: number }[],
  layout: { bom: boolean; crlf: boolean },
  person: { id: string; name: string },
  baseVersion: number,
): Promise<{ version: number }> {
  // One op: remove the row's captions and add the imported ones, storing
  // the original milliseconds for the byte-for-byte round trip.
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT version FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
    const meta = await client.query<{ version: number }>('SELECT version FROM projects WHERE id = $1', [projectId]);
    const version = meta.rows[0]!.version + 1;
    const old = await client.query('SELECT id, start_frame, end_frame, text, original_start_ms, original_end_ms, srt_bom, srt_crlf, imported FROM captions WHERE row_id = $1', [rowId]);
    await client.query('DELETE FROM captions WHERE row_id = $1', [rowId]);
    for (const cue of cues) {
      const id = `${rowId}-${cue.startMs}`;
      await client.query(
        `INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text, original_start_ms, original_end_ms, srt_bom, srt_crlf, imported)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
        [id, projectId, rowId, cue.startFrame, cue.endFrame, cue.lines.join('\n'), cue.startMs, cue.endMs, layout.bom, layout.crlf],
      );
    }
    await client.query(
      `INSERT INTO ops (project_id, version, person_id, person_name, op_type, op, undo_data)
       VALUES ($1,$2,$3,$4,'caption_import',$5,$6)`,
      [projectId, version, person.id, person.name,
        JSON.stringify({ type: 'caption_import', row_id: rowId, op_id: `imp-${newHex(8)}`, base_version: baseVersion }),
        JSON.stringify({ kind: 'caption_import', rowId, old: old.rows })],
    );
    await client.query('UPDATE projects SET version = $2 WHERE id = $1', [projectId, version]);
    await client.query('DELETE FROM redo_stack WHERE person_id = $1 AND project_id = $2', [person.id, projectId]);
    await client.query('INSERT INTO undo_stack (person_id, project_id, version) VALUES ($1,$2,$3)', [person.id, projectId, version]);
    await client.query('COMMIT');
    return { version };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function cueLengthProblem(text: string): string | null {
  const problem = cueTextProblem(text);
  if (problem === null) return null;
  return problem;
}

