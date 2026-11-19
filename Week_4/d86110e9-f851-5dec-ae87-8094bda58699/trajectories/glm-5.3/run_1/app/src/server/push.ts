// Server push helpers: run list items, run events, drain counts and the
// announcement sentences that feed status "Run updates".

import type { Db } from "./db.js";
import { runsRepo, runStepsRepo, automations } from "./repo.js";
import type { RunRow } from "./repo.js";
import { pushEvent } from "./events.js";

export interface RunListItem {
  id: string; number: number; automation_id: string; automation_name: string;
  status: string; test: boolean; version: number | null; replay_of: string | null;
  started_at: string | null; finished_at: string | null; message: string | null;
}

export function runListItem(run: RunRow, automationName: string): RunListItem {
  return {
    id: run.id, number: run.number, automation_id: run.automation_id, automation_name: automationName,
    status: run.status, test: run.test, version: run.version, replay_of: run.replay_of,
    started_at: run.started_at ? new Date(run.started_at).toISOString() : null,
    finished_at: run.finished_at ? new Date(run.finished_at).toISOString() : null,
    message: run.message,
  };
}

export async function runListShape(d: Db, run: RunRow): Promise<RunListItem> {
  const a = await automations.byId(d, run.automation_id);
  return runListItem(run, a?.name ?? "");
}

// Push a "run" event with the run list item and per-step statuses.
export async function pushRunListItem(d: Db, wsId: string, runId: string): Promise<void> {
  const run = await runsRepo.byId(d, runId);
  if (!run) return;
  const item = await runListShape(d, run);
  const steps = await runStepsRepo.list(d, runId);
  pushEvent(wsId, {
    type: "run",
    workspace_id: wsId,
    run: item,
    steps: steps.map((s) => ({ id: s.step_id, status: s.status })),
  });
}

export function pushAnnouncement(wsId: string, sentence: string): void {
  pushEvent(wsId, { type: "announce", workspace_id: wsId, sentence });
}

export function pushVersionEvent(wsId: string, aid: string, version: number): void {
  pushEvent(wsId, { type: "version", workspace_id: wsId, automation_id: aid, version });
}

export async function pushDrainCount(d: Db, wsId: string, aid: string): Promise<void> {
  const a = await automations.byId(d, aid);
  if (!a) return;
  const count = await runsRepo.drainCount(d, aid, a.live_version);
  pushEvent(wsId, { type: "drain", workspace_id: wsId, automation_id: aid, count });
}

export function pushDraftEvent(wsId: string, aid: string, revision: number, stepId: string, step: unknown): void {
  pushEvent(wsId, { type: "draft", workspace_id: wsId, automation_id: aid, revision, step_id: stepId, step });
}

export function pushTableEventMsg(wsId: string, tableId: string): void {
  pushEvent(wsId, { type: "table", workspace_id: wsId, table_id: tableId });
}
