import type { PoolClient } from 'pg';
import type { Ctx } from '../api/ctx.js';
import { parsePackLine, RECORD_FIELD_COUNTS, decodeList, encodeBool } from '../domain/spurpack.js';
import { storeBlob, storeTree, storeCommit, blobId, splitLines } from '../domain/repo.js';

/** Store a validated spurpack as a new project. */
export async function applyImport(ctx: Ctx, c: PoolClient, projectId: number, pack: string): Promise<void> {
  const lines = pack.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const users = new Map<string, number>();
  const labels = new Map<string, number>();
  const milestones = new Map<string, number>();
  const issueIds = new Map<number, number>();
  const mrIds = new Map<number, number>();
  const now = ctx.now();
  const commitFiles = new Map<string, Map<string, string>>();
  const pendingFiles: Array<{ path: string; content: string }> = [];

  const usernameToId = async (username: string): Promise<number | null> => {
    if (users.has(username)) return users.get(username)!;
    const r = (await c.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [username])).rows[0];
    if (r) users.set(username, r.id);
    return r?.id ?? null;
  };

  for (let i = 1; i < lines.length; i++) {
    const parsed = parsePackLine(lines[i]);
    if (!parsed) continue;
    const { name, fields } = parsed;
    if (name === 'user') {
      await usernameToId(fields[0]);
    } else if (name === 'file') {
      pendingFiles.push({ path: fields[0], content: fields[1] });
    } else if (name === 'commit') {
      const filesMap = new Map<string, string>();
      for (const f of pendingFiles) filesMap.set(f.path, f.content);
      pendingFiles.length = 0;
      commitFiles.set(fields[0], filesMap);
      await storeCommit(c, {
        tree: '',
        parents: fields[1] === '-' ? [] : decodeList(fields[1]),
        author: fields[2].split(' ')[0],
        author_time: parseInt(fields[2].split(' ')[1], 10),
        committer: fields[3].split(' ')[0],
        commit_time: parseInt(fields[3].split(' ')[1], 10),
        message: fields[4],
      });
    } else if (name === 'ref') {
      await c.query(`INSERT INTO refs (project_id, kind, name, commit_id) VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id, kind, name) DO UPDATE SET commit_id = $4`, [projectId, fields[0], fields[1], fields[2]]);
    } else if (name === 'label') {
      const r = await c.query<{ id: number }>(`INSERT INTO labels (project_id, name, description, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
        [projectId, fields[0], fields[1], now]);
      labels.set(fields[0], r.rows[0].id);
    } else if (name === 'milestone') {
      const r = await c.query<{ id: number }>(`INSERT INTO milestones (project_id, title, start_date, due_date, time_zone, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [projectId, fields[0], fields[1] === '-' ? null : fields[1], fields[2] === '-' ? null : fields[2], fields[3], fields[4], now]);
      milestones.set(fields[0], r.rows[0].id);
    } else if (name === 'issue') {
      const author = await usernameToId(fields[3]);
      const r = await c.query<{ id: number }>(`INSERT INTO issues (project_id, iid, title, description, state, author_id, confidential, weight, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
        [projectId, parseInt(fields[0], 10), fields[1], fields[8], fields[2], author ?? 0, fields[7] === 'true', fields[6] === '-' ? null : parseInt(fields[6], 10), now]);
      issueIds.set(parseInt(fields[0], 10), r.rows[0].id);
      for (const ln of decodeList(fields[4])) {
        const lid = labels.get(ln);
        if (lid) await c.query(`INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [r.rows[0].id, lid]);
      }
      if (fields[5] !== '-') {
        const mid = milestones.get(fields[5]);
        if (mid) await c.query(`INSERT INTO issue_milestones (issue_id, milestone_id) VALUES ($1, $2)`, [r.rows[0].id, mid]);
      }
    } else if (name === 'request') {
      const author = await usernameToId(fields[3]);
      const r = await c.query<{ id: number }>(`INSERT INTO merge_requests (project_id, iid, title, description, state, draft, author_id, source, target, assignees, reviewers, delete_source_branch, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, '{}', '{}', false, $9, $9) RETURNING id`,
        [projectId, parseInt(fields[0], 10), fields[1], fields[6], fields[2], author ?? 0, fields[4], fields[5], now]);
      mrIds.set(parseInt(fields[0], 10), r.rows[0].id);
    } else if (name === 'thread') {
      const mrId = mrIds.get(parseInt(fields[0], 10));
      const author = await usernameToId(fields[4]);
      if (mrId === undefined || !author) continue;
      const line = fields[2] === '-' ? null : parseInt(fields[2], 10);
      const tr = await c.query<{ id: number }>(`INSERT INTO threads (mr_id, path, old_line, new_line, end_line, version, side, current_line, resolved, outdated, created_at) VALUES ($1, $2, NULL, $3, NULL, 1, 'new', $3, $4, false, $5) RETURNING id`,
        [mrId, fields[1] === '-' ? null : fields[1], line, fields[3] === 'true', now]);
      await c.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, thread_id, created_at) VALUES ($1, $2, $3, false, false, $4, $5, $6)`,
        [projectId, fields[4], fields[5], mrId, tr.rows[0].id, now]);
    } else if (name === 'wikipage') {
      const page = await c.query<{ id: number }>(`INSERT INTO wiki_pages (project_id, slug) VALUES ($1, $2) ON CONFLICT (project_id, slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`, [projectId, fields[0]]);
      await c.query(`INSERT INTO wiki_versions (page_id, version, title, content, author, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [page.rows[0].id, parseInt(fields[1], 10), fields[3], fields[4], fields[2], now]);
    } else if (name === 'config') {
      const [key, value] = fields;
      if (['merge_trains', 'pipelines_must_succeed', 'reset_approvals_on_push', 'author_can_approve', 'auto_resolve_outdated'].includes(key)) {
        await c.query(`UPDATE projects SET ${key} = $2 WHERE id = $1`, [projectId, value === 'true']);
      } else if (key === 'merge_method' || key === 'visibility' || key === 'default_branch') {
        await c.query(`UPDATE projects SET ${key} = $2 WHERE id = $1`, [projectId, value]);
      }
    }
  }

  // materialize each commit's tree from its stored file snapshot
  for (const [commitId, files] of commitFiles) {
    const tree = await buildTreeFromFilesSnapshot(c, files, ctx.settings.inlineMaxBytes);
    await c.query(`UPDATE commits SET tree = $2 WHERE id = $1`, [commitId, tree]);
  }
  await c.query(`INSERT INTO mr_iids (project_id, kind, next_iid) VALUES ($1, 'issue', 1), ($1, 'request', 1) ON CONFLICT DO NOTHING`, [projectId]);
  void storeBlob; void storeTree; void blobId; void splitLines; void encodeBool; void RECORD_FIELD_COUNTS;
}

async function buildTreeFromFilesSnapshot(c: PoolClient, files: Map<string, string>, inlineMax: number): Promise<string> {
  const { buildTreeFromFiles } = await import('../domain/repo.js');
  return buildTreeFromFiles(c, files, inlineMax);
}
