import type { PoolClient } from 'pg';
import { AppError } from '../core/errors.js';
import { Ctx } from '../api/ctx.js';
import { short } from '../core/util.js';
import {
  buildTreeFromFiles, getCommit, getTreeEntries, readTreeFlat, readTreeFull,
  storeCommit, storeTree, splitLines, type TreeEntry,
} from './repo.js';
import { diffLines } from './diff.js';
import { evaluatePushRules, protectionFor, pushRulesFor, type PushVerdict, type PushContext, type PushRulesRow } from './push-rules.js';
import { ROLE_LEVEL, type Role } from './access.js';

export interface CommitAction {
  action: 'create' | 'update' | 'delete' | 'move';
  path: string;
  content?: string;
  previous_path?: string;
}

export interface CommitRequest {
  branch: string;
  start_ref: string | null;
  base_commit: string | null;
  message: string;
  actions: CommitAction[];
  author: string;
  authorTime?: number;
  commitTime?: number;
  committer?: string;
}

export interface CommitResult {
  id: string;
  tree: string;
}

export async function branchHead(c: PoolClient, projectId: number, branch: string): Promise<string | null> {
  const r = await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, branch]);
  return r.rows[0]?.commit_id ?? null;
}

export async function refHead(c: PoolClient, projectId: number, kind: 'branch' | 'tag', name: string): Promise<string | null> {
  const r = await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = $2 AND name = $3`, [projectId, kind, name]);
  return r.rows[0]?.commit_id ?? null;
}

export async function resolveRef(c: PoolClient, projectId: number, ref: string): Promise<string | null> {
  const b = await branchHead(c, projectId, ref);
  if (b) return b;
  const t = await refHead(c, projectId, 'tag', ref);
  if (t) return t;
  const commit = await getCommit(c, ref);
  return commit ? commit.id : null;
}

export async function treeFiles(c: PoolClient, ctx: Ctx, commitId: string): Promise<Map<string, string>> {
  const commit = await getCommit(c, commitId);
  if (!commit) throw new AppError(404, 'not_found', 'Not found.');
  return readTreeFull(c, commit.tree, async (key) => ctx.storage.tryGet(key));
}

export async function blobIdsOfTree(c: PoolClient, commitId: string): Promise<Map<string, string>> {
  const commit = await getCommit(c, commitId);
  if (!commit) throw new AppError(404, 'not_found', 'Not found.');
  return readTreeFlat(c, commit.tree);
}

export async function fileAt(c: PoolClient, ctx: Ctx, commitId: string, path: string): Promise<string | null> {
  const files = await treeFiles(c, ctx, commitId);
  return files.get(path) ?? null;
}

function validatePath(path: string): void {
  if (path === '') throw new AppError(422, 'validation', 'File  does not exist.', { fields: { path: 'File  does not exist.' } });
  if (path.startsWith('/')) throw new AppError(422, 'validation', `File ${path} does not exist.`, { fields: { path: `File ${path} does not exist.` } });
  const segs = path.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') throw new AppError(422, 'validation', `File ${path} does not exist.`, { fields: { path: `File ${path} does not exist.` } });
  }
}

function isUtf8(content: string): boolean {
  try {
    Buffer.from(content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export interface PushOutcome {
  commit: string;
  newBranch: boolean;
}

/** The single commit routine used by the editor, the API, suggestions, merges and trains. */
export async function applyCommit(
  ctx: Ctx,
  c: PoolClient,
  projectId: number,
  req: CommitRequest,
  opts: { bypassProtection?: boolean; bypassPushRules?: boolean; isTrain?: boolean } = {},
): Promise<CommitResult> {
  const now = ctx.now();
  const authorTime = req.authorTime ?? Math.floor(now / 1000);
  const commitTime = req.commitTime ?? Math.floor(now / 1000);
  const committer = req.committer ?? req.author;

  const existing = await branchHead(c, projectId, req.branch);
  const isNewBranch = existing === null && req.start_ref !== undefined && req.start_ref !== null && (await branchHead(c, projectId, req.start_ref)) !== null;
  let parentForBase: string | null;
  if (req.start_ref) {
    parentForBase = await resolveRef(c, projectId, req.start_ref);
    if (parentForBase === null) {
      throw new AppError(422, 'validation', `Ref ${req.start_ref} doesn't exist.`, { fields: { start_ref: `Ref ${req.start_ref} doesn't exist.` } });
    }
    const startBranchHead = await branchHead(c, projectId, req.start_ref);
    if (startBranchHead === null) {
      throw new AppError(422, 'validation', `Ref ${req.start_ref} doesn't exist.`, { fields: { start_ref: `Ref ${req.start_ref} doesn't exist.` } });
    }
    parentForBase = startBranchHead;
  } else {
    parentForBase = existing;
  }

  const isEmptyRepo = existing === null && req.start_ref === undefined || req.start_ref === null && existing === null;

  // base check
  const expected = parentForBase;
  if (req.base_commit === null) {
    if (!isEmptyRepo) {
      throw new AppError(409, 'stale_base', `Your base commit none is behind ${req.branch} at ${short(expected ?? '')}. Refresh and try again.`);
    }
  } else if (req.base_commit !== expected) {
    throw new AppError(409, 'stale_base', `Your base commit ${short(req.base_commit)} is behind ${req.branch} at ${short(expected ?? 'none')}. Refresh and try again.`);
  }

  if (req.message.trim() === '') {
    throw new AppError(422, 'validation', "Commit message can't be blank.", { fields: { message: "Commit message can't be blank." } });
  }

  // Build the new file set
  const baseCommit = expected;
  const files = new Map<string, string>();
  if (baseCommit) {
    const baseFiles = await treeFiles(c, ctx, baseCommit);
    for (const [k, v] of baseFiles) files.set(k, v);
  }

  const changedFiles: string[] = [];
  for (const act of req.actions) {
    validatePath(act.path);
    if (act.action === 'create') {
      if (files.has(act.path)) throw new AppError(422, 'validation', `File ${act.path} already exists.`, { fields: { path: `File ${act.path} already exists.` } });
      const content = act.content ?? '';
      if (!isUtf8(content)) throw new AppError(422, 'validation', `File ${act.path} is not UTF-8 text.`);
      if (Buffer.byteLength(content, 'utf8') > ctx.settings.fileMaxBytes) {
        throw new AppError(413, 'payload_too_large', `File ${act.path} is too large (${ctx.settings.fileMaxBytes} bytes at most).`);
      }
      files.set(act.path, content);
      changedFiles.push(act.path);
    } else if (act.action === 'update') {
      if (!files.has(act.path)) throw new AppError(422, 'validation', `File ${act.path} does not exist.`, { fields: { path: `File ${act.path} does not exist.` } });
      const content = act.content ?? '';
      if (!isUtf8(content)) throw new AppError(422, 'validation', `File ${act.path} is not UTF-8 text.`);
      if (Buffer.byteLength(content, 'utf8') > ctx.settings.fileMaxBytes) {
        throw new AppError(413, 'payload_too_large', `File ${act.path} is too large (${ctx.settings.fileMaxBytes} bytes at most).`);
      }
      files.set(act.path, content);
      changedFiles.push(act.path);
    } else if (act.action === 'delete') {
      if (!files.has(act.path)) throw new AppError(422, 'validation', `File ${act.path} does not exist.`, { fields: { path: `File ${act.path} does not exist.` } });
      files.delete(act.path);
      changedFiles.push(act.path);
    } else if (act.action === 'move') {
      const from = act.previous_path ?? '';
      if (!files.has(from)) throw new AppError(422, 'validation', `File ${from} does not exist.`, { fields: { path: `File ${from} does not exist.` } });
      const content = act.content ?? files.get(from) ?? '';
      files.delete(from);
      files.set(act.path, content);
      changedFiles.push(from, act.path);
    }
  }

  // Large blobs must go to storage
  for (const [path, content] of files) {
    if (Buffer.byteLength(content, 'utf8') > ctx.settings.inlineMaxBytes) {
      if (!(await ctx.storage.healthy())) {
        throw new AppError(503, 'storage_unavailable', 'File storage is unavailable. Nothing was committed. Try again in a moment.');
      }
    }
  }

  // Push rules (may be bypassed for seeds)
  if (!opts.bypassPushRules) {
    const rules = await pushRulesFor(c, projectId);
    if (rules) {
      const addedLines: Array<{ path: string; line: number; text: string }> = [];
      if (rules.secrets) {
        for (const path of changedFiles) {
          const before = baseCommit ? (await treeFiles(c, ctx, baseCommit)).get(path) ?? null : null;
          const after = files.get(path) ?? null;
          const oldSet = new Set(splitLines(before ?? ''));
          if (after) {
            splitLines(after).forEach((text, i) => {
              if (!oldSet.has(text)) addedLines.push({ path, line: i + 1, text });
            });
          }
        }
      }
      const verdict = evaluatePushRules(rules, {
        branch: req.branch,
        isNewBranch: isNewBranch || isEmptyRepo && req.start_ref === null && existing === null && parentForBase === null,
        message: req.message,
        changedFiles: changedFiles.filter((f) => files.has(f)),
        resultingTree: [...files.keys()].sort(),
        addedLines,
      });
      if (!verdict.ok) {
        throw new AppError(verdict.status ?? 422, verdict.code ?? 'push_rule', verdict.message ?? 'push rule');
      }
    }
  }

  // Protection
  if (!opts.bypassProtection) {
    const prot = await protectionFor(c, projectId, req.branch);
    if (prot) {
      // allowed_to_push resolved by the caller; here we record the requirement
      // The caller (route) checks the user role before calling with a protection context.
      throw new ProtectionRequired(prot.pattern, prot.allowed_to_push);
    }
  }

  const tree = await buildTreeFromFiles(c, files, ctx.settings.inlineMaxBytes);
  // store large blobs in storage
  for (const [path, content] of files) {
    if (Buffer.byteLength(content, 'utf8') > ctx.settings.inlineMaxBytes) {
      const { blobId } = await import('./repo.js');
      const id = blobId(content);
      const stored = await ctx.storage.put(`blobs/${id}`, content);
      void stored;
      // update blobs row to reflect stored status
      await c.query(`UPDATE blobs SET content = NULL, inline_exceeded = true WHERE id = $1`, [id]);
    }
  }

  const parents = baseCommit ? [baseCommit] : [];
  const id = await storeCommit(c, {
    tree,
    parents,
    author: req.author,
    author_time: authorTime,
    committer,
    commit_time: commitTime,
    message: req.message,
  });

  if (existing === null && (req.start_ref || req.base_commit === null)) {
    await c.query(`INSERT INTO refs (project_id, kind, name, commit_id) VALUES ($1, 'branch', $2, $3) ON CONFLICT (project_id, kind, name) DO NOTHING`, [projectId, req.branch, id]);
  } else if (existing === null && req.start_ref === undefined) {
    await c.query(`INSERT INTO refs (project_id, kind, name, commit_id) VALUES ($1, 'branch', $2, $3)`, [projectId, req.branch, id]);
  } else {
    await c.query(`UPDATE refs SET commit_id = $3 WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, req.branch, id]);
  }

  return { id, tree };
}

