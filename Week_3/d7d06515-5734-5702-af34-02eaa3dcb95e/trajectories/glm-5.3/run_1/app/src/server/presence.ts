import { db } from "./db.js";
import { config } from "./config.js";
import { trialDaysLeft, workspaceNow } from "./clock.js";
import { publishAccountEvent, publishDrawingEvent } from "./live.js";


export interface PresenceInput {
  tabId: string;
  drawingId: string;
  name: string;
  access: string;
}

export async function recordPresence(input: PresenceInput): Promise<void> {
  const { epochMs } = await workspaceNow(null);
  const state = input.access === "owner" || input.access === "edit" ? "Editing" : "Viewing";
  await db.run(
    `insert into presence (tab_id, drawing_id, name, access, state, last_input_epoch, seen_epoch)
     values ($1, $2, $3, $4, $5, $6, $6)
     on conflict (tab_id) do update set drawing_id = $2, name = $3, access = $4, state = $5, last_input_epoch = $6, seen_epoch = $6`,
    [input.tabId, input.drawingId, input.name, input.access, state, epochMs],
  );
  await publishPresence(input.drawingId).catch(() => undefined);
}

export interface Collaborator {
  name: string;
  state: "Editing" | "Viewing" | "Away";
}

export async function collaborators(drawingId: string, selfName: string | null): Promise<Collaborator[]> {
  const { epochMs } = await workspaceNow(null);
  const idleLimit = config.limits.PRESENCE_IDLE_SECONDS * 1000;
  const rows = await db.all<{ name: string; access: string; state: string; last_input_epoch: string; seen_epoch: string }>(
    `select name, access, state, last_input_epoch, seen_epoch from presence
     where drawing_id = $1 and seen_epoch > $2`,
    [drawingId, epochMs - 30_000],
  );
  const byName = new Map<string, Collaborator>();
  for (const row of rows) {
    const base: Collaborator = {
      name: row.name,
      state: epochMs - Number(row.last_input_epoch) >= idleLimit ? "Away" : (row.state as Collaborator["state"]),
    };
    if (selfName === null || row.name !== selfName) {
      const existing = byName.get(row.name);
      if (!existing || (existing.state === "Away" && base.state !== "Away")) byName.set(row.name, base);
    }
  }
  return [...byName.values()];
}

export async function publishPresence(drawingId: string): Promise<void> {
  const list = await collaborators(drawingId, null);
  publishDrawingEvent(drawingId, "presence", {
    collaborators: list,
  });
}

/** Push time-driven updates at least once a second. */
export async function startReevaluationLoop(): Promise<void> {
  setInterval(() => {
    void reevaluate();
  }, 1000);
}

const lastLinkStatus = new Map<string, string>();
const lastTrialState = new Map<string, string>();

/** A set clock makes the next evaluation a change worth pushing. */
export function forgetTrialState(workspaceId: string): void {
  lastTrialState.delete(workspaceId);
}

async function reevaluate(): Promise<void> {
  const expired = await db
    .all<{ id: string; drawing_id: string; expires_epoch: string; workspace_id: string }>(
      `select s.id, s.drawing_id, s.expires_epoch, d.workspace_id
       from shares s join drawings d on d.id = s.drawing_id
       where s.revoked = false and s.expires_epoch is not null`,
    )
    .catch(() => [] as Array<{ id: string; drawing_id: string; expires_epoch: string; workspace_id: string }>);
  for (const share of expired) {
    const { epochMs } = await workspaceNow(share.workspace_id);
    if (epochMs >= Number(share.expires_epoch)) {
      const known = lastLinkStatus.get(share.id) ?? "active";
      if (known !== "expired") {
        lastLinkStatus.set(share.id, "expired");
        publishDrawingEvent(share.drawing_id, "link", { status: "expired" });
      }
    }
  }
  // Trial edges: re-evaluate every workspace each second; a workspace whose
  // trial state differs from the last-pushed state pushes to its drawings.
  const workspaces = await db
    .all<{ id: string; zone: string; confirmed_date_key: string | null }>(
      `select w.id, w.time_zone as zone, a.confirmed_date_key
       from workspaces w join accounts a on a.workspace_id = w.id
       where a.confirmed_date_key is not null`,
    )
    .catch(() => [] as Array<{ id: string; zone: string; confirmed_date_key: string | null }>);
  for (const workspace of workspaces) {
    const { epochMs } = await workspaceNow(workspace.id);
    const left = trialDaysLeft(workspace.confirmed_date_key!, epochMs, workspace.zone);
    const ended = left === 0;
    const key = `${left}:${ended}`;
    const known = lastTrialState.get(workspace.id);
    if (known === key) continue;
    lastTrialState.set(workspace.id, key);
    publishAccountEvent(workspace.id, "trial", { days_left: left, ended });
    const drawings = await db
      .all<{ id: string }>(`select id from drawings where workspace_id = $1 and deleted_epoch is null`, [workspace.id])
      .catch(() => [] as Array<{ id: string }>);
    for (const drawing of drawings) {
      publishDrawingEvent(drawing.id, "trial", { days_left: left, ended });
    }
  }
}

export async function touchSeen(tabId: string): Promise<void> {
  const { epochMs } = await workspaceNow(null);
  await db.run(`update presence set seen_epoch = $1 where tab_id = $2`, [epochMs, tabId]).catch(() => undefined);
}

export async function removePresence(tabId: string): Promise<void> {
  const row = await db.one<{ drawing_id: string }>(`select drawing_id from presence where tab_id = $1`, [tabId]);
  await db.run(`delete from presence where tab_id = $1`, [tabId]);
  if (row) await publishPresence(row.drawing_id).catch(() => undefined);
}

export async function prunePresence(): Promise<void> {
  const { epochMs } = await workspaceNow(null);
  const stale = await db.all<{ drawing_id: string; tab_id: string }>(
    `select drawing_id, tab_id from presence where seen_epoch <= $1`,
    [epochMs - 35_000],
  );
  if (stale.length > 0) {
    await db.run(`delete from presence where seen_epoch <= $1`, [epochMs - 35_000]);
    const drawings = new Set(stale.map((r) => r.drawing_id));
    for (const drawingId of drawings) await publishPresence(drawingId).catch(() => undefined);
  }
}

export async function startPresenceLoop(): Promise<void> {
  setInterval(() => {
    void prunePresence();
  }, 10_000);
}
