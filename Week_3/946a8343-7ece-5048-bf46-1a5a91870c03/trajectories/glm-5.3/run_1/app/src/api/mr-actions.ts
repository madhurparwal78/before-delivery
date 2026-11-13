import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, requireReadCode, writeAudit } from './common.js';
import { ROLE_LEVEL, hasPermission } from '../domain/access.js';
import { getMr, latestVersion, countUnresolvedThreads, approvalsOf, headPipelineOf } from '../domain/mr-service.js';
import { mergeBase, isAncestor } from '../domain/repo.js';
import { filesOf, computeMerge } from '../domain/merge-service.js';
import { pushConsequences } from '../domain/push-consequences.js';
import { addToTrain, removeFromTrain, carsFor } from '../domain/train.js';
import { createPipeline } from '../domain/pipeline-service.js';
import { mergeProtectionVerdict, applyCommit, branchHead } from '../domain/repo-service.js';
import { buildChecks, buildApprovals } from './mrs.js';
import { short } from '../core/util.js';
import { hasConflictMarkers, mergeFileStates, applySuggestion } from '../domain/diff.js';

export async function approveMr(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  return approveOrRevoke(rc, true);
}

export async function revokeApproval(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  return approveOrRevoke(rc, false);
}

async function approveOrRevoke(rc: RequestCtx, approve: boolean): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const me = rc.user;
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    if (!hasPermission(access, 'approve') && access.level < ROLE_LEVEL.developer) throw errs.forbidden();
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const version = await latestVersion(client, mr.id);
    const sha = typeof body.sha === 'string' ? body.sha : '';
    if (approve && version && sha !== version.head) {
      throw new AppError(409, 'stale_head', 'The source branch changed. Review the new commits and try again.');
    }
    const now = rc.ctx.now();
    if (approve) {
      if (mr.author_id === rc.user.id && !project.author_can_approve) {
        throw new AppError(403, 'author_cannot_approve', "Authors can't approve their own merge request.");
      }
      const existing = (await client.query(`SELECT id FROM approvals WHERE mr_id = $1 AND user_id = $2`, [mr.id, rc.user.id])).rows[0];
      if (existing) throw new AppError(409, 'already_approved', 'You already approved this merge request.');
      const { rules } = await (await import('./mrs.js')).buildApprovals(rc, client, project, mr);
      const authorUsername = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [mr.author_id])).rows[0]?.username ?? '';
      // eligibility: any developer when no rule applies; any rule's eligible set otherwise
      const projectRules = (await client.query<{ users: string[]; groups: string[] }>(`SELECT users, groups FROM approval_rules WHERE project_id = $1`, [id])).rows;
      const eligible = new Set<string>();
      for (const r of projectRules) {
        for (const u of r.users) eligible.add(u);
        for (const g of r.groups) {
          const gRow = (await client.query<{ id: number }>(`SELECT id FROM groups WHERE path = $1`, [g])).rows[0];
          if (gRow) {
            const members = (await client.query<{ username: string }>(`SELECT u.username FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1 AND (gm.role IN ('developer','maintainer','owner') OR EXISTS (SELECT 1 FROM custom_roles cr WHERE cr.id = gm.custom_role_id AND cr.base IN ('developer','maintainer','owner')))`, [gRow.id])).rows;
            for (const m of members) eligible.add(m.username);
          }
        }
      }
      const ownersRules = rules.filter((r) => r.kind === 'owners');
      void ownersRules;
      void authorUsername;
      if (eligible.size === 0 && rules.filter((r) => r.kind === 'rule').length === 0 && rules.filter((r) => r.kind === 'owners').length === 0) {
        // any developer may approve
      } else if (!eligible.has(rc.user.username)) {
        const ownersMatch = rules.find((r) => r.kind === 'owners');
        if (!ownersMatch) {
          throw new AppError(403, 'not_eligible', "You aren't eligible to approve this merge request.");
        }
      }
      await client.query(`INSERT INTO approvals (mr_id, user_id, sha, created_at) VALUES ($1, $2, $3, $4)`, [mr.id, rc.user.id, sha, now]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
        [id, rc.user.username, `Approved by @${rc.user.username}.`, mr.id, now]);
      await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'approval.add', target: `${project.path}!${iid}`, before: null, after: { user: rc.user.username }, at: now });
    } else {
      const existing = (await client.query<{ id: number }>(`SELECT id FROM approvals WHERE mr_id = $1 AND user_id = $2`, [mr.id, rc.user.id])).rows[0];
      if (!existing) throw new AppError(404, 'not_found', 'Not found.');
      await client.query(`DELETE FROM approvals WHERE mr_id = $1 AND user_id = $2`, [mr.id, rc.user.id]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
        [id, rc.user.username, `Revoked approval by @${rc.user.username}.`, mr.id, now]);
      await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'approval.remove', target: `${project.path}!${iid}`, before: { user: rc.user.username }, after: null, at: now });
    }
    const seq = await rc.ctx.live(client, id, 'approvals', { mr_iid: iid });
    await client.query('COMMIT');
    return await approvalsResponse(rc, client, project, mr);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function approvalsResponse(rc: RequestCtx, client: import('pg').PoolClient, project: { id: number; path: string }, mr: { id: number; iid: number; title: string; state: string; draft: boolean; author_id: number; source: string; target: string; description: string; assignees: string[]; reviewers: string[]; delete_source_branch: boolean; created_at: number; updated_at: number; merged_at: number | null; merge_commit: string | null; auto_merge: boolean; auto_merge_reason: string | null; project_id: number }): Promise<unknown> {
  return buildApprovals(rc, client, project, mr);
}

