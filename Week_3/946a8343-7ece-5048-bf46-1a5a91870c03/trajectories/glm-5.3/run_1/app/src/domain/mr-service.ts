import type { PoolClient } from 'pg';
import { AppError } from '../core/errors.js';
import type { Ctx } from '../api/ctx.js';
import { getCommit, mergeBase, isAncestor, splitLines } from './repo.js';
import { diffLines } from './diff.js';
import { short } from '../core/util.js';

export interface MrRow {
  id: number;
  project_id: number;
  iid: number;
  title: string;
  description: string;
  state: string;
  draft: boolean;
  author_id: number;
  source: string;
  target: string;
  assignees: string[];
  reviewers: string[];
  delete_source_branch: boolean;
  created_at: number;
  updated_at: number;
  merged_at: number | null;
  merge_commit: string | null;
  auto_merge: boolean;
  auto_merge_reason: string | null;
}

export async function getMr(c: PoolClient, projectId: number, iid: number): Promise<MrRow | null> {
  const r = await c.query<MrRow>(`SELECT * FROM merge_requests WHERE project_id = $1 AND iid = $2`, [projectId, iid]);
  return r.rows[0] ?? null;
}

export async function getMrById(c: PoolClient, id: number): Promise<MrRow | null> {
  const r = await c.query<MrRow>(`SELECT * FROM merge_requests WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function mrHead(c: PoolClient, projectId: number, source: string): Promise<string | null> {
  const r = await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, source]);
  return r.rows[0]?.commit_id ?? null;
}

export interface MrVersion {
  number: number;
  head: string;
  base: string;
  start_commit: string;
}

export async function latestVersion(c: PoolClient, mrId: number): Promise<MrVersion | null> {
  const r = await c.query<MrVersion & { created_at: number }>(`SELECT number, head, base, start_commit FROM mr_versions WHERE mr_id = $1 ORDER BY number DESC LIMIT 1`, [mrId]);
  const row = r.rows[0];
  if (!row) return null;
  return { number: row.number, head: row.head, base: row.base, start_commit: row.start_commit };
}

export async function versionByNumber(c: PoolClient, mrId: number, n: number): Promise<MrVersion | null> {
  const r = await c.query<MrVersion>(`SELECT number, head, base, start_commit FROM mr_versions WHERE mr_id = $1 AND number = $2`, [mrId, n]);
  return r.rows[0] ?? null;
}

export interface CheckResult {
  name: string;
  state: 'passed' | 'failed' | 'inactive';
  text: string;
}

export interface CheckDeps {
  projectId: number;
  targetExists: boolean;
  stackedOn: number | null; // iid of the request it waits for
  conflicts: string[] | null;
  needsRebase: boolean;
  unresolvedThreads: number;
  approvalRules: Array<{ name: string; kind: string; required: number; given: number }>;
  headPipeline: { id: number; status: string } | null;
  headSha: string | null;
  pipelinesMustSucceed: boolean;
  securityFindings: number;
}

/** The single merge check order: state, target, stack, draft, conflicts, rebase, threads, approvals, pipeline, security. */
export function evaluateChecks(mr: MrRow, deps: CheckDeps): CheckResult[] {
  const out: CheckResult[] = [];
  const push = (name: string, state: CheckResult['state'], text: string): void => {
    out.push({ name, state, text });
  };
  if (mr.state === 'closed') {
    push('state', 'failed', 'This merge request is closed.');
  } else if (mr.state === 'merged') {
    push('state', 'inactive', 'This merge request is already merged.');
  } else {
    push('state', 'passed', 'This merge request is open.');
  }
  if (!deps.targetExists) {
    push('target', 'failed', `Target branch ${mr.target} no longer exists.`);
  } else {
    push('target', 'passed', 'Target branch exists.');
  }
  if (deps.stackedOn !== null) {
    push('stack', 'failed', `Waiting for !${deps.stackedOn} to merge.`);
  } else {
    push('stack', 'inactive', 'This request is not stacked.');
  }
  if (mr.draft) {
    push('draft', 'failed', 'This merge request is a draft.');
  } else {
    push('draft', 'passed', 'This merge request is ready.');
  }
  if (deps.conflicts !== null && deps.conflicts.length > 0) {
    push('conflicts', 'failed', `Source branch has conflicts with ${mr.target}.`);
  } else {
    push('conflicts', 'passed', 'Source branch has no conflicts.');
  }
  if (deps.needsRebase) {
    push('rebase', 'failed', `Source branch must be rebased onto ${mr.target}.`);
  } else {
    push('rebase', 'inactive', 'Rebase is not required.');
  }
  if (deps.unresolvedThreads > 0) {
    const n = deps.unresolvedThreads;
    push('threads', 'failed', n === 1 ? '1 unresolved thread must be resolved.' : `${n} unresolved threads must be resolved.`);
  } else {
    push('threads', 'passed', 'All threads are resolved.');
  }
  const missing = deps.approvalRules.filter((r) => r.given < r.required);
  if (missing.length > 0) {
    const n = missing.reduce((s, r) => s + (r.required - r.given), 0);
    const names = missing.map((r) => r.name).join(', ');
    push('approvals', 'failed', n === 1 ? `Needs 1 more approval: ${names}.` : `Needs ${n} more approvals: ${names}.`);
  } else {
    push('approvals', 'passed', 'All approval rules are satisfied.');
  }
  if (deps.pipelinesMustSucceed) {
    if (deps.headPipeline === null) {
      push('pipeline', 'failed', `Pipeline must succeed. No pipeline has run on ${short(deps.headSha ?? '')}.`);
    } else if (deps.headPipeline.status === 'success' || deps.headPipeline.status === 'warning') {
      push('pipeline', 'passed', `Pipeline ${deps.headPipeline.id} succeeded.`);
    } else {
      push('pipeline', 'failed', `Pipeline must succeed. Latest pipeline ${deps.headPipeline.id} is ${deps.headPipeline.status}.`);
    }
  } else {
    push('pipeline', 'inactive', 'Pipelines need not succeed.');
  }
  if (deps.securityFindings > 0) {
    const n = deps.securityFindings;
    push('security', 'failed', n === 1 ? '1 security finding needs review.' : `${n} security findings need review.`);
  } else {
    push('security', 'passed', 'No security findings need review.');
  }
  return out;
}

export function firstFailed(checks: CheckResult[]): CheckResult | null {
  return checks.find((c) => c.state === 'failed') ?? null;
}

export async function countUnresolvedThreads(c: PoolClient, mrId: number): Promise<number> {
  const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM threads WHERE mr_id = $1 AND resolved = false AND outdated = false`, [mrId]);
  return Number(r.rows[0]?.n ?? 0);
}

