import { useLayoutEffect, useState } from "preact/hooks";
import { ApiError, api, type Integrations, type Project, type User } from "./api";

export class Store<T> {
  private value: T;
  private subs = new Set<() => void>();
  constructor(initial: T) { this.value = initial; }
  get(): T { return this.value; }
  set(next: T): void { this.value = next; this.subs.forEach((fn) => fn()); }
  subscribe(fn: () => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
}

export function useStore<T>(store: Store<T>): T {
  const [, tick] = useState(0);
  useLayoutEffect(() => store.subscribe(() => tick((n) => n + 1)), [store]);
  return store.get();
}

/** The signed-in user: undefined while unknown, null when signed out. */
export const sessionStore = new Store<User | null | undefined>(undefined);
export const projectsStore = new Store<Project[] | null>(null);
export const integrationsStore = new Store<Integrations | null>(null);
export const messageStore = new Store<{ status: string; problem: string }>({ status: "", problem: "" });

export const say = (status: string) => messageStore.set({ status, problem: "" });
export const complain = (problem: string) => messageStore.set({ status: "", problem });

export async function loadSession(): Promise<User | null> {
  try {
    const me = await api<{ user: User }>("GET", "/api/me");
    sessionStore.set(me.user);
    return me.user;
  } catch (e) {
    if (e instanceof ApiError && e.status !== 401) throw e;
    sessionStore.set(null);
    return null;
  }
}

export async function loadProjects(): Promise<void> {
  try {
    projectsStore.set((await api<{ projects: Project[] }>("GET", "/api/projects")).projects);
  } catch {
    projectsStore.set(projectsStore.get() ?? []);
  }
}

const STATUS_WORDS: Record<string, string> = {
  untranslated: "Untranslated", drafted: "Drafted", scored: "Scored", needs_review: "Needs review", approved: "Approved",
  open: "Open", in_review: "In review", merged: "Merged", abandoned: "Abandoned",
  queued: "Queued", awaiting_host_confirmation: "Awaiting host confirmation", published: "Published", failed: "Failed",
};
export const statusWord = (s: string) => STATUS_WORDS[s] ?? s;

/** HH:MM in the browser's local 24-hour time, from a server timestamp. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${day} ${clock(iso)}`;
}

const PUBLISH_FAILURES: Record<string, string> = {
  git_host_unavailable: "Publish failed: the repository host isn't answering.",
  pull_request_rejected: "Publish failed: the repository host rejected the pull request.",
  not_confirmed: "Publish failed: the repository host didn't confirm the pull request.",
};
export const publishFailureCopy = (reason: string | null) => PUBLISH_FAILURES[reason ?? ""] ?? "Publish failed.";

/** The published failure sentence for an API error; `context` names the language or branch where a sentence needs one. */
export function errorCopy(e: unknown, context: { branch?: string; language?: string } = {}): string {
  if (!(e instanceof ApiError)) return "The desk couldn't reach the server. Check your connection and try again.";
  const d = e.details;
  switch (e.code) {
    case "network": return e.message;
    case "payload_too_large": return "That file is larger than 5,000,000 bytes.";
    case "storage_unavailable": return "File storage isn't answering. Nothing was saved; try again in a few minutes.";
    case "branch_not_open": return "This branch is in review, so keys and translations are locked.";
    case "branch_closed": return "This branch is merged or abandoned, so it can't change.";
    case "key_exists": return "Another key on this branch already has that name.";
    case "illegal_transition": return `That change isn't allowed from ${statusWord(String(d.from))}.`;
    case "assignment_expired": return "This assignment expired. Ask the engineer to assign it again.";
    case "key_removed": return e.message;
    case "no_segments_to_review": return `There are no unassigned segments that need review in ${context.language ?? ""} on ${context.branch ?? ""}.`;
    case "conflict_held": return `This conflict is being resolved in another session until ${clock(String(d.held_until))}.`;
    case "hold_required": return "Your hold on this conflict ran out. Hold it again to resolve it.";
    case "conflicts_unresolved": return `Resolve every conflict before merging. ${(d.conflicts as string[]).length} left.`;
    case "restore_superseded": return "Later changes were made after this, so it can't be restored exactly.";
    case "already_restored": return "This was already restored.";
    case "publish_in_progress": return "Another publish is still running for this project.";
    case "slug_taken": return "That slug is already used by another project.";
    case "branch_exists": return "A branch with that name already exists.";
    case "branch_limit": return "This project already has five open branches. Merge or abandon one first.";
    case "reviewer_exists": return "That reviewer already has access to this project.";
    case "webhooks_unavailable": return "The webhook service isn't answering. The endpoint wasn't saved; try again in a few minutes.";
    case "ai_engine_unavailable": return "The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated.";
    case "invalid_credentials": return "That email and password don't match.";
    case "validation_failed": return Object.values(e.fields)[0] ?? e.message;
    default: return e.message;
  }
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** Runs one action with its pending copy, then its success copy or its failure copy. */
export async function act<T>(
  pending: string,
  fn: () => Promise<T>,
  success?: string | ((value: T) => string),
  context: { branch?: string; language?: string } = {},
): Promise<Outcome<T>> {
  say(pending);
  try {
    const value = await fn();
    say(typeof success === "function" ? success(value) : (success ?? ""));
    return { ok: true, value };
  } catch (e) {
    const error = e instanceof ApiError ? e : new ApiError(0, "network", "");
    complain(errorCopy(error, context));
    return { ok: false, error };
  }
}

export interface Loaded<T> { data?: T; error?: ApiError; loading: boolean; reload: () => void }

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    let live = true;
    setState((s) => ({ data: s.data, loading: true }));
    load().then(
      (data) => { if (live) setState({ data, loading: false }); },
      (e) => { if (live) setState({ error: e instanceof ApiError ? e : new ApiError(0, "network", ""), loading: false }); },
    );
    return () => { live = false; };
  }, [...deps, version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}