export class ProtectionRequired extends AppError {
  readonly pattern: string;
  readonly allowedToPush: string;
  constructor(pattern: string, allowedToPush: string) {
    super(403, 'protected_branch', `You can't push to protected branch ${pattern}.`);
    this.pattern = pattern;
    this.allowedToPush = allowedToPush;
  }
}

export function roleAtLeast(role: Role | null, min: Role): boolean {
  return ROLE_LEVEL[role ?? 'guest' as Role] >= ROLE_LEVEL[min];
}

/** Verdict for pushing a branch by a user of the given role. */
export async function pushProtectionVerdict(c: PoolClient, projectId: number, branch: string, role: Role | null, hasPushProtected: boolean): Promise<PushVerdict> {
  const prot = await protectionFor(c, projectId, branch);
  if (!prot) return { ok: true };
  const min = prot.allowed_to_push as Role;
  const allowed = ROLE_LEVEL[role ?? 'guest'] >= ROLE_LEVEL[min] || hasPushProtected;
  if (allowed) return { ok: true };
  return { ok: false, code: 'protected_branch', status: 403, message: `You can't push to protected branch ${prot.pattern}.` };
}

export async function mergeProtectionVerdict(c: PoolClient, projectId: number, branch: string, role: Role | null, hasPushProtected: boolean): Promise<PushVerdict> {
  const prot = await protectionFor(c, projectId, branch);
  if (!prot) return { ok: true };
  const min = prot.allowed_to_merge as Role;
  const allowed = ROLE_LEVEL[role ?? 'guest'] >= ROLE_LEVEL[min] || hasPushProtected;
  if (allowed) return { ok: true };
  return { ok: false, code: 'protected_branch', status: 403, message: `You can't merge into protected branch ${prot.pattern}.` };
}

