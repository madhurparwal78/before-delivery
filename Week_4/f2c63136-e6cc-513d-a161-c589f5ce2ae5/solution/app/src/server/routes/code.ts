import { config } from '../config.ts';
import { db, transaction, type Row } from '../db.ts';
import { iso } from '../clock.ts';
import { HttpError, invalid, notFound, OUTAGE_EXPORT, StorageDown } from '../errors.ts';
import { asObject, readBody, reply, usable, type Json, type Router } from '../http.ts';
import { authenticate, repoAccess, requireMaintainer, requireWrite, type RepoAccess } from '../domain/access.ts';
import { isTimedOut, recordReport } from '../domain/reports.ts';
import { branchHead, performPush, staleHead, uploadFiles, type FileChange } from '../domain/push.ts';
import { Contents, describeRevision, loadRevision, loadSnap } from '../domain/revisions.ts';
import { byteOrder, decodeUtf8, validBranch, validPath, validRevisionId } from '../domain/validate.ts';
import { putArchive } from '../s3.ts';
import { makeZip } from '../zip.ts';
import { unmergedChanges } from '../domain/stack.ts';
import type { CheckState } from '../../shared/types.ts';
import { repoObject } from './account.ts';

const STATES: CheckState[] = ['queued', 'in_progress', 'success', 'failure'];
const isString = (value: unknown): value is string => typeof value === 'string';

async function revisionOr404(access: RepoAccess, id: string): Promise<Row> {
  const row = validRevisionId(id) ? await loadRevision(db, access.repo.id, id) : null;
  if (!row) throw notFound();
  return row;
}

export const authorOf = (access: RepoAccess) =>
  access.user ? { username: access.user.username, name: access.user.name } : { username: `token:${access.tokenName}`, name: access.tokenName! };

interface PushFile {
  path: string;
  change: FileChange;
}

/** Validates the pushed file list against the branch snapshot; one entry per bad field. */
async function checkFiles(value: unknown, snapshotPaths: Set<string>, errors: Record<string, string>): Promise<PushFile[]> {
  if (!Array.isArray(value)) {
    errors.files = 'files is required';
    return [];
  }
  if (value.length < 1 || value.length > 200) {
    errors.files = 'Files must hold 1 to 200 entries';
    return [];
  }
  const files: PushFile[] = [];
  const seen = new Set<string>();
  value.forEach((raw, i) => {
    const entry = asObject(raw);
    const path = isString(entry.path) ? entry.path : '';
    const key = `files.${i}.path`;
    if (!isString(entry.path)) errors[key] = 'path is required';
    else if (!validPath(path)) errors[key] = 'Invalid path';
    else if (seen.has(path)) errors[key] = 'Duplicate path';
    seen.add(path);
    const kinds = ['content', 'content_base64', 'delete'].filter((field) => field in entry);
    if (kinds.length !== 1) {
      errors[`files.${i}.content`] = 'content is required';
      return;
    }
    if (key in errors) return;
    if (kinds[0] === 'delete') {
      if (entry.delete !== true) errors[`files.${i}.delete`] = 'delete is required';
      else if (!snapshotPaths.has(path)) errors[key] = 'Path does not exist';
      else files.push({ path, change: { delete: true } });
    } else if (kinds[0] === 'content') {
      if (isString(entry.content)) files.push({ path, change: { bytes: Buffer.from(entry.content, 'utf8') } });
      else errors[`files.${i}.content`] = 'content is required';
    } else {
      const bytes = isString(entry.content_base64) && /^[A-Za-z0-9+/]*={0,2}$/.test(entry.content_base64) ? Buffer.from(entry.content_base64, 'base64') : null;
      if (bytes && decodeUtf8(bytes) !== null) files.push({ path, change: { bytes } });
      else errors[`files.${i}.content_base64`] = `File ${path} is not UTF-8 text`;
    }
  });
  return files;
}

