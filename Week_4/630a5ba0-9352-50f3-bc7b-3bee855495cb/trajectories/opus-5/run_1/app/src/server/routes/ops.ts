import { pool } from '../db/pool.js';
import type { WorkspaceRow } from '../db/records.js';
import type { OpsWorkspaceDto } from '../../shared/types.js';
import { requireOperator, type RequestContext } from '../http/context.js';
import { activeSeatCount, billingEventsFor, statusFrom } from '../services/workspaces.js';
import { instantToIso } from '../../shared/time.js';
import type { Router } from '../http/router.js';

interface OutboxCounts {
  workspace_id: string | null;
  pending: string;
  sent: string;
}

/** Billing, seats, queue depth and import activity only: never any planning content. */
async function workspaces(context: RequestContext): Promise<{ workspaces: OpsWorkspaceDto[] }> {
  requireOperator(context);

  const rows = await pool.query<WorkspaceRow>('select * from workspaces order by created_at');
  const outbox = await pool.query<OutboxCounts>(
    `select payload->>'workspaceId' as workspace_id,
            count(*) filter (where status = 'pending')::text as pending,
            count(*) filter (where status = 'sent')::text as sent
       from outbox group by payload->>'workspaceId'`,
  );
  const imports = await pool.query<{ workspace_id: string; batches: string; last_at: Date | null }>(
    `select workspace_id, count(*)::text as batches, max(created_at) as last_at
       from import_batches group by workspace_id`,
  );
  const mailByMember = await pool.query<{ workspace_id: string; pending: string; sent: string }>(
    `select m.workspace_id,
            count(*) filter (where o.status = 'pending')::text as pending,
            count(*) filter (where o.status = 'sent')::text as sent
       from outbox o
       join members m on m.email = o.payload->>'to'
      where o.kind = 'mail'
      group by m.workspace_id`,
  );

  const importsByWorkspace = new Map(imports.rows.map((row) => [row.workspace_id, row]));
  const queueByWorkspace = new Map(outbox.rows.filter((row) => row.workspace_id).map((row) => [row.workspace_id!, row]));
  const mailQueue = new Map(mailByMember.rows.filter((row) => row.workspace_id).map((row) => [row.workspace_id, row]));

  const result: OpsWorkspaceDto[] = [];
  for (const workspace of rows.rows) {
    const status = statusFrom(workspace, await billingEventsFor(workspace.id));
    const queue = queueByWorkspace.get(workspace.id);
    const mail = mailQueue.get(workspace.id);
    const batch = importsByWorkspace.get(workspace.id);
    result.push({
      id: workspace.id,
      name: workspace.name,
      state: status.state,
      trialEndsAt: instantToIso(workspace.trial_ends_at),
      activeSeats: await activeSeatCount(workspace.id),
      billedSeats: status.billedSeats,
      lastBillingEventAt: status.lastBillingEventAt ? instantToIso(status.lastBillingEventAt) : null,
      outbox: {
        pending: Number(queue?.pending ?? '0') + Number(mail?.pending ?? '0'),
        sent: Number(queue?.sent ?? '0') + Number(mail?.sent ?? '0'),
      },
      imports: {
        batches: Number(batch?.batches ?? '0'),
        lastAt: batch?.last_at ? instantToIso(batch.last_at) : null,
      },
    });
  }
  return { workspaces: result };
}

export function registerOpsRoutes(router: Router): void {
  router.get('/api/ops/workspaces', workspaces);
}
