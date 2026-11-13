import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, requireReadCode, writeAudit, nextIid } from './common.js';
import { ROLE_LEVEL, hasPermission, type Permission } from '../domain/access.js';
import {
  getMr, latestVersion, evaluateChecks, firstFailed, countUnresolvedThreads, changedFilesOf,
  computeConflicts, ownersForChangedFiles, parseOwnersFile, approvalsOf, headPipelineOf,
  needsRebase, type MrRow, type ApprovalRuleView,
} from '../domain/mr-service.js';
import { mergeBase, isAncestor, getCommit, storeCommit, buildTreeFromFiles, readTreeFull } from '../domain/repo.js';
import { diffLines, mergeFileStates, hasConflictMarkers, applySuggestion } from '../domain/diff.js';
import { filesOf, computeMerge, closingKeywords, commitsBetween, commitMessagesOf } from '../domain/merge-service.js';
import { pushConsequences } from '../domain/push-consequences.js';
import { addToTrain, removeFromTrain, carsFor, onCarPipelineFinished } from '../domain/train.js';
import { createPipeline } from '../domain/pipeline-service.js';
import { mergeProtectionVerdict, applyCommit, branchHead } from '../domain/repo-service.js';
import { short } from '../core/util.js';
import { OWNERS_FILE } from '../core/config.js';