export async function tagProtectionVerdict(c: PoolClient, projectId: number, tag: string, role: Role | null): Promise<PushVerdict> {
  const r = await c.query<{ pattern: string; allowed_to_create: string }>(`SELECT pattern, allowed_to_create FROM protected_tags WHERE project_id = $1`, [projectId]);
  for (const row of r.rows) {
    const pattern = row.pattern;
    const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    if (re.test(tag)) {
      const min = row.allowed_to_create as Role;
      if (ROLE_LEVEL[role ?? 'guest'] >= ROLE_LEVEL[min]) return { ok: true };
      return { ok: false, code: 'protected_tag', status: 403, message: `You can't create protected tag ${tag}.` };
    }
  }
  return { ok: true };
}

export async function diffOfCommits(c: PoolClient, ctx: Ctx, from: string, to: string): Promise<Array<{ path: string; old_path: string; status: string; hunks: ReturnType<typeof diffLines> }>> {
  const fromFiles = await treeFiles(c, ctx, from);
  const toFiles = await treeFiles(c, ctx, to);
  const paths = new Set([...fromFiles.keys(), ...toFiles.keys()]);
  const out = [];
  for (const path of [...paths].sort()) {
    const a = fromFiles.get(path) ?? '';
    const b = toFiles.get(path) ?? '';
    if (a === b) continue;
    const status = !fromFiles.has(path) ? 'added' : !toFiles.has(path) ? 'deleted' : 'modified';
    out.push({ path, old_path: path, status, hunks: diffLines(a, b) });
  }
  return out;
}

export async function buildTree(c: PoolClient, ctx: Ctx, files: Map<string, string>): Promise<string> {
  return buildTreeFromFiles(c, files, ctx.settings.inlineMaxBytes);
}

export { splitLines, getCommit, getTreeEntries, storeTree, readTreeFlat, readTreeFull, storeCommit };
export type { TreeEntry, PushRulesRow };