export interface OwnerSection {
  name: string;
  required: number;
  optional: boolean;
  lines: Array<{ glob: string; owners: string[] }>;
  ownersByFile: Map<string, string[]>;
}

export interface OwnersParse {
  sections: OwnerSection[];
  problems: Array<{ line: number; reason: string }>;
}

export function parseOwnersFile(content: string, validUsers: Set<string>, validGroups: Set<string>): OwnersParse {
  const sections: OwnerSection[] = [];
  const problems: Array<{ line: number; reason: string }> = [];
  const lines = splitLines(content);
  let current: OwnerSection = { name: 'Owners', required: 1, optional: false, lines: [], ownersByFile: new Map() };
  sections.push(current);
  lines.forEach((text, i) => {
    const ln = i + 1;
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const sectionMatch = trimmed.match(/^(\^?)\[([^\]]*)\](\[(\d+)\])?$/);
    if (sectionMatch) {
      const optional = sectionMatch[1] === '^';
      const name = sectionMatch[2].trim();
      const count = sectionMatch[4] ? parseInt(sectionMatch[4], 10) : 1;
      if (name === '' || /\[/.test(name)) {
        problems.push({ line: ln, reason: 'bad section header' });
        return;
      }
      if (!Number.isInteger(count) || count < 0) {
        problems.push({ line: ln, reason: 'bad count' });
        return;
      }
      current = { name, required: count, optional, lines: [], ownersByFile: new Map() };
      sections.push(current);
      return;
    }
    // owner line: glob @user @group/path
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      problems.push({ line: ln, reason: 'no owners' });
      return;
    }
    const glob = parts[0];
    const owners: string[] = [];
    let bad = false;
    for (let k = 1; k < parts.length; k++) {
      const p = parts[k];
      if (!p.startsWith('@')) {
        problems.push({ line: ln, reason: 'no owners' });
        bad = true;
        break;
      }
      const name = p.slice(1);
      if (name.includes('/')) {
        if (!validGroups.has(name)) {
          problems.push({ line: ln, reason: `unknown group @${name}` });
          bad = true;
          break;
        }
      } else {
        if (!validUsers.has(name)) {
          problems.push({ line: ln, reason: `unknown user @${name}` });
          bad = true;
          break;
        }
      }
      owners.push(p.slice(1));
    }
    if (bad) return;
    current.lines.push({ glob, owners });
  });
  return { sections, problems };
}

