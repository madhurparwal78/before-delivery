import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Role } from "../shared/rules";
import { Skeleton } from "./components/ui";
import { MarketDetail } from "./market/MarketDetail";
import { AdminPage } from "./pages/Admin";
import { BalancePage } from "./pages/Balance";
import { BuilderPage } from "./pages/Builder";
import { NoVenuePage, NotFoundPage, SignInErrorPage, SignInUnavailablePage } from "./pages/Errors";
import { HomePage } from "./pages/Home";
import { MarketsPage } from "./pages/Markets";
import { OrderDetailPage, OrdersPage, ProfilePage, StatementsPage } from "./pages/Member";
import { OwnerPage } from "./pages/Owner";
import { PlatformPage } from "./pages/Platform";
import { RouterProvider, usePath } from "./router";
import { SessionProvider, useSession } from "./session";
import "./styles.css";

const AcceptInvitePage = lazy(() => import("./pages/AcceptInvite"));

const INITIAL_PATH = window.location.pathname;

/** Pages the server marked itself (sign-in errors, unknown routes) for the first path it served. */
const SERVER_PAGES: Record<string, () => ReactNode> = {
  "signin-error": () => <SignInErrorPage />,
  "signin-unavailable": () => <SignInUnavailablePage />,
  "not-found": () => <NotFoundPage />,
};

interface Screen {
  pattern: RegExp;
  render: (match: RegExpExecArray) => ReactNode;
  /** Roles that may open the screen; a venue member with any venue role when absent. */
  roles?: Role[];
}

const SCREENS: Screen[] = [
  { pattern: /^\/markets$/, render: () => <MarketsPage /> },
  { pattern: /^\/markets\/([^/]+)$/, render: (m) => <MarketDetail key={m[1]} id={m[1] ?? ""} /> },
  { pattern: /^\/balance$/, render: () => <BalancePage /> },
  { pattern: /^\/orders$/, render: () => <OrdersPage /> },
  { pattern: /^\/orders\/([^/]+)$/, render: (m) => <OrderDetailPage id={m[1] ?? ""} /> },
  { pattern: /^\/statements$/, render: () => <StatementsPage /> },
  { pattern: /^\/profile$/, render: () => <ProfilePage /> },
  { pattern: /^\/builder$/, render: () => <BuilderPage />, roles: ["builder"] },
  { pattern: /^\/admin$/, render: () => <AdminPage />, roles: ["market_admin"] },
  { pattern: /^\/owner$/, render: () => <OwnerPage />, roles: ["org_owner"] },
  { pattern: /^\/platform$/, render: () => <PlatformPage />, roles: ["founder_operator"] },
];

function App() {
  const path = usePath();
  const { session } = useSession();
  const marker = document.documentElement.dataset.page ?? "app";
  const serverPage = SERVER_PAGES[marker];
  if (serverPage && path === INITIAL_PATH) return serverPage();

  const invite = /^\/invites\/([^/]+)$/.exec(path);
  if (invite) {
    return (
      <Suspense fallback={<div className="field field-slate"><Skeleton rows={3} /></div>}>
        <AcceptInvitePage token={decodeURIComponent(invite[1] ?? "")} />
      </Suspense>
    );
  }
  if (session.status === "loading") return <div className="field field-slate"><Skeleton rows={3} /></div>;
  if (path === "/") {
    if (session.status === "signed-in" && session.me.venue === null && !session.me.roles.includes("founder_operator")) return <NoVenuePage />;
    return <HomePage />;
  }
  const screen = SCREENS.find((s) => s.pattern.test(path));
  if (!screen) return <NotFoundPage />;
  if (session.status !== "signed-in") {
    window.location.assign(`/auth/login?next=${encodeURIComponent(path)}`);
    return null;
  }
  const { me } = session;
  if (me.venue === null && !screen.roles?.includes("founder_operator")) {
    return me.roles.includes("founder_operator") ? <NotFoundPage /> : <NoVenuePage />;
  }
  if (screen.roles && !screen.roles.some((role) => me.roles.includes(role))) return <NotFoundPage />;
  return <>{screen.render(screen.pattern.exec(path) as RegExpExecArray)}</>;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
);
