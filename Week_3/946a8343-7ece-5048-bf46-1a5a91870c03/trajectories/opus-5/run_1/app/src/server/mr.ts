import { Access, ProjectRow, levelOf, roleLevels } from './access';
import { nowMs } from './clock';
import { Sql } from './db';
import { errors } from './errors';
import { Tx, emit } from './live';
import { lineDiff, splitLines, threeWayMergeTrees } from './diff';
import { OwnersProblem, OwnersSection, ownersPath, readOwners } from './owners';
import { branchHead, filesOfCommit, isAncestor, mergeBase, shortId } from './repo';
import { changedPaths } from './diff';

export type MergeRequestRow = {
  id: number;
  project_id: number;
  iid: number;
  title: string;
  description: string;
  author: string;
  source: string;
  target: string;
  state: string;
  delete_source_branch: boolean;
  assignees: string[];
  reviewers: string[];
  auto_merge: boolean;
  auto_merge_sha: string | null;
  merge_commit: string | null;
};

export type VersionRow = { id: number; number: number; base: string; head: string; start_commit: string };

export type ThreadRow = {
  id: number;
  project_id: number;
  mr_id: number | null;
  position: {
    path: string;
    old_line: number | null;
    new_line: number | null;
    end_line: number | null;
    version: number;
  } | null;
  current_line: number | null;
  resolved: boolean;
  outdated: boolean;
};

export type NoteRow = {
  id: number;
  author: string;
  body: string;
  system: boolean;
  pending: boolean;
  thread_id: number | null;
  created_at: string;
};

export function isDraft(title: string): boolean {
  return title.startsWith('Draft: ');
}

export async function loadRequest(sql: Sql, projectId: number, iid: number): Promise<MergeRequestRow | null> {
  const row = await sql.one<MergeRequestRow>(
    `select id, project_id, iid, title, description, author, source, target, state, delete_source_branch,
            assignees, reviewers, auto_merge, auto_merge_sha, merge_commit
     from merge_requests where project_id = $1 and iid = $2`,
    [projectId, iid],
  );
  return row === null ? null : { ...row, id: Number(row.id), project_id: Number(row.project_id), iid: Number(row.iid) };
}

export async function requireRequest(sql: Sql, projectId: number, iid: number): Promise<MergeRequestRow> {
  const request = await loadRequest(sql, projectId, iid);
  if (request === null) throw errors.notFound();
  return request;
}

