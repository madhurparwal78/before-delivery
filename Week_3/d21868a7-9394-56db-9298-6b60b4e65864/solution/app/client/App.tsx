// Session, routes and role guards: a signed-out visit goes to sign-in with its return path, a page
// route of another role goes to the visitor's home route, and sign-in lands where the return path allows.
import { useEffect, useState, type ReactNode } from "react";
import { HOME, landingFor, mayOpen, signInFor } from "../shared/roles.ts";
import { BareTopBar, TopBar } from "./components/Shell.tsx";
import { api, navigate, useLocation } from "./lib.ts";
import { Board } from "./pages/Board.tsx";
import { CapacityTable } from "./pages/CapacityTable.tsx";
import { Contractors } from "./pages/Contractors.tsx";
import { Field } from "./pages/Field.tsx";
import { GrowerHome } from "./pages/GrowerHome.tsx";
import { OrderForm } from "./pages/OrderForm.tsx";
import { OrderPage } from "./pages/OrderPage.tsx";
import { NewPack, PackPage, Packs } from "./pages/Packs.tsx";
import { RestrictionPage } from "./pages/RestrictionPage.tsx";
import { Review } from "./pages/Review.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import type { User } from "./types.ts";

interface Screen {
  path: RegExp;
  render: (user: User, params: string[]) => ReactNode;
}

const SCREENS: Screen[] = [
  { path: /^\/grower$/, render: () => <GrowerHome /> },
  { path: /^\/grower\/orders\/new$/, render: (user) => <OrderForm user={user} /> },
  { path: /^\/orders\/([^/]+)$/, render: (user, [n]) => <OrderPage key={n} number={n!} user={user} /> },
  { path: /^\/field$/, render: () => <Field /> },
  { path: /^\/board$/, render: () => <Board /> },
  { path: /^\/channels\/([^/]+)\/capacity$/, render: (user, [id]) => <CapacityTable key={id} channelId={id!} user={user} /> },
  { path: /^\/restrictions\/([^/]+)$/, render: (_user, [id]) => <RestrictionPage key={id} id={id!} /> },
  { path: /^\/packs$/, render: () => <Packs /> },
  { path: /^\/packs\/new$/, render: () => <NewPack /> },
  { path: /^\/packs\/([^/]+)$/, render: (user, [id]) => <PackPage key={id} id={id!} user={user} /> },
  { path: /^\/contractors$/, render: (user) => <Contractors user={user} /> },
  { path: /^\/review$/, render: () => <Review /> },
];

function NotFound() {
  return (
    <>
      <BareTopBar />
      <main className="page page-narrow" id="main">
        <h1 className="page-title">Page not found</h1>
        <p>Nothing lives at this address. Check the link, or go back to your desk.</p>
        <p>
          <a href="/" className="link">Go to your home screen</a>
        </p>
      </main>
    </>
  );
}

export function App() {
  const { path, query } = useLocation();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    // Reaching sign-in (signed out, or sent there by a 401) forgets the person who was signed in.
    if (path === "/sign-in") return setUser(undefined);
    if (user) return;
    void api<{ user: User }>("/api/me").then((reply) => setUser(reply.ok ? reply.data.user : null));
  }, [path, user]);

  const screen = SCREENS.find((s) => s.path.test(path));
  useEffect(() => {
    if (path === "/sign-in" || user === undefined) return;
    if (user === null && (screen || path === "/")) navigate(signInFor(location.pathname + location.search), true);
    else if (user && (path === "/" || (screen && !mayOpen(user.role, path)))) navigate(HOME[user.role], true);
  }, [path, user, screen]);

  if (path === "/sign-in") {
    return (
      <SignIn
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          navigate(landingFor(signedIn.role, query.get("return")), true);
        }}
      />
    );
  }
  if (path === "/") return null;
  if (!screen) return <NotFound />;
  if (!user || !mayOpen(user.role, path)) return <BareTopBar />;
  const params = screen.path.exec(path)!.slice(1).map(decodeURIComponent);
  return (
    <>
      <TopBar user={user} />
      {screen.render(user, params)}
    </>
  );
}
