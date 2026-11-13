// Live messages and webhooks of a request: one message per change, announcements inside it.
import type { Say, Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { dispatchWebhook } from "../admin/index.ts";
import { sayOnRequest, type MrRow } from "./store.ts";

export type RequestChange = "opened" | "updated" | "merged" | "closed" | "reopened" | "retargeted" | "draft" | "ready";
type WebhookAction = "open" | "update" | "merge" | "close" | "reopen" | "approve";

function announcements(iid: number, texts: readonly string[]): Say[] {
  return texts.map((text) => sayOnRequest(iid, text));
}

/** The one `merge_request` message of a change; `texts` are the sentences it announces on the request's pages. */
export async function emitRequest(tx: Tx, project: Pick<ProjectRow, "id">, iid: number, change: RequestChange, texts: readonly string[] = []): Promise<number> {
  return tx.emit(project.id, "merge_request", { iid, change }, texts.length === 0 ? {} : { say: announcements(iid, texts) });
}

export async function requestWebhook(tx: Tx, project: ProjectRow, mr: Pick<MrRow, "iid" | "title" | "state" | "source" | "target">, action: WebhookAction, user: string): Promise<void> {
  await dispatchWebhook(tx, project, "merge_request", {
    event: "merge_request",
    action,
    project: { id: project.id, path: project.path },
    merge_request: { iid: mr.iid, title: mr.title, state: mr.state, source: mr.source, target: mr.target },
    user,
  });
}
