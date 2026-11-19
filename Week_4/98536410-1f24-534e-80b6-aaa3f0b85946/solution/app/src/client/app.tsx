import { useEffect, useMemo, useState } from "react";
import { ApiFailure, api, discardInFlight, onSessionEnded } from "./lib/api";
import { navigate, useLocation } from "./lib/router";
import { Frame, landingPath } from "./shell";
import { classifyRoute, roleOfRoute } from "../shared/routes";
import { SESSION_ENDED_COPY, SessionContext, writeSignInMemory } from "./session";
import type { Me } from "./types";
import { Landing } from "./screens/landing";
import { NotFound } from "./screens/notfound";
import { SignIn } from "./screens/signin";
import { Estate } from "./estate";
import { ShopScreen } from "./shop";
import { CareOrder, CareSearch } from "./screens/care";
import { Catalogue } from "./screens/catalogue";
import { CartScreen } from "./screens/cart";
import { OrderPage } from "./screens/order";
import { ProductPage } from "./screens/product";

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Screen({ me }: { me: Me | null }) {
  const { pathname, search } = useLocation();
  if (pathname === "/") return <Landing me={me} />;
  if (pathname === "/sign-in") return me ? <Redirect to={landingPath(me)} /> : <SignIn />;
  const { kind } = classifyRoute(pathname);
  if (kind === "unknown") return <NotFound />;
  if (!me) return <Redirect to={`/sign-in?next=${encodeURIComponent(pathname + search)}`} />;
  if (roleOfRoute(kind) !== me.user.role) return <NotFound />;
  if (pathname === "/estate") return <Estate />;
  if (pathname.startsWith("/shop/")) return <ShopScreen key={pathname} code={pathname.slice("/shop/".length)} />;
  if (pathname === "/care") return <CareSearch />;
  if (pathname.startsWith("/care/orders/")) return <CareOrder key={pathname} id={pathname.slice("/care/orders/".length)} />;
  if (pathname === "/catalogue") return <Catalogue />;
  if (pathname === "/cart") return <CartScreen />;
  if (pathname.startsWith("/products/")) return <ProductPage sku={pathname.slice("/products/".length)} />;
  if (pathname.startsWith("/orders/")) return <OrderPage id={pathname.slice("/orders/".length)} />;
  return <NotFound />;
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (document.querySelector('meta[name="tramela-session"]')?.getAttribute("content") !== "in") {
      setMe(null);
      return;
    }
    api<Me>("GET", "/api/me").then(setMe, (error: unknown) => {
      if (error instanceof ApiFailure) setMe(null);
    });
  }, []);

  useEffect(() => {
    onSessionEnded(() => {
      discardInFlight();
      writeSignInMemory({ email: "", focus: "email", alert: SESSION_ENDED_COPY });
      setMe(null);
      navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    });
  }, []);

  const session = useMemo(() => ({ me: me ?? null, setMe: (value: Me | null) => setMe(value) }), [me]);
  if (me === undefined) return null;
  const landing = pathname === "/";
  return (
    <SessionContext.Provider value={session}>
      {landing ? (
        <Screen me={me} key={pathname + search} />
      ) : (
        <Frame me={me}>
          <Screen me={me} key={pathname} />
        </Frame>
      )}
    </SessionContext.Provider>
  );
}
