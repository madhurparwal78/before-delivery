/** The job store: loading, the live event stream and the offline overlay. */

import {
  api, cacheJob, enqueue, hasQueuedChanges, newClientId, newOpId, queueFor, readCachedJob, syncQueue,
  type ChangeOrder, type Costs, type Item, type Job, type JobData, type Member, type OutboxEntry,
  type PlanRevision, type QueuedOp, type Room, type SyncReport, type Visit,
} from "./api.js";

export type { JobData };

export type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: JobData }
  | { kind: "notfound" }
  | { kind: "roleended"; message: string };

export async function loadJob(jobId: string): Promise<JobData> {
  const [jobRes, roomsRes, itemsRes, membersRes, visitsRes] = await Promise.all([
    api<Job>("GET", `/api/jobs/${jobId}`),
    api<{ rooms: Room[] }>("GET", `/api/jobs/${jobId}/rooms`),
    api<{ items: Item[] }>("GET", `/api/jobs/${jobId}/items`),
    api<{ members: Member[] }>("GET", `/api/jobs/${jobId}/members`),
    api<{ visits: Visit[] }>("GET", `/api/jobs/${jobId}/visits`).catch(() => ({ visits: [] as Visit[] })),
  ]);
  const data: JobData = {
    job: jobRes,
    rooms: roomsRes.rooms,
    items: itemsRes.items,
    members: membersRes.members,
    visits: visitsRes.visits,
    costs: null,
    changeOrders: [],
    outbox: [],
    planRevisions: [],
    access: null,
  };
  if (jobRes.my_role === "owner" || jobRes.my_role === "lead") {
    const [costsRes, changeOrdersRes, revisionsRes] = await Promise.all([
      api<Costs>("GET", `/api/jobs/${jobId}/costs`).catch(() => null),
      api<{ change_orders: ChangeOrder[] }>("GET", `/api/jobs/${jobId}/change-orders`).catch(() => ({ change_orders: [] as ChangeOrder[] })),
      api<{ revisions: PlanRevision[] }>("GET", `/api/jobs/${jobId}/plan/revisions`).catch(() => ({ revisions: [] as PlanRevision[] })),
    ]);
    data.costs = costsRes;
    data.changeOrders = changeOrdersRes.change_orders;
    data.planRevisions = revisionsRes.revisions;
  }
  if (jobRes.my_role === "owner") {
    const outboxRes = await api<{ entries: OutboxEntry[] }>("GET", `/api/jobs/${jobId}/outbox`).catch(() => ({ entries: [] as OutboxEntry[] }));
    data.outbox = outboxRes.entries;
  }
  cacheJob(jobId, data);
  return data;
}

export type LiveEvent =
  | { type: "item"; item: Item }
  | { type: "item_deleted"; id: string; number: number }
  | { type: "room"; room: Room }
  | { type: "counts"; progress: Job["progress"]; rooms: { id: string; counts: Room["counts"] }[] }
  | { type: "note"; item_id: string; note: unknown }
  | { type: "plan"; revision: number; plan_url: string }
  | { type: "visit"; visit: Visit }
  | { type: "visit_deleted"; id: string }
  | { type: "costs"; costs: Costs }
  | { type: "job"; job: Job }
  | { type: "role_ended" }
  | { type: "reset" };