export async function addNote(
  t: Tx,
  request: MergeRequestRow,
  author: string,
  body: string,
  options: { system?: boolean; pending?: boolean; threadId?: number } = {},
): Promise<number> {
  const row = await t.sql.one<{ id: string }>(
    `insert into notes (project_id, mr_id, thread_id, author, body, system, pending, created_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      request.project_id,
      request.id,
      options.threadId ?? null,
      author,
      body,
      options.system === true,
      options.pending === true,
      nowMs(),
    ],
  );
  return Number(row?.id);
}

export async function systemNote(t: Tx, request: MergeRequestRow, author: string, body: string): Promise<void> {
  await addNote(t, request, author, body, { system: true });
  await emit(t, request.project_id, 'merge_request', { iid: request.iid, note: body, announcement: body });
}

export async function notesOf(sql: Sql, request: MergeRequestRow, viewer: string, filter: string): Promise<NoteRow[]> {
  const rows = await sql.query<NoteRow>(
    `select id, author, body, system, pending, thread_id, created_at from notes
     where mr_id = $1 order by id`,
    [request.id],
  );
  return rows
    .map((row) => ({ ...row, id: Number(row.id), thread_id: row.thread_id === null ? null : Number(row.thread_id) }))
    .filter((row) => !row.pending || row.author === viewer)
    .filter((row) => (filter === 'comments' ? !row.system : filter === 'history' ? row.system : true));
}

export async function versionsOf(sql: Sql, requestId: number): Promise<VersionRow[]> {
  const rows = await sql.query<VersionRow>(
    'select id, number, base, head, start_commit from mr_versions where mr_id = $1 order by number',
    [requestId],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), number: Number(row.number) }));
}

export async function latestVersion(sql: Sql, requestId: number): Promise<VersionRow | null> {
  const versions = await versionsOf(sql, requestId);
  return versions.length === 0 ? null : versions[versions.length - 1];
}

export async function createVersion(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  head: string,
): Promise<VersionRow> {
  const targetHead = await branchHead(t.sql, project.id, request.target);
  const base = targetHead === null ? head : (await mergeBase(t.sql, project.id, targetHead, head)) ?? head;
  const existing = await versionsOf(t.sql, request.id);
  const number = existing.length + 1;
  const row = await t.sql.one<{ id: string }>(
    `insert into mr_versions (mr_id, number, base, head, start_commit) values ($1, $2, $3, $4, $5) returning id`,
    [request.id, number, base, head, targetHead ?? head],
  );
  await emit(t, project.id, 'version', { iid: request.iid, version: number, head });
  return { id: Number(row?.id), number, base, head, start_commit: targetHead ?? head };
}

export async function threadsOf(sql: Sql, requestId: number): Promise<ThreadRow[]> {
  const rows = await sql.query<ThreadRow>(
    `select id, project_id, mr_id, position, current_line, resolved, outdated from threads
     where mr_id = $1 order by id`,
    [requestId],
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    project_id: Number(row.project_id),
    mr_id: row.mr_id === null ? null : Number(row.mr_id),
    current_line: row.current_line === null ? null : Number(row.current_line),
  }));
}

export type SuggestionRow = {
  id: number;
  note_id: number;
  thread_id: number;
  path: string;
  start_line: number;
  end_line: number;
  lines: string[];
  state: string;
};

export async function suggestionsOf(sql: Sql, requestId: number): Promise<SuggestionRow[]> {
  const rows = await sql.query<SuggestionRow>(
    `select id, note_id, thread_id, path, start_line, end_line, lines, state from suggestions
     where mr_id = $1 order by id`,
    [requestId],
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    note_id: Number(row.note_id),
    thread_id: Number(row.thread_id),
    start_line: Number(row.start_line),
    end_line: Number(row.end_line),
  }));
}

export function parseSuggestionBlocks(body: string): { before: number; after: number; lines: string[] }[] {
  const out: { before: number; after: number; lines: string[] }[] = [];
  const lines = body.split('\n');
  let index = 0;
  while (index < lines.length) {
    const opener = /^```suggestion(?::-(\d+)\+(\d+))?\s*$/.exec(lines[index].trim());
    if (opener === null) {
      index += 1;
      continue;
    }
    const before = opener[1] === undefined ? 0 : Number(opener[1]);
    const after = opener[2] === undefined ? 0 : Number(opener[2]);
    const body2: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== '```') {
      body2.push(lines[index]);
      index += 1;
    }
    index += 1;
    out.push({ before, after, lines: body2 });
  }
  return out;
}

export async function createThread(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  author: string,
  body: string,
  position: ThreadRow['position'],
  pending: boolean,
): Promise<{ threadId: number; noteId: number }> {
  const row = await t.sql.one<{ id: string }>(
    `insert into threads (project_id, mr_id, position, current_line, resolved, outdated)
     values ($1, $2, $3, $4, false, false) returning id`,
    [
      project.id,
      request.id,
      position === null ? null : JSON.stringify(position),
      position === null ? null : position.new_line ?? position.old_line,
    ],
  );
  const threadId = Number(row?.id);
  const noteId = await addNote(t, request, author, body, { pending, threadId });
  if (position !== null) {
    for (const block of parseSuggestionBlocks(body)) {
      const start = (position.new_line ?? position.old_line ?? 1) - block.before;
      const end = (position.end_line ?? position.new_line ?? position.old_line ?? 1) + block.after;
      await t.sql.query(
        `insert into suggestions (note_id, thread_id, mr_id, path, start_line, end_line, lines, state)
         values ($1, $2, $3, $4, $5, $6, $7, 'open')`,
        [noteId, threadId, request.id, position.path, Math.max(1, start), end, JSON.stringify(block.lines)],
      );
    }
  }
  if (!pending) {
    await emit(t, project.id, 'thread', { iid: request.iid, thread_id: threadId, action: 'created' });
  }
  return { threadId, noteId };
}

