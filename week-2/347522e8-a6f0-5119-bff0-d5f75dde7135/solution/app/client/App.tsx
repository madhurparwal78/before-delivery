// The app shell: who is signed in, which screen the address names, and the role landings.

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { UserView } from "../shared/api.js";
import { api, whenSignedOut } from "./api.js";
import { Header } from "./components/Header.js";
import { Apply } from "./pages/Apply.js";
import { Board } from "./pages/board/Board.js";
import { Kitchen } from "./pages/Kitchen.js";
import { Operator } from "./pages/Operator.js";
import { Share } from "./pages/Share.js";
import { Shift } from "./pages/Shift.js";
import { SignIn } from "./pages/SignIn.js";
import { navigate, usePlace } from "./router.js";
import { type Session, SessionContext, landingFor, mayOpen } from "./session.js";

type Who = { state: "loading" } | { state: "visitor" } | { state: "signed-in"; user: UserView };

const PUBLIC = ["/", "/apply"];

export function App() {
  const place = usePlace();
  const [who, setWho] = useState<Who>({ state: "loading" });

  const refresh = useCallback(async () => {
    const me = await api<{ user: UserView }>("/api/me");
    setWho(me.ok ? { state: "signed-in", user: me.data.user } : { state: "visitor" });
  }, []);

  useEffect(() => {
    void refresh();
    whenSignedOut(() => setWho({ state: "visitor" }));
  }, [refresh]);

  const signedIn = useCallback((user: UserView, landing?: { to: string; notice?: string }) => {
    setWho({ state: "signed-in", user });
    navigate(landing?.to ?? landingFor(user), landing?.notice ? { notice: landing.notice } : {});
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/session", { method: "DELETE" });
    setWho({ state: "visitor" });
    navigate("/");
  }, []);

  const share = place.path.startsWith("/share/");
  const redirect =
    who.state === "loading" || share
      ? null
      : who.state === "visitor"
        ? PUBLIC.includes(place.path)
          ? null
          : "/"
        : PUBLIC.includes(place.path) || !mayOpen(place.path, who.user)
          ? landingFor(who.user)
          : null;

  useLayoutEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect]);

  if (share) return <Share token={place.path.slice("/share/".length)} />;
  if (who.state === "loading" || redirect) return <div className="shell shell--loading" aria-busy="true" />;
  if (who.state === "visitor") {
    return place.path === "/apply" ? <Apply onApplied={signedIn} /> : <SignIn onSignedIn={signedIn} />;
  }
  const session: Session = { user: who.user, refresh, signOut };
  return (
    <SessionContext.Provider value={session}>
      <div className="shell">
        <Header user={who.user} onSignOut={() => void signOut()} />
        <main className="page" id="main">
          {place.path === "/board" ? <Board /> : null}
          {place.path === "/kitchen" && who.user.renter_id ? <Kitchen renterId={who.user.renter_id} /> : null}
          {place.path === "/operator" ? <Operator /> : null}
          {place.path === "/shift" ? <Shift /> : null}
        </main>
      </div>
    </SessionContext.Provider>
  );
}
