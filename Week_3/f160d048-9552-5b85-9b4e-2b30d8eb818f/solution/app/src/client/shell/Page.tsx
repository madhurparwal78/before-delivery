import { useEffect, type ReactNode } from "react";
import { Link, navigate, useLocation } from "../router";
import { useSession } from "../session";
import type { Role } from "../../shared/reference";
import { usePageTitle } from "../hooks";
import { SiteHeader } from "./SiteHeader";

/** A full-width working page: header, an optional alert band, then the page. */
export function Screen({ title, band, children, narrow = false }: { title: string; band?: ReactNode; children: ReactNode; narrow?: boolean }) {
  usePageTitle(title);
  return (
    <>
      <SiteHeader />
      {band}
      <main className={narrow ? "narrow" : "screen"}>{children}</main>
    </>
  );
}

export function NotFound() {
  usePageTitle("Page not found");
  return (
    <Screen title="Page not found" narrow>
      <div className="empty">
        <h1>Page not found</h1>
        <p>It may have been removed, or the link is wrong.</p>
        <Link to="/jobs" className="btn">
          Search lab jobs
        </Link>
      </div>
    </Screen>
  );
}

export function Loading() {
  return (
    <>
      <SiteHeader />
      <main className="screen">
        <p>Loading</p>
      </main>
    </>
  );
}

/** Signed-out visitors go to sign in; a signed-in role the page does not serve sees the not-found page. */
export function Guard({ roles, children }: { roles?: readonly Role[]; children: ReactNode }) {
  const { me, ready } = useSession();
  const { path, query } = useLocation();
  useEffect(() => {
    if (ready && !me) {
      const next = `${path}${query.toString() ? `?${query.toString()}` : ""}`;
      navigate(`/sign-in?next=${encodeURIComponent(next)}`, true);
    }
  }, [ready, me, path, query]);
  if (!ready || !me) return <Loading />;
  if (roles && !roles.includes(me.role)) return <NotFound />;
  return <>{children}</>;
}
