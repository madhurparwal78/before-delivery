import type { Db } from './db';
import { secondsToFrames, clipLength } from '../shared/frames';

/**
 * The one-time upgrade of older projects stored in seconds. Each project is
 * converted in one transaction by the rounding rule, and a restart never
 * converts a project twice because its time_unit becomes "frames".
 */
export async function upgradeSecondsProjects(db: Db): Promise<void> {
  const rows = await db.query<{ id: string; frame_rate: string }>(
    "SELECT id, frame_rate FROM projects WHERE time_unit = 'seconds'",
  );
  for (const project of rows.rows) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const meta = await client.query<{ id: string; frame_rate: string }>(
        'SELECT id, frame_rate FROM projects WHERE id = $1 FOR UPDATE',
        [project.id],
      );
      if (meta.rows[0] === undefined || (await client.query("SELECT time_unit FROM projects WHERE id = $1", [project.id])).rows[0]!.time_unit !== 'seconds') {
        await client.query('ROLLBACK');
        continue;
      }
      const rate = meta.rows[0]!.frame_rate;
      const clips = await client.query('SELECT id, source_in, source_out, speed_percent, start_frame FROM clips WHERE project_id = $1', [project.id]);
      for (const clip of clips.rows) {
        const start = secondsToFrames(Number(clip.start_frame), rate);
        const sourceIn = secondsToFrames(Number(clip.source_in), rate);
        const sourceOut = secondsToFrames(Number(clip.source_out), rate);
        // end_frame is never converted from seconds: it is the converted
        // start_frame plus the length rule applied to the converted source.
        const end = start + clipLength(sourceIn, sourceOut, Number(clip.speed_percent));
        await client.query(
          'UPDATE clips SET start_frame = $2, source_in = $3, source_out = $4, end_frame = $5 WHERE id = $1',
          [clip.id, start, sourceIn, sourceOut, end],
        );
      }
      const captions = await client.query('SELECT id, start_frame, end_frame FROM captions WHERE project_id = $1', [project.id]);
      for (const cap of captions.rows) {
        const start = secondsToFrames(Number(cap.start_frame), rate);
        const end = secondsToFrames(Number(cap.end_frame), rate);
        await client.query('UPDATE captions SET start_frame = $2, end_frame = $3 WHERE id = $1', [cap.id, start, end]);
      }
      const markers = await client.query('SELECT frame FROM markers WHERE project_id = $1', [project.id]);
      for (const marker of markers.rows) {
        const frame = secondsToFrames(Number(marker.frame), rate);
        await client.query('UPDATE markers SET frame = $2 WHERE project_id = $1 AND frame = $3', [project.id, frame, marker.frame]);
      }
      const comments = await client.query('SELECT id, frame FROM comments WHERE project_id = $1', [project.id]);
      for (const comment of comments.rows) {
        const frame = secondsToFrames(Number(comment.frame), rate);
        await client.query('UPDATE comments SET frame = $2, live_frame = $3 WHERE id = $1', [comment.id, frame, frame]);
      }
      await client.query("UPDATE projects SET time_unit = 'frames' WHERE id = $1", [project.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
