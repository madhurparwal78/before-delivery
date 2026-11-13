import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { NotFound } from "../../components/NotFound";
import { signInHref, useAuth } from "../../lib/auth";

/** Order screens belong to signed-in shoppers: a stranger goes to sign-in and comes back here, another role sees the not-found panel. */
export function ShopperOnly({ children }: { children: ReactNode }): ReactNode {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "signedOut") return <Navigate to={signInHref(`${location.pathname}${location.search}`)} replace />;
  if (auth.account && auth.account.role !== "shopper") return <NotFound />;
  if (auth.status === "loading") {
    return (
      <section className="panel panel--ground" aria-busy="true">
        <div className="skeleton" style={{ minHeight: 240 }} />
      </section>
    );
  }
  return children;
}
