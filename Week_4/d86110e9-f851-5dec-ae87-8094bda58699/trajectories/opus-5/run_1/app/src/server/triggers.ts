import { one, query } from './db';
import { createRun, type StartedRun } from './engine/runs';
import type { AutomationContent, JsonObject, JsonValue } from '../shared/types';

export interface LiveVersion {
  version: number;
  content: AutomationContent;
}

/** Version binding: a run binds to the version live when it started. */
export async function liveVersion(automationId: string): Promise<LiveVersion | null> {
  const row = await one<{ version: number; content: AutomationContent }>(
    `select v.version, v.content from automations a
       join versions v on v.automation_id = a.id and v.version = a.live_version
       where a.id = $1`,
    [automationId],
  );
  return row === null ? null : { version: row.version, content: row.content };
}

async function startLiveRun(
  workspaceId: string,
  automationId: string,
  triggerOutput: JsonValue,
): Promise<StartedRun | null> {
  const live = await liveVersion(automationId);
  if (live === null) return null;
  return createRun({
    workspaceId,
    automationId,
    version: live.version,
    content: live.content,
    triggerOutput,
    test: false,
  });
}

interface LiveAutomation {
  id: string;
  workspace_id: string;
  content: AutomationContent;
}

export async function findLiveByTrigger(
  workspaceSlug: string,
  kind: 'form' | 'webhook',
  path: string,
): Promise<LiveAutomation | null> {
  const rows = await query<LiveAutomation>(
    `select a.id, a.workspace_id, v.content from automations a
       join workspaces w on w.id = a.workspace_id
       join versions v on v.automation_id = a.id and v.version = a.live_version
       where w.slug = $1 and a.trigger_kind = $2`,
    [workspaceSlug, kind],
  );
  return (
    rows.find((row) => {
      const field = row.content.trigger.fields.path;
      return typeof field === 'string' && field.trim() === path;
    }) ?? null
  );
}

export async function fireRowAdded(workspaceId: string, tableId: string, row: JsonObject): Promise<void> {
  const rows = await query<LiveAutomation>(
    `select a.id, a.workspace_id, v.content from automations a
       join versions v on v.automation_id = a.id and v.version = a.live_version
       where a.workspace_id = $1 and a.trigger_kind = 'row_added'`,
    [workspaceId],
  );
  for (const candidate of rows) {
    if (candidate.content.trigger.fields.table === tableId) {
      await startLiveRun(workspaceId, candidate.id, row);
    }
  }
}
