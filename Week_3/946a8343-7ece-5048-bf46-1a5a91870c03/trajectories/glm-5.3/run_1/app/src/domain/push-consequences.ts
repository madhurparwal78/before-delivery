import type { PoolClient } from 'pg';
import type { Ctx } from '../api/ctx.js';
import { AppError } from '../core/errors.js';
import { mergeBase } from './repo.js';
import { diffLines } from './diff.js';
import { filesOf } from './merge-service.js';
import { createPipeline, cancelOlderInterruptible } from './pipeline-service.js';
import type { MrRow } from './mr-service.js';

/**
 * One push to a source branch: version, threads, approvals reset, owners,
 * pipeline, train removal, auto-merge cancel — all in one transaction.
 */
export async function pushConsequences(
  ctx: Ctx,
  c: PoolClient,
  opts: {
    projectId: number;
    projectPath: string;
    branch: string;
    previousHead: string | null;
    newHead: string;
    defaultBranch: string;
    resetApprovalsOnPush: boolean;
    autoResolveOutdated: boolean;
    actor: string;
    skipPipeline?: boolean;
    skipTrain?: boolean;
    forceNote?: string;
  },
): Promise<{ pipeline: { id: number | null; created: boolean; reason?: string }; seq: number }> {
  const now = ctx.now();
  const mrs = (await c.query<MrRow>(`SELECT * FROM merge_requests WHERE project_id = $1 AND source = $2 AND state = 'opened'`, [opts.projectId, opts.branch])).rows;

  let pipelineResult: { id: number | null; created: boolean; reason?: string } = { id: null, created: false, reason: 'no config' };
  if (!opts.skipPipeline) {
    pipelineResult = await createPipeline(ctx, c, {
      projectId: opts.projectId,
      projectPath: opts.projectPath,
      ref: opts.branch,
      sha: opts.newHead,
      source: 'push',
      defaultBranch: opts.defaultBranch,
      previousHead: opts.previousHead,
      mr: mrs.length > 0 ? mrs.sort((a, b) => a.iid - b.iid)[0] : null,
    });
    if ('id' in pipelineResult && pipelineResult.id !== null) {
      await cancelOlderInterruptible(ctx, c, opts.projectId, opts.branch, pipelineResult.id, now);
    }
  }

  for (const mr of mrs) {
    const targetHead = (await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [opts.projectId, mr.target])).rows[0]?.commit_id ?? null;
    const base = targetHead ? await mergeBase(c, opts.newHead, targetHead) : null;
    const versionCount = (await c.query<{ n: string }>(`SELECT count(*) AS n FROM mr_versions WHERE mr_id = $1`, [mr.id])).rows[0];
    const nextNumber = Number(versionCount?.n ?? 0) + 1;
    await c.query(`INSERT INTO mr_versions (mr_id, number, head, base, start_commit, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
      mr.id, nextNumber, opts.newHead, base ?? '', targetHead ?? '', now,
    ]);
    await c.query(`UPDATE merge_requests SET updated_at = $2 WHERE id = $1`, [mr.id, now]);

    // remap or outdate threads
    const threads = (await c.query<{ id: number; path: string | null; old_line: number | null; new_line: number | null; end_line: number | null; version: number; side: string; current_line: number | null; resolved: boolean; outdated: boolean }>(
      `SELECT id, path, old_line, new_line, end_line, version, side, current_line, resolved, outdated FROM threads WHERE mr_id = $1`,
      [mr.id],
    )).rows;
    const prevVersion = (await c.query<{ head: string; base: string }>(`SELECT head, base FROM mr_versions WHERE mr_id = $1 AND number = $2`, [mr.id, nextNumber - 1])).rows[0];
    for (const t of threads) {
      if (t.outdated) continue;
      if (t.path === null) continue;
      const oldFiles = prevVersion ? await filesOf(c, ctx, prevVersion.head) : new Map();
      const newFiles = await filesOf(c, ctx, opts.newHead);
      const oldText = oldFiles.get(t.path) ?? '';
      const newText = newFiles.get(t.path) ?? '';
      const prevSide = t.side === 'old' ? oldText : oldText;
      void prevSide;
      const fromText = oldText;
      const toText = newText;
      const d = diffLines(fromText, toText);
      const mapping = mapLines(d, t.side, t.old_line, t.new_line, t.end_line);
      if (mapping.kind === 'outdated') {
        await c.query(`UPDATE threads SET outdated = true, current_line = NULL WHERE id = $1`, [t.id]);
        if (opts.autoResolveOutdated && !t.resolved) {
          await c.query(`UPDATE threads SET resolved = true WHERE id = $1`, [t.id]);
          await c.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, thread_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5, $6)`,
            [opts.projectId, opts.actor, 'Resolved because the line changed.', mr.id, t.id, now]);
        }
      } else {
        await c.query(`UPDATE threads SET current_line = $2 WHERE id = $1`, [t.id, mapping.line]);
      }
    }

    // approvals reset
    if (opts.resetApprovalsOnPush) {
      const had = (await c.query<{ n: string }>(`SELECT count(*) AS n FROM approvals WHERE mr_id = $1`, [mr.id])).rows[0];
      if (Number(had?.n ?? 0) > 0) {
        await c.query(`DELETE FROM approvals WHERE mr_id = $1`, [mr.id]);
        await c.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
          [opts.projectId, 'system', 'Approvals reset: new commits were pushed.', mr.id, now]);
        for (const a of []) void a;
        await writeAuditForApprovalReset(c, opts.projectId, mr);
      }
    }

    // train removal
    if (!opts.skipTrain) {
      await c.query(`DELETE FROM train_cars WHERE mr_id = $1`, [mr.id]);
    }

    // auto-merge cancel
    if (mr.auto_merge) {
      await c.query(`UPDATE merge_requests SET auto_merge = false, auto_merge_reason = 'new commits were pushed' WHERE id = $1`, [mr.id]);
      await c.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, $2, $3, true, false, $4, $5)`,
        [opts.projectId, 'system', 'Auto-merge canceled: new commits were pushed.', mr.id, now]);
    }
  }

  const seq = await ctx.live(c, opts.projectId, 'version', { branch: opts.branch, head: opts.newHead });
  return { pipeline: pipelineResult, seq };
}

type Mapping = { kind: 'moved'; line: number } | { kind: 'outdated' };

function mapLines(d: ReturnType<typeof diffLines>, side: string, oldLine: number | null, newLine: number | null, endLine: number | null): Mapping {
  const start = side === 'old' ? oldLine : newLine;
  if (start === null) return { kind: 'outdated' };
  const end = endLine ?? start;
  let current: number | null = null;
  // check each line of the range
  let allOk = true;
  for (let n = start; n <= end; n++) {
    const line = findMapped(d, side, n);
    if (line === null) {
      allOk = false;
      break;
    }
    if (n === start) current = line;
  }
  if (!allOk) return { kind: 'outdated' };
  return { kind: 'moved', line: current ?? start };
}

function findMapped(d: ReturnType<typeof diffLines>, side: string, n: number): number | null {
  for (const l of d) {
    if (side === 'old' && l.old === n) {
      return l.new;
    }
    if (side === 'new' && l.new === n) {
      return l.new;
    }
  }
  return null;
}

async function writeAuditForApprovalReset(c: PoolClient, projectId: number, mr: MrRow): Promise<void> {
  // approvals reset is announced; audit rows are per approval add/remove so nothing to write here
  void c; void projectId; void mr;
}

export { mergeBase };