/** A push: stale head, then field errors, then storage, then the one revision under the repository lock. */
export async function opPush(access: RepoAccess, input: Json): Promise<{ revision: string; branch: string; parent: string }> {
  const repo = access.repo;
  const branch = isString(input.branch) ? input.branch : '';
  const current = await branchHead(db, repo.id, branch);
  if ('expected_head' in input) {
    const expected = input.expected_head;
    if (current !== null && expected !== current && (expected === null || isString(expected))) throw staleHead(current);
    if (current === null && isString(expected)) throw notFound();
  }
  const errors: Record<string, string> = {};
  if (!isString(input.branch)) errors.branch = 'branch is required';
  else if (!validBranch(branch)) errors.branch = 'Invalid branch name';
  if (!('expected_head' in input) || (input.expected_head !== null && !isString(input.expected_head))) errors.expected_head = 'expected_head is required';
  let parent = current;
  if (input.expected_head === null && current === null) {
    parent = isString(input.from) ? await branchHead(db, repo.id, input.from) : null;
    if (isString(input.from) && parent === null) throw notFound();
    if (!isString(input.from)) errors.from = 'from is required';
  }
  if (!isString(input.message) || input.message.trim() === '') errors.message = 'Message is required';
  else if (input.message.length > 500) errors.message = 'Message must be 1 to 500 characters';
  const snapshotPaths = parent ? new Set((await loadSnap(db, repo.id, parent)).keys()) : new Set<string>();
  const files = await checkFiles(input.files, snapshotPaths, errors);
  if (Object.keys(errors).length) throw invalid(errors);
  const contents = new Contents();
  const changes = new Map<string, FileChange>(files.map((file) => [file.path, file.change]));
  const stored = await uploadFiles(changes, contents);
  const done = await transaction((tx) =>
    performPush(
      tx,
      repo,
      { branch, expectedHead: input.expected_head as string | null, from: isString(input.from) ? input.from : null, message: input.message as string, files: changes },
      stored,
      authorOf(access),
      contents,
    ),
  );
  return { revision: done.revision, branch, parent: done.parent };
}

/** A check report: 404 for an unknown revision, 409 for a timed-out check, then field errors. */
export async function opReport(access: RepoAccess, input: Json): Promise<{ revision: string; name: string; state: unknown }> {
  const repo = access.repo;
  const revision = isString(input.revision) ? input.revision : '';
  if (validRevisionId(revision) && !(await loadRevision(db, repo.id, revision))) throw notFound();
  const name = isString(input.name) ? input.name : '';
  if (name && name.length <= 64 && validRevisionId(revision) && (await isTimedOut(db, repo, revision, name))) {
    throw new HttpError(409, { error: `Check ${name} timed out` });
  }
  const errors: Record<string, string> = {};
  if (!validRevisionId(revision)) errors.revision = 'Revision must be 12 hex characters';
  if (!isString(input.name) || input.name === '') errors.name = 'Name is required';
  else if (input.name.length > 64) errors.name = 'Name must be 1 to 64 characters';
  if (!STATES.includes(input.state as CheckState)) errors.state = 'State must be one of queued, in_progress, success, failure';
  const summary = input.summary === undefined ? '' : input.summary;
  if (!isString(summary) || summary.length > 1000) errors.summary = 'Summary must be at most 1000 characters';
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    await tx.lockRepo(repo.id);
    await recordReport(tx, repo, revision, name, input.state as CheckState, summary as string, new Contents());
  });
  return { revision, name, state: input.state };
}

