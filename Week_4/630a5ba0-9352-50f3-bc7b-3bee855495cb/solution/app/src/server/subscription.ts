import type { WorkspaceState } from "../shared/types.js";
import { sql, type Db } from "./db.js";

// The subscription state machine (Business rules › Subscription state machine), decided here only.

const STATE_EVENTS = ["subscription.trial_converted", "payment.failed", "payment.succeeded", "subscription.cancelled"] as const;
export const EVENT_TYPES = [...STATE_EVENTS, "seats.changed"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
type Step = (typeof STATE_EVENTS)[number] | "trial_end";

const TRANSITIONS: Record<WorkspaceState, Partial<Record<Step, WorkspaceState>>> = {
  trialing: { "subscription.trial_converted": "active", trial_end: "read_only", "subscription.cancelled": "cancelled" },
  active: { "payment.failed": "past_due", "subscription.cancelled": "cancelled" },
  past_due: { "payment.succeeded": "active", "payment.failed": "read_only", "subscription.cancelled": "cancelled" },
  read_only: { "payment.succeeded": "active", "subscription.trial_converted": "active", "subscription.cancelled": "cancelled" },
  cancelled: {},
};

export function isWritable(state: WorkspaceState): boolean {
  return state === "trialing" || state === "active" || state === "past_due";
}

type StoredEvent = { event_id: string; type: string; occurred_at: Date };

/**
 * Replays every stored state event in occurredAt order (ties by eventId), with the trial-end trigger
 * placed at trialEndsAt once it has passed. Returns the final state and which event ids were legal steps.
 */
function replay(events: StoredEvent[], trialEndsAt: Date, now: number): { state: WorkspaceState; applied: Set<string> } {
  type Item = { at: number; key: string; step: Step; id: string | null };
  const items: Item[] = events
    .filter((e): e is StoredEvent & { type: Step } => (STATE_EVENTS as readonly string[]).includes(e.type))
    .map((e) => ({ at: e.occurred_at.getTime(), key: e.event_id, step: e.type, id: e.event_id }));
  if (trialEndsAt.getTime() <= now) items.push({ at: trialEndsAt.getTime(), key: "￿", step: "trial_end", id: null });
  items.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let state: WorkspaceState = "trialing";
  const applied = new Set<string>();
  for (const item of items) {
    const next: WorkspaceState | undefined = TRANSITIONS[state][item.step];
    if (next) {
      state = next;
      if (item.id) applied.add(item.id);
    }
  }
  return { state, applied };
}

/** Recomputes and stores a workspace's state from its events. Call inside a transaction holding the row. */
export async function settleState(db: Db, workspaceId: string, now: number): Promise<{ state: WorkspaceState; applied: Set<string> }> {
  const [workspace] = await db<{ trial_ends_at: Date }[]>`
    SELECT trial_ends_at FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
  const events = await db<StoredEvent[]>`
    SELECT event_id, type, occurred_at FROM billing_events WHERE workspace_id = ${workspaceId}`;
  const result = replay(events, workspace.trial_ends_at, now);
  await db`UPDATE workspaces SET state = ${result.state} WHERE id = ${workspaceId} AND state <> ${result.state}`;
  return result;
}

/** The trial-end trigger: any trialing workspace whose trial has passed is replayed. */
export async function settleEndedTrials(now: number, workspaceId?: string): Promise<void> {
  const due = await sql<{ id: string }[]>`
    SELECT id FROM workspaces
    WHERE state = 'trialing' AND trial_ends_at <= ${new Date(now)}
      ${workspaceId ? sql`AND id = ${workspaceId}` : sql``}`;
  for (const { id } of due) await sql.begin((tx) => settleState(tx, id, now));
}
