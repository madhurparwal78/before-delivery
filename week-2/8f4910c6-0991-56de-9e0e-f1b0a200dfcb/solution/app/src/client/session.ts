// The signed-in member, role homes, sign-out, ended-session state and kept drafts.

import { useSyncExternalStore } from "react";
import { api, onSessionProblem } from "./api.js";
import type { OfficeId } from "../shared/zones.js";

export type Role = "agency_director" | "booker" | "accounts_lead" | "scout" | "talent";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  office: OfficeId;
  talentId: string | null;
}

export const HOMES: Record<Role, string> = {
  agency_director: "/workspace/overview",
  booker: "/workspace/board",
  accounts_lead: "/workspace/licences",
  scout: "/workspace/applications",
  talent: "/workspace/me",
};

export const SESSION_ENDED_COPY = "Your session ended. Your draft is kept; sign in again to finish.";
export const ACCESS_REMOVED_COPY = "Your access to Rungboard was removed. Nothing more can be saved.";
export const DRAFT_RESTORED_COPY = "Your draft was restored.";

export type SessionProblem = "session_ended" | "access_removed" | null;

interface State {
  status: "loading" | "signed-out" | "signed-in";
  member: Member | null;
  problem: SessionProblem;
}

let state: State = { status: "loading", member: null, problem: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The session state, re-rendering on change. */
export function useSession(): State {
  return useSyncExternalStore(subscribe, () => state);
}

let loading: Promise<void> | null = null;

/** Loads `/api/me` once; call again with `force` after signing in or out. */
export function loadMember(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = api<Member>("GET", "/api/me").then((result) => {
    if (result.ok) set({ status: "signed-in", member: result.data });
    else if (state.status !== "signed-in") set({ status: "signed-out", member: null });
  });
  return loading;
}

export function signedIn(member: Member): void {
  loading = Promise.resolve();
  set({ status: "signed-in", member, problem: null });
}

export async function signOut(): Promise<void> {
  await api("DELETE", "/api/session");
  loading = Promise.resolve();
  set({ status: "signed-out", member: null, problem: null });
}

onSessionProblem((code) => {
  if (state.status === "signed-in") set({ problem: code });
});

/** The copy for a failed call whose session is gone, or null. */
export function sessionCopy(error: { error: string }): string | null {
  if (error.error === "access_removed") return ACCESS_REMOVED_COPY;
  if (error.error === "session_ended" || error.error === "unauthenticated") return SESSION_ENDED_COPY;
  return null;
}

/** Where "Sign in again" goes: back to this path afterwards. */
export function signInAgainHref(): string {
  return `/sign-in?return=${encodeURIComponent(location.pathname + location.search)}`;
}

/** Only same-origin app paths are followed after signing in. */
export function safeReturn(value: string | null): string | null {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

// Kept drafts: an open form or dialog's values, saved when the session ends mid-task.

export interface KeptDraft {
  path: string;
  dialog?: string;
  values: Record<string, string>;
}

const DRAFT_KEY = "rb.keptDraft";

export function keepDraft(draft: KeptDraft): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

/** Returns and forgets the kept draft for `path` (pathname + search), if any. */
export function takeDraft(path: string): KeptDraft | null {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  const draft = JSON.parse(raw) as KeptDraft;
  if (draft.path !== path) return null;
  localStorage.removeItem(DRAFT_KEY);
  return draft;
}
