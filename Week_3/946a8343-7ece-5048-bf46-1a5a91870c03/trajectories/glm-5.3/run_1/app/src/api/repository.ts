import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, requireReadCode, writeAudit, projectByPath, groupByPath, canReadGroup } from './common.js';
import { effectiveAccess, groupAccess, ROLE_LEVEL } from '../domain/access.js';
import {
  applyCommit, branchHead, resolveRef, treeFiles, ProtectionRequired,
} from '../domain/repo-service.js';
import { getCommit, readTreeFlat, readTreeFull, splitLines, firstParentChain, mergeBase } from '../domain/repo.js';
import { diffLines, diffFiles } from '../domain/diff.js';
import { pushConsequences } from '../domain/push-consequences.js';
import { pushProtectionVerdict } from '../domain/repo-service.js';
import { filesOf } from '../domain/merge-service.js';

export async function listRefs(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const branches = (await client.query<{ name: string; commit_id: string }>(`SELECT name, commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' ORDER BY name`, [id])).rows;
    const prots = (await client.query<{ pattern: string }>(`SELECT pattern FROM protected_branches WHERE project_id = $1`, [id])).rows;
    const tags = (await client.query<{ name: string; commit_id: string }>(`SELECT name, commit_id FROM refs WHERE project_id = $1 AND kind = 'tag' ORDER BY name`, [id])).rows;
    const tagMeta = (await client.query<{ name: string; message: string | null }>(`SELECT name, message FROM tags_meta WHERE project_id = $1`, [id])).rows;
    return {
      branches: branches.map((b) => ({
        name: b.name,
        commit: b.commit_id,
        protected: prots.some((p) => new RegExp(`^${p.pattern.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(b.name)),
      })),
      tags: tags.map((t) => ({ name: t.name, commit: t.commit_id, message: tagMeta.find((m) => m.name === t.name)?.message ?? '' })),
    };
  } finally {
    client.release();
  }
}

export async function createBranch(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const name = typeof body.name === 'string' ? body.name : '';
  const ref = typeof body.ref === 'string' ? body.ref : '';
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    if (name === '') throw errs.validation({ name: "Name can't be blank." });
    const head = await resolveRef(client, id, ref);
    if (!head) throw errs.validation({ ref: `Ref ${ref} doesn't exist.` });
    const existing = await branchHead(client, id, name);
    if (existing) throw new AppError(422, 'validation', `Branch ${name} already exists.`, { fields: { name: `Branch ${name} already exists.` } });
    await client.query(`INSERT INTO refs (project_id, kind, name, commit_id) VALUES ($1, 'branch', $2, $3)`, [id, name, head]);
    const seq = await rc.ctx.live(client, id, 'version', { branch: name, head });
    await client.query('COMMIT');
    return { name, commit: head, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteBranch(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const name = rc.params.name;
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const { protectionFor } = await import('../domain/push-rules.js');
    const prot = await protectionFor(client, id, name);
    if (prot) throw new AppError(403, 'protected_branch', `You can't delete protected branch ${name}.`);
    const existing = await branchHead(client, id, name);
    if (!existing) throw errs.notFound();
    await client.query(`DELETE FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [id, name]);
    await client.query('COMMIT');
    return null;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function createTag(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const name = typeof body.name === 'string' ? body.name : '';
  const ref = typeof body.ref === 'string' ? body.ref : '';
  const message = typeof body.message === 'string' ? body.message : '';
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'maintainer');
    const head = await resolveRef(client, id, ref);
    if (!head) throw errs.validation({ ref: `Ref ${ref} doesn't exist.` });
    const { tagProtectionVerdict } = await import('../domain/repo-service.js');
    const verdict = await tagProtectionVerdict(client, id, name, access.role);
    if (!verdict.ok) throw new AppError(verdict.status ?? 403, verdict.code ?? 'protected_tag', verdict.message ?? '');
    const existing = await resolveRef(client, id, name);
    if (existing) throw new AppError(422, 'validation', `Tag ${name} already exists.`, { fields: { name: `Tag ${name} already exists.` } });
    await client.query(`INSERT INTO refs (project_id, kind, name, commit_id) VALUES ($1, 'tag', $2, $3)`, [id, name, head]);
    await client.query(`INSERT INTO tags_meta (project_id, name, message) VALUES ($1, $2, $3)`, [id, name, message]);
    await client.query('COMMIT');
    return { name, commit: head };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function getTree(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const ref = rc.query.get('ref') ?? '';
  const path = rc.query.get('path') ?? '';
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const head = await resolveRef(client, id, ref);
    if (!head) throw errs.notFound();
    const commit = await getCommit(client, head);
    if (!commit) throw errs.notFound();
    const treeId = await treeIdAtPath(client, rc.ctx, head, path);
    if (!treeId) throw errs.notFound();
    const entries = (await client.query<{ entries: unknown }>(`SELECT entries FROM trees WHERE id = $1`, [treeId])).rows[0];
    if (!entries) throw errs.notFound();
    const list = entries.entries as Array<{ name: string; mode: string; id: string; type: string }>;
    return { id: treeId, entries: list.map((e) => ({ name: e.name, mode: e.mode, id: e.id, type: e.type })) };
  } finally {
    client.release();
  }
}

async function treeIdAtPath(c: import('pg').PoolClient, ctx: import('../api/ctx.js').Ctx, commitId: string, path: string): Promise<string | null> {
  const commit = await getCommit(c, commitId);
  if (!commit) return null;
  if (path === '') return commit.tree;
  const files = await readTreeFlat(c, commit.tree);
  // walk to the tree containing the path
  const segs = path.split('/');
  let treeId = commit.tree;
  for (const seg of segs) {
    const entries = (await c.query<{ entries: Array<{ name: string; mode: string; id: string; type: string }> }>(`SELECT entries FROM trees WHERE id = $1`, [treeId])).rows[0];
    if (!entries) return null;
    const entry = entries.entries.find((e) => e.name === seg);
    if (!entry) return null;
    if (entry.type !== 'tree') return null;
    treeId = entry.id;
  }
  void ctx;
  return treeId;
}

export async function getFile(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const ref = rc.query.get('ref') ?? '';
  const path = rc.query.get('path') ?? '';
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const head = await resolveRef(client, id, ref);
    if (!head) throw errs.notFound();
    const files = await filesOf(client, rc.ctx, head);
    const content = files.get(path);
    if (content === undefined) throw errs.notFound();
    const { blobId } = await import('../domain/repo.js');
    return { path, blob: blobId(content), size: Buffer.byteLength(content, 'utf8'), content };
  } finally {
    client.release();
  }
}

export async function listCommits(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const ref = rc.query.get('ref') ?? '';
  const path = rc.query.get('path') ?? '';
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const head = await resolveRef(client, id, ref);
    if (!head) throw errs.notFound();
    const chain = await firstParentChain(client, head);
    const out = [];
    for (const commit of chain) {
      if (path !== '') {
        const cur = (await readTreeFlat(client, commit.tree)).get(path);
        const parent = commit.parents[0] ? await getCommit(client, commit.parents[0]) : null;
        const prev = parent ? (await readTreeFlat(client, parent.tree)).get(path) : undefined;
        if (cur === prev) continue;
      }
      out.push({
        id: commit.id,
        parents: commit.parents,
        author: commit.author,
        authored_at: commit.author_time,
        committer: commit.committer,
        committed_at: commit.commit_time,
        message: commit.message,
      });
    }
    return { commits: out };
  } finally {
    client.release();
  }
}

export async function getOneCommit(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const commitId = rc.params.commit;
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const commit = await getCommit(client, commitId);
    if (!commit) throw errs.notFound();
    const files = await filesOf(client, rc.ctx, commit.id);
    const parent = commit.parents[0] ? await getCommit(client, commit.parents[0]) : null;
    const parentFiles = parent ? await filesOf(client, rc.ctx, parent.id) : new Map<string, string>();
    const diffs = [];
    for (const path of new Set([...parentFiles.keys(), ...files.keys()])) {
      const a = parentFiles.get(path) ?? '';
      const b = files.get(path) ?? '';
      if (a === b && parentFiles.has(path) === files.has(path)) continue;
      diffs.push({ path, old_path: path, status: !parentFiles.has(path) ? 'added' : !files.has(path) ? 'deleted' : 'modified', hunks: diffLines(a, b) });
    }
    return {
      id: commit.id,
      parents: commit.parents,
      author: commit.author,
      authored_at: commit.author_time,
      committer: commit.committer,
      committed_at: commit.commit_time,
      message: commit.message,
      tree: commit.tree,
      diffs,
    };
  } finally {
    client.release();
  }
}

export async function getBlame(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const ref = rc.query.get('ref') ?? '';
  const path = rc.query.get('path') ?? '';
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const head = await resolveRef(client, id, ref);
    if (!head) throw errs.notFound();
    const chain = await firstParentChain(client, head);
    const contents = new Map<string, string>();
    for (const commit of chain) {
      const files = await filesOf(client, rc.ctx, commit.id);
      contents.set(commit.id, files.get(path) ?? '');
    }
    const headText = contents.get(chain[0].id) ?? '';
    const lines = splitLines(headText);
    const lineCommits: string[] = [];
    let currentAssign: string[] = new Array(lines.length).fill('');
    for (const commit of chain.reverse()) {
      const text = contents.get(commit.id) ?? '';
      const d = diffLines(text, headText);
      const committed = new Set<number>();
      for (const l of d) {
        if (l.type === 'add' && l.new !== null) committed.add(l.new);
        if (l.type === 'context' && l.new !== null) committed.add(l.new);
      }
      for (let i = 0; i < lines.length; i++) {
        if (committed.has(i + 1) && currentAssign[i] === '') {
          currentAssign[i] = commit.id;
        }
      }
    }
    void lineCommits;
    const out = lines.map((text, i) => {
      const commit = chain.find((c) => c.id === currentAssign[i]) ?? chain[0];
      return { line: i + 1, commit: commit.id, author: commit.author, text };
    });
    return { lines: out };
  } finally {
    client.release();
  }
}

export async function compareRefs(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const from = rc.query.get('from') ?? '';
  const to = rc.query.get('to') ?? '';
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const fromHead = await resolveRef(client, id, from);
    const toHead = await resolveRef(client, id, to);
    if (!fromHead || !toHead) throw errs.notFound();
    const base = await mergeBase(client, fromHead, toHead);
    const fromFiles = await filesOf(client, rc.ctx, fromHead);
    const toFiles = await filesOf(client, rc.ctx, toHead);
    const diffs = [];
    for (const path of new Set([...fromFiles.keys(), ...toFiles.keys()])) {
      const a = fromFiles.get(path) ?? '';
      const b = toFiles.get(path) ?? '';
      if (a === b && fromFiles.has(path) === toFiles.has(path)) continue;
      diffs.push({ path, old_path: path, status: !fromFiles.has(path) ? 'added' : !toFiles.has(path) ? 'deleted' : 'modified', hunks: diffLines(a, b) });
    }
    // commits between
    const commits = [];
    const seen = new Set<string>();
    const stack = [toHead];
    const fromReach = new Set<string>();
    const stack2 = [fromHead];
    while (stack2.length > 0) {
      const cid = stack2.pop()!;
      if (fromReach.has(cid)) continue;
      fromReach.add(cid);
      const cm = await getCommit(client, cid);
      if (cm) stack2.push(...cm.parents);
    }
    while (stack.length > 0) {
      const cid = stack.pop()!;
      if (seen.has(cid)) continue;
      seen.add(cid);
      if (fromReach.has(cid)) continue;
      const cm = await getCommit(client, cid);
      if (!cm) continue;
      commits.push({ id: cm.id, parents: cm.parents, author: cm.author, authored_at: cm.author_time, committer: cm.committer, committed_at: cm.commit_time, message: cm.message });
      stack.push(...cm.parents);
    }
    commits.sort((a, b) => b.committed_at - a.committed_at);
    return { merge_base: base, commits, diffs };
  } finally {
    client.release();
  }
}

/** The commit API: one request, one commit, all-or-nothing. */
export async function postCommit(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const branch = typeof body.branch === 'string' ? body.branch : '';
  const startRef = typeof body.start_ref === 'string' ? body.start_ref : undefined;
  const baseCommit = typeof body.base_commit === 'string' ? body.base_commit : null;
  const message = typeof body.message === 'string' ? body.message : '';
  const actions = Array.isArray(body.actions) ? body.actions : [];
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    const previousHead = await branchHead(client, id, branch);
    // protection verdict first
    const verdict = await pushProtectionVerdict(client, id, branch, access.role, access.permissions.has('push_protected'));
    if (!verdict.ok) throw new AppError(verdict.status ?? 403, verdict.code ?? 'protected_branch', verdict.message ?? '');
    const isNew = previousHead === null;
    if (isNew) {
      requireMinRole(access, 'developer');
    } else {
      requireMinRole(access, 'developer');
    }
    const result = await applyCommit(rc.ctx, client, id, {
      branch,
      start_ref: startRef ?? null,
      base_commit: baseCommit,
      message,
      actions: actions.map((a) => {
        const act = a as Record<string, unknown>;
        return {
          action: String(act.action) as 'create' | 'update' | 'delete' | 'move',
          path: String(act.path ?? ''),
          content: act.content === undefined ? undefined : String(act.content),
          previous_path: act.previous_path === undefined ? undefined : String(act.previous_path),
        };
      }),
      author: rc.user.username,
    }, { bypassProtection: true, bypassPushRules: false });
    const push = await pushConsequences(rc.ctx, client, {
      projectId: id,
      projectPath: project.path,
      branch,
      previousHead,
      newHead: result.id,
      defaultBranch: project.default_branch,
      resetApprovalsOnPush: project.reset_approvals_on_push,
      autoResolveOutdated: project.auto_resolve_outdated,
      actor: rc.user.username,
    });
    const seq = push.pipeline.created && push.pipeline.id
      ? await rc.ctx.live(client, id, 'pipeline', { pipeline_id: push.pipeline.id, status: 'running' })
      : await rc.ctx.currentSeq(client, id);
    await client.query('COMMIT');
    return {
      commit: result.id,
      seq,
      pipeline: push.pipeline.created && push.pipeline.id ? { id: push.pipeline.id } : { created: false, reason: push.pipeline.reason },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export { loadProject, projectByPath, groupByPath, canReadGroup, effectiveAccess, groupAccess, ROLE_LEVEL, diffFiles, ProtectionRequired };
