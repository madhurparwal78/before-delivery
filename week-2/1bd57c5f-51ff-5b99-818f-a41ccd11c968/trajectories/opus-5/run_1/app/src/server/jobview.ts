import { formatLocalDateTime } from './core/timezone.js';
import type { Queryable } from './db.js';
import { jobProgress, loadItems, type JobRecord, type Viewer } from './model.js';
import {
  allOccurrences,
  codeWindow,
  currentOrNextOccurrence,
  occurrencesOfMember,
} from './visits.js';

export async function currentRevision(
  tx: Queryable,
  jobId: string,
): Promise<{ revision: number; objectKey: string; contentType: string } | null> {
  const { rows } = await tx.query(
    `select revision, object_key, content_type from plan_revisions
      where job_id = $1 order by revision desc limit 1`,
    [jobId],
  );
  if (rows.length === 0) return null;
  return {
    revision: rows[0].revision as number,
    objectKey: rows[0].object_key as string,
    contentType: rows[0].content_type as string,
  };
}

/** Whether this viewer may read the access card right now, by role and by code window. */
export async function accessAvailability(
  tx: Queryable,
  job: JobRecord,
  viewer: Viewer,
  now: Date,
): Promise<{ available: boolean; visibleUntil: Date | null }> {
  if (viewer.role === 'owner' || viewer.role === 'lead') {
    return { available: true, visibleUntil: null };
  }
  if (viewer.role === 'homeowner' || viewer.memberId === null) {
    return { available: false, visibleUntil: null };
  }
  const mine = occurrencesOfMember(await allOccurrences(tx, job), viewer.memberId);
  const window = codeWindow(mine, now);
  return { available: window.open, visibleUntil: window.visibleUntil };
}

export async function projectJob(
  tx: Queryable,
  job: JobRecord,
  viewer: Viewer,
  now: Date,
): Promise<Record<string, unknown>> {
  const items = await loadItems(tx, job.id);
  const plan = await currentRevision(tx, job.id);
  const access = await accessAvailability(tx, job, viewer, now);

  let nextVisit: { starts_at: string; ends_at: string } | null = null;
  if (viewer.role === 'trade' && viewer.memberId !== null) {
    const mine = occurrencesOfMember(await allOccurrences(tx, job), viewer.memberId);
    const next = currentOrNextOccurrence(mine, now);
    if (next !== null) {
      nextVisit = {
        starts_at: formatLocalDateTime(next.startsLocal),
        ends_at: formatLocalDateTime(next.endsLocal),
      };
    }
  }

  return {
    id: job.id,
    name: job.name,
    address: job.address,
    time_zone: job.timeZone,
    status: job.status,
    progress: jobProgress(items, viewer),
    my_role: viewer.role,
    my_trade: viewer.trade,
    plan_url: plan === null ? null : `/api/jobs/${job.id}/plan`,
    plan_revision: plan === null ? null : plan.revision,
    access_codes_available: access.available,
    next_visit: nextVisit,
  };
}
