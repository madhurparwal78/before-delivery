import type { SessionUser, TeamRole } from "../shared/api";
import { api, ApiFailure } from "./api";
import { createStore } from "./store";

interface SessionState {
  loaded: boolean;
  user: SessionUser | null;
  teams: TeamRole[];
}

export const session = createStore<SessionState>({ loaded: false, user: null, teams: [] });

/** Reads who is signed in; a missing session is an ordinary answer, not a failure. */
export async function refreshSession(): Promise<void> {
  try {
    const me = await api<{ user: SessionUser; teams: TeamRole[] }>("GET", "/api/me");
    session.set({ loaded: true, user: me.user, teams: me.teams });
  } catch (error) {
    if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
    session.set({ loaded: true, user: null, teams: [] });
  }
}

export async function signOut(): Promise<void> {
  await api<void>("POST", "/api/auth/signout");
  session.set({ loaded: true, user: null, teams: [] });
}
