import { isoUtc, serverNow } from '../clock.js';
import { db } from '../db.js';
import { conflict, forbidden, invalidFields, notFound } from '../errors.js';
import { repoAccess, sendJson, sendText, type Ctx } from '../http.js';
import { getObject, putObject } from '../storage.js';
import { buildZip, type ZipEntry } from '../zip.js';
import { CHECK_STATE_WORDS, latestReports, timeoutDeadline } from '../../domain/checks.js';
import { entriesForRevision, entryReportArrived } from '../../domain/queue.js';
import { listChanges } from '../../domain/model.js';
import {
  byteOrder,
  getBranchRevision,
  getRevision,
  getSnapshot,
  sortedPaths,
} from '../../domain/revisions.js';
import { performPush } from '../../domain/push.js';
import { asString, body, inRepoTx, storageError, wholeNumber } from './common.js';
import { randomTokenValue, tokenHash } from './accounts.js';

export async function handleGetRepo(ctx: Ctx, org: string, name: string): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: true });
  const repo = access.repo;
  sendJson(ctx.response, 200, {
    id: repo.id,
    org: repo.org,
    name: repo.name,
    visibility: repo.visibility,
    your_role: access.role,
    settings: {
      required_approvals: repo.requiredApprovals,
      required_checks: repo.requiredChecks,
      queue: repo.queueOn,
    },
  });
}

export async function handleSettings(ctx: Ctx, org: string, name: string): Promise<void> {
  const settings = await inRepoTx(ctx, org, name, 'maintainer', {}, async (tx, access) => {
    const input = body(ctx);
    const errors: Record<string, string> = {};
    const updates: string[] = [];
    const values: unknown[] = [access.repo.id];

    if (input.required_approvals !== undefined) {
      const value = wholeNumber(input.required_approvals);
      if (value === null || value < 0 || value > 10) errors.required_approvals = 'Must be a whole number from 0 to 10';
      else {
        values.push(value);
        updates.push(`required_approvals = $${values.length}`);
      }
    }
    if (input.required_checks !== undefined) {
      const value = input.required_checks;
      const names = Array.isArray(value) ? value : null;
      const valid =
        names !== null &&
        names.length <= 20 &&
        names.every((entry) => typeof entry === 'string' && entry.length >= 1 && entry.length <= 64) &&
        new Set(names).size === names.length;
      if (!valid) errors.required_checks = 'Must be at most 20 unique names of 1 to 64 characters';
      else {
        values.push(names);
        updates.push(`required_checks = $${values.length}`);
      }
    }
    if (input.queue !== undefined) {
      if (typeof input.queue !== 'boolean') errors.queue = 'Must be true or false';
      else {
        values.push(input.queue);
        updates.push(`queue_on = $${values.length}`);
      }
    }
    if (input.visibility !== undefined) {
      if (input.visibility !== 'private' && input.visibility !== 'public') {
        errors.visibility = 'Visibility must be private or public';
      } else {
        values.push(input.visibility);
        updates.push(`visibility = $${values.length}`);
      }
    }
    if (Object.keys(errors).length > 0) throw invalidFields(errors);
    if (updates.length > 0) {
      await tx.query(`UPDATE rs_repos SET ${updates.join(', ')} WHERE id = $1`, values);
    }
    const rows = await tx.query<{ required_approvals: number; required_checks: string[]; queue_on: boolean }>(
      'SELECT required_approvals, required_checks, queue_on FROM rs_repos WHERE id = $1',
      [access.repo.id],
    );
    return {
      required_approvals: Number(rows[0].required_approvals),
      required_checks: rows[0].required_checks,
      queue: rows[0].queue_on,
    };
  });
  sendJson(ctx.response, 200, settings);
}

export async function handleGrantRole(ctx: Ctx, org: string, name: string): Promise<void> {
  await inRepoTx(ctx, org, name, 'maintainer', {}, async (tx, access) => {
    const input = body(ctx);
    const subject = asString(input.subject);
    const role = asString(input.role);
    if (!['reader', 'writer', 'maintainer', 'owner'].includes(role)) {
      throw invalidFields({ role: 'Role must be reader, writer, maintainer or owner' });
    }
    if (role === 'owner' && access.role !== 'owner') throw forbidden('Only owners can grant owner');

    const [kind, value] = subject.split(':');
    if (kind === 'user') {
      const rows = await tx.query<{ id: string }>('SELECT id FROM rs_users WHERE username = $1', [value]);
      if (rows.length === 0) throw notFound();
      await tx.query(
        `INSERT INTO rs_roles (repo_id, subject_type, subject_id, role) VALUES ($1, 'user', $2, $3)
         ON CONFLICT (repo_id, subject_type, subject_id) DO UPDATE SET role = $3`,
        [access.repo.id, rows[0].id, role],
      );
    } else if (kind === 'team') {
      const rows = await tx.query<{ id: string }>(
        'SELECT t.id FROM rs_teams t WHERE t.org_id = $1 AND t.name = $2',
        [access.repo.orgId, value.includes('/') ? value.split('/')[1] : value],
      );
      if (rows.length === 0) throw notFound();
      await tx.query(
        `INSERT INTO rs_roles (repo_id, subject_type, subject_id, role) VALUES ($1, 'team', $2, $3)
         ON CONFLICT (repo_id, subject_type, subject_id) DO UPDATE SET role = $3`,
        [access.repo.id, rows[0].id, role],
      );
    } else {
      throw notFound();
    }
  });
  ctx.response.writeHead(204).end();
}

