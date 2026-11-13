import type { Ctx } from '../api/ctx.js';
import { recordLine, encodeBool, encodeList, encodeOptional, encodeOptionalInt } from '../domain/spurpack.js';
import { getCommit, readTreeFull, splitLines, blobId, commitIdOf, treeIdOf, storeBlob, storeTree, storeCommit } from '../domain/repo.js';
import { EXPORT_FAILED_STORAGE } from '../core/util.js';

/** Background export/import progress in 5 steps on the server clock. */
class ProgressRunner {
  private timers: Array<() => void> = [];

  scheduleExport(ctx: Ctx, exportId: number, projectId: number): void {
    this.runSteps(ctx, async (step) => {
      const client = await ctx.db.pool.connect();
      try {
        const row = (await client.query<{ status: string; progress: number }>(`SELECT status, progress FROM exports WHERE id = $1`, [exportId])).rows[0];
        if (!row || row.status !== 'running') return false;
        if (step === 4) {
          const pack = await buildPack(ctx, client, projectId);
          let ok = true;
          try {
            const stored = await ctx.storage.put(`exports/${projectId}/${exportId}.spurpack`, pack);
            void stored;
            await client.query(`UPDATE exports SET progress = 100, status = 'finished', object_key = $2, finished_at = $3 WHERE id = $1`,
              [exportId, `exports/${projectId}/${exportId}.spurpack`, ctx.now()]);
          } catch {
            ok = false;
            await client.query(`UPDATE exports SET status = 'failed', error = $2 WHERE id = $1`, [exportId, EXPORT_FAILED_STORAGE]);
          }
          await ctx.live(client, projectId, 'export', { id: exportId, progress: ok ? 100 : 80, status: ok ? 'finished' : 'failed' });
          return false;
        }
        const progress = (step + 1) * 20;
        await client.query(`UPDATE exports SET progress = $2 WHERE id = $1`, [exportId, progress]);
        await ctx.live(client, projectId, 'export', { id: exportId, progress, status: 'running' });
        return true;
      } finally {
        client.release();
      }
    });
  }

  scheduleImport(ctx: Ctx, importId: number, projectId: number): void {
    this.runSteps(ctx, async (step) => {
      const client = await ctx.db.pool.connect();
      try {
        const row = (await client.query<{ status: string; pack: string; group_id: number; slug: string }>(`SELECT status, pack, group_id, slug FROM imports WHERE id = $1`, [importId])).rows[0];
        if (!row || row.status !== 'running') return false;
        if (step === 4) {
          const { applyImport } = await import('./import-apply.js');
          const packText = row.pack;
          await client.query('BEGIN');
          try {
            await applyImport(ctx, client, projectId, packText);
            await client.query(`UPDATE imports SET status = 'finished', progress = 100, finished_at = $2 WHERE id = $1`, [importId, ctx.now()]);
            await client.query('COMMIT');
          } catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw e;
          }
          await ctx.live(client, projectId, 'import', { id: importId, progress: 100, status: 'finished' });
          return false;
        }
        const progress = (step + 1) * 20;
        await client.query(`UPDATE imports SET progress = $2 WHERE id = $1`, [importId, progress]);
        await ctx.live(client, projectId, 'import', { id: importId, progress, status: 'running' });
        return true;
      } finally {
        client.release();
      }
    });
  }

  private runSteps(ctx: Ctx, step: (i: number) => Promise<boolean>): void {
    let i = 0;
    const tick = (): void => {
      if (i >= 5) return;
      void step(i).then((cont) => {
        i++;
        if (cont && i < 5) {
          this.timers.push(setTimeout(tick, ctx.settings.exportStepMs).unref?.() as unknown as () => void);
        }
      });
    };
    tick();
  }
}

export const progressJob = new ProgressRunner();