export interface OwnerMatch {
  section: string;
  required: number;
  optional: boolean;
  owners: string[];
  given: number;
}

export function ownersForChangedFiles(parse: OwnersParse, changedFiles: string[]): OwnerMatch[] {
  const out: OwnerMatch[] = [];
  for (const section of parse.sections) {
    const entries = section.lines;
    if (entries.length === 0) continue;
    let matched = false;
    const owners = new Set<string>();
    for (const f of changedFiles) {
      let winner: { glob: string; owners: string[] } | null = null;
      for (const e of entries) {
        if (globMatches(e.glob, f)) winner = e;
      }
      if (winner) {
        matched = true;
        for (const o of winner.owners) owners.add(o);
      }
    }
    if (!matched) continue;
    out.push({ section: section.name, required: section.required, optional: section.optional, owners: [...owners], given: 0 });
  }
  return out;
}

function globMatches(pattern: string, path: string): boolean {
  let p = pattern;
  let anchored = false;
  if (p.startsWith('/')) {
    anchored = true;
    p = p.slice(1);
  }
  const endsWithSlash = p.endsWith('/');
  if (endsWithSlash) p = p.slice(0, -1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        re += '.*';
        i++;
        if (p[i + 1] === '/') i++;
        continue;
      }
      re += '[^/]*';
      continue;
    }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (endsWithSlash) re += '(?:/.*)?';
  if (anchored) {
    return new RegExp(`^${re}$`).test(path);
  }
  return new RegExp(`^(?:.*/)?${re}$`).test(path);
}

export async function changedFilesOf(c: PoolClient, ctx: Ctx, mr: MrRow): Promise<string[]> {
  const version = await latestVersion(c, mr.id);
  if (!version) return [];
  const base = await mergeBase(c, version.head, version.base);
  if (!base) return [];
  const headFiles = await fileIdsOfCommit(c, ctx, version.head);
  const baseFiles = await fileIdsOfCommit(c, ctx, base);
  const out: string[] = [];
  for (const p of new Set([...headFiles.keys(), ...baseFiles.keys()])) {
    if (headFiles.get(p) !== baseFiles.get(p)) out.push(p);
  }
  return out.sort();
}

async function fileIdsOfCommit(c: PoolClient, ctx: Ctx, commitId: string): Promise<Map<string, string>> {
  void ctx;
  const commit = await getCommit(c, commitId);
  if (!commit) return new Map();
  const { readTreeFlat } = await import('./repo.js');
  return readTreeFlat(c, commit.tree);
}