export async function handleRemoveRole(ctx: Ctx, org: string, name: string, subject: string): Promise<void> {
  await inRepoTx(ctx, org, name, 'maintainer', {}, async (tx, access) => {
    const [kind, value] = subject.split(':');
    if (kind === 'user') {
      await tx.query(
        `DELETE FROM rs_roles WHERE repo_id = $1 AND subject_type = 'user'
         AND subject_id = (SELECT id FROM rs_users WHERE username = $2)`,
        [access.repo.id, value],
      );
    } else {
      const teamName = value.includes('/') ? value.split('/')[1] : value;
      await tx.query(
        `DELETE FROM rs_roles WHERE repo_id = $1 AND subject_type = 'team'
         AND subject_id = (SELECT id FROM rs_teams WHERE org_id = $2 AND name = $3)`,
        [access.repo.id, access.repo.orgId, teamName],
      );
    }
  });
  ctx.response.writeHead(204).end();
}

export async function handleCreateToken(ctx: Ctx, org: string, name: string): Promise<void> {
  const created = await inRepoTx(ctx, org, name, 'maintainer', {}, async (tx, access) => {
    const input = body(ctx);
    const tokenName = asString(input.name);
    const accessLevel = asString(input.access);
    if (tokenName.trim() === '') throw invalidFields({ name: 'Name is required' });
    if (accessLevel !== 'read' && accessLevel !== 'write') {
      throw invalidFields({ access: 'Access must be read or write' });
    }
    const value = randomTokenValue();
    const rows = await tx.query<{ id: string }>(
      'INSERT INTO rs_tokens (repo_id, name, access, token_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [access.repo.id, tokenName, accessLevel, tokenHash(value)],
    );
    return { id: Number(rows[0].id), name: tokenName, access: accessLevel, token: value };
  });
  sendJson(ctx.response, 201, created);
}

export async function handleRevokeToken(ctx: Ctx, org: string, name: string, id: string): Promise<void> {
  await inRepoTx(ctx, org, name, 'maintainer', {}, async (tx, access) => {
    const rows = await tx.query('SELECT 1 FROM rs_tokens WHERE id = $1 AND repo_id = $2', [id, access.repo.id]);
    if (rows.length === 0) throw notFound();
    await tx.query('DELETE FROM rs_tokens WHERE id = $1', [id]);
  });
  ctx.response.writeHead(204).end();
}

export async function handleGetBranch(ctx: Ctx, org: string, name: string, branch: string): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: true });
  const revision = await getBranchRevision(db, access.repo.id, branch);
  if (revision === null) throw notFound();
  sendJson(ctx.response, 200, { name: branch, revision });
}

export async function handleGetRevision(ctx: Ctx, org: string, name: string, id: string): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: true });
  const revision = await getRevision(db, access.repo.id, id);
  if (!revision) throw notFound();
  const snapshot = await getSnapshot(db, access.repo.id, id);
  sendJson(ctx.response, 200, {
    id: revision.id,
    parents: revision.parents,
    message: revision.message,
    author: revision.authorUsername,
    created_at: isoUtc(revision.createdAt),
    files: sortedPaths(snapshot.keys()).map((path) => ({ path, size: snapshot.get(path)!.size })),
  });
}

export async function handleRevisionFile(
  ctx: Ctx,
  org: string,
  name: string,
  id: string,
  path: string,
): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: true });
  const revision = await getRevision(db, access.repo.id, id);
  if (!revision) throw notFound();
  const snapshot = await getSnapshot(db, access.repo.id, id);
  const entry = snapshot.get(path);
  if (!entry) throw notFound();
  try {
    const bytes = await getObject(entry.contentKey);
    sendText(ctx.response, 200, bytes, 'text/plain; charset=utf-8');
  } catch (error) {
    storageError(error, 'push');
  }
}

export function revisionTextFile(
  revision: { id: string; parents: string[]; authorUsername: string; message: string; createdAt: Date },
  fileCount: number,
): string {
  return [
    `revision: ${revision.id}`,
    `parents: ${revision.parents.length === 0 ? 'none' : revision.parents.join(', ')}`,
    `author: ${revision.authorUsername}`,
    `message: ${revision.message}`,
    `time: ${isoUtc(revision.createdAt)}`,
    `files: ${fileCount}`,
    '',
  ].join('\n');
}

