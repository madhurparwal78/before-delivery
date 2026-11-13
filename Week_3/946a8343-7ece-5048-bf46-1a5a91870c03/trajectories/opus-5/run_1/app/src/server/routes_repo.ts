import { levelOf, readableProject, requireLevel, roleLevels } from './access';
import { db } from './db';
import { diffTrees, fileDiff, splitLines } from './diff';
import { ApiError, errors } from './errors';
import { Ctx, Reply, param, route, text } from './http';
import { seqOf, tx } from './live';
import { CommitAction, commitToBranch } from './push';
import {
  assertCanPush,
  isProtectedBranch,
  protectedBranchError,
  tagProtectionFor,
} from './pushrules';
import {
  blame,
  branchHead,
  filesOfCommit,
  filesOfTree,
  findCommit,
  historyFor,
  loadCommit,
  mergeBase,
  readTree,
  resolveRef,
  setBranch,
  shortId,
} from './repo';

route('GET', '/api/projects/:id/refs', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const rows = await db.query<{ kind: string; name: string; commit_id: string; message: string | null }>(
    'select kind, name, commit_id, message from refs where project_id = $1 order by kind, name',
    [project.id],
  );
  const branches: Record<string, unknown>[] = [];
  for (const row of rows.filter((item) => item.kind === 'branch')) {
    branches.push({
      name: row.name,
      commit: row.commit_id,
      protected: await isProtectedBranch(db, project.id, row.name),
    });
  }
  return {
    status: 200,
    body: {
      branches,
      tags: rows
        .filter((item) => item.kind === 'tag')
        .map((row) => ({ name: row.name, commit: row.commit_id, message: row.message ?? '' })),
    },
  };
});

route(
  'POST',
  '/api/projects/:id/branches',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const name = text(ctx.body, 'name') ?? '';
      const ref = text(ctx.body, 'ref') ?? project.default_branch;
      const head = await resolveRef(t.sql, project.id, ref);
      if (head === null) throw errors.notFound();
      await assertCanPush(t.sql, project, access, name);
      await setBranch(t, project.id, name, head);
      return { status: 201, body: { name, commit: head, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'DELETE',
  '/api/projects/:id/branches/:name',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const name = ctx.params.name;
      if (await isProtectedBranch(t.sql, project.id, name)) throw protectedBranchError(name, 'delete');
      await t.sql.query("delete from refs where project_id = $1 and kind = 'branch' and name = $2", [project.id, name]);
      return { status: 204, body: null };
    }),
  { write: true },
);

route(
  'POST',
  '/api/projects/:id/tags',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const name = text(ctx.body, 'name') ?? '';
      const ref = text(ctx.body, 'ref') ?? project.default_branch;
      const message = text(ctx.body, 'message') ?? '';
      const protection = await tagProtectionFor(t.sql, project.id, name);
      if (protection !== null && access.level < levelOf(protection.allowed_to_create)) {
        throw new ApiError(403, 'protected_tag', `You can't create protected tag ${name}.`);
      }
      const head = await resolveRef(t.sql, project.id, ref);
      if (head === null) throw errors.notFound();
      await t.sql.query(
        `insert into refs (project_id, kind, name, commit_id, message) values ($1, 'tag', $2, $3, $4)
         on conflict (project_id, kind, name) do update set commit_id = $3, message = $4`,
        [project.id, name, head, message],
      );
      return { status: 201, body: { name, commit: head, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/tree', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const ref = ctx.url.searchParams.get('ref') ?? project.default_branch;
  const path = ctx.url.searchParams.get('path') ?? '';
  const head = await resolveRef(db, project.id, ref);
  if (head === null) return { status: 200, body: { id: null, entries: [] } };
  const commit = await loadCommit(db, project.id, head);
  let treeId = commit.tree;
  if (path !== '') {
    for (const segment of path.split('/').filter((part) => part !== '')) {
      const entries = await readTree(db, project.id, treeId);
      const found = entries.find((entry) => entry.name === segment && entry.type === 'tree');
      if (found === undefined) throw errors.notFound();
      treeId = found.id;
    }
  }
  const entries = await readTree(db, project.id, treeId);
  return { status: 200, body: { id: treeId, entries } };
});

route('GET', '/api/projects/:id/files', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const ref = ctx.url.searchParams.get('ref') ?? project.default_branch;
  const path = ctx.url.searchParams.get('path') ?? '';
  const head = await resolveRef(db, project.id, ref);
  if (head === null) throw errors.notFound();
  const files = await filesOfCommit(db, project.id, head);
  const content = files.get(path);
  if (content === undefined) throw errors.notFound();
  const { hashBlob } = await import('./repo');
  return {
    status: 200,
    body: { path, blob: hashBlob(content), size: Buffer.byteLength(content, 'utf8'), content },
  };
});

route('GET', '/api/projects/:id/commits', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const ref = ctx.url.searchParams.get('ref') ?? project.default_branch;
  const path = ctx.url.searchParams.get('path');
  const head = await resolveRef(db, project.id, ref);
  if (head === null) return { status: 200, body: { commits: [] } };
  const commits = await historyFor(db, project.id, head, path === null || path === '' ? null : path);
  return {
    status: 200,
    body: {
      commits: commits.map((commit) => ({
        id: commit.id,
        parents: commit.parents,
        author: commit.author,
        authored_at: new Date(commit.authored_at * 1000).toISOString(),
        committer: commit.committer,
        committed_at: new Date(commit.committed_at * 1000).toISOString(),
        message: commit.message,
      })),
    },
  };
});