/** Opens the job's live event stream, applying each frame through `apply`. */
export function openStream(jobId: string, apply: (event: LiveEvent) => void, onRoleEnded: () => void, onUnauthenticated: () => void): EventSource {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.addEventListener("item", (e) => apply({ type: "item", item: JSON.parse((e as MessageEvent).data).item }));
  source.addEventListener("item_deleted", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    apply({ type: "item_deleted", id: data.id, number: data.number });
  });
  source.addEventListener("room", (e) => apply({ type: "room", room: JSON.parse((e as MessageEvent).data).room }));
  source.addEventListener("counts", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    apply({ type: "counts", progress: data.progress, rooms: data.rooms });
  });
  source.addEventListener("plan", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    apply({ type: "plan", revision: data.revision, plan_url: data.plan_url });
  });
  source.addEventListener("visit", (e) => apply({ type: "visit", visit: JSON.parse((e as MessageEvent).data).visit }));
  source.addEventListener("visit_deleted", (e) => apply({ type: "visit_deleted", id: JSON.parse((e as MessageEvent).data).id }));
  source.addEventListener("costs", (e) => apply({ type: "costs", costs: JSON.parse((e as MessageEvent).data) }));
  source.addEventListener("job", (e) => apply({ type: "job", job: JSON.parse((e as MessageEvent).data).job }));
  source.addEventListener("role_ended", () => {
    source.close();
    onRoleEnded();
  });
  source.addEventListener("reset", () => apply({ type: "reset" }));
  source.onerror = () => {
    void (async () => {
      try {
        await api("GET", "/api/me");
      } catch {
        source.close();
        onUnauthenticated();
      }
    })();
  };
  return source;
}

// --- Offline overlay ---

/** The pending operations for one job, keyed by the item they touch. */
export function pendingByItem(jobId: string): Map<string, QueuedOp[]> {
  const map = new Map<string, QueuedOp[]>();
  for (const op of queueFor(jobId)) {
    if (op.status !== "pending") continue;
    const key = op.type === "create_item" ? `client:${op.client_item_id}` : op.item_id;
    const list = map.get(key);
    if (list === undefined) map.set(key, [op]);
    else list.push(op);
  }
  return map;
}

export function queueItem(jobId: string, fields: Record<string, unknown>): string {
  const clientItemId = newClientId();
  enqueue(jobId, {
    op_id: newOpId(),
    type: "create_item",
    client_item_id: clientItemId,
    fields,
  });
  return clientItemId;
}

export function queueUpdate(jobId: string, itemId: string, changes: Record<string, { from: unknown; to: unknown }>): void {
  enqueue(jobId, { op_id: newOpId(), type: "update_item", item_id: itemId, changes });
}

export function queueAction(jobId: string, itemId: string, action: string, reason?: string): void {
  const spec: Record<string, unknown> = { op_id: newOpId(), type: "item_action", item_id: itemId, action };
  if (reason !== undefined) spec.reason = reason;
  enqueue(jobId, spec as never);
}

export function queueNote(jobId: string, itemId: string, body: string, audience: string, parentId?: string): string {
  const clientNoteId = newClientId();
  const spec: Record<string, unknown> = { op_id: newOpId(), type: "add_note", item_id: itemId, client_note_id: clientNoteId, body, audience };
  if (parentId !== undefined) spec.parent_id = parentId;
  enqueue(jobId, spec as never);
  return clientNoteId;
}

export function queueNoteEdit(jobId: string, itemId: string, noteId: string, baseRev: number, pos: number, del: number, insert: string): void {
  enqueue(jobId, { op_id: newOpId(), type: "edit_note", item_id: itemId, note_id: noteId, base_rev: baseRev, pos, delete: del, insert });
}

/** Runs the queue and reports the outcome for the Activity region. */
export async function runSync(jobId: string): Promise<{ sentence: string; report: SyncReport | null }> {
  if (!hasQueuedChanges(jobId)) return { sentence: "", report: null };
  try {
    const report = await syncQueue(jobId);
    const removed = report.results.filter((r) => r.outcome === "rejected" && r.error !== null && r.error.error === "not_found");
    const sentences = [`Sync complete: ${report.synced} synced, ${report.conflicts} to review.`];
    for (const r of removed) {
      sentences.push(`Item ${r.item === null ? "?" : r.item.number} removed. Not saved: ${r.error?.message ?? "Not found."}`);
    }
    return { sentence: sentences.join(" "), report };
  } catch {
    return { sentence: "Waiting to sync.", report: null };
  }
}

export function readCache<T>(jobId: string): T | null {
  return readCachedJob<T>(jobId);
}
