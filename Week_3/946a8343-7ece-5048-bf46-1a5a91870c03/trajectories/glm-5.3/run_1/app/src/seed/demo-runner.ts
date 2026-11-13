import type { Ctx } from '../api/ctx.js';
import { Scheduler } from '../domain/scheduler.js';

/** Run scheduler rounds until the demo pipeline finishes, with a store for artifacts. */
export async function runDemoScheduler(ctx: Ctx, client: import('pg').PoolClient, projectId: number, pipelineId: number): Promise<void> {
  const scheduler = new Scheduler(ctx);
  for (let i = 0; i < 50; i++) {
    const result = await scheduler.round(client, projectId);
    if (!result.changed) break;
  }
  const jobs = (await client.query(`SELECT id, name, status, env_name FROM jobs WHERE pipeline_id = $1`, [pipelineId])).rows;
  const now = ctx.now();
  for (const job of jobs) {
    if (job.status === 'success' && job.env_name) {
      const env = await client.query<{ id: number }>(`INSERT INTO environments (project_id, name, tier, state, current_number) VALUES ($1, $2, 'production', 'available', 0) ON CONFLICT (project_id, name) DO UPDATE SET tier = 'production' RETURNING id`, [projectId, job.env_name]);
      const sha = (await client.query<{ sha: string }>(`SELECT sha FROM pipelines WHERE id = $1`, [pipelineId])).rows[0]?.sha ?? '';
      const dep = await client.query<{ id: number }>(`INSERT INTO deployments (environment_id, number, status, sha, pipeline_id, job_id, created_at, finished_at, rolled_back) VALUES ($1, 1, 'success', $2, $3, $4, $5, $5, false) RETURNING id`, [env.rows[0].id, sha, pipelineId, job.id, now]);
      await client.query(`UPDATE environments SET current_number = 1 WHERE id = $1`, [env.rows[0].id]);
      const arts = (await client.query(`SELECT path, object_key, size FROM artifacts WHERE job_id = $1`, [job.id])).rows;
      for (const a of arts) {
        if (a.object_key) {
          await client.query(`INSERT INTO deploy_artifacts (deployment_id, path, object_key, size) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [dep.rows[0].id, a.path, a.object_key, a.size]);
        }
      }
    }
  }
}