export async function unresolvedCount(sql: Sql, requestId: number): Promise<number> {
  const threads = await threadsOf(sql, requestId);
  return threads.filter((thread) => !thread.resolved).length;
}

export async function setThreadResolved(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  thread: ThreadRow,
  resolved: boolean,
): Promise<number> {
  await t.sql.query('update threads set resolved = $2 where id = $1', [thread.id, resolved]);
  const left = await unresolvedCount(t.sql, request.id);
  const announcement = resolved
    ? left === 0
      ? 'Thread resolved. No unresolved threads left.'
      : left === 1
        ? 'Thread resolved. 1 unresolved thread left.'
        : `Thread resolved. ${left} unresolved threads left.`
    : 'Thread reopened.';
  await emit(t, project.id, 'thread', {
    iid: request.iid,
    thread_id: thread.id,
    resolved,
    unresolved: left,
    announcement,
  });
  return left;
}

export type RuleState = {
  name: string;
  kind: 'rule' | 'owners' | 'security';
  required: number;
  given: number;
  optional: boolean;
  eligible: string[];
};

export async function changedFilesOf(sql: Sql, project: ProjectRow, request: MergeRequestRow): Promise<string[]> {
  const version = await latestVersion(sql, request.id);
  if (version === null) return [];
  const before = await filesOfCommit(sql, project.id, version.base);
  const after = await filesOfCommit(sql, project.id, version.head);
  return changedPaths(before, after);
}

export async function approvalsGiven(sql: Sql, requestId: number): Promise<string[]> {
  const rows = await sql.query<{ username: string }>(
    'select username from approvals where mr_id = $1 order by id',
    [requestId],
  );
  return rows.map((row) => row.username);
}

async function groupEligible(sql: Sql, paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    const { eligibleGroupMembers } = await import('./access');
    out.push(...(await eligibleGroupMembers(sql, path)));
  }
  return out;
}

export async function ownersOf(
  sql: Sql,
  project: ProjectRow,
  request: MergeRequestRow,
): Promise<{ sections: OwnersSection[]; problems: OwnersProblem[] }> {
  const targetHead = await branchHead(sql, project.id, request.target);
  if (targetHead === null) return { sections: [], problems: [] };
  const files = await filesOfCommit(sql, project.id, targetHead);
  const content = files.get(ownersPath) ?? null;
  const changed = await changedFilesOf(sql, project, request);
  return readOwners(sql, content, changed);
}

export async function securityPending(sql: Sql, requestId: number): Promise<number> {
  const rows = await sql.query<{ count: string }>(
    `select count(*)::text as count from findings
     where mr_id = $1 and state in ('detected','confirmed') and severity in ('high','critical')`,
    [requestId],
  );
  return Number(rows[0]?.count ?? '0');
}

export async function securityNeedingReview(sql: Sql, requestId: number): Promise<number> {
  const rows = await sql.query<{ count: string }>(
    `select count(*)::text as count from findings where mr_id = $1 and state in ('detected','confirmed')`,
    [requestId],
  );
  return Number(rows[0]?.count ?? '0');
}

