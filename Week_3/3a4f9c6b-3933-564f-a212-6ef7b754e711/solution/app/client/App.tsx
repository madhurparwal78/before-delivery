// Client routes: /sign-in, /projects/<slug>, /projects/<slug>/windows and /approvals/<token>.
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { SessionBody } from "../shared/api";
import { call, whenSessionEnds } from "./api";
import { ApprovalPage } from "./ApprovalPage";
import { COPY, FeedbackProvider, FeedbackRegions } from "./feedback";
import { navigate, useLocation } from "./hooks";
import { SignIn } from "./SignIn";
import { Windows } from "./Windows";
import { Workspace } from "./Workspace";

export function App() {
  const { pathname, search } = useLocation();
  const [session, setSession] = useState<SessionBody | null | undefined>(undefined);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    whenSessionEnds(() => {
      setSession(null);
      setEnded(true);
      navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
    });
  }, []);

  const approval = /^\/approvals\/([^/]+)$/.exec(pathname);
  const project = /^\/projects\/([^/]+)(\/windows)?$/.exec(pathname);

  const protectedRoute = project !== null;
  useEffect(() => {
    if (!protectedRoute || session) return;
    void call<SessionBody>("GET", "/api/session", { guest: true }).then((r) => {
      if (r.ok) setSession(r.data);
      else navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`, true);
    });
  }, [protectedRoute, session]);

  if (approval) {
    return <FeedbackProvider key="approval"><ApprovalPage token={decodeURIComponent(approval[1] ?? "")} /></FeedbackProvider>;
  }
  if (pathname === "/sign-in") {
    const signedIn = (body: SessionBody) => {
      // Commit the session before the route changes, so the protected route never sees the old, empty one.
      flushSync(() => {
        setSession(body);
        setEnded(false);
      });
      const next = search.get("next");
      const first = body.memberships[0]?.project;
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : first ? `/projects/${first}` : "/sign-in");
    };
    return <FeedbackProvider key={`sign-in-${ended}`} initialProblem={ended ? COPY.sessionEnded : ""}><SignIn onSignedIn={signedIn} /></FeedbackProvider>;
  }
  if (project && session) {
    const slug = decodeURIComponent(project[1] ?? "");
    return project[2]
      ? <FeedbackProvider key={`windows-${slug}`}><Windows session={session} slug={slug} /></FeedbackProvider>
      : <FeedbackProvider key={`workspace-${slug}`}><Workspace session={session} slug={slug} /></FeedbackProvider>;
  }
  if (project) return <p className="loading">Loading…</p>;
  return (
    <FeedbackProvider key="lost">
      <main className="lost"><h1 className="page-title">Page not found</h1><FeedbackRegions /></main>
    </FeedbackProvider>
  );
}
