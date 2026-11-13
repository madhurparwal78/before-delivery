import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, groupById, groupByPath } from './common.js';
import { ROLE_LEVEL, groupAccess } from '../domain/access.js';
import { getCommit, readTreeFull, storeCommit, storeTree, blobId, splitLines } from '../domain/repo.js';
import { RECORD_FIELD_COUNTS, recordLine, parsePackLine, encodeBool, encodeList, encodeOptional, encodeOptionalInt } from '../domain/spurpack.js';
import { commitIdOf, treeIdOf } from '../domain/repo.js';
import { progressJob } from './progress.js';

export async function startExport(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'owner');
    const now = rc.ctx.now();
    const r = await client.query<{ id: number }>(`INSERT INTO exports (project_id, status, progress, created_at) VALUES ($1, 'running', 0, $2) RETURNING id`, [id, now]);
    const seq = await rc.ctx.live(client, id, 'export', { id: r.rows[0].id, progress: 0, status: 'running' });
    await client.query('COMMIT');
    progressJob.scheduleExport(rc.ctx, r.rows[0].id, id);
    return { id: r.rows[0].id, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function getExport(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const row = (await client.query<{ id: number; project_id: number; status: string; progress: number; error: string | null; object_key: string | null }>(`SELECT id, project_id, status, progress, error, object_key FROM exports WHERE id = $1`, [id])).rows[0];
    if (!row) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, row.project_id, rc.user.id);
    requireMinRole(access, 'owner');
    return {
      status: row.status,
      progress: row.progress,
      error: row.error,
      download: row.object_key !== null && row.status === 'finished' ? `/api/exports/${id}/file` : null,
    };
  } finally {
    client.release();
  }
}

export async function downloadExport(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const row = (await client.query<{ project_id: number; object_key: string | null; status: string }>(`SELECT project_id, object_key, status FROM exports WHERE id = $1`, [id])).rows[0];
    if (!row) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, row.project_id, rc.user.id);
    requireMinRole(access, 'owner');
    if (row.status !== 'finished' || !row.object_key) throw errs.notFound();
    const content = await rc.ctx.storage.tryGet(row.object_key);
    if (content === null) throw errs.notFound();
    return { __file: content, __type: 'text/plain; charset=utf-8' };
  } finally {
    client.release();
  }
}