export async function createMr(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const title = typeof body.title === 'string' ? body.title : '';
    const source = typeof body.source === 'string' ? body.source : '';
    const target = typeof body.target === 'string' ? body.target : '';
    const description = typeof body.description === 'string' ? body.description : '';
    const assignees = Array.isArray(body.assignees) ? body.assignees.map(String) : [];
    const reviewers = Array.isArray(body.reviewers) ? body.reviewers.map(String) : [];
    const deleteSource = body.delete_source_branch === true;
    const fields: Record<string, string> = {};
    if (title === '') fields.title = "Title can't be blank.";
    else if (title.length > 255) fields.title = 'Title is too long (255 characters at most).';
    if (source === '') fields.source = "Source branch can't be blank.";
    if (target === '') fields.target = "Target branch can't be blank.";
    if (Object.keys(fields).length > 0) throw errs.validation(fields);
    const sourceHead = await branchHead(client, id, source);
    const targetHead = await branchHead(client, id, target);
    if (!sourceHead) throw errs.validation({ source: `Branch ${source} doesn't exist.` });
    if (!targetHead) throw errs.validation({ target: `Branch ${target} doesn't exist.` });
    const draft = title.startsWith('Draft: ');
    const now = rc.ctx.now();
    const iid = await nextIid(client, id, 'request');
    const r = await client.query<{ id: number }>(
      `INSERT INTO merge_requests (project_id, iid, title, description, state, draft, author_id, source, target, assignees, reviewers, delete_source_branch, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'opened', $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
      [id, iid, title, description, draft, rc.user.id, source, target, assignees, reviewers, deleteSource, now],
    );
    const mrId = r.rows[0].id;
    const base = await mergeBase(client, sourceHead, targetHead);
    await client.query(`INSERT INTO mr_versions (mr_id, number, head, base, start_commit, created_at) VALUES ($1, 1, $2, $3, $4, $5)`,
      [mrId, sourceHead, base ?? '', targetHead, now]);
    await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
      [id, rc.user.username, 'Opened.', mrId, now]);
    const seq = await rc.ctx.live(client, id, 'merge_request', { iid, state: 'opened', event: 'open' });
    // webhook
    await queueMrWebhook(client, id, 'open', { iid, title, state: 'opened', source, target }, rc.user.username);
    await client.query('COMMIT');
    return { iid, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function queueMrWebhook(c: import('pg').PoolClient, projectId: number, action: string, mr: { iid: number; title: string; state: string; source: string; target: string }, user: string): Promise<void> {
  const hooks = (await c.query<{ id: number }>(`SELECT id FROM webhooks WHERE project_id = $1 AND 'merge_request' = ANY(events)`, [projectId])).rows;
  for (const h of hooks) {
    await c.query(`INSERT INTO deliveries (webhook_id, event, payload, state, attempts, next_at, retry_step, created_at) VALUES ($1, 'merge_request', $2, 'pending', 0, $3, 0, $3)`,
      [h.id, JSON.stringify({ event: 'merge_request', action, project: { id: projectId }, merge_request: mr, user }), 0]);
  }
}

export async function getMrDetail(rc: RequestCtx): Promise<unknown> {
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
    const versions = (await client.query(`SELECT number, head, base, start_commit FROM mr_versions WHERE mr_id = $1 ORDER BY number`, [mr.id])).rows;
    const checks = await buildChecks(rc, client, project, mr);
    const approvalsData = await buildApprovals(rc, client, project, mr);
    const headPipeline = await headPipelineOf(client, mr.id);
    const car = (await client.query<{ position: number; sha: string; pipeline_id: number | null }>(`SELECT position, sha, pipeline_id FROM train_cars WHERE mr_id = $1`, [mr.id])).rows[0] ?? null;
    const autoMerge = mr.auto_merge;
    const closes = visibleClosingIssues(client, id, mr, access);
    const viewing = (await client.query(`SELECT u.username FROM presence p JOIN users u ON u.id = p.user_id WHERE p.project_id = $1 AND p.mr_id = $2 AND p.last_seen > $3`, [id, mr.id, rc.ctx.now() - rc.ctx.settings.presenceTimeoutMs])).rows.map((r2) => (r2 as { username: string }).username);
    const ownersProblems = checks.ownersProblems;
    const reports = await buildReports(rc, client, mr);
    return {
      iid: mr.iid,
      title: mr.title,
      state: mr.state,
      draft: mr.draft,
      author: (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [mr.author_id])).rows[0]?.username ?? '',
      source: mr.source,
      target: mr.target,
      description: mr.description,
      source_head: version?.head ?? null,
      target_head: (await branchHead(client, id, mr.target)) ?? null,
      merge_base: version ? await mergeBase(client, version.head, version.base) : null,
      versions: versions,
      checks: checks.checks,
      approvals: approvalsData,
      owners_problems: ownersProblems,
      head_pipeline: headPipeline,
      train: car,
      auto_merge: autoMerge,
      closes: await closes,
      viewing,
      reports,
    };
  } finally {
    client.release();
  }
}

async function buildChecks(rc: RequestCtx, c: import('pg').PoolClient, project: { id: number; path: string; default_branch: string; merge_method: string; pipelines_must_succeed: boolean }, mr: MrRow): Promise<{ checks: Array<{ name: string; state: string; text: string }>; ownersProblems: Array<{ line: number; reason: string }>; rules: Array<{ name: string; kind: string; required: number; given: number; optional: boolean }> }> {
  const targetExists = (await branchHead(c, project.id, mr.target)) !== null;
  const stacked = (await c.query<{ iid: number }>(`SELECT mr2.iid FROM merge_requests mr2 WHERE mr2.project_id = $1 AND mr2.state = 'opened' AND mr2.source = $2 AND mr2.id != $3 ORDER BY mr2.iid LIMIT 1`, [project.id, mr.target, mr.id])).rows[0];
  const conflicts = await computeConflicts(c, rc.ctx, mr);
  const rebase = await needsRebase(c, rc.ctx, mr, project.merge_method);
  const unresolved = await countUnresolvedThreads(c, mr.id);
  const { rules, ownersProblems } = await ownerRules(rc, c, project, mr);
  const headPipeline = await headPipelineOf(c, mr.id);
  const version = await latestVersion(c, mr.id);
  const securityFindings = (await c.query<{ n: string }>(`SELECT count(*) AS n FROM findings WHERE mr_id = $1 AND severity IN ('high','critical') AND state IN ('detected','confirmed')`, [mr.id])).rows[0];
  const checks = evaluateChecks(mr, {
    projectId: project.id,
    targetExists,
    stackedOn: stacked ? stacked.iid : null,
    conflicts,
    needsRebase: rebase,
    unresolvedThreads: unresolved,
    approvalRules: rules.map((r) => ({ name: r.name, kind: r.kind, required: r.required, given: r.given })),
    headPipeline,
    headSha: version?.head ?? null,
    pipelinesMustSucceed: project.pipelines_must_succeed,
    securityFindings: Number(securityFindings?.n ?? 0),
  });
  return { checks: checks.map((c2) => ({ name: c2.name, state: c2.state, text: c2.text })), ownersProblems, rules };
}

async function ownerRules(rc: RequestCtx, c: import('pg').PoolClient, project: { id: number; path: string }, mr: MrRow): Promise<{ rules: Array<{ name: string; kind: string; required: number; given: number; optional: boolean }>; ownersProblems: Array<{ line: number; reason: string }> }> {
  const targetHead = await branchHead(c, project.id, mr.target);
  const changed = await changedFilesOf(c, rc.ctx, mr);
  const projectRules = (await c.query<{ name: string; required_count: number; users: string[]; groups: string[] }>(`SELECT name, required_count, users, groups FROM approval_rules WHERE project_id = $1 ORDER BY id`, [project.id])).rows;
  const isProtected = (await c.query<{ pattern: string }>(`SELECT pattern FROM protected_branches WHERE project_id = $1`, [project.id])).rows.some((p) => new RegExp(`^${p.pattern.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(mr.target));
  const approvals = await approvalsOf(c, mr.id);
  const out: Array<{ name: string; kind: string; required: number; given: number; optional: boolean }> = [];
  let ownersProblems: Array<{ line: number; reason: string }> = [];
  const authorUsername = (await c.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [mr.author_id])).rows[0]?.username ?? '';
  if (isProtected) {
    for (const rule of projectRules) {
      const eligible = new Set(rule.users);
      for (const g of rule.groups) {
        const gRow = (await c.query<{ id: number }>(`SELECT id FROM groups WHERE path = $1`, [g])).rows[0];
        if (gRow) {
          const members = (await c.query<{ username: string }>(`SELECT u.username FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1 AND (gm.role IN ('developer','maintainer','owner') OR (gm.custom_role_id IS NOT NULL AND EXISTS (SELECT 1 FROM custom_roles cr WHERE cr.id = gm.custom_role_id AND cr.base IN ('developer','maintainer','owner'))))`, [gRow.id])).rows;
          for (const m of members) eligible.add(m.username);
        }
      }
      const given = approvals.filter((a) => eligible.has(a.username) && a.username !== authorUsername).length;
      out.push({ name: rule.name, kind: 'rule', required: rule.required_count, given, optional: false });
    }
    // owners file
    if (targetHead) {
      const ownersText = (await filesOf(c, rc.ctx, targetHead)).get(OWNERS_FILE) ?? null;
      if (ownersText !== null) {
        const users = new Set((await c.query<{ username: string }>(`SELECT username FROM users`)).rows.map((r) => r.username));
        const groups = new Set((await c.query<{ path: string }>(`SELECT path FROM groups`)).rows.map((r) => r.path));
        const parsed = parseOwnersFile(ownersText, users, groups);
        ownersProblems = parsed.problems;
        const matches = ownersForChangedFiles(parsed, changed);
        for (const m of matches) {
          const given = approvals.filter((a) => m.owners.includes(a.username) && a.username !== authorUsername).length;
          out.push({ name: m.section, kind: 'owners', required: m.required, given, optional: m.optional });
        }
      }
    }
  }
  const highCritical = (await c.query<{ n: string }>(`SELECT count(*) AS n FROM findings WHERE mr_id = $1 AND severity IN ('high','critical') AND state IN ('detected','confirmed')`, [mr.id])).rows[0];
  if (Number(highCritical?.n ?? 0) > 0) {
    const given = approvals.filter((a) => {
      const acc = a.username;
      void acc;
      return false;
    }).length;
    void given;
    const gRow = (await c.query<{ group_id: number }>(`SELECT group_id FROM projects WHERE id = $1`, [project.id])).rows[0];
    const ancestors = gRow ? (await (await import('../domain/access.js')).groupAncestors(c, gRow.group_id)) : [];
    const maintainers = new Set((await c.query<{ username: string }>(`
      SELECT u.username FROM users u WHERE u.id IN (
        SELECT user_id FROM project_members WHERE project_id = $1 AND (role IN ('maintainer','owner') OR EXISTS (SELECT 1 FROM custom_roles cr WHERE cr.id = project_members.custom_role_id AND cr.base IN ('maintainer','owner')))
        UNION
        SELECT user_id FROM group_members WHERE group_id = ANY($2::bigint[]) AND (role IN ('maintainer','owner') OR EXISTS (SELECT 1 FROM custom_roles cr WHERE cr.id = group_members.custom_role_id AND cr.base IN ('maintainer','owner')))
      )
    `, [project.id, ancestors])).rows.map((r) => r.username));
    const givenCount = approvals.filter((a) => maintainers.has(a.username) && a.username !== authorUsername).length;
    out.push({ name: 'Security review', kind: 'security', required: 1, given: givenCount, optional: false });
  }
  return { rules: out, ownersProblems };
}

