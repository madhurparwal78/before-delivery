import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { BillingEventRow, MemberRow, WorkspaceRow } from '../db/records.js';
import type { WorkspaceDto, WorkspaceState } from '../../shared/types.js';
import { instantToIso } from '../../shared/time.js';
import { isStateEventType, isWritable, replaySubscription, type StateEvent } from '../domain/subscription.js';
import { config } from '../config.js';
import { enqueue } from './outbox.js';
import { trialNoticeMail } from './messages.js';

export interface WorkspaceStatus {
  state: WorkspaceState;
  billedSeats: number | null;
  lastBillingEventAt: Date | null;
  appliedEventIds: Set<string>;
  newestSeatEventId: string | null;
}

type Queryable = Pick<PoolClient, 'query'>;

export async function billingEventsFor(
  workspaceId: string,
  client: Queryable = pool,
): Promise<BillingEventRow[]> {
  const result = await client.query<BillingEventRow>(
    'select * from billing_events where workspace_id = $1 order by occurred_at, event_id',
    [workspaceId],
  );
  return result.rows;
}

export function statusFrom(
  workspace: WorkspaceRow,
  events: BillingEventRow[],
  now: Date = new Date(),
): WorkspaceStatus {
  const stateEvents: StateEvent[] = events
    .filter((event) => isStateEventType(event.type))
    .map((event) => ({
      eventId: event.event_id,
      type: event.type as StateEvent['type'],
      occurredAt: event.occurred_at,
    }));
  const { state, appliedEventIds } = replaySubscription(stateEvents, workspace.trial_ends_at, now);

  const seatEvents = events.filter((event) => event.type === 'seats.changed');
  const newestSeatEvent = seatEvents.reduce<BillingEventRow | null>((newest, candidate) => {
    if (!newest) return candidate;
    const byTime = candidate.occurred_at.getTime() - newest.occurred_at.getTime();
    if (byTime > 0) return candidate;
    if (byTime === 0 && candidate.event_id > newest.event_id) return candidate;
    return newest;
  }, null);

  const lastEvent = events.reduce<BillingEventRow | null>((newest, candidate) => {
    if (!newest) return candidate;
    return candidate.occurred_at.getTime() > newest.occurred_at.getTime() ? candidate : newest;
  }, null);

  return {
    state,
    billedSeats: newestSeatEvent?.seats ?? null,
    lastBillingEventAt: lastEvent?.occurred_at ?? null,
    appliedEventIds,
    newestSeatEventId: newestSeatEvent?.event_id ?? null,
  };
}

export function workspaceDto(workspace: WorkspaceRow, state: WorkspaceState): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    state,
    trialEndsAt: instantToIso(workspace.trial_ends_at),
    writable: isWritable(state),
  };
}

/** Seat-holding members: the owner plus members who are active or invited. */
export async function activeSeatCount(workspaceId: string, client: Queryable = pool): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from members
      where workspace_id = $1 and status in ('active', 'invited')`,
    [workspaceId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

/**
 * Queues one trial notice per workspace when the remaining trial time falls to the
 * configured lead, while the workspace is still trialing.
 */
export async function sweepTrialNotices(now: Date = new Date()): Promise<void> {
  const workspaces = await pool.query<WorkspaceRow>(
    `select w.* from workspaces w
      where w.trial_ends_at - ($1 || ' seconds')::interval <= now()
        and not exists (select 1 from trial_notices t where t.workspace_id = w.id)`,
    [String(config.trialNoticeLeadSeconds)],
  );
  for (const workspace of workspaces.rows) {
    const status = statusFrom(workspace, await billingEventsFor(workspace.id), now);
    if (status.state !== 'trialing') continue;
    const owner = await pool.query<MemberRow>(
      `select * from members where workspace_id = $1 and role = 'owner' limit 1`,
      [workspace.id],
    );
    const ownerRow = owner.rows[0];
    if (!ownerRow) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const claimed = await client.query(
        'insert into trial_notices (workspace_id, queued_at) values ($1, now()) on conflict do nothing',
        [workspace.id],
      );
      if (claimed.rowCount === 1) {
        await enqueue(
          client,
          'mail',
          {
            ...trialNoticeMail({
              email: ownerRow.email,
              workspaceName: workspace.name,
              trialEndsAt: workspace.trial_ends_at,
              timeZone: ownerRow.time_zone,
            }),
          },
          `trial_notice:${workspace.id}`,
        );
      }
      await client.query('commit');
    } catch {
      await client.query('rollback');
    } finally {
      client.release();
    }
  }
}

export function startTrialSweep(): void {
  const tick = async (): Promise<void> => {
    try {
      await sweepTrialNotices();
    } catch {
      // The next sweep retries.
    }
  };
  setInterval(() => void tick(), 5000).unref();
  void tick();
}
