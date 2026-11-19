import { instancePort } from './config';
import { one, query } from './db';
import { stepNumber, validateForPublish } from './automations';
import { anchorSchedule } from './scheduler';
import type { AutomationContent } from '../shared/types';

function countsFor(content: AutomationContent): { counts: Record<string, number>; highest: number } {
  const counts: Record<string, number> = {};
  let highest = 0;
  for (const step of content.steps) {
    counts[step.kind] = (counts[step.kind] ?? 0) + 1;
    highest = Math.max(highest, stepNumber(step.id));
  }
  return { counts, highest };
}

/** Replaces a draft's whole content and raises its revision. */
export async function saveDraftContent(automationId: string, content: AutomationContent): Promise<void> {
  const { counts, highest } = countsFor(content);
  await query(
    `update automations set draft = $2, revision = revision + 1, step_seq = $3, edge_seq = $4,
       kind_counts = $5, trigger_kind = $6 where id = $1`,
    [
      automationId,
      JSON.stringify(content),
      highest,
      content.edges.length,
      JSON.stringify(counts),
      content.trigger.kind,
    ],
  );
}

/** Publish copies the content into the next immutable numbered version and makes it live. */
export async function publishContent(
  workspaceId: string,
  automationId: string,
  content: AutomationContent,
  version: number,
  publishedAt: Date,
): Promise<void> {
  await validateForPublish(content, workspaceId, automationId);
  const row = await one<{ revision: number }>('select revision from automations where id = $1', [automationId]);
  await query(
    `insert into versions (automation_id, version, content, revision, published_at, owner_port)
       values ($1, $2, $3, $4, $5, $6)`,
    [automationId, version, JSON.stringify(content), row === null ? 1 : row.revision, publishedAt, instancePort],
  );
  await query('update automations set live_version = $2 where id = $1', [automationId, version]);
  await anchorSchedule(automationId, version, content, publishedAt);
}