async function buildApprovals(rc: RequestCtx, c: import('pg').PoolClient, project: { id: number; path: string }, mr: MrRow): Promise<{ rules: Array<{ name: string; kind: string; required: number; given: number; optional: boolean }>; approved_by: string[] }> {
  const { rules } = await ownerRules(rc, c, project, mr);
  const approvals = await approvalsOf(c, mr.id);
  return { rules, approved_by: approvals.map((a) => a.username) };
}

async function buildReports(rc: RequestCtx, c: import('pg').PoolClient, mr: MrRow): Promise<Record<string, unknown>> {
  const version = await latestVersion(c, mr.id);
  if (!version) return { tests: null, coverage: null, quality: null, security: null };
  const headPipeline = await headPipelineOf(c, mr.id);
  const targetHead = await branchHead(c, mr.project_id, mr.target);
  let basePipeline: number | null = null;
  if (targetHead) {
    const base = await mergeBase(c, version.head, targetHead);
    if (base) {
      const r = (await c.query<{ id: number }>(`SELECT id FROM pipelines WHERE project_id = $1 AND sha = $2 AND status = 'success' ORDER BY id DESC LIMIT 1`, [mr.project_id, base])).rows[0];
      basePipeline = r?.id ?? null;
    }
  }
  const headTests = headPipeline ? await reportOf(c, headPipeline.id, 'tests') : null;
  const baseTests = basePipeline ? await reportOf(c, basePipeline, 'tests') : null;
  const testsText = headTests ? testsSummary(headTests, baseTests) : 'No test report.';
  const headCov = headPipeline ? await reportOf(c, headPipeline.id, 'coverage') : null;
  const baseCov = basePipeline ? await reportOf(c, basePipeline, 'coverage') : null;
  const coverageText = headCov ? coverageSummary(headCov, baseCov) : 'Coverage unknown';
  const headQ = headPipeline ? await reportOf(c, headPipeline.id, 'quality') : null;
  const baseQ = basePipeline ? await reportOf(c, basePipeline, 'quality') : null;
  const qualityText = headQ ? qualitySummary(headQ, baseQ) : 'No code quality report.';
  const findings = (await c.query(`SELECT id, report_id, severity, title, path, line, state, reason FROM findings WHERE mr_id = $1`, [mr.id])).rows;
  const reviewCount = findings.filter((f) => ['detected', 'confirmed'].includes(f.state)).length;
  const securityText = reviewCount === 0 ? 'No security findings need review.' : reviewCount === 1 ? '1 security finding needs review.' : `${reviewCount} security findings need review.`;
  return {
    base_pipeline_id: basePipeline,
    head_pipeline_id: headPipeline?.id ?? null,
    tests: { text: testsText, ...(headTests ? testsDetail(headTests, baseTests) : { new_failures: [], failed: 0, passed: 0, skipped: 0 }) },
    coverage: { text: coverageText, head: headCov?.percent ?? null, base: baseCov?.percent ?? null },
    quality: { text: qualityText, ...(headQ ? qualityDetail(headQ, baseQ) : { new: [], resolved: [] }) },
    security: { text: securityText, findings },
  };
}

