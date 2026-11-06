import { pool, tx } from '../db.js';
import { blobKey, manifestKey } from '../domain/blobs.js';
import { deleteObject, listKeys, probeStorage } from '../services/storage.js';
import { announceSession, returnBatonToMentor } from './batonWrites.js';
import { publish } from './bus.js';

const ERASED = 'Erased learner';

async function unreferencedBlobs(projectId: string, learnerId: string): Promise<string[]> {
  const { rows } = await pool.query<{ sha256: string }>(
    `select distinct f.sha256
       from checkpoint_files f join checkpoints c on c.id = f.checkpoint_id
      where c.project_id = $1 and c.created_by = $2
        and not exists (
          select 1 from checkpoint_files g join checkpoints d on d.id = g.checkpoint_id
           where d.project_id = $1 and d.created_by is distinct from $2
             and g.sha256 = f.sha256)`,
    [projectId, learnerId],
  );
  return rows.map((row) => row.sha256);
}

/**
 * Erases a learner: their account, their one-to-one projects, the checkpoints
 * they made and every storage object only those held.
 */
export async function eraseLearner(learner: { id: string; name: string; email: string | null }): Promise<void> {
  await probeStorage();

  const soleProjects = await pool.query<{ id: string }>(
    `select p.id from projects p join memberships m on m.project_id = p.id
      where p.kind = 'one_to_one' and m.user_id = $1 and m.role = 'student'`,
    [learner.id],
  );
  const sharedProjects = await pool.query<{ id: string }>(
    `select p.id from projects p join memberships m on m.project_id = p.id
      where p.kind = 'group' and m.user_id = $1 and m.role = 'student'`,
    [learner.id],
  );
  const ownCheckpoints = await pool.query<{ id: string; project_id: string }>(
    `select c.id, c.project_id from checkpoints c
       join projects p on p.id = c.project_id
      where c.created_by = $1 and p.kind = 'group'`,
    [learner.id],
  );

  const doomedKeys: string[] = [];
  for (const row of soleProjects.rows) {
    doomedKeys.push(...(await listKeys(`projects/${row.id}/`)));
  }
  for (const row of ownCheckpoints.rows) {
    doomedKeys.push(manifestKey(row.project_id, row.id));
  }
  for (const row of sharedProjects.rows) {
    for (const sha of await unreferencedBlobs(row.id, learner.id)) {
      doomedKeys.push(blobKey(row.id, sha));
    }
  }
  for (const key of doomedKeys) {
    await deleteObject(key);
  }

  const handedBack = await tx(async (client) => {
    const sessions = [];
    for (const row of sharedProjects.rows) {
      const session = await returnBatonToMentor(client, row.id, learner.id);
      if (session !== null) sessions.push(session);
    }

    await client.query(
      `update edit_log set user_id = null, actor_name = $2 where user_id = $1`,
      [learner.id, ERASED],
    );
    await client.query(
      `update audit_events set actor_id = null, actor_name = $2 where actor_id = $1`,
      [learner.id, ERASED],
    );
    await client.query(
      `update audit_events set subject = replace(subject::text, $1, $2)::jsonb
        where subject::text like '%' || $1 || '%'`,
      [learner.name, ERASED],
    );
    if (learner.email !== null) {
      await client.query(
        `update audit_events set subject = replace(subject::text, $1, $2)::jsonb
          where subject::text like '%' || $1 || '%'`,
        [learner.email, ERASED],
      );
      await client.query('delete from signin_tokens where email = $1', [learner.email]);
      await client.query('delete from invites where email = $1', [learner.email]);
      await client.query('delete from outbox where to_email = $1', [learner.email]);
    }
    await client.query('delete from outbox where recipient_user_id = $1', [learner.id]);
    await client.query(`delete from checkpoints where created_by = $1`, [learner.id]);
    for (const row of soleProjects.rows) {
      await client.query('delete from projects where id = $1', [row.id]);
    }
    await client.query('delete from users where id = $1', [learner.id]);
    return sessions;
  });

  for (const row of sharedProjects.rows) {
    await publish({ project_id: row.id, user_id: learner.id, frame: { type: 'access_revoked' } });
  }
  for (const session of handedBack) {
    await announceSession(session);
  }
}