export async function approvalRules(
  sql: Sql,
  project: ProjectRow,
  request: MergeRequestRow,
): Promise<{ rules: RuleState[]; approvedBy: string[]; problems: OwnersProblem[] }> {
  const approvedBy = await approvalsGiven(sql, request.id);
  const counted = approvedBy.filter((username) => username !== request.author);
  const rules: RuleState[] = [];
  const { protectionFor } = await import('./pushrules');
  const protection = await protectionFor(sql, project.id, request.target);
  if (protection !== null) {
    const rows = await sql.query<{ name: string; required: number; users: string[]; groups: string[] }>(
      'select name, required, users, groups from approval_rules where project_id = $1 order by id',
      [project.id],
    );
    for (const row of rows) {
      const eligible = [...row.users, ...(await groupEligible(sql, row.groups))];
      rules.push({
        name: row.name,
        kind: 'rule',
        required: Number(row.required),
        given: counted.filter((username) => eligible.includes(username)).length,
        optional: Number(row.required) === 0,
        eligible,
      });
    }
  }
  const owners = await ownersOf(sql, project, request);
  for (const section of owners.sections) {
    rules.push({
      name: section.name,
      kind: 'owners',
      required: section.count,
      given: counted.filter((username) => section.owners.includes(username)).length,
      optional: section.optional,
      eligible: section.owners,
    });
  }
  if ((await securityPending(sql, request.id)) > 0) {
    const maintainers = await sql.query<{ username: string }>(
      `select u.username from memberships m join users u on u.id = m.user_id
       left join custom_roles r on r.id = m.custom_role_id
       where ((m.subject_type = 'project' and m.subject_id = $1)
              or (m.subject_type = 'group' and m.subject_id in (select id from groups)))
         and (m.role in ('maintainer','owner') or r.permissions ? 'approve')`,
      [project.id],
    );
    rules.push({
      name: 'Security review',
      kind: 'security',
      required: 1,
      given: counted.filter((username) => maintainers.some((row) => row.username === username)).length,
      optional: false,
      eligible: maintainers.map((row) => row.username),
    });
  }
  return { rules, approvedBy, problems: owners.problems };
}

export function missingApprovals(rules: RuleState[]): { total: number; names: string[] } {
  const unsatisfied = rules.filter((rule) => !rule.optional && rule.given < rule.required);
  return {
    total: unsatisfied.reduce((sum, rule) => sum + (rule.required - rule.given), 0),
    names: unsatisfied.map((rule) => rule.name),
  };
}

export type Check = { name: string; state: 'passed' | 'failed' | 'inactive'; text: string };

export async function mergeChecks(sql: Sql, project: ProjectRow, request: MergeRequestRow): Promise<Check[]> {
  const checks: Check[] = [];
  const targetHead = await branchHead(sql, project.id, request.target);
  const sourceHead = await branchHead(sql, project.id, request.source);
  const settings = project.settings;

  checks.push({
    name: 'state',
    state: request.state === 'closed' ? 'failed' : 'inactive',
    text: 'This merge request is closed.',
  });
  checks.push({
    name: 'target',
    state: targetHead === null ? 'failed' : 'passed',
    text: `Target branch ${request.target} no longer exists.`,
  });
  const stacked = await sql.one<{ iid: number }>(
    `select iid from merge_requests where project_id = $1 and source = $2 and state in ('opened') and id <> $3
     order by iid limit 1`,
    [project.id, request.target, request.id],
  );
  checks.push({
    name: 'stack',
    state: stacked === null ? 'inactive' : 'failed',
    text: stacked === null ? 'Waiting for a stacked request to merge.' : `Waiting for !${stacked.iid} to merge.`,
  });
  checks.push({
    name: 'draft',
    state: isDraft(request.title) ? 'failed' : 'passed',
    text: 'This merge request is a draft.',
  });

  let conflicted = false;
  if (targetHead !== null && sourceHead !== null) {
    const base = (await mergeBase(sql, project.id, targetHead, sourceHead)) ?? targetHead;
    const merged = threeWayMergeTrees(
      await filesOfCommit(sql, project.id, base),
      await filesOfCommit(sql, project.id, targetHead),
      await filesOfCommit(sql, project.id, sourceHead),
      request.target,
      request.source,
    );
    conflicted = merged.conflicts.length > 0;
  }
  checks.push({
    name: 'conflicts',
    state: conflicted ? 'failed' : 'passed',
    text: `Source branch has conflicts with ${request.target}.`,
  });

  const needsRebase =
    ['fast_forward', 'rebase'].includes(settings.merge_method) &&
    targetHead !== null &&
    sourceHead !== null &&
    !(await isAncestor(sql, project.id, targetHead, sourceHead));
  checks.push({
    name: 'rebase',
    state: !['fast_forward', 'rebase'].includes(settings.merge_method) ? 'inactive' : needsRebase ? 'failed' : 'passed',
    text: `Source branch must be rebased onto ${request.target}.`,
  });

  const unresolved = await unresolvedCount(sql, request.id);
  checks.push({
    name: 'threads',
    state: unresolved > 0 ? 'failed' : 'passed',
    text:
      unresolved === 1
        ? '1 unresolved thread must be resolved.'
        : `${unresolved} unresolved threads must be resolved.`,
  });

  const { rules } = await approvalRules(sql, project, request);
  const missing = missingApprovals(rules);
  checks.push({
    name: 'approvals',
    state: missing.total > 0 ? 'failed' : 'passed',
    text:
      missing.total === 1
        ? `Needs 1 more approval: ${missing.names.join(', ')}.`
        : `Needs ${missing.total} more approvals: ${missing.names.join(', ')}.`,
  });

  if (!settings.pipelines_must_succeed) {
    checks.push({ name: 'pipeline', state: 'inactive', text: 'Pipeline must succeed.' });
  } else {
    const pipeline =
      sourceHead === null
        ? null
        : await sql.one<{ id: string; status: string }>(
            'select id, status from pipelines where project_id = $1 and sha = $2 order by id desc limit 1',
            [project.id, sourceHead],
          );
    if (pipeline === null) {
      checks.push({
        name: 'pipeline',
        state: 'failed',
        text: `Pipeline must succeed. No pipeline has run on ${shortId(sourceHead ?? '')}.`,
      });
    } else {
      checks.push({
        name: 'pipeline',
        state: pipeline.status === 'success' ? 'passed' : 'failed',
        text: `Pipeline must succeed. Latest pipeline ${Number(pipeline.id)} is ${pipeline.status}.`,
      });
    }
  }

  const pending = await securityPending(sql, request.id);
  checks.push({
    name: 'security',
    state: pending > 0 ? 'failed' : 'passed',
    text: pending === 1 ? '1 security finding needs review.' : `${pending} security findings need review.`,
  });
  return checks;
}

