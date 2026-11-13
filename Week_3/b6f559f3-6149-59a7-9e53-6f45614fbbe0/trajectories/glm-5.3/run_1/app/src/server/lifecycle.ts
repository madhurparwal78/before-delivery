// Automatic purging: trashed projects vanish once server time passes purgeAt.
import type { App } from './app';

export async function purgeDueProjects(app: App): Promise<void> {
  const res = await app.pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE status = 'trashed' AND purge_at <= now()`,
  );
  for (const row of res.rows) {
    // Every row and object goes; scenes, versions, assets and members cascade.
    await app.pool.query(`DELETE FROM projects WHERE id = $1`, [row.id]);
    await app.s3.deletePrefix(`projects/${row.id}/`).catch(() => undefined);
  }
}