export async function mergeMr(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    if (mr.state === 'merged') throw new AppError(409, 'wrong_state', 'This merge request is already merged.');
    const sha = typeof body.sha === 'string' ? body.sha : '';
    const version = await latestVersion(client, mr.id);
    if (!version || sha !== version.head) {
      throw new AppError(409, 'stale_head', 'The source branch changed. Review the new commits and try again.');
    }
    // protection
    const verdict = await mergeProtectionVerdict(client, id, mr.target, access.role, access.permissions.has('push_protected'));
    if (!verdict.ok) throw new AppError(verdict.status ?? 403, verdict.code ?? 'protected_branch', verdict.message ?? '');
    // checks
    const checks = await buildChecks(rc, client, project, mr);
    const failed = firstFailedCheck(checks.checks);
    if (failed) throw new AppError(409, 'merge_blocked', failed.text);
    // merge
    const merge = await computeMerge(rc.ctx, client, mr, project.merge_method, rc.user.username);
    if (merge.conflicts.length > 0 || merge.commitId === null) {
      throw new AppError(409, 'merge_blocked', `Source branch has conflicts with ${mr.target}.`);
    }
    const now = rc.ctx.now();
    const fastForward = merge.fastForward;
    await client.query(`UPDATE merge_requests SET state = 'merged', merged_at = $2, merge_commit = $3, updated_at = $2 WHERE id = $1`, [mr.id, now, merge.commitId]);
    await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
      [id, rc.user.username, `Merged by @${rc.user.username} into ${mr.target}.`, mr.id, now]);
    // target push pipeline
    await createPipeline(rc.ctx, client, {
      projectId: id, projectPath: project.path, ref: mr.target, sha: merge.commitId as string, source: 'push', defaultBranch: project.default_branch,
    });
    // delete source branch
    if (mr.delete_source_branch) {
      await client.query(`DELETE FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [id, mr.source]);
    }
    // closing keywords
    await (await import('../domain/merge-journey.js')).closeIssuesForMerge(rc.ctx, client, project, mr, merge.commitId as string, rc.user.username);
    // retarget stacked requests
    await (await import('../domain/merge-journey.js')).retargetStacked(rc.ctx, client, project, mr, rc.ctx.settings.retargetLimit);
    await client.query('COMMIT');
    const seq = await rc.ctx.currentSeq(client, id);
    return { state: 'merged', merge_commit: merge.commitId, seq, fast_forward: fastForward };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function firstFailedCheck(checks: Array<{ name: string; state: string; text: string }>): { name: string; state: string; text: string } | null {
  const order = ['state', 'target', 'stack', 'draft', 'conflicts', 'rebase', 'threads', 'approvals', 'pipeline', 'security'];
  for (const name of order) {
    const c = checks.find((x) => x.name === name && x.state === 'failed');
    if (c) return c;
  }
  return null;
}

export async function getConflicts(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const version = await latestVersion(client, mr.id);
    if (!version) throw errs.notFound();
    const sourceHead = version.head;
    const targetHead = await branchHead(client, id, mr.target);
    if (!targetHead) throw errs.notFound();
    const base = await mergeBase(client, sourceHead, targetHead);
    const baseFiles = base ? await filesOf(client, rc.ctx, base) : new Map();
    const targetFiles = await filesOf(client, rc.ctx, targetHead);
    const sourceFiles = await filesOf(client, rc.ctx, sourceHead);
    const out = [];
    for (const path of [...new Set([...baseFiles.keys(), ...targetFiles.keys(), ...sourceFiles.keys()])].sort()) {
      const res = mergeFileStates(baseFiles.get(path) ?? null, targetFiles.get(path) ?? null, sourceFiles.get(path) ?? null, mr.target, mr.source);
      if (res.conflict && res.content !== null) {
        out.push({ path, content: res.content });
      }
    }
    return { files: out.map((f) => ({ path: f.path, content: f.content })) };
  } finally {
    client.release();
  }
}

export async function resolveConflicts(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const version = await latestVersion(client, mr.id);
    if (!version) throw errs.notFound();
    const sourceHead = version.head;
    const targetHead = await branchHead(client, id, mr.target);
    if (!targetHead) throw errs.notFound();
    const files = Array.isArray(body.files) ? body.files : [];
    const resolvedFiles = new Map<string, string>();
    for (const f of files) {
      const rec = f as Record<string, unknown>;
      const path = String(rec.path ?? '');
      if (typeof rec.content === 'string') {
        if (hasConflictMarkers(rec.content)) {
          throw new AppError(422, 'conflict_markers', 'Remove all conflict markers before committing.', { fields: { content: 'Remove all conflict markers before committing.' } });
        }
        resolvedFiles.set(path, rec.content);
      } else if (Array.isArray(rec.hunks)) {
        const sourceFilesMap = await filesOf(client, rc.ctx, sourceHead);
        const targetFilesMap = await filesOf(client, rc.ctx, targetHead);
        const base = await mergeBase(client, sourceHead, targetHead);
        const baseFiles = base ? await filesOf(client, rc.ctx, base) : new Map();
        let content = sourceFilesMap.get(path) ?? '';
        const hunks = rec.hunks.map((h) => String(h));
        void baseFiles; void targetFilesMap;
        for (const choice of hunks) {
          if (choice !== 'ours' && choice !== 'theirs') {
            throw errs.validation({ hunks: 'Hunk choices must be ours or theirs.' });
          }
          content = resolveMarkers(content, choice);
        }
        if (hasConflictMarkers(content)) {
          throw new AppError(422, 'conflict_markers', 'Remove all conflict markers before committing.', { fields: { content: 'Remove all conflict markers before committing.' } });
        }
        resolvedFiles.set(path, content);
      }
    }
    // build the resolution commit on the source branch
    const { buildTreeFromFiles, storeCommit } = await import('../domain/repo.js');
    const allFiles = new Map(await filesOf(client, rc.ctx, sourceHead));
    for (const [k, v] of resolvedFiles) allFiles.set(k, v);
    const tree = await buildTreeFromFiles(client, allFiles, rc.ctx.settings.inlineMaxBytes);
    const now = Math.floor(rc.ctx.now() / 1000);
    const commitId = await storeCommit(client, {
      tree,
      parents: [sourceHead, targetHead],
      author: rc.user.username,
      author_time: now,
      committer: rc.user.username,
      commit_time: now,
      message: `Resolve conflicts with ${mr.target}`,
    });
    await client.query(`UPDATE refs SET commit_id = $3 WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [id, mr.source, commitId]);
    const push = await pushConsequences(rc.ctx, client, {
      projectId: id, projectPath: project.path, branch: mr.source, previousHead: sourceHead, newHead: commitId,
      defaultBranch: project.default_branch, resetApprovalsOnPush: project.reset_approvals_on_push,
      autoResolveOutdated: project.auto_resolve_outdated, actor: rc.user.username,
    });
    await client.query('COMMIT');
    return { commit: commitId, seq: push.seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function resolveMarkers(content: string, choice: 'ours' | 'theirs'): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let mode: 'none' | 'ours' | 'theirs' | 'sep' = 'none';
  let ours: string[] = [];
  let theirs: string[] = [];
  for (const line of lines) {
    if (line.startsWith('<<<<<<< ')) {
      mode = 'ours';
      ours = [];
      theirs = [];
      continue;
    }
    if (line === '=======') {
      mode = 'theirs';
      continue;
    }
    if (line.startsWith('>>>>>>> ')) {
      out.push(...(choice === 'ours' ? ours : theirs));
      mode = 'none';
      ours = [];
      theirs = [];
      continue;
    }
    if (mode === 'ours') ours.push(line);
    else if (mode === 'theirs') theirs.push(line);
    else out.push(line);
  }
  return out.join('\n');
}

export async function applySuggestions(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const version = await latestVersion(client, mr.id);
    if (!version) throw errs.notFound();
    const suggestions = [];
    for (const sid of ids) {
      const row = (await client.query<{ id: number; note_id: number; path: string; start_line: number; end_line: number; lines: unknown; state: string; thread_id: number | null; thread_resolved: boolean; thread_outdated: boolean }>(
        `SELECT s.id, s.note_id, s.path, s.start_line, s.end_line, s.lines, s.state, n.thread_id,
           t.resolved AS thread_resolved, t.outdated AS thread_outdated
         FROM suggestions s JOIN notes n ON n.id = s.note_id LEFT JOIN threads t ON t.id = n.thread_id
         WHERE s.id = $1 AND n.mr_id = $2`, [sid, mr.id])).rows[0];
      if (!row) throw errs.notFound();
      suggestions.push(row);
    }
    // check order: outdated, overlap, applied, thread resolved
    for (const s of suggestions) {
      if (s.thread_outdated || s.state === 'outdated') {
        throw new AppError(409, 'suggestion_outdated', 'This suggestion is outdated: the lines changed.');
      }
      if (s.state === 'applied') {
        throw new AppError(409, 'suggestion_applied', 'This suggestion was already applied.');
      }
      if (s.thread_resolved) {
        throw new AppError(409, 'thread_resolved', 'This thread is resolved.');
      }
    }
    // overlap check by path and lines
    const byPath = new Map<string, Array<{ start: number; end: number }>>();
    for (const s of suggestions) {
      if (!byPath.has(s.path)) byPath.set(s.path, []);
      byPath.get(s.path)!.push({ start: s.start_line, end: s.end_line });
    }
    for (const [path, ranges] of byPath) {
      const sorted = [...ranges].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start <= sorted[i - 1].end) {
          throw new AppError(409, 'suggestion_overlap', `These suggestions overlap: ${path} lines ${sorted[i - 1].start}-${sorted[i - 1].end}.`);
        }
      }
    }
    // apply
    let files = new Map(await filesOf(client, rc.ctx, version.head));
    const paths = new Set(suggestions.map((s) => s.path));
    for (const s of suggestions) {
      files = applySuggestion(files, s.path, s.start_line, s.end_line, s.lines as string[]);
    }
    const { buildTreeFromFiles, storeCommit } = await import('../domain/repo.js');
    const tree = await buildTreeFromFiles(client, files, rc.ctx.settings.inlineMaxBytes);
    const now = Math.floor(rc.ctx.now() / 1000);
    const message = suggestions.length === 1
      ? `Apply suggestion to ${suggestions[0].path}`
      : `Apply ${suggestions.length} suggestions to ${paths.size} files`;
    const commitId = await storeCommit(client, {
      tree,
      parents: [version.head],
      author: rc.user.username,
      author_time: now,
      committer: rc.user.username,
      commit_time: now,
      message,
    });
    await client.query(`UPDATE refs SET commit_id = $3 WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [id, mr.source, commitId]);
    // resolve each suggestion's thread
    for (const s of suggestions) {
      await client.query(`UPDATE suggestions SET state = 'applied' WHERE id = $1`, [s.id]);
      if (s.thread_id) {
        await client.query(`UPDATE threads SET resolved = true WHERE id = $1`, [s.thread_id]);
      }
    }
    const push = await pushConsequences(rc.ctx, client, {
      projectId: id, projectPath: project.path, branch: mr.source, previousHead: version.head, newHead: commitId,
      defaultBranch: project.default_branch, resetApprovalsOnPush: project.reset_approvals_on_push,
      autoResolveOutdated: project.auto_resolve_outdated, actor: rc.user.username,
    });
    await client.query('COMMIT');
    return { commit: commitId, seq: push.seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function submitReview(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const summary = typeof body.summary === 'string' ? body.summary : null;
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'reporter');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const pending = (await client.query<{ id: number }>(`SELECT id FROM notes WHERE mr_id = $1 AND author = $2 AND pending = true`, [mr.id, rc.user.username])).rows;
    const published = pending.length;
    await client.query(`UPDATE notes SET pending = false WHERE mr_id = $1 AND author = $2 AND pending = true`, [mr.id, rc.user.username]);
    if (summary !== null && summary !== '') {
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, false, false, $4, $5)`,
        [id, rc.user.username, summary, mr.id, rc.ctx.now()]);
    }
    const seq = await rc.ctx.live(client, id, 'review', { mr_iid: iid, published });
    await client.query('COMMIT');
    return { published, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function discardReview(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'reporter');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    await client.query(`DELETE FROM notes WHERE mr_id = $1 AND author = $2 AND pending = true`, [mr.id, rc.user.username]);
    await client.query('COMMIT');
    return null;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function moveThreadsToIssue(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'reporter');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const open = (await client.query(`SELECT t.id, t.path, t.old_line, t.new_line, t.end_line FROM threads t WHERE t.mr_id = $1 AND t.resolved = false`, [mr.id])).rows;
    const now = rc.ctx.now();
    const newIid = await (await import('./common.js')).nextIid(client, id, 'issue');
    const title = `Threads from !${iid}`;
    let description = '';
    for (const t of open) {
      const notes = (await client.query<{ author: string; body: string }>(`SELECT author, body FROM notes WHERE thread_id = $1 ORDER BY id`, [t.id])).rows;
      for (const n of notes) {
        const linePart = t.path ? ` (${t.path} line ${t.new_line ?? t.old_line ?? 0})` : '';
        description += `> ${n.body}${linePart} — @${n.author}\n\n`;
      }
    }
    const issueR = await client.query<{ id: number }>(`INSERT INTO issues (project_id, iid, title, description, state, author_id, confidential, created_at, updated_at) VALUES ($1, $2, $3, $4, 'opened', $5, false, $6, $6) RETURNING id`,
      [id, newIid, title, description, rc.user.id, now]);
    for (const t of open) {
      await client.query(`UPDATE threads SET resolved = true WHERE id = $1`, [t.id]);
    }
    const n = open.length;
    await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
      [id, rc.user.username, n === 1 ? `Moved 1 thread to #${newIid}.` : `Moved ${n} threads to #${newIid}.`, mr.id, now]);
    const seq = await rc.ctx.live(client, id, 'issue', { iid: newIid, event: 'opened' });
    await rc.ctx.live(client, id, 'thread', { mr_iid: iid, event: 'moved' });
    await client.query('COMMIT');
    return { issue_iid: newIid, moved: n, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function rebaseMr(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const version = await latestVersion(client, mr.id);
    if (!version) throw errs.notFound();
    const sourceHead = version.head;
    const targetHead = await branchHead(client, id, mr.target);
    if (!targetHead) throw errs.notFound();
    if (await isAncestor(client, targetHead, sourceHead)) {
      throw new AppError(409, 'wrong_state', 'Source branch is already up to date.');
    }
    const base = await mergeBase(client, sourceHead, targetHead);
    if (!base) throw new AppError(409, 'merge_blocked', `Source branch has conflicts with ${mr.target}.`);
    // replay commits after base
    const { commitsBetween } = await import('../domain/merge-service.js');
    const toReplay = (await commitsBetween(client, base, sourceHead)).reverse();
    const baseFiles = await filesOf(client, rc.ctx, base);
    let replayFiles = new Map(baseFiles);
    let parent = targetHead;
    for (const cid of toReplay) {
      const commit = (await import('../domain/repo.js')).getCommit;
      const cm = await commit(client, cid);
      if (!cm) throw errs.notFound();
      const cmFiles = await filesOf(client, rc.ctx, cid);
      const parentFiles = cm.parents[0] ? await filesOf(client, rc.ctx, cm.parents[0]) : new Map();
      const result = new Map(replayFiles);
      const conflicted: string[] = [];
      for (const path of new Set([...parentFiles.keys(), ...cmFiles.keys()])) {
        const before = parentFiles.get(path) ?? null;
        const after = cmFiles.get(path) ?? null;
        const targetCurrent = replayFiles.get(path) ?? null;
        if (before === after) continue;
        const res = mergeFileStates(before, targetCurrent, after, mr.target, mr.source);
        if (res.conflict) conflicted.push(path);
        if (res.content !== null) result.set(path, res.content);
        else result.delete(path);
      }
      if (conflicted.length > 0) {
        throw new AppError(409, 'rebase_conflict', `Rebase stopped at ${short(cid)}: ${conflicted.sort()[0]} conflicts.`);
      }
      const { buildTreeFromFiles, storeCommit } = await import('../domain/repo.js');
      const tree = await buildTreeFromFiles(client, result, rc.ctx.settings.inlineMaxBytes);
      const newId = await storeCommit(client, {
        tree,
        parents: [parent],
        author: cm.author,
        author_time: cm.author_time,
        committer: rc.user.username,
        commit_time: Math.floor(rc.ctx.now() / 1000),
        message: cm.message,
      });
      replayFiles = result;
      parent = newId;
    }
    await client.query(`UPDATE refs SET commit_id = $3 WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [id, mr.source, parent]);
    await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
      [id, rc.user.username, `Rebased onto ${mr.target} at ${short(parent)}.`, mr.id, rc.ctx.now()]);
    const push = await pushConsequences(rc.ctx, client, {
      projectId: id, projectPath: project.path, branch: mr.source, previousHead: sourceHead, newHead: parent,
      defaultBranch: project.default_branch, resetApprovalsOnPush: project.reset_approvals_on_push,
      autoResolveOutdated: project.auto_resolve_outdated, actor: rc.user.username,
    });
    await client.query('COMMIT');
    return { source_head: parent, seq: push.seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function setAutoMerge(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  return autoMergeImpl(rc, true);
}

export async function cancelAutoMerge(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  return autoMergeImpl(rc, false);
}

async function autoMergeImpl(rc: RequestCtx, enable: boolean): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const actor = rc.user.username;
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const now = rc.ctx.now();
    if (enable) {
      const checks = await buildChecks(rc, client, project, mr);
      const failed = firstFailedCheck(checks.checks);
      if (failed && failed.name !== 'pipeline') {
        throw new AppError(409, 'merge_blocked', failed.text);
      }
      await client.query(`UPDATE merge_requests SET auto_merge = true WHERE id = $1`, [mr.id]);
    } else {
      await client.query(`UPDATE merge_requests SET auto_merge = false, auto_merge_reason = $2 WHERE id = $1`, [mr.id, `canceled by ${actor}`]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
        [id, 'system', `Auto-merge canceled: canceled by ${actor}.`, mr.id, now]);
    }
    const seq = await rc.ctx.live(client, id, 'merge_request', { iid, event: 'auto_merge' });
    await client.query('COMMIT');
    return { auto_merge: enable, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function addMrToTrain(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    if (!project.merge_trains) {
      throw new AppError(409, 'wrong_state', 'Merge trains are off.');
    }
    const checks = await buildChecks(rc, client, project, mr);
    const failed = firstFailedCheck(checks.checks);
    if (failed && failed.name !== 'pipeline') {
      throw new AppError(409, 'merge_blocked', failed.text);
    }
    const { addToTrain } = await import('../domain/train.js');
    const result = await addToTrain(rc.ctx, client, id, project.path, mr, project.default_branch);
    const seq = await rc.ctx.live(client, id, 'train', { target: mr.target, event: 'added', iid, position: result.position, sha: result.sha });
    await client.query('COMMIT');
    return { position: result.position, sha: result.sha, pipeline_id: result.pipelineId, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function removeMrFromTrain(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    // own request or maintainer
    if (mr.author_id !== rc.user.id) requireMinRole(access, 'maintainer');
    const { removeFromTrain } = await import('../domain/train.js');
    await removeFromTrain(rc.ctx, client, id, project.path, mr, `removed by ${rc.user.username}`, project.default_branch);
    const seq = await rc.ctx.currentSeq(client, id);
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function mergeNow(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    if (mr.state === 'merged') throw new AppError(409, 'wrong_state', 'This merge request is already merged.');
    const merge = await computeMerge(rc.ctx, client, mr, project.merge_method, rc.user.username);
    if (merge.conflicts.length > 0 || merge.commitId === null) {
      throw new AppError(409, 'merge_blocked', `Source branch has conflicts with ${mr.target}.`);
    }
    const now = rc.ctx.now();
    await client.query(`UPDATE merge_requests SET state = 'merged', merged_at = $2, merge_commit = $3, updated_at = $2 WHERE id = $1`, [mr.id, now, merge.commitId]);
    await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
      [id, rc.user.username, `Merged by @${rc.user.username} into ${mr.target}.`, mr.id, now]);
    await client.query(`DELETE FROM train_cars WHERE mr_id = $1`, [mr.id]);
    if (mr.delete_source_branch) {
      await client.query(`DELETE FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [id, mr.source]);
    }
    await createPipeline(rc.ctx, client, { projectId: id, projectPath: project.path, ref: mr.target, sha: merge.commitId as string, source: 'push', defaultBranch: project.default_branch });
    await (await import('../domain/merge-journey.js')).closeIssuesForMerge(rc.ctx, client, project, mr, merge.commitId as string, rc.user.username);
    await (await import('../domain/merge-journey.js')).retargetStacked(rc.ctx, client, project, mr, rc.ctx.settings.retargetLimit);
    await client.query('COMMIT');
    const seq = await rc.ctx.currentSeq(client, id);
    return { state: 'merged', merge_commit: merge.commitId, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function getTrain(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const target = rc.query.get('target') ?? '';
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const { carsFor } = await import('../domain/train.js');
    const cars = await carsFor(client, id, target);
    const out = [];
    for (const car of cars) {
      const status = car.pipeline_id ? (await client.query<{ status: string }>(`SELECT status FROM pipelines WHERE id = $1`, [car.pipeline_id])).rows[0]?.status ?? null : null;
      out.push({ iid: car.iid, position: car.position, sha: car.sha, pipeline_id: car.pipeline_id, pipeline_status: status });
    }
    return { target, cars: out };
  } finally {
    client.release();
  }
}

export { isAncestor };