export function firstFailedCheck(checks: Check[]): Check | null {
  return checks.find((check) => check.state === 'failed') ?? null;
}

export function closingIids(text: string): number[] {
  const out: number[] = [];
  const pattern = /\b(?:closes|fixes|resolves)\s+#(\d+)/gi;
  for (const match of text.matchAll(pattern)) {
    const iid = Number(match[1]);
    if (!out.includes(iid)) out.push(iid);
  }
  return out;
}

export async function closingText(sql: Sql, project: ProjectRow, request: MergeRequestRow, viewer: number): Promise<string> {
  const iids = await closingIssues(sql, project, request, viewer);
  if (iids.length === 0) return 'Merging closes no issues.';
  const list = iids.map((iid) => `#${iid}`).join(', ');
  return iids.length === 1 ? `Merging closes 1 issue: ${list}.` : `Merging closes ${iids.length} issues: ${list}.`;
}

export async function closingIssues(
  sql: Sql,
  project: ProjectRow,
  request: MergeRequestRow,
  viewerId: number,
): Promise<number[]> {
  const iids = closingIids(request.description);
  const out: number[] = [];
  for (const iid of iids) {
    const issue = await sql.one<{ id: string; confidential: boolean; author: string; assignees: string[] }>(
      'select id, confidential, author, assignees from issues where project_id = $1 and iid = $2',
      [project.id, iid],
    );
    if (issue === null) continue;
    if (issue.confidential) {
      const { canSeeConfidential } = await import('./planning');
      if (!(await canSeeConfidential(sql, project, viewerId, issue))) continue;
    }
    out.push(iid);
  }
  return out;
}

