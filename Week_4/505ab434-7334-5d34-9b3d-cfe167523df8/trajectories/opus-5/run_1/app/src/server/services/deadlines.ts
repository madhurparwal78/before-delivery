import { REQUEST_STATE_LABELS } from '../../shared/labels.js';
import { appendAudit } from '../audit.js';
import { readClock, writeClock } from '../clock.js';
import { db, withTransaction, type Queryable } from '../db.js';
import { EVERYONE, REVIEWERS, publish } from '../live.js';
import { enqueueMail } from '../mail.js';
import { repo } from '../repo.js';
import { leastLoaded } from '../domain/routing.js';
import { notices } from './notices.js';
import { openStageCounts, openStageOf, publishRequestChange } from './requests.js';
import { dueTimers, markTimerFired, type TimerRow } from './timers.js';

async function fireTimer(tx: Queryable, timer: TimerRow): Promise<void> {
  const request = await repo.requestForUpdate(timer.requestId, tx);
  await markTimerFired(tx, timer.id, timer.dueAt);
  if (!request || request.state !== 'under_review' || request.submissionSeq !== timer.submissionSeq) return;

  if (timer.kind === 'warning') {
    const holder = await repo.principal(request.holderId, tx);
    if (holder && request.deadline) {
      await enqueueMail(tx, notices.deadlineWarning(holder.email, request.id, request.deadline), timer.dueAt);
    }
    return;
  }

  if (timer.kind === 'breach') {
    const stages = await repo.stages(request.id, tx);
    const stage = openStageOf(stages);
    if (!stage) return;
    const owners = await repo.principalsByRole('owner', tx);
    const counts = await openStageCounts(tx);
    const owner = leastLoaded(
      owners.map((candidate) => ({
        id: candidate.id,
        displayName: candidate.displayName,
        openStages: counts.get(candidate.id) ?? 0,
      })),
    );
    if (!owner) return;
    const previousHolder = await repo.principal(request.holderId, tx);
    await tx.query('update request_stages set assignee_id = $1 where request_id = $2 and n = $3', [
      owner.id,
      request.id,
      stage.n,
    ]);
    await tx.query('update requests set holder_id = $1, escalation = $2 where id = $3', [
      owner.id,
      'deadline_missed',
      request.id,
    ]);
    await appendAudit(tx, {
      occurredAt: timer.dueAt,
      actorId: 'system',
      actorRole: 'system',
      action: 'request.escalated',
      resourceType: 'request',
      resourceId: request.id,
      requestId: request.id,
      before: { holder: request.holderId },
      after: { escalation: 'deadline_missed', holder: owner.id },
      outcome: 'success',
    });
    const ownerPrincipal = await repo.principal(owner.id, tx);
    if (ownerPrincipal) {
      await enqueueMail(
        tx,
        notices.deadlineMissed(ownerPrincipal.email, request.id, previousHolder?.displayName ?? 'nobody'),
        timer.dueAt,
      );
    }
    await publishRequestChange(tx, { ...request, holderId: owner.id });
    return;
  }

  await tx.query('update requests set state = $1, holder_id = $2 where id = $3', [
    'expired',
    request.requesterId,
    request.id,
  ]);
  await appendAudit(tx, {
    occurredAt: timer.dueAt,
    actorId: 'system',
    actorRole: 'system',
    action: 'request.expired',
    resourceType: 'request',
    resourceId: request.id,
    requestId: request.id,
    before: { state: 'under_review' },
    after: { state: 'expired' },
    outcome: 'success',
  });
  const requester = await repo.principal(request.requesterId, tx);
  if (requester) {
    await enqueueMail(
      tx,
      notices.decision(requester.email, request.id, REQUEST_STATE_LABELS.expired, null, false),
      timer.dueAt,
    );
  }
  await publishRequestChange(tx, request);
}

/** Moves the app clock, firing every timer that becomes due in due order. */
export async function moveClockTo(target: Date): Promise<Date> {
  for (;;) {
    const pending = await db.query<{ id: number }>(
      `select id from timers where fired_at is null and cancelled = false and due_at <= $1 limit 1`,
      [target],
    );
    if (pending.rows.length === 0) break;
    const fired = await withTransaction(async (tx) => {
      const timers = await dueTimers(tx, target);
      const timer = timers[0];
      if (!timer) return false;
      await writeClock(tx, timer.dueAt);
      await fireTimer(tx, timer);
      return true;
    });
    if (!fired) break;
  }

  await withTransaction(async (tx) => {
    await writeClock(tx, target);
    await publish(tx, { type: 'library.updated' }, EVERYONE);
    await publish(tx, { type: 'queue.updated' }, { roles: REVIEWERS });
  });
  return readClock();
}
