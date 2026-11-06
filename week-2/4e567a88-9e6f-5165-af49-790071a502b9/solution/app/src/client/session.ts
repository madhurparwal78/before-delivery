// What every signed-in screen shares: the member, the catalogue, the teams and the Notices bar.

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Member, Model, Team } from "./api";

export interface Session {
  me: Member;
  models: Model[];
  teams: Team[];
  /** The team an org role chose with the Team selector, or the member's own team. */
  teamId: string;
  setTeamId: (id: string) => void;
  /** Writes a pending or success message to `status "Notices"`. */
  notify: (text: string) => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside the signed-in shell");
  return session;
}

export const isOrgRole = (me: Member): boolean => me.role !== "member";

export function teamNameOf(session: Session, id: string): string {
  return session.teams.find((t) => t.id === id)?.name ?? id;
}

export function modelNameOf(session: Session, slug: string | null): string {
  if (slug === null) return "Upload";
  return session.models.find((m) => m.slug === slug)?.name ?? slug;
}
