// Who caused the work in progress and under which request id, carried through async calls so audit entries,
// jobs and log lines name the request that caused them (brief: Deployment, Request ids; Audit).
import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
export const SYSTEM = { type: "system", id: null };
export function runAs(context, work) {
    return storage.run(context, work);
}
export const currentContext = () => storage.getStore() ?? { requestId: null, actor: SYSTEM, origin: "background", after: [] };
/** Context for background work (jobs, reconcilers), carrying the id of the request that caused it. */
export const background = (requestId) => ({ requestId, actor: SYSTEM, origin: "background", after: [] });
/** Queues work for after commit; it runs in this context once the request or job has finished its transactions. */
export function afterCommit(work) {
    currentContext().after.push(work);
}
/** Runs the queued after-commit work in order; each piece handles its own failures. */
export async function runAfterCommit(context) {
    for (const work of context.after.splice(0))
        await work();
}
/** Replaces the actor once the request's caller is known. */
export function setActor(actor) {
    const store = storage.getStore();
    if (store)
        store.actor = actor;
}
