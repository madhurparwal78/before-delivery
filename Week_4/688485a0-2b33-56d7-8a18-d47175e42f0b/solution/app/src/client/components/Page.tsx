import type { ReactNode } from "react";
import { Link, navigate } from "../router.js";
import { useEffect } from "react";
import { useKnownSession } from "../session.js";
import { TopBar } from "../shell/TopBar.js";

/** A full page outside a project: signed-in screens get the top bar, account screens a plain brand bar. */
export function Page({ children, signedIn = true }: { children: ReactNode; signedIn?: boolean }): ReactNode {
  return (
    <div className="app-shell">
      {signedIn ? (
        <TopBar onCollections={null} />
      ) : (
        <header className="topbar">
          <Link to="/" className="brand">
            Jarful
          </Link>
        </header>
      )}
      <main className="page">{children}</main>
    </div>
  );
}

/** Wraps screens that need a signed-in person: others go to /signin and come back afterwards. */
export function RequireSession({ children, path }: { children: ReactNode; path: string }): ReactNode {
  const { state } = useKnownSession();
  const out = state.status === "out";
  useEffect(() => {
    if (out) navigate(`/signin?next=${encodeURIComponent(path)}`, true);
  }, [out, path]);
  if (state.status === "loading" || state.status === "unknown") return <div className="app-shell" aria-busy="true" />;
  return out ? null : children;
}
