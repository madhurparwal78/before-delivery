// Who caused the work in progress and under which request id, carried through async calls so audit entries,
// jobs and log lines name the request that caused them (brief: Deployment, Request ids; Audit).
import { AsyncLocalStorage } from "node:async_hooks";

type ActorType = "user" | "token" | "system";

export interface Actor {
  type: ActorType;
  id: string | null;
}

interface WorkContext {
  requestId: string | null;
  actor: Actor;
  /** Request work queues request-queued emails; jobs and background passes queue background-queued ones. */
  origin: "request" | "background";
  /** Work to run once this request's or job's transactions have committed (first send attempts, Kill Bill legs). */
  after: Array<() => Promise<void>>;
}

const storage = new AsyncLocalStorage<WorkContext>();

export const SYSTEM: Actor = { type: "system", id: null };

export function runAs<T>(context: WorkContext, work: () => Promise<T>): Promise<T> {
  return storage.run(context, work);
}

export const currentContext = (): WorkContext =>
  storage.getStore() ?? { requestId: null, actor: SYSTEM, origin: "background", after: [] };

/** Context for background work (jobs, reconcilers), carrying the id of the request that caused it. */
export const background = (requestId: string | null): WorkContext => ({ requestId, actor: SYSTEM, origin: "background", after: [] });

/** Queues work for after commit; it runs in this context once the request or job has finished its transactions. */
export function afterCommit(work: () => Promise<void>): void {
  currentContext().after.push(work);
}

/** Runs the queued after-commit work in order; each piece handles its own failures. */
export async function runAfterCommit(context: WorkContext): Promise<void> {
  for (const work of context.after.splice(0)) await work();
}

/** Replaces the actor once the request's caller is known. */
export function setActor(actor: Actor): void {
  const store = storage.getStore();
  if (store) store.actor = actor;
}