async function reportOf(c: import('pg').PoolClient, pipelineId: number, kind: string): Promise<Record<string, unknown> | null> {
  const r = (await c.query<{ data: string }>(`SELECT data FROM reports WHERE pipeline_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1`, [pipelineId, kind])).rows[0];
  if (!r) return null;
  try {
    return JSON.parse(r.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface TestReport { cases: Array<{ name: string; status: string; ms: number }> }
interface CoverageReport { percent: number }
interface QualityItem { fingerprint: string; severity: string; path: string; line: number; message: string }

function testsSummary(head: Record<string, unknown>, base: Record<string, unknown> | null): string {
  const cases = head.cases as TestReport['cases'];
  const failed = cases.filter((c) => c.status === 'failed').length;
  const passed = cases.filter((c) => c.status === 'passed').length;
  const skipped = cases.filter((c) => c.status === 'skipped').length;
  const baseFailed = new Set((base?.cases as TestReport['cases'] | undefined)?.filter((c) => c.status === 'failed').map((c) => c.name) ?? []);
  const newFailures = cases.filter((c) => c.status === 'failed' && !baseFailed.has(c.name)).length;
  return `${newFailures} new failures, ${failed} failed, ${passed} passed, ${skipped} skipped`;
}

function testsDetail(head: Record<string, unknown>, base: Record<string, unknown> | null): { new_failures: string[]; failed: number; passed: number; skipped: number } {
  const cases = head.cases as TestReport['cases'];
  const baseFailed = new Set((base?.cases as TestReport['cases'] | undefined)?.filter((c) => c.status === 'failed').map((c) => c.name) ?? []);
  return {
    new_failures: cases.filter((c) => c.status === 'failed' && !baseFailed.has(c.name)).map((c) => c.name),
    failed: cases.filter((c) => c.status === 'failed').length,
    passed: cases.filter((c) => c.status === 'passed').length,
    skipped: cases.filter((c) => c.status === 'skipped').length,
  };
}

function coverageSummary(head: Record<string, unknown>, base: Record<string, unknown> | null): string {
  const hp = head.percent as number;
  if (!base) return `Coverage ${hp.toFixed(2)}% (no base)`;
  const bp = base.percent as number;
  const diff = hp - bp;
  return `Coverage ${hp.toFixed(2)}% (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})`;
}

function qualitySummary(head: Record<string, unknown>, base: Record<string, unknown> | null): string {
  const items = head as unknown as QualityItem[];
  const baseItems = (base as unknown as QualityItem[] | null) ?? [];
  const baseFp = new Set(baseItems.map((x) => x.fingerprint));
  const headFp = new Set(items.map((x) => x.fingerprint));
  const added = items.filter((x) => !baseFp.has(x.fingerprint)).length;
  const resolved = baseItems.filter((x) => !headFp.has(x.fingerprint)).length;
  return `${added} new, ${resolved} resolved`;
}

function qualityDetail(head: Record<string, unknown>, base: Record<string, unknown> | null): { new: string[]; resolved: string[] } {
  const items = head as unknown as QualityItem[];
  const baseItems = (base as unknown as QualityItem[] | null) ?? [];
  const baseFp = new Set(baseItems.map((x) => x.fingerprint));
  const headFp = new Set(items.map((x) => x.fingerprint));
  return {
    new: items.filter((x) => !baseFp.has(x.fingerprint)).map((x) => x.fingerprint),
    resolved: baseItems.filter((x) => !headFp.has(x.fingerprint)).map((x) => x.fingerprint),
  };
}

async function visibleClosingIssues(c: import('pg').PoolClient, projectId: number, mr: MrRow, access: { role: string | null; level: number; member: boolean }): Promise<number[]> {
  const iids = closingKeywords(mr.description);
  const commits = await commitsBetween(c, mr.source, mr.target);
  const messages = await commitMessagesOf(c, commits);
  for (const m of messages) {
    for (const n of closingKeywords(m)) iids.push(n);
  }
  const out: number[] = [];
  for (const iid of new Set(iids)) {
    const issue = (await c.query<{ id: number; confidential: boolean; author_id: number }>(`SELECT id, confidential, author_id FROM issues WHERE project_id = $1 AND iid = $2`, [projectId, iid])).rows[0];
    if (!issue) continue;
    if (issue.confidential && access.level < ROLE_LEVEL.reporter) {
      const assigned = (await c.query<{ n: string }>(`SELECT count(*) AS n FROM issue_assignees WHERE issue_id = $1 AND user_id = $2`, [issue.id, -1])).rows[0];
      void assigned;
      const isAuthor = false;
      void isAuthor;
      continue;
    }
    out.push(iid);
  }
  return out;
}

export async function patchMr(rc: RequestCtx): Promise<unknown> {
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
    if (mr.state === 'merged') {
      const event = body.state_event;
      if (event) throw new AppError(409, 'wrong_state', 'This merge request is already merged.');
    }
    const now = rc.ctx.now();
    if (typeof body.title === 'string') {
      if (body.title === '') throw errs.validation({ title: "Title can't be blank." });
      if (body.title.length > 255) throw errs.validation({ title: 'Title is too long (255 characters at most).' });
      await client.query(`UPDATE merge_requests SET title = $2, draft = $3, updated_at = $4 WHERE id = $1`, [mr.id, body.title, body.title.startsWith('Draft: '), now]);
      if (body.title.startsWith('Draft: ') && !mr.draft) {
        await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, 'Marked as draft.', true, false, $3, $4)`, [id, rc.user.username, mr.id, now]);
      } else if (!body.title.startsWith('Draft: ') && mr.draft) {
        await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, 'Marked as ready.', true, false, $3, $4)`, [id, rc.user.username, mr.id, now]);
      }
    }
    if (typeof body.description === 'string') {
      await client.query(`UPDATE merge_requests SET description = $2, updated_at = $3 WHERE id = $1`, [mr.id, body.description, now]);
    }
    if (typeof body.target === 'string' && body.target !== mr.target) {
      const targetHead = await branchHead(client, id, body.target);
      if (!targetHead) throw errs.validation({ target: `Branch ${body.target} doesn't exist.` });
      await client.query(`UPDATE merge_requests SET target = $2, updated_at = $3 WHERE id = $1`, [mr.id, body.target, now]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`, [id, rc.user.username, `Changed target from ${mr.target} to ${body.target}.`, mr.id, now]);
    }
    if (Array.isArray(body.assignees)) {
      await client.query(`UPDATE merge_requests SET assignees = $2 WHERE id = $1`, [mr.id, body.assignees.map(String)]);
    }
    if (Array.isArray(body.reviewers)) {
      await client.query(`UPDATE merge_requests SET reviewers = $2 WHERE id = $1`, [mr.id, body.reviewers.map(String)]);
    }
    const stateEvent = typeof body.state_event === 'string' ? body.state_event : null;
    if (stateEvent === 'close') {
      if (mr.state === 'merged') throw new AppError(409, 'wrong_state', 'This merge request is already merged.');
      await client.query(`UPDATE merge_requests SET state = 'closed', updated_at = $2 WHERE id = $1`, [mr.id, now]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, 'Closed.', true, false, $3, $4)`, [id, rc.user.username, mr.id, now]);
      await queueMrWebhook(client, id, 'close', { iid: mr.iid, title: mr.title, state: 'closed', source: mr.source, target: mr.target }, rc.user.username);
    } else if (stateEvent === 'reopen') {
      if (mr.state === 'merged') throw new AppError(409, 'wrong_state', 'This merge request is already merged.');
      await client.query(`UPDATE merge_requests SET state = 'opened', updated_at = $2 WHERE id = $1`, [mr.id, now]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, 'Reopened.', true, false, $3, $4)`, [id, rc.user.username, mr.id, now]);
      await queueMrWebhook(client, id, 'reopen', { iid: mr.iid, title: mr.title, state: 'opened', source: mr.source, target: mr.target }, rc.user.username);
    } else if (stateEvent === 'ready') {
      if (!mr.draft) throw new AppError(409, 'wrong_state', "This merge request isn't a draft.");
      const newTitle = mr.title.replace(/^Draft: /, '');
      await client.query(`UPDATE merge_requests SET title = $2, draft = false, updated_at = $3 WHERE id = $1`, [mr.id, newTitle, now]);
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, 'Marked as ready.', true, false, $3, $4)`, [id, rc.user.username, mr.id, now]);
    }
    const seq = await rc.ctx.live(client, id, 'merge_request', { iid, state: 'updated', event: 'update' });
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function listMrThreads(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const threads = (await client.query(`SELECT * FROM threads WHERE mr_id = $1 ORDER BY id`, [mr.id])).rows;
    const out = [];
    for (const t of threads) {
      const notes = (await client.query(`SELECT id, author, body, system, pending, thread_id, created_at FROM notes WHERE thread_id = $1 AND (pending = false OR author = $2) ORDER BY id`, [t.id, rc.user.username])).rows;
      const sugg = (await client.query(`SELECT id, note_id, path, start_line, end_line, lines, state FROM suggestions WHERE note_id IN (SELECT id FROM notes WHERE thread_id = $1)`, [t.id])).rows;
      out.push({
        id: t.id,
        position: t.path === null ? null : { path: t.path, old_line: t.old_line, new_line: t.new_line, end_line: t.end_line, version: t.version },
        current_line: t.current_line,
        resolved: t.resolved,
        outdated: t.outdated,
        notes,
        suggestions: sugg,
      });
    }
    return { threads: out };
  } finally {
    client.release();
  }
}