route('GET', '/api/projects/:id/commits/:commit', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const id = await resolveRef(db, project.id, ctx.params.commit);
  if (id === null) throw errors.notFound();
  const commit = await loadCommit(db, project.id, id);
  const parent = commit.parents.length > 0 ? await findCommit(db, project.id, commit.parents[0]) : null;
  const before = parent === null ? new Map<string, string>() : await filesOfTree(db, project.id, parent.tree);
  const after = await filesOfTree(db, project.id, commit.tree);
  return {
    status: 200,
    body: {
      id: commit.id,
      parents: commit.parents,
      author: commit.author,
      authored_at: new Date(commit.authored_at * 1000).toISOString(),
      committer: commit.committer,
      committed_at: new Date(commit.committed_at * 1000).toISOString(),
      message: commit.message,
      tree: commit.tree,
      diffs: diffTrees(before, after),
    },
  };
});

route('GET', '/api/projects/:id/blame', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const ref = ctx.url.searchParams.get('ref') ?? project.default_branch;
  const path = ctx.url.searchParams.get('path') ?? '';
  const head = await resolveRef(db, project.id, ref);
  if (head === null) throw errors.notFound();
  return { status: 200, body: { lines: await blame(db, project.id, head, path) } };
});

route('GET', '/api/projects/:id/compare', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const from = ctx.url.searchParams.get('from') ?? project.default_branch;
  const to = ctx.url.searchParams.get('to') ?? project.default_branch;
  const fromId = await resolveRef(db, project.id, from);
  const toId = await resolveRef(db, project.id, to);
  if (fromId === null || toId === null) throw errors.notFound();
  const base = (await mergeBase(db, project.id, fromId, toId)) ?? fromId;
  const beforeFiles = await filesOfCommit(db, project.id, base);
  const afterFiles = await filesOfCommit(db, project.id, toId);
  const commits = await historyFor(db, project.id, toId, null);
  const baseReach = await (await import('./repo')).ancestors(db, project.id, base);
  return {
    status: 200,
    body: {
      merge_base: base,
      commits: commits
        .filter((commit) => !baseReach.has(commit.id))
        .map((commit) => ({
          id: commit.id,
          parents: commit.parents,
          author: commit.author,
          authored_at: new Date(commit.authored_at * 1000).toISOString(),
          committer: commit.committer,
          committed_at: new Date(commit.committed_at * 1000).toISOString(),
          message: commit.message,
        })),
      diffs: diffTrees(beforeFiles, afterFiles),
    },
  };
});

route('GET', '/api/projects/:id/expand', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const ref = ctx.url.searchParams.get('ref') ?? project.default_branch;
  const path = ctx.url.searchParams.get('path') ?? '';
  const head = await resolveRef(db, project.id, ref);
  if (head === null) throw errors.notFound();
  const files = await filesOfCommit(db, project.id, head);
  const content = files.get(path) ?? '';
  return { status: 200, body: { path, lines: splitLines(content) } };
});

function readActions(body: Record<string, unknown>): CommitAction[] {
  const raw = body.actions;
  if (!Array.isArray(raw)) throw errors.validation('actions', 'Give at least one action.');
  return raw.map((item) => {
    const action = item as Record<string, unknown>;
    return {
      action: String(action.action) as CommitAction['action'],
      path: String(action.path ?? ''),
      content: action.content === undefined || action.content === null ? undefined : String(action.content),
      previous_path:
        action.previous_path === undefined || action.previous_path === null ? undefined : String(action.previous_path),
    };
  });
}

route(
  'POST',
  '/api/projects/:id/commits',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      if (access.level < roleLevels.developer) throw errors.forbidden();
      const branch = text(ctx.body, 'branch') ?? project.default_branch;
      const result = await commitToBranch(t, {
        project,
        access,
        actor: ctx.user.username,
        branch,
        startRef: text(ctx.body, 'start_ref'),
        baseCommit: text(ctx.body, 'base_commit'),
        message: text(ctx.body, 'message') ?? '',
        actions: readActions(ctx.body),
      });
      return {
        status: 201,
        body: {
          commit: result.commit,
          short: shortId(result.commit),
          seq: await seqOf(t, project.id),
          pipeline: 'id' in result.pipeline ? { id: result.pipeline.id } : result.pipeline,
        },
      };
    }),
  { write: true, limit: 'commit', idempotent: true },
);

route('GET', '/api/projects/:id/diff', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const path = ctx.url.searchParams.get('path') ?? '';
  const from = ctx.url.searchParams.get('from') ?? '';
  const to = ctx.url.searchParams.get('to') ?? '';
  const fromId = await resolveRef(db, project.id, from);
  const toId = await resolveRef(db, project.id, to);
  if (fromId === null || toId === null) throw errors.notFound();
  const before = (await filesOfCommit(db, project.id, fromId)).get(path) ?? null;
  const after = (await filesOfCommit(db, project.id, toId)).get(path) ?? null;
  return { status: 200, body: { diff: fileDiff(path, before, after) } };
});

route('GET', '/api/projects/:id/branch_head', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const name = ctx.url.searchParams.get('name') ?? project.default_branch;
  const head = await branchHead(db, project.id, name);
  return { status: 200, body: { name, commit: head } };
});
