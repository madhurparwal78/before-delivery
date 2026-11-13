// Delivery metrics from stored deployments (DP-32): production-tier facts plus lead times from merged requests.
import { now } from "../clock.ts";
import type { Queryable } from "../db.ts";
import { commitsBetween, isAncestor } from "../repo/index.ts";
import { computeMetrics, type DeploymentFact, type Metrics } from "./metrics.ts";

interface DeploymentRecord {
  readonly environment_id: number;
  readonly number: number;
  readonly status: string;
  readonly finished_at: number;
  readonly sha: string;
}

interface MergedRequest {
  readonly id: number;
  readonly merge_commit: string;
}

/** Earliest author time (ms) among the commits of a merged request, or null when it has none to read. */
async function earliestAuthorTime(q: Queryable, projectId: number, requestId: number): Promise<number | null> {
  const version = await q.maybe<{ base: string | null; head: string }>(
    "SELECT base, head FROM mr_versions WHERE mr_id = $1 ORDER BY number DESC LIMIT 1",
    [requestId],
  );
  if (version === undefined) return null;
  const commits = await commitsBetween(q, projectId, version.base, version.head);
  if (commits.length === 0) return null;
  return Math.min(...commits.map((commit) => commit.authored_at)) * 1000;
}

async function leadTimes(
  q: Queryable,
  projectId: number,
  merged: readonly MergedRequest[],
  deployed: DeploymentRecord,
  before: readonly DeploymentRecord[],
): Promise<number[]> {
  const times: number[] = [];
  for (const request of merged) {
    if (!(await isAncestor(q, projectId, request.merge_commit, deployed.sha))) continue;
    let earlier = false;
    for (const prior of before) {
      if (await isAncestor(q, projectId, request.merge_commit, prior.sha)) {
        earlier = true;
        break;
      }
    }
    if (earlier) continue;
    const authored = await earliestAuthorTime(q, projectId, request.id);
    if (authored !== null) times.push(deployed.finished_at - authored);
  }
  return times;
}

export async function projectMetrics(q: Queryable, projectId: number, zone: string, days: number): Promise<Metrics> {
  const records = await q.q<DeploymentRecord>(
    `SELECT d.environment_id, d.number, d.status, d.finished_at, d.sha FROM ci_deployments d
       JOIN ci_environments e ON e.id = d.environment_id
      WHERE d.project_id = $1 AND e.tier = 'production' AND d.finished_at IS NOT NULL AND d.status IN ('success', 'failed', 'rolled_back')
      ORDER BY d.environment_id, d.number`,
    [projectId],
  );
  const merged = await q.q<MergedRequest>(
    "SELECT id, merge_commit FROM merge_requests WHERE project_id = $1 AND state = 'merged' AND merge_commit IS NOT NULL ORDER BY id",
    [projectId],
  );
  const facts: DeploymentFact[] = [];
  for (const record of records) {
    const shipped = record.status === "success" || record.status === "rolled_back";
    const prior = records.filter((other) => other.environment_id === record.environment_id && other.number < record.number && other.status !== "failed");
    facts.push({
      environmentId: record.environment_id,
      number: record.number,
      status: record.status,
      finishedAt: record.finished_at,
      leadTimesMs: shipped && merged.length > 0 ? await leadTimes(q, projectId, merged, record, prior) : [],
    });
  }
  return computeMetrics(facts, now(), zone, days);
}