export async function handleArchive(ctx: Ctx, org: string, name: string, id: string): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'maintainer', {});
  const repo = access.repo;
  const revision = await getRevision(db, repo.id, id);
  if (!revision) throw notFound();
  const snapshot = await getSnapshot(db, repo.id, id);
  const prefix = `${repo.name}-${revision.id}`;

  try {
    const entries: ZipEntry[] = [];
    for (const path of sortedPaths(snapshot.keys())) {
      entries.push({ name: `${prefix}/${path}`, content: await getObject(snapshot.get(path)!.contentKey) });
    }
    entries.push({
      name: `${prefix}/REVISION.txt`,
      content: Buffer.from(revisionTextFile(revision, snapshot.size), 'utf8'),
    });
    entries.sort((a, b) => byteOrder(a.name, b.name));
    const key = `archives/${repo.id}/${revision.id}.zip`;
    await putObject(key, buildZip(entries));
    sendJson(ctx.response, 201, { key, revision: revision.id, entries: entries.map((entry) => entry.name) });
  } catch (error) {
    storageError(error, 'archive');
  }
}

export async function handlePush(ctx: Ctx, org: string, name: string): Promise<void> {
  try {
    const result = await inRepoTx(ctx, org, name, 'write', { tokensAllowed: true }, async (tx, access, sink) => {
      const input = body(ctx);
      const branch = input.branch;
      if (typeof branch !== 'string' || branch === '') throw invalidFields({ branch: 'branch is required' });
      const expectedHead = typeof input.expected_head === 'string' ? input.expected_head : null;
      const from = typeof input.from === 'string' ? input.from : null;
      if (expectedHead === null && input.expected_head !== null && from === null) {
        throw invalidFields({ expected_head: 'expected_head is required' });
      }
      const actor = access.token
        ? { username: `token:${access.token.name}`, name: access.token.name }
        : { username: access.user!.username, name: access.user!.name };
      return performPush(
        tx,
        access.repo,
        { branch, expectedHead, from, message: input.message, files: input.files, actor },
        sink,
      );
    });
    sendJson(ctx.response, 201, { revision: result.revision, branch: result.branch, parent: result.parent });
  } catch (error) {
    storageError(error, 'push');
  }
}

export async function handleChecks(ctx: Ctx, org: string, name: string): Promise<void> {
  const result = await inRepoTx(ctx, org, name, 'write', { tokensAllowed: true }, async (tx, access, sink) => {
    const input = body(ctx);
    const repo = access.repo;
    const revisionId = asString(input.revision);
    const checkName = typeof input.name === 'string' ? input.name : '';
    const state = asString(input.state);
    const summary = input.summary === undefined || input.summary === null ? '' : asString(input.summary);

    const errors: Record<string, string> = {};
    if (!/^[0-9a-f]{12}$/.test(revisionId)) errors.revision = 'Revision must be 12 hex characters';
    if (checkName === '') errors.name = 'Name is required';
    else if (checkName.length > 64) errors.name = 'Name must be 1 to 64 characters';
    if (!['queued', 'in_progress', 'success', 'failure'].includes(state)) {
      errors.state = 'State must be one of queued, in_progress, success, failure';
    }
    if (summary.length > 1000) errors.summary = 'Summary must be at most 1000 characters';
    if (errors.revision !== undefined) throw invalidFields(errors);

    const revision = await getRevision(tx, repo.id, revisionId);
    if (!revision) throw notFound();
    if (Object.keys(errors).length > 0) throw invalidFields(errors);

    if (repo.requiredChecks.includes(checkName)) {
      const reports = await latestReports(tx, repo.id, revisionId);
      const report = reports.get(checkName);
      const final = report && (report.state === 'success' || report.state === 'failure');
      if (!final) {
        const deadlines: Date[] = [];
        for (const change of await listChanges(tx, repo.id)) {
          if (change.state === 'merged') continue;
          const head = await getBranchRevision(tx, repo.id, change.headBranch);
          if (head === revisionId) deadlines.push(timeoutDeadline(revision.createdAt));
        }
        for (const entry of await entriesForRevision(tx, repo.id, revisionId)) {
          deadlines.push(timeoutDeadline(entry.revisionSetAt));
        }
        const now = serverNow().getTime();
        if (deadlines.some((deadline) => deadline.getTime() <= now)) {
          throw conflict(`Check ${checkName} timed out`);
        }
      }
    }

    await tx.query(
      'INSERT INTO rs_check_reports (repo_id, revision_id, name, state, summary, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [repo.id, revisionId, checkName, state, summary, serverNow()],
    );

    for (const change of await listChanges(tx, repo.id)) {
      const head = await getBranchRevision(tx, repo.id, change.headBranch);
      if (head === revisionId && change.state !== 'merged') {
        sink.add({
          kind: 'check',
          text: `#${change.number}: check ${checkName} ${CHECK_STATE_WORDS[state as 'queued']}`,
          change: change.number,
        });
      }
    }
    for (const entry of await entriesForRevision(tx, repo.id, revisionId)) {
      sink.add({
        kind: 'check',
        text: `#${entry.changeNumber}: check ${checkName} ${CHECK_STATE_WORDS[state as 'queued']}`,
        change: entry.changeNumber,
      });
    }
    await entryReportArrived(tx, repo, revisionId, sink);
    return { revision: revisionId, name: checkName, state };
  });
  sendJson(ctx.response, 201, result);
}
