import { LogOut, UserRound, LayoutList } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { User } from "../shared/domain";
import { CATALOGUE } from "../shared/catalogue";
import { AnnounceContext, RetractErrorContext } from "./activity";
import { ApiFailure, NetworkError, api, whenSignedOut } from "./api";
import { cache } from "./cache";
import { BrandMark } from "./components/Glyphs";
import { COPY } from "./copy";
import { useOnline } from "./online";
import { followLink, navigate, usePath } from "./router";
import { Account } from "./screens/Account";
import { Jobs } from "./screens/Jobs";
import { NotFound } from "./screens/NotFound";
import { SignIn } from "./screens/SignIn";
import { JobView } from "./job/JobView";

type Session = { state: "checking" } | { state: "signed-out"; ended: boolean } | { state: "signed-in"; user: User };

const JOB_ROUTE = /^\/jobs\/([^/]+)(?:\/items\/([^/]+))?\/?$/;

export function App() {
  const path = usePath();
  const online = useOnline();
  // A returning user sees their cached account at once (and any queued offline work starts
  // syncing) while the server confirms the session in the background.
  const [session, setSession] = useState<Session>(() => {
    const cached = cache.me();
    return cached ? { state: "signed-in", user: cached } : { state: "checking" };
  });
  const [message, setMessage] = useState({ text: "", key: 0 });
  const announce = useCallback((text: string) => setMessage((previous) => ({ text, key: previous.key + 1 })), []);
  const retractError = useCallback(
    () => setMessage((previous) => (previous.text === CATALOGUE.validation.message ? { text: "", key: previous.key + 1 } : previous)),
    [],
  );

  useEffect(retractError, [path, retractError]);

  const endSession = useCallback((ended: boolean) => {
    cache.saveMe(null);
    setSession({ state: "signed-out", ended });
    navigate("/signin", { replace: true });
  }, []);

  useEffect(() => whenSignedOut(() => endSession(true)), [endSession]);

  useEffect(() => {
    api<{ user: User }>("GET", "/api/me", undefined, { quietAuth: true })
      .then(({ user }) => {
        cache.saveMe(user);
        setSession((current) =>
          current.state === "signed-in" && current.user.email === user.email && current.user.name === user.name
            ? current
            : { state: "signed-in", user },
        );
      })
      .catch((error: unknown) => {
        const offlineUser = error instanceof NetworkError ? cache.me() : null;
        if (offlineUser) setSession({ state: "signed-in", user: offlineUser });
        else endSession(cache.me() !== null);
      });
  }, [endSession]);

  useEffect(() => {
    if (session.state === "signed-out" && path !== "/signin") navigate("/signin", { replace: true });
    if (session.state === "signed-in" && (path === "/signin" || path === "/")) navigate("/jobs", { replace: true });
  }, [session, path]);

  const signedIn = (user: User) => {
    cache.saveMe(user);
    setSession({ state: "signed-in", user });
    navigate("/jobs");
  };

  const signOut = async () => {
    try {
      await api("DELETE", "/api/session");
    } catch (error) {
      if (!(error instanceof ApiFailure)) {
        announce("Signing out needs a connection.");
        return;
      }
    }
    cache.clear();
    endSession(true);
  };

  const jobMatch = JOB_ROUTE.exec(path);
  const view = session.state !== "signed-in" ? "signin" : jobMatch ? "job" : path === "/account" ? "account" : path === "/jobs" ? "jobs" : "other";

  let screen = null;
  if (session.state === "signed-out") screen = <SignIn ended={session.ended} onSignedIn={signedIn} />;
  else if (session.state === "signed-in") {
    if (jobMatch) {
      screen = <JobView key={jobMatch[1]} jobId={jobMatch[1]!} itemId={jobMatch[2] ?? null} user={session.user} />;
    } else if (path === "/jobs") screen = <Jobs user={session.user} />;
    else if (path === "/account") screen = <Account />;
    else if (path !== "/" && path !== "/signin") screen = <NotFound />;
  }

  return (
    <AnnounceContext.Provider value={announce}>
      <RetractErrorContext.Provider value={retractError}>
      <div className="app" data-view={view}>
        <header className="topbar">
          <div className="brand">
            <BrandMark />
            <span className="brand-name">Snaglight</span>
            <span className="brand-kicker">Plumb &amp; Pencil</span>
          </div>
          {session.state === "signed-in" && (
            <nav className="topnav" aria-label="Main">
              <a href="/jobs" onClick={followLink} aria-current={view === "jobs" ? "page" : undefined}>
                <LayoutList size={18} aria-hidden="true" />
                <span>Your jobs</span>
              </a>
              <a href="/account" onClick={followLink} aria-current={view === "account" ? "page" : undefined}>
                <UserRound size={18} aria-hidden="true" />
                <span>Account</span>
              </a>
              <button type="button" className="btn btn--quiet" onClick={signOut}>
                <LogOut size={18} aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </nav>
          )}
        </header>
        <div role="status" aria-label="Connection" className="connection">
          {online ? "" : COPY.offlineBanner}
        </div>
        <main className="main">{screen}</main>
        <div role="status" aria-label="Activity" className="activity" data-place={view === "job" ? "job" : "page"}>
          {message.text && <span key={message.key}>{message.text}</span>}
        </div>
      </div>
      </RetractErrorContext.Provider>
    </AnnounceContext.Provider>
  );
}
