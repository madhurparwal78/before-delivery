/**
 * The one-time upgrade of projects stored in seconds. Each project is converted
 * in one transaction; a restart never converts one twice.
 */
import type { PoolClient } from 'pg';
import { pool, query } from '../db.js';
import { loadMediaInfo } from './media.js';
import { loadProject } from './projects.js';

export async function upgradeProject(projectId: string): Promise<void> {
  const media = await loadMediaInfo();
  const client: PoolClient = await pool.connect();
  try {
    await client.query('begin');
    const locked = await client.query<{ time_unit: string }>(
      `select time_unit from projects where id = $1 for update`,
      [projectId],
    );
    if (locked.rows.length === 0 || locked.rows[0].time_unit !== 'seconds') {
      await client.query('rollback');
      return;
    }
    const loaded = await loadProject(client, projectId, media);
    if (loaded === null) {
      await client.query('rollback');
      return;
    }
    for (const clip of loaded.state.clips) {
      await client.query(
        `update clips set start_frame = $2, end_frame = $3, source_in = $4, source_out = $5 where id = $1`,
        [clip.id, clip.start_frame, clip.end_frame, clip.source_in, clip.source_out],
      );
    }
    for (const caption of loaded.state.captions) {
      await client.query(`update captions set start_frame = $2, end_frame = $3 where id = $1`, [
        caption.id,
        caption.start_frame,
        caption.end_frame,
      ]);
    }
    const markerRows = await client.query<{ id: number }>(
      `select id from markers where project_id = $1 order by id`,
      [projectId],
    );
    for (const [index, marker] of markerRows.rows.entries()) {
      await client.query(`update markers set frame = $2 where id = $1`, [marker.id, loaded.markers[index]?.frame ?? 0]);
    }
    for (const comment of loaded.state.comments) {
      await client.query(`update comments set pin_frame = $2, pin_seconds = null where id = $1`, [
        comment.id,
        comment.pin_frame,
      ]);
    }
    await client.query(`update projects set time_unit = 'frames' where id = $1`, [projectId]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function upgradeProjectsStoredInSeconds(): Promise<void> {
  const pending = await query<{ id: string }>(`select id from projects where time_unit = 'seconds' order by seed_order`);
  for (const project of pending) await upgradeProject(project.id);
}
