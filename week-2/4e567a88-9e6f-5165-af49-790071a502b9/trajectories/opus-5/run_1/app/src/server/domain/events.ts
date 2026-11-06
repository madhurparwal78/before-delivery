import { db } from '../db';
import { memberById } from '../store/people';
import { currentPolicy } from '../store/policy';
import { deliverableEndpointsOfTeam, insertEvent, newEventId } from '../store/webhooks';
import { JobRecord } from '../types';
import { projectJob } from './projection';

export type JobEventType = 'job.succeeded' | 'job.failed' | 'job.cancelled';

export function eventTypeFor(status: string): JobEventType | null {
  if (status === 'succeeded') return 'job.succeeded';
  if (status === 'failed') return 'job.failed';
  if (status === 'cancelled') return 'job.cancelled';
  return null;
}

/** One event per enabled endpoint of the job's team, carrying the payload that endpoint's owner may see. */
export async function emitJobEvent(job: JobRecord, type: JobEventType): Promise<void> {
  const endpoints = await deliverableEndpointsOfTeam(db, job.teamId);
  if (endpoints.length === 0) return;
  const policy = await currentPolicy();
  for (const endpoint of endpoints) {
    const owner = await memberById(endpoint.createdBy);
    if (!owner) continue;
    const projection = await projectJob(job, owner, policy);
    const eventId = newEventId();
    const body = JSON.stringify({
      id: eventId,
      type,
      created_at: new Date().toISOString(),
      data: { job: projection },
    });
    await insertEvent(db, { id: eventId, endpointId: endpoint.id, jobId: job.id, eventType: type, body });
  }
}