export async function retryExport(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query<{ id: number; project_id: number; status: string }>(`SELECT id, project_id, status FROM exports WHERE id = $1`, [id])).rows[0];
    if (!row) throw errs.notFound();
    const { project, access } = await loadProject(client, rc.ctx, row.project_id, rc.user.id);
    requireMinRole(access, 'owner');
    if (row.status !== 'failed') throw new AppError(409, 'wrong_state', 'Only failed exports can be retried.');
    const now = rc.ctx.now();
    const r = await client.query<{ id: number }>(`INSERT INTO exports (project_id, status, progress, created_at) VALUES ($1, 'running', 0, $2) RETURNING id`, [row.project_id, now]);
    const seq = await rc.ctx.live(client, row.project_id, 'export', { id: r.rows[0].id, progress: 0, status: 'running' });
    await client.query('COMMIT');
    progressJob.scheduleExport(rc.ctx, r.rows[0].id, row.project_id);
    return { id: r.rows[0].id, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function startImport(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const slug = rc.query.get('slug') ?? 'imported';
  const pack = rc.raw.toString('utf8');
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const g = await groupById(client, id);
    if (!g) throw errs.notFound();
    const acc = await groupAccess(client, id, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    const parsed = validatePack(pack);
    const now = rc.ctx.now();
    const r = await client.query<{ id: number }>(`INSERT INTO imports (group_id, slug, status, progress, pack, created_at) VALUES ($1, $2, 'preview', 0, $3, $4) RETURNING id`,
      [id, slug, pack, now]);
    await client.query('COMMIT');
    if (parsed.kind === 'error') {
      throw new AppError(422, 'invalid_pack', 'The spurpack has errors.', { errors: parsed.errors });
    }
    return { id: r.rows[0].id, preview: { commits: parsed.preview.commits, issues: parsed.preview.issues, requests: parsed.preview.requests } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function confirmImport(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query<{ id: number; group_id: number; slug: string; pack: string; status: string }>(`SELECT id, group_id, slug, pack, status FROM imports WHERE id = $1`, [id])).rows[0];
    if (!row) throw errs.notFound();
    const acc = await groupAccess(client, row.group_id, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    const parsed = validatePack(row.pack);
    if (parsed.kind === 'error') {
      throw new AppError(422, 'invalid_pack', 'The spurpack has errors.', { errors: parsed.errors });
    }
    const g = await groupById(client, row.group_id);
    const projectPath = `${g!.path}/${row.slug}`;
    const now = rc.ctx.now();
    const proj = await client.query<{ id: number }>(`INSERT INTO projects (group_id, slug, path, visibility, default_branch, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [row.group_id, row.slug, projectPath, parsed.config.visibility ?? 'private', parsed.config.default_branch ?? 'main', now]);
    const projectId = proj.rows[0].id;
    await client.query(`INSERT INTO mr_iids (project_id, kind, next_iid) VALUES ($1, 'issue', 1), ($1, 'request', 1) ON CONFLICT DO NOTHING`, [projectId]);
    await client.query(`UPDATE imports SET status = 'running', project_id = $2 WHERE id = $1`, [id, projectId]);
    const seq = await rc.ctx.live(client, projectId, 'import', { id, progress: 0, status: 'running' });
    await client.query('COMMIT');
    progressJob.scheduleImport(rc.ctx, id, projectId);
    return { project: projectId, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function getImport(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const row = (await client.query<{ id: number; group_id: number; status: string; progress: number; project_id: number | null }>(`SELECT id, group_id, status, progress, project_id FROM imports WHERE id = $1`, [id])).rows[0];
    if (!row) throw errs.notFound();
    const acc = await groupAccess(client, row.group_id, rc.user.id);
    if (acc.level < ROLE_LEVEL.owner) throw errs.forbidden();
    return { status: row.status, progress: row.progress, project: row.project_id };
  } finally {
    client.release();
  }
}

// ---- pack validation ----

export interface PackPreview {
  commits: number;
  issues: number;
  requests: number;
}

export type PackValidation =
  | { kind: 'ok'; records: Array<{ name: string; fields: string[]; line: number }>; preview: PackPreview; config: Record<string, string> }
  | { kind: 'error'; errors: string[] };

const CONFIG_KEYS = ['author_can_approve', 'auto_resolve_outdated', 'default_branch', 'merge_method', 'merge_trains', 'pipelines_must_succeed', 'reset_approvals_on_push', 'visibility'];

export function validatePack(pack: string): PackValidation {
  const lines = pack.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const errors: string[] = [];
  if (lines[0] !== 'spurpack 1') {
    return { kind: 'error', errors: ['Line 1: not a spurpack file.'] };
  }
  const records: Array<{ name: string; fields: string[]; line: number }> = [];
  const users = new Set<string>();
  const commits = new Map<string, { line: number; files: Map<string, string> }>();
  const refs = new Map<string, { line: number; commit: string }>();
  const labels = new Set<string>();
  const milestones = new Set<string>();
  const issues = new Set<number>();
  const requests = new Set<number>();
  const wikiPages = new Set<string>();
  const config = new Map<string, string>();
  let pendingFiles: Array<{ path: string; content: string; line: number }> = [];
  let pendingFilesLine = 1;
  let lastCommitHadFiles = false;
  let fileRunStart = 0;
  const dbUsers = new Set<string>(); // filled by caller via getUsernames — here we approximate with a callback

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const parsed = parsePackLine(lines[i]);
    if (!parsed || parsed.name === '') {
      errors.push(`Line ${lineNo}: unknown record "".`);
      continue;
    }
    const { name, fields } = parsed;
    if (!(name in RECORD_FIELD_COUNTS)) {
      errors.push(`Line ${lineNo}: unknown record "${name}".`);
      continue;
    }
    const expected = RECORD_FIELD_COUNTS[name];
    if (fields.length !== expected - 1) {
      errors.push(`Line ${lineNo}: ${name} needs ${expected - 1} fields, got ${fields.length}.`);
      continue;
    }
    if (name === 'user') {
      const username = fields[0];
      if (!/^[a-z0-9_]{3,24}$/.test(username) && username !== 'spurline-train') {
        errors.push(`Line ${lineNo}: bad value for username.`);
        continue;
      }
      if (users.has(username)) {
        errors.push(`Line ${lineNo}: duplicate user ${username}.`);
        continue;
      }
      users.add(username);
      if (pendingFiles.length > 0) {
        errors.push(`Line ${fileRunStart}: file belongs to no commit.`);
        pendingFiles = [];
      }
      lastCommitHadFiles = false;
      continue;
    }
    if (name === 'file') {
      const [path, content] = fields;
      if (!validPath(path)) {
        errors.push(`Line ${lineNo}: bad value for path.`);
        continue;
      }
      if (pendingFiles.length === 0) fileRunStart = lineNo;
      pendingFiles.push({ path, content, line: lineNo });
      continue;
    }
    if (name === 'commit') {
      const [id, parentsStr, author, committer, message] = fields;
      if (!/^[0-9a-f]{64}$/.test(id)) {
        errors.push(`Line ${lineNo}: bad value for id.`);
        continue;
      }
      if (commits.has(id)) {
        errors.push(`Line ${lineNo}: duplicate commit ${id}.`);
        continue;
      }
      const parents = parentsStr === '-' ? [] : parentsStr.split(',');
      for (const p of parents) {
        if (!/^[0-9a-f]{64}$/.test(p)) {
          errors.push(`Line ${lineNo}: bad value for parents.`);
          continue;
        }
      }
      const authorM = author.match(/^(\S+) (\d+)$/);
      const committerM = committer.match(/^(\S+) (\d+)$/);
      if (!authorM || !committerM) {
        errors.push(`Line ${lineNo}: bad value for author.`);
        continue;
      }
      if (!users.has(authorM[1])) {
        errors.push(`Line ${lineNo}: bad value for author.`);
        continue;
      }
      if (!users.has(committerM[1])) {
        errors.push(`Line ${lineNo}: bad value for committer.`);
        continue;
      }
      if (message.trim() === '') {
        errors.push(`Line ${lineNo}: bad value for message.`);
        continue;
      }
      const filesMap = new Map<string, string>();
      let dup = false;
      for (const f of pendingFiles) {
        if (filesMap.has(f.path)) {
          errors.push(`Line ${lineNo}: duplicate file ${f.path}.`);
          dup = true;
          break;
        }
        filesMap.set(f.path, f.content);
      }
      if (dup) continue;
      // unknown parents
      for (const p of parents) {
        if (!commits.has(p)) {
          errors.push(`Line ${lineNo}: commit ${id.slice(0, 7)} has unknown parent ${p.slice(0, 7)}.`);
          break;
        }
      }
      // commit id check
      const treeId = treeIdOf([...filesMap.entries()].sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b))).map(([path2, content]) => ({ name: path2, mode: '100644' as const, id: blobId(content), type: 'blob' as const })));
      const computed = commitIdOf(treeId, parents, authorM[1], parseInt(authorM[2], 10), committerM[1], parseInt(committerM[2], 10), message);
      if (computed !== id) {
        errors.push(`Line ${lineNo}: commit id doesn't match its contents.`);
      }
      commits.set(id, { line: lineNo, files: filesMap });
      pendingFiles = [];
      lastCommitHadFiles = true;
      continue;
    }
    // any other record flushes a pending file run
    if (pendingFiles.length > 0) {
      errors.push(`Line ${fileRunStart}: file belongs to no commit.`);
      pendingFiles = [];
    }
    lastCommitHadFiles = false;
    if (name === 'ref') {
      const [kind, refName, commit] = fields;
      if (kind !== 'branch' && kind !== 'tag') {
        errors.push(`Line ${lineNo}: bad value for kind.`);
        continue;
      }
      if (refName === '') {
        errors.push(`Line ${lineNo}: bad value for name.`);
        continue;
      }
      if (refs.has(`${kind} ${refName}`)) {
        errors.push(`Line ${lineNo}: duplicate ref ${kind} ${refName}.`);
        continue;
      }
      if (!commits.has(commit)) {
        errors.push(`Line ${lineNo}: ref ${refName} points to unknown commit ${commit.slice(0, 7)}.`);
        continue;
      }
      refs.set(`${kind} ${refName}`, { line: lineNo, commit });
      continue;
    }
    if (name === 'label') {
      const [labelName, description] = fields;
      if (labelName === '' || labelName.includes('\t') || labelName.includes('\n')) {
        errors.push(`Line ${lineNo}: bad value for name.`);
        continue;
      }
      if (labels.has(labelName)) {
        errors.push(`Line ${lineNo}: duplicate label ${labelName}.`);
        continue;
      }
      labels.add(labelName);
      continue;
    }
    if (name === 'milestone') {
      const [title, start, due, zone, state] = fields;
      if (title === '') {
        errors.push(`Line ${lineNo}: bad value for title.`);
        continue;
      }
      if (milestones.has(title)) {
        errors.push(`Line ${lineNo}: duplicate milestone ${title}.`);
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) && start !== '-') {
        errors.push(`Line ${lineNo}: bad value for start.`);
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) && due !== '-') {
        errors.push(`Line ${lineNo}: bad value for due.`);
        continue;
      }
      if (start !== '-' && due !== '-' && start > due) {
        errors.push(`Line ${lineNo}: bad value for start.`);
        continue;
      }
      if (!isValidZone(zone)) {
        errors.push(`Line ${lineNo}: bad value for zone.`);
        continue;
      }
      if (state !== 'active' && state !== 'closed') {
        errors.push(`Line ${lineNo}: bad value for state.`);
        continue;
      }
      milestones.add(title);
      continue;
    }
    if (name === 'issue') {
      const [iidStr, title, state, author, labelsStr, milestone, weight, confidential, description] = fields;
      const iid = parseInt(iidStr, 10);
      if (!/^\d+$/.test(iidStr) || iid <= 0) {
        errors.push(`Line ${lineNo}: bad value for iid.`);
        continue;
      }
      if (issues.has(iid)) {
        errors.push(`Line ${lineNo}: duplicate issue ${iid}.`);
        continue;
      }
      if (title === '' || title.length > 255) {
        errors.push(`Line ${lineNo}: bad value for title.`);
        continue;
      }
      if (state !== 'opened' && state !== 'closed') {
        errors.push(`Line ${lineNo}: bad value for state.`);
        continue;
      }
      if (!users.has(author)) {
        errors.push(`Line ${lineNo}: bad value for author.`);
        continue;
      }
      const issueLabels = labelsStr === '-' ? [] : labelsStr.split(',');
      for (const l of issueLabels) {
        if (!labels.has(l)) {
          errors.push(`Line ${lineNo}: bad value for labels.`);
          break;
        }
      }
      if (milestone !== '-' && !milestones.has(milestone)) {
        errors.push(`Line ${lineNo}: bad value for milestone.`);
        continue;
      }
      if (weight !== '-' && !/^\d+$/.test(weight)) {
        errors.push(`Line ${lineNo}: bad value for weight.`);
        continue;
      }
      if (weight !== '-' && (parseInt(weight, 10) < 0 || parseInt(weight, 10) > 100)) {
        errors.push(`Line ${lineNo}: bad value for weight.`);
        continue;
      }
      if (confidential !== 'true' && confidential !== 'false') {
        errors.push(`Line ${lineNo}: bad value for confidential.`);
        continue;
      }
      issues.add(iid);
      continue;
    }
    if (name === 'request') {
      const [iidStr, title, state, author, source, target, description] = fields;
      const iid = parseInt(iidStr, 10);
      if (!/^\d+$/.test(iidStr) || iid <= 0) {
        errors.push(`Line ${lineNo}: bad value for iid.`);
        continue;
      }
      if (requests.has(iid)) {
        errors.push(`Line ${lineNo}: duplicate request ${iid}.`);
        continue;
      }
      if (title === '' || title.length > 255) {
        errors.push(`Line ${lineNo}: bad value for title.`);
        continue;
      }
      if (state !== 'opened' && state !== 'closed' && state !== 'merged') {
        errors.push(`Line ${lineNo}: bad value for state.`);
        continue;
      }
      if (!users.has(author)) {
        errors.push(`Line ${lineNo}: bad value for author.`);
        continue;
      }
      if (source === '' || target === '') {
        errors.push(`Line ${lineNo}: bad value for source.`);
        continue;
      }
      requests.add(iid);
      continue;
    }
    if (name === 'thread') {
      const [requestIidStr, path, lineStr, resolved, author, body] = fields;
      const requestIid = parseInt(requestIidStr, 10);
      if (!requests.has(requestIid)) {
        errors.push(`Line ${lineNo}: bad value for request.`);
        continue;
      }
      if (path === '-') {
        if (lineStr !== '-') {
          errors.push(`Line ${lineNo}: bad value for line.`);
          continue;
        }
      } else {
        if (!validPath(path)) {
          errors.push(`Line ${lineNo}: bad value for path.`);
          continue;
        }
        if (!/^\d+$/.test(lineStr) || parseInt(lineStr, 10) <= 0) {
          errors.push(`Line ${lineNo}: bad value for line.`);
          continue;
        }
      }
      if (resolved !== 'true' && resolved !== 'false') {
        errors.push(`Line ${lineNo}: bad value for resolved.`);
        continue;
      }
      if (!users.has(author)) {
        errors.push(`Line ${lineNo}: bad value for author.`);
        continue;
      }
      if (body === '') {
        errors.push(`Line ${lineNo}: bad value for body.`);
        continue;
      }
      continue;
    }
    if (name === 'wikipage') {
      const [slug, versionStr, author, title, content] = fields;
      if (slug === '' || !/^[a-z0-9-/]+$/.test(slug)) {
        errors.push(`Line ${lineNo}: bad value for slug.`);
        continue;
      }
      const version = parseInt(versionStr, 10);
      if (!/^\d+$/.test(versionStr) || version < 1) {
        errors.push(`Line ${lineNo}: bad value for version.`);
        continue;
      }
      if (wikiPages.has(`${slug} ${versionStr}`)) {
        errors.push(`Line ${lineNo}: duplicate wikipage ${slug} ${versionStr}.`);
        continue;
      }
      const prev = wikiPages.has(`${slug} ${version - 1}`) || version === 1;
      if (!prev) {
        errors.push(`Line ${lineNo}: bad value for version.`);
        continue;
      }
      if (!users.has(author)) {
        errors.push(`Line ${lineNo}: bad value for author.`);
        continue;
      }
      if (title === '') {
        errors.push(`Line ${lineNo}: bad value for title.`);
        continue;
      }
      wikiPages.add(`${slug} ${versionStr}`);
      continue;
    }
    if (name === 'config') {
      const [key, value] = fields;
      if (!CONFIG_KEYS.includes(key)) {
        errors.push(`Line ${lineNo}: bad value for key.`);
        continue;
      }
      if (config.has(key)) {
        errors.push(`Line ${lineNo}: duplicate config ${key}.`);
        continue;
      }
      if (key === 'merge_method' && !['merge_commit', 'squash', 'fast_forward', 'rebase'].includes(value)) {
        errors.push(`Line ${lineNo}: bad value for value.`);
        continue;
      }
      if (key === 'visibility' && !['private', 'internal', 'public'].includes(value)) {
        errors.push(`Line ${lineNo}: bad value for value.`);
        continue;
      }
      if (['author_can_approve', 'auto_resolve_outdated', 'merge_trains', 'pipelines_must_succeed', 'reset_approvals_on_push'].includes(key) && value !== 'true' && value !== 'false') {
        errors.push(`Line ${lineNo}: bad value for value.`);
        continue;
      }
      config.set(key, value);
      continue;
    }
  }
  if (pendingFiles.length > 0) {
    errors.push(`Line ${fileRunStart}: file belongs to no commit.`);
  }
  void lastCommitHadFiles;
  void dbUsers;
  if (errors.length > 0) {
    return { kind: 'error', errors: errors.slice(0, 20) };
  }
  return {
    kind: 'ok',
    records,
    preview: { commits: commits.size, issues: issues.size, requests: requests.size },
    config: Object.fromEntries(config),
  };
}

function validPath(path: string): boolean {
  if (path === '') return false;
  if (path.startsWith('/')) return false;
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return false;
  }
  return true;
}

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export { ROLE_LEVEL };