export async function createThread(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'reporter');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const bodyText = typeof body.body === 'string' ? body.body : '';
    if (bodyText === '') throw errs.validation({ body: "Comment can't be blank." });
    const pos = body.position as Record<string, unknown> | null | undefined;
    const pending = body.pending === true;
    const now = rc.ctx.now();
    let threadId: number | null = null;
    let position: { path: string | null; old_line: number | null; new_line: number | null; end_line: number | null; version: number | null } = { path: null, old_line: null, new_line: null, end_line: null, version: null };
    if (pos && typeof pos === 'object') {
      const path = typeof pos.path === 'string' ? pos.path : '';
      const oldLine = typeof pos.old_line === 'number' ? pos.old_line : null;
      const newLine = typeof pos.new_line === 'number' ? pos.new_line : null;
      const endLine = typeof pos.end_line === 'number' ? pos.end_line : null;
      const version = typeof pos.version === 'number' ? pos.version : null;
      if (oldLine === null && newLine === null) throw errs.validation({ position: 'A line comment needs old_line or new_line.' });
      if (endLine !== null && oldLine === null && newLine === null) throw errs.validation({ position: 'A range needs a start line.' });
      position = { path, old_line: oldLine, new_line: newLine, end_line: endLine, version };
      const side = oldLine !== null ? 'old' : 'new';
      const r = await client.query<{ id: number }>(`INSERT INTO threads (mr_id, path, old_line, new_line, end_line, version, side, current_line, resolved, outdated, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, false, $9) RETURNING id`,
        [mr.id, path, oldLine, newLine, endLine, version ?? 1, side, newLine ?? oldLine, now]);
      threadId = r.rows[0].id;
    } else {
      const r = await client.query<{ id: number }>(`INSERT INTO threads (mr_id, path, old_line, new_line, end_line, version, side, current_line, resolved, outdated, created_at) VALUES ($1, NULL, NULL, NULL, NULL, 1, 'none', NULL, false, false, $2) RETURNING id`,
        [mr.id, now]);
      threadId = r.rows[0].id;
    }
    const noteR = await client.query<{ id: number }>(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, thread_id, created_at) VALUES ($1, $2, $3, false, $4, $5, $6, $7) RETURNING id`,
      [id, rc.user.username, bodyText, pending, mr.id, threadId, now]);
    // suggestions
    await parseSuggestions(client, noteR.rows[0].id, bodyText, position.path, position.new_line, position.end_line ?? position.new_line, position.old_line);
    const seq = await rc.ctx.live(client, id, 'thread', { mr_iid: iid, thread_id: threadId, event: pending ? 'review' : 'created' });
    await client.query('COMMIT');
    return { id: threadId, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function parseSuggestions(c: import('pg').PoolClient, noteId: number, body: string, path: string | null, newLine: number | null, endLine: number | null, oldLine: number | null): Promise<void> {
  if (path === null) return;
  const re = /```suggestion(:([+-]\d+)([+-]\d+))?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let above = 0;
    let below = 0;
    if (m[1]) {
      const a = m[2];
      const b = m[3];
      if (a) above = parseInt(a, 10);
      if (b) below = parseInt(b, 10);
    }
    const lines = m[4].split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    void oldLine;
    const start = (newLine ?? 1) - above;
    const end = (endLine ?? newLine ?? 1) + below;
    await c.query(`INSERT INTO suggestions (note_id, path, start_line, end_line, lines, state, created_at) VALUES ($1, $2, $3, $4, $5, 'open', $6)`,
      [noteId, path, start, end, JSON.stringify(lines), 0]);
  }
}