export async function computeConflicts(c: PoolClient, ctx: Ctx, mr: MrRow): Promise<string[]> {
  const version = await latestVersion(c, mr.id);
  if (!version) return [];
  const base = await mergeBase(c, version.head, version.base);
  if (!base) return [];
  if (base === version.base) {
    // target is ancestor: fast-forward possible, no conflicts
    return [];
  }
  const { mergeFileStates } = await import('./diff.js');
  const baseFiles = await filesOf(c, ctx, base);
  const targetFiles = await filesOf(c, ctx, version.base);
  const headFiles = await filesOf(c, ctx, version.head);
  const conflicts: string[] = [];
  for (const path of new Set([...baseFiles.keys(), ...targetFiles.keys(), ...headFiles.keys()])) {
    const res = mergeFileStates(baseFiles.get(path) ?? null, targetFiles.get(path) ?? null, headFiles.get(path) ?? null, mr.target, mr.source);
    if (res.conflict) conflicts.push(path);
  }
  return conflicts;
}

export async function filesOf(c: PoolClient, ctx: Ctx, commitId: string): Promise<Map<string, string>> {
  const commit = await getCommit(c, commitId);
  if (!commit) return new Map();
  const { readTreeFull } = await import('./repo.js');
  return readTreeFull(c, commit.tree, async (key) => ctx.storage.tryGet(key));
}

export async function needsRebase(c: PoolClient, ctx: Ctx, mr: MrRow, mergeMethod: string): Promise<boolean> {
  void ctx;
  if (mergeMethod !== 'fast_forward' && mergeMethod !== 'rebase') return false;
  const version = await latestVersion(c, mr.id);
  if (!version) return true;
  const targetHeadCommit = await branchHeadCommit(c, mr.project_id, mr.target);
  if (!targetHeadCommit) return true;
  return !(await isAncestor(c, targetHeadCommit, version.head));
}

async function branchHeadCommit(c: PoolClient, projectId: number, branch: string): Promise<string | null> {
  const r = await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, branch]);
  return r.rows[0]?.commit_id ?? null;
}

export async function headPipelineOf(c: PoolClient, mrId: number): Promise<{ id: number; status: string } | null> {
  const version = await latestVersion(c, mrId);
  if (!version) return null;
  const r = await c.query<{ id: number; status: string }>(
    `SELECT id, status FROM pipelines WHERE mr_id = $1 AND sha = $2 ORDER BY id DESC LIMIT 1`,
    [mrId, version.head],
  );
  return r.rows[0] ?? null;
}

export interface ApprovalRuleView {
  name: string;
  kind: 'rule' | 'owners' | 'security';
  required: number;
  given: number;
  optional: boolean;
  eligible: string[];
}

export function eligibleForRule(rule: { users: string[]; groups: string[] }, groupMembers: Map<string, string[]>): Set<string> {
  const out = new Set<string>(rule.users);
  for (const g of rule.groups) {
    for (const u of groupMembers.get(g) ?? []) out.add(u);
  }
  return out;
}

export async function approvalsOf(c: PoolClient, mrId: number): Promise<Array<{ user_id: number; username: string; sha: string }>> {
  const r = await c.query<{ user_id: number; username: string; sha: string }>(
    `SELECT a.user_id, u.username, a.sha FROM approvals a JOIN users u ON u.id = a.user_id WHERE a.mr_id = $1 ORDER BY a.created_at, a.id`,
    [mrId],
  );
  return r.rows;
}

export async function unresolvedThreadCount(c: PoolClient, mrId: number): Promise<number> {
  return countUnresolvedThreads(c, mrId);
}

export function pluralCheck(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export interface MrNote {
  id: number;
  author: string;
  body: string;
  system: boolean;
  pending: boolean;
  thread_id: number | null;
  created_at: number;
}

export async function notesOfMr(c: PoolClient, mrId: number, filter: string): Promise<MrNote[]> {
  const r = await c.query<MrNote>(
    `SELECT id, author, body, system, pending, thread_id, created_at FROM notes WHERE mr_id = $1 AND pending = false ORDER BY id`,
    [mrId],
  );
  if (filter === 'comments') return r.rows.filter((n) => !n.system);
  if (filter === 'history') return r.rows.filter((n) => n.system);
  return r.rows;
}