export function register(router: Router): void {
  router.add('GET', '/api/repos/:org/:repo/branches', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    const rows = await db.q<Row>('SELECT name, revision FROM branches WHERE repo_id = $1 ORDER BY name COLLATE "C"', [access.repo.id]);
    return reply(200, rows);
  });

  router.add('GET', '/api/repos/:org/:repo/branches/:branch', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    const revision = await branchHead(db, access.repo.id, c.params.branch);
    if (!revision) throw notFound();
    return reply(200, { name: c.params.branch, revision });
  });

  router.add('GET', '/api/repos/:org/:repo/revisions/:id', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    const row = await revisionOr404(access, c.params.id);
    const files = [...(await loadSnap(db, access.repo.id, row.id)).entries()].sort(([a], [b]) => byteOrder(a, b));
    return reply(200, { ...describeRevision(row), files: files.map(([path, ref]) => ({ path, size: ref.size })) });
  });

  router.add('GET', '/api/repos/:org/:repo/revisions/:id/files/*path', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    const row = await revisionOr404(access, c.params.id);
    const ref = (await loadSnap(db, access.repo.id, row.id)).get(c.params.path);
    if (!ref) throw notFound();
    return { status: 200, raw: { type: 'text/plain; charset=utf-8', data: await new Contents().get(ref.sha) } };
  });

  router.add('GET', '/api/repos/:org/:repo/revisions/:id/contents', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, false), c.params.org, c.params.repo);
    const row = await revisionOr404(access, c.params.id);
    const contents = new Contents();
    const files = [...(await loadSnap(db, access.repo.id, row.id)).entries()].sort(([a], [b]) => byteOrder(a, b));
    const texts = await Promise.all(files.map(async ([path, ref]) => ({ path, size: ref.size, text: (await contents.get(ref.sha)).toString('utf8') })));
    return reply(200, { ...describeRevision(row), files: texts });
  });

  router.add('POST', '/api/repos/:org/:repo/revisions/:id/archive', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, false), c.params.org, c.params.repo);
    const row = await revisionOr404(access, c.params.id);
    requireMaintainer(access);
    const snap = await loadSnap(db, access.repo.id, row.id);
    const prefix = `${access.repo.name}-${row.id}/`;
    const contents = new Contents();
    try {
      const files = await Promise.all([...snap].map(async ([path, ref]) => ({ name: prefix + path, data: await contents.get(ref.sha) })));
      const info = describeRevision(row);
      const manifest = [
        `revision: ${info.id}`,
        `parents: ${info.parents.length ? info.parents.join(', ') : 'none'}`,
        `author: ${info.author}`,
        `message: ${info.message}`,
        `time: ${info.created_at}`,
        `files: ${snap.size}`,
        '',
      ].join('\n');
      const entries = [...files, { name: `${prefix}REVISION.txt`, data: Buffer.from(manifest) }].sort((a, b) => byteOrder(a.name, b.name));
      const key = `archives/${access.repo.id}/${row.id}.zip`;
      await putArchive(key, makeZip(entries));
      return reply(201, { key, revision: row.id, entries: entries.map((entry) => entry.name) });
    } catch (error) {
      throw error instanceof StorageDown ? new StorageDown(OUTAGE_EXPORT) : error;
    }
  });

  router.add('POST', '/api/repos/:org/:repo/push', async (c) => {
    const caller = await authenticate(c.req, true);
    const body = await readBody(c.req, config.pushSizeLimitBytes);
    const access = await repoAccess(db, caller, c.params.org, c.params.repo);
    requireWrite(access);
    return reply(201, await opPush(access, usable(body, config.pushSizeLimitBytes)));
  });

  router.add('POST', '/api/repos/:org/:repo/checks', async (c) => {
    const caller = await authenticate(c.req, true);
    const body = await readBody(c.req, config.pushSizeLimitBytes);
    const access = await repoAccess(db, caller, c.params.org, c.params.repo);
    requireWrite(access);
    return reply(201, await opReport(access, usable(body, config.pushSizeLimitBytes)));
  });

  router.add('GET', '/api/repos/:org/:repo/overview', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, false), c.params.org, c.params.repo);
    const repo = access.repo;
    const branches = await db.q<Row>('SELECT name, revision FROM branches WHERE repo_id = $1 ORDER BY name COLLATE "C"', [repo.id]);
    const wanted = c.url.searchParams.get('branch') ?? 'main';
    const branch = branches.find((row) => row.name === wanted);
    if (!branch) throw notFound();
    const files = [...(await loadSnap(db, repo.id, branch.revision)).entries()].sort(([a], [b]) => byteOrder(a, b));
    const open = await unmergedChanges(db, repo.id);
    const authors = await db.q<Row>('SELECT id, username FROM users WHERE id = ANY($1)', [open.map((change) => change.author_id)]);
    const recent = await db.q<Row>('SELECT * FROM revisions WHERE repo_id = $1 ORDER BY created_at DESC, id LIMIT 10', [repo.id]);
    return reply(200, {
      repo: repoObject(repo, access.role!),
      branches: branches.map((row) => row.name),
      branch: branch.name,
      files: files.map(([path, ref]) => ({ path, size: ref.size })),
      open_changes: open.map((change) => ({
        number: change.number,
        title: change.title,
        state: change.state,
        author: authors.find((author) => author.id === change.author_id)?.username,
      })),
      recent: recent.map((row) => ({ id: row.id, message: row.message, author: row.author_username, created_at: iso(row.created_at) })),
    });
  });
}