export async function resolveThread(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const tid = Number(rc.params.tid);
  const body = requireBody(rc);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'reporter');
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const thread = (await client.query(`SELECT * FROM threads WHERE id = $1 AND mr_id = $2`, [tid, mr.id])).rows[0];
    if (!thread) throw errs.notFound();
    const resolved = body.resolved === true;
    await client.query(`UPDATE threads SET resolved = $2 WHERE id = $1`, [tid, resolved]);
    const seq = await rc.ctx.live(client, id, 'thread', { mr_iid: iid, thread_id: tid, event: resolved ? 'resolved' : 'reopened' });
    await client.query('COMMIT');
    return { resolved, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function listMrNotes(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const iid = Number(rc.params.iid);
  const filter = rc.query.get('filter') ?? 'all';
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const mr = await getMr(client, id, iid);
    if (!mr) throw errs.notFound();
    const rows = (await client.query(`SELECT id, author, body, system, pending, thread_id, created_at FROM notes WHERE mr_id = $1 AND (pending = false OR author = $2) ORDER BY id`, [mr.id, rc.user.username])).rows;
    const filtered = filter === 'comments' ? rows.filter((n) => !n.system) : filter === 'history' ? rows.filter((n) => n.system) : rows;
    return { notes: filtered };
  } finally {
    client.release();
  }
}

export { buildChecks, buildApprovals, buildReports };