export async function mapThreadsToVersion(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  previous: VersionRow | null,
  next: VersionRow,
): Promise<void> {
  if (previous === null) return;
  const threads = await threadsOf(t.sql, request.id);
  const oldHead = await filesOfCommit(t.sql, project.id, previous.head);
  const newHead = await filesOfCommit(t.sql, project.id, next.head);
  const oldBase = await filesOfCommit(t.sql, project.id, previous.base);
  const newBase = await filesOfCommit(t.sql, project.id, next.base);
  for (const thread of threads) {
    if (thread.position === null || thread.outdated) continue;
    const onNewSide = thread.position.new_line !== null;
    const before = (onNewSide ? oldHead : oldBase).get(thread.position.path) ?? null;
    const after = (onNewSide ? newHead : newBase).get(thread.position.path) ?? null;
    if (after === null) {
      await markOutdated(t, project, request, thread);
      continue;
    }
    const diff = lineDiff(before === null ? [] : splitLines(before), splitLines(after));
    const mapping = new Map<number, number>();
    for (const line of diff) {
      if (line.type === 'context' && line.old !== null && line.new !== null) mapping.set(line.old, line.new);
    }
    const start = (onNewSide ? thread.position.new_line : thread.position.old_line) ?? 0;
    const end = thread.position.end_line ?? start;
    let outdated = false;
    for (let line = start; line <= end; line += 1) {
      if (!mapping.has(line)) outdated = true;
    }
    if (outdated) {
      await markOutdated(t, project, request, thread);
      continue;
    }
    await t.sql.query('update threads set current_line = $2 where id = $1', [thread.id, mapping.get(start) ?? start]);
  }
  await remapSuggestions(t, project, request, next);
}

async function remapSuggestions(t: Tx, project: ProjectRow, request: MergeRequestRow, next: VersionRow): Promise<void> {
  const suggestions = await suggestionsOf(t.sql, request.id);
  const threads = await threadsOf(t.sql, request.id);
  const files = await filesOfCommit(t.sql, project.id, next.head);
  for (const suggestion of suggestions) {
    if (suggestion.state !== 'open') continue;
    const thread = threads.find((item) => item.id === suggestion.thread_id);
    if (thread === undefined) continue;
    if (thread.outdated || !files.has(suggestion.path)) {
      await t.sql.query("update suggestions set state = 'outdated' where id = $1", [suggestion.id]);
      continue;
    }
    const shift = (thread.current_line ?? suggestion.start_line) - (thread.position?.new_line ?? suggestion.start_line);
    if (shift !== 0) {
      await t.sql.query('update suggestions set start_line = start_line + $2, end_line = end_line + $2 where id = $1', [
        suggestion.id,
        shift,
      ]);
    }
  }
}

async function markOutdated(t: Tx, project: ProjectRow, request: MergeRequestRow, thread: ThreadRow): Promise<void> {
  await t.sql.query('update threads set outdated = true, current_line = null where id = $1', [thread.id]);
  if (project.settings.auto_resolve_outdated && !thread.resolved) {
    await t.sql.query('update threads set resolved = true where id = $1', [thread.id]);
    await addNote(t, request, 'system', 'Resolved because the line changed.', { system: true, threadId: thread.id });
  }
  await emit(t, project.id, 'thread', { iid: request.iid, thread_id: thread.id, outdated: true });
}

export async function resetApprovals(t: Tx, project: ProjectRow, request: MergeRequestRow): Promise<void> {
  const given = await approvalsGiven(t.sql, request.id);
  if (given.length === 0) return;
  await t.sql.query('delete from approvals where mr_id = $1', [request.id]);
  await systemNote(t, request, 'system', 'Approvals reset: new commits were pushed.');
  await emit(t, project.id, 'approvals', {
    iid: request.iid,
    announcement: 'Approvals reset: new commits were pushed.',
  });
}

export async function openRequestsForBranch(sql: Sql, projectId: number, branch: string): Promise<MergeRequestRow[]> {
  const rows = await sql.query<MergeRequestRow>(
    `select id, project_id, iid, title, description, author, source, target, state, delete_source_branch,
            assignees, reviewers, auto_merge, auto_merge_sha, merge_commit
     from merge_requests where project_id = $1 and source = $2 and state in ('opened') order by iid`,
    [projectId, branch],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), project_id: Number(row.project_id), iid: Number(row.iid) }));
}

export function approvalEligible(access: Access, rules: RuleState[], username: string): boolean {
  if (rules.length === 0) return access.level >= roleLevels.developer || access.permissions.includes('approve');
  return rules.some((rule) => rule.eligible.includes(username));
}

export function canApprove(access: Access): boolean {
  return access.level >= roleLevels.developer || access.permissions.includes('approve');
}

export function levelAtLeast(access: Access, role: string): boolean {
  return access.level >= levelOf(role);
}
