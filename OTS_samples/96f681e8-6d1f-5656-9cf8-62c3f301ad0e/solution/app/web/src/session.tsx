import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { type Club, type Me, call } from "./api";
import { clearDraft, keepDraftOnlyFor } from "./draft";
import { setClubTimezone } from "./format";

type Session = { state: "loading" } | { state: "signed-out" } | { state: "signed-in"; me: Me };

const SessionContext = createContext<Session>({ state: "loading" });

export function useSession(): Session {
  return useContext(SessionContext);
}

/**
 * Ends the session on the server before the page leaves, then loads the home page afresh: the next page load can never
 * see the session, and the page holds no name, row or balance of the person who left.
 */
export function signOut(): void {
  clearDraft();
  const request = new XMLHttpRequest();
  request.open("POST", "/logout", false);
  request.send();
  window.location.assign("/");
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ state: "loading" });
  useEffect(() => {
    let live = true;
    // The club's timezone and the person are both known before the first paint, and a slot dialog draft kept for
    // anyone else is gone by then.
    const club = call<Club>("/api/club")
      .then((value) => setClubTimezone(value.timezone))
      .catch(() => undefined);
    const me = call<Me>("/api/me").catch(() => null);
    void Promise.all([me, club]).then(([person]) => {
      if (!live) return;
      if (person) {
        keepDraftOnlyFor(person.username);
        setSession({ state: "signed-in", me: person });
      } else setSession({ state: "signed-out" });
    });
    return () => {
      live = false;
    };
  }, []);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function hasRole(session: Session, role: string): boolean {
  return session.state === "signed-in" && session.me.roles.includes(role);
}
