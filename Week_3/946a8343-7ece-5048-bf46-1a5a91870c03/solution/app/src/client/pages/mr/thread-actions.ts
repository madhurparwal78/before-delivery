// Writes on threads and the state they share between the thread list, the threads drawn in the diff and the diff itself.
//   useThreads(page)          the page's threads with optimistic resolves applied
//   refusal / useRefusal()    the API message of the latest refused thread action, shown in the strip at the top of the panel
//   batch                     suggestion ids picked for `Apply batch`
//   setResolved, reply, moveToIssue, applySuggestions   one request each; a refusal is announced and shown in the strip
import { useLayoutEffect, useMemo } from "preact/hooks";
import { announce } from "../../announce.tsx";
import { api, asApiError } from "../../api.ts";
import { createStore, useStore } from "../../store.ts";
import { mrBase, type MrPage, type ThreadView } from "./data.ts";

const resolveOverrides = createStore<ReadonlyMap<number, boolean>>(new Map());
const refusal = createStore<string | null>(null);
export const batch = createStore<ReadonlySet<number>>(new Set());

/** The latest refusal; it is forgotten when the component showing it leaves the page. */
export function useRefusal(): string | null {
  useLayoutEffect(() => () => refusal.set(null), []);
  return useStore(refusal);
}

/** Runs one write; a refusal is announced and shown, and the result is undefined. */
export async function attempt<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await work();
    refusal.set(null);
    return result;
  } catch (cause) {
    const failure = asApiError(cause);
    refusal.set(failure.message);
    announce(failure.message, "error");
    return undefined;
  }
}

export function useThreads(page: MrPage): ThreadView[] {
  const forced = useStore(resolveOverrides);
  return useMemo(
    () =>
      page.threads.map((thread) => {
        const resolved = forced.get(thread.id);
        return resolved === undefined ? thread : { ...thread, resolved };
      }),
    [page.threads, forced],
  );
}

function dropOverride(id: number): void {
  resolveOverrides.update((current) => {
    const next = new Map(current);
    next.delete(id);
    return next;
  });
}

/** Shows the new state at once; a refusal puts the server's state back. */
export async function setResolved(page: MrPage, id: number, resolved: boolean): Promise<void> {
  resolveOverrides.update((current) => new Map(current).set(id, resolved));
  await attempt(async () => {
    await api.patch(`${mrBase(page.project, page.iid)}/threads/${id}`, { resolved });
    await page.reload();
  });
  dropOverride(id);
}

export async function reply(page: MrPage, id: number, body: string): Promise<boolean> {
  const done = await attempt(async () => {
    await api.post(`${mrBase(page.project, page.iid)}/threads/${id}/notes`, { body });
    await page.reload();
    return true;
  });
  return done === true;
}

export async function moveToIssue(page: MrPage): Promise<void> {
  await attempt(async () => {
    await api.post(`${mrBase(page.project, page.iid)}/threads/move_to_issue`);
    await page.reload();
  });
}

export async function applySuggestions(page: MrPage, ids: readonly number[]): Promise<void> {
  const done = await attempt(async () => {
    await api.post(`${mrBase(page.project, page.iid)}/suggestions/apply`, { ids });
    await page.reload();
    return true;
  });
  if (done) batch.update((current) => new Set([...current].filter((id) => !ids.includes(id))));
}

export function toggleBatch(id: number): void {
  batch.update((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
}