async function buildPack(ctx: Ctx, client: import('pg').PoolClient, projectId: number): Promise<string> {
  const project = (await client.query<{ path: string; visibility: string; default_branch: string; merge_method: string; merge_trains: boolean; pipelines_must_succeed: boolean; reset_approvals_on_push: boolean; author_can_approve: boolean; auto_resolve_outdated: boolean }>(
    `SELECT path, visibility, default_branch, merge_method, merge_trains, pipelines_must_succeed, reset_approvals_on_push, author_can_approve, auto_resolve_outdated FROM projects WHERE id = $1`, [projectId])).rows[0];
  const lines: string[] = ['spurpack 1'];
  // users and commits
  const refs = (await client.query<{ kind: string; name: string; commit_id: string }>(`SELECT kind, name, commit_id FROM refs WHERE project_id = $1`, [projectId])).rows;
  const reachable = new Set<string>();
  const stack = refs.map((r) => r.commit_id);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const cm = await getCommit(client, id);
    if (cm) stack.push(...cm.parents);
  }
  const commitRows: Array<{ id: string; parents: string[]; author: string; author_time: number; committer: string; commit_time: number; message: string; tree: string }> = [];
  for (const id of reachable) {
    const cm = await getCommit(client, id);
    if (cm) commitRows.push(cm);
  }
  commitRows.sort((a, b) => a.commit_time - b.commit_time || (a.id < b.id ? -1 : 1));
  const users = new Set<string>();
  for (const cm of commitRows) {
    users.add(cm.author);
    users.add(cm.committer);
  }
  const issues = (await client.query(`SELECT id, iid, title, state, author_id, confidential, weight, description FROM issues WHERE project_id = $1 ORDER BY iid`, [projectId])).rows;
  for (const i of issues) {
    const u = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [i.author_id])).rows[0];
    if (u) users.add(u.username);
  }
  const mrs = (await client.query(`SELECT id, iid, title, state, author_id, source, target, description FROM merge_requests WHERE project_id = $1 ORDER BY iid`, [projectId])).rows;
  for (const m of mrs) {
    const u = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [m.author_id])).rows[0];
    if (u) users.add(u.username);
  }
  const threads = (await client.query(`SELECT t.path, t.resolved, n.author, n.body, mr.iid FROM threads t JOIN merge_requests mr ON mr.id = t.mr_id JOIN notes n ON n.thread_id = t.id LEFT JOIN issues i ON i.id = n.issue_id WHERE mr.project_id = $1 ORDER BY n.id`, [projectId])).rows;
  for (const t of threads) users.add(t.author);
  const wikiVersions = (await client.query(`SELECT wv.author, wp.slug FROM wiki_versions wv JOIN wiki_pages wp ON wp.id = wv.page_id WHERE wp.project_id = $1 ORDER BY wp.slug, wv.version`, [projectId])).rows;
  for (const w of wikiVersions) users.add(w.author);
  for (const u of [...users].sort()) {
    lines.push(recordLine('user', [u]));
  }
  // commits with files
  for (const cm of commitRows) {
    const files = await readTreeFull(client, cm.tree, async (key) => ctx.storage.tryGet(key));
    for (const [path, content] of [...files.entries()].sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))) {
      lines.push(recordLine('file', [path, content]));
    }
    lines.push(recordLine('commit', [
      cm.id,
      cm.parents.length === 0 ? '-' : encodeList(cm.parents),
      `${cm.author} ${cm.author_time}`,
      `${cm.committer} ${cm.commit_time}`,
      cm.message,
    ]));
  }
  for (const r of [...refs].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'branch' ? -1 : 1))) {
    lines.push(recordLine('ref', [r.kind, r.name, r.commit_id]));
  }
  // labels: project labels + inherited group labels carried by exported issues
  const projectLabels = (await client.query(`SELECT name, description FROM labels WHERE project_id = $1 ORDER BY name`, [projectId])).rows;
  const groupLabels = (await client.query<{ name: string; description: string; group_id: number }>(
    `SELECT l.name, l.description, l.group_id FROM labels l WHERE l.group_id IN (WITH RECURSIVE gg AS (SELECT id, parent_id FROM groups WHERE id = (SELECT group_id FROM projects WHERE id = $1)) SELECT id FROM gg UNION SELECT p.id FROM groups p JOIN gg ON gg.parent_id = p.id) ORDER BY l.name`, [projectId])).rows;
  const usedLabels = new Set<string>();
  for (const i of issues) {
    const ls = (await client.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [i.id])).rows;
    for (const l of ls) usedLabels.add(l.name);
  }
  const labelNames = new Set<string>(projectLabels.map((l) => l.name));
  for (const gl of groupLabels) {
    if (usedLabels.has(gl.name)) labelNames.add(gl.name);
  }
  const labelDescriptions = new Map<string, string>();
  for (const l of projectLabels) labelDescriptions.set(l.name, l.description);
  for (const gl of groupLabels) {
    if (labelNames.has(gl.name) && !labelDescriptions.has(gl.name)) labelDescriptions.set(gl.name, gl.description);
  }
  for (const name of [...labelNames].sort()) {
    lines.push(recordLine('label', [name, labelDescriptions.get(name) ?? '']));
  }
  // milestones
  const milestones = (await client.query(`SELECT id, title, start_date, due_date, time_zone, state FROM milestones WHERE project_id = $1 ORDER BY title`, [projectId])).rows;
  for (const m of milestones) {
    lines.push(recordLine('milestone', [m.title, encodeOptional(m.start_date), encodeOptional(m.due_date), m.time_zone, m.state]));
  }
  // issues
  for (const i of issues) {
    const author = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [i.author_id])).rows[0]?.username ?? '';
    const labels = (await client.query<{ name: string }>(`SELECT l.name FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = $1`, [i.id])).rows.map((r) => r.name);
    const milestone = (await client.query<{ title: string }>(`SELECT m.title FROM issue_milestones im JOIN milestones m ON m.id = im.milestone_id WHERE im.issue_id = $1`, [i.id])).rows[0]?.title ?? null;
    lines.push(recordLine('issue', [
      String(i.iid), i.title, i.state, author, encodeList(labels), encodeOptional(milestone), encodeOptionalInt(i.weight), encodeBool(i.confidential), encodeOptional(i.description),
    ]));
  }
  // requests
  for (const m of mrs) {
    const author = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [m.author_id])).rows[0]?.username ?? '';
    lines.push(recordLine('request', [String(m.iid), m.title, m.state, author, m.source, m.target, encodeOptional(m.description)]));
  }
  // threads: first note only
  for (const t of threads) {
    lines.push(recordLine('thread', [String(t.iid), t.path ?? '-', '-', encodeBool(t.resolved), t.author, t.body]));
  }
  // wiki pages
  for (const w of wikiVersions) {
    const full = (await client.query(`SELECT wv.title, wv.content, wv.version FROM wiki_versions wv JOIN wiki_pages wp ON wp.id = wv.page_id WHERE wp.project_id = $1 AND wp.slug = $2 ORDER BY wv.version`, [projectId, w.slug])).rows;
    for (const v of full) {
      lines.push(recordLine('wikipage', [w.slug, String(v.version), v.author ?? w.author, v.title, v.content]));
    }
  }
  // config
  const config: Array<[string, string]> = [
    ['author_can_approve', encodeBool(project.author_can_approve)],
    ['auto_resolve_outdated', encodeBool(project.auto_resolve_outdated)],
    ['default_branch', project.default_branch],
    ['merge_method', project.merge_method],
    ['merge_trains', encodeBool(project.merge_trains)],
    ['pipelines_must_succeed', encodeBool(project.pipelines_must_succeed)],
    ['reset_approvals_on_push', encodeBool(project.reset_approvals_on_push)],
    ['visibility', project.visibility],
  ];
  for (const [k, v] of config) {
    lines.push(recordLine('config', [k, v]));
  }
  return lines.join('\n') + '\n';
}

export { buildPack, splitLines };
