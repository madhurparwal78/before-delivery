// Seeding merge requests for the grading seed route and the demo instance: no live messages, notes, audit or webhooks.
import type { Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { now } from "../clock.ts";
import { validationOne } from "../errors.ts";
import type { MergeRequestSeedResult, SeedKeys, SeedMergeRequest, SeedThread } from "../admin/seed-spec.ts";
import * as repo from "../repo/index.ts";
import { parseSuggestionBlocks, suggestionRegion } from "./suggestions.ts";

function userId(keys: SeedKeys, username: string): number {
  const id = keys.userIds.get(username);
  if (id === undefined) throw validationOne("merge_requests", `Unknown user ${username}.`);
  return id;
}

async function seedThread(tx: Tx, mrId: number, keys: SeedKeys, spec: SeedThread, stamp: number): Promise<number> {
  const author = userId(keys, spec.author);
  const onLine = spec.path !== null;
  const first = spec.new_line ?? spec.old_line;
  const thread = await tx.one<{ id: number }>(
    `INSERT INTO mr_threads (mr_id, author_id, path, old_line, new_line, end_line, version, current_line, current_end, outdated, resolved, pending, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, false, $11) RETURNING id`,
    [mrId, author, spec.path, onLine ? spec.old_line : null, onLine ? spec.new_line : null, onLine ? spec.end_line : null, onLine ? 1 : null,
      onLine ? first : null, onLine ? (spec.end_line ?? first) : null, spec.resolved, stamp],
  );
  const note = await tx.one<{ id: number }>(
    "INSERT INTO mr_notes (mr_id, thread_id, author, user_id, body, system, pending, created_at) VALUES ($1, $2, $3, $4, $5, false, false, $6) RETURNING id",
    [mrId, thread.id, spec.author, author, spec.body, stamp],
  );
  if (onLine && spec.new_line !== null) {
    for (const block of parseSuggestionBlocks(spec.body)) {
      const region = suggestionRegion(spec.new_line, spec.end_line ?? spec.new_line, block);
      await tx.q(
        `INSERT INTO mr_suggestions (mr_id, thread_id, note_id, above, below, lines, start_line, end_line, outdated, applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, false)`,
        [mrId, thread.id, note.id, block.above, block.below, block.lines, region.start, region.end],
      );
    }
  }
  return thread.id;
}

export async function seedMergeRequests(tx: Tx, project: ProjectRow, keys: SeedKeys, specs: readonly SeedMergeRequest[]): Promise<MergeRequestSeedResult> {
  const requests: Record<string, { id: number; iid: number }> = {};
  const threads: Record<string, { id: number }> = {};
  const stamp = now();
  for (const spec of specs) {
    const { iid } = await tx.one<{ iid: number }>("UPDATE projects SET next_mr_iid = next_mr_iid + 1 WHERE id = $1 RETURNING next_mr_iid - 1 AS iid", [project.id]);
    const row = await tx.one<{ id: number }>(
      `INSERT INTO merge_requests (project_id, iid, author_id, title, description, source, target, state, delete_source_branch, assignees, reviewers, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
      [project.id, iid, userId(keys, spec.author), spec.title, spec.description, spec.source, spec.target, spec.state, spec.delete_source_branch, spec.assignees, spec.reviewers, stamp],
    );
    const sourceHead = await repo.branchHead(tx, project.id, spec.source);
    const targetHead = await repo.branchHead(tx, project.id, spec.target);
    if (sourceHead !== null) {
      const base = targetHead === null ? null : await repo.mergeBase(tx, project.id, targetHead, sourceHead);
      await tx.q("INSERT INTO mr_versions (mr_id, number, base, head, start, created_at) VALUES ($1, 1, $2, $3, $4, $5)", [row.id, base, sourceHead, targetHead, stamp]);
    }
    for (const username of spec.approvals) {
      await tx.q("INSERT INTO mr_approvals (mr_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [row.id, userId(keys, username), stamp]);
    }
    for (const thread of spec.threads) threads[thread.key] = { id: await seedThread(tx, row.id, keys, thread, stamp) };
    requests[spec.key] = { id: row.id, iid };
    keys.mergeRequestIds.set(spec.key, { id: row.id, iid });
  }
  return { merge_requests: requests, threads };
}
