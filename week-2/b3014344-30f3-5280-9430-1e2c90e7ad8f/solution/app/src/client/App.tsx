import { LogOut } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Footer, Header, SkipLink } from "./components/Chrome";
import { Stage, type Section } from "./components/Stage";
import { api, boot } from "./lib/api";
import { Link, navigate, useLocation } from "./lib/router";
import { CaseStudy } from "./pages/CaseStudy";
import { Checkout } from "./pages/Checkout";
import { Home } from "./pages/Home";
import { Invite } from "./pages/Invite";
import { Invoices } from "./pages/Invoices";
import { Journal, JournalPost } from "./pages/Journal";
import { AccessEnded, NotFound } from "./pages/Missing";
import { Overview } from "./pages/Overview";
import { PlanPage } from "./pages/Plan";
import { ProjectPage } from "./pages/Project";
import { Receipt } from "./pages/Receipt";
import { SignIn } from "./pages/SignIn";
import { Studio } from "./pages/Studio";
import { useSession } from "./session";
import { useDeck } from "./pages/deck";

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function PublicLayout({ children, stage }: { children: ReactNode; stage: Section | null }) {
  const deck = useDeck();
  return (
    <div className={stage === null ? "public public--home" : "public"}>
      <SkipLink />
      <Header />
      <Stage fixed={stage} deckCount={deck.entries?.length ?? 4} />
      <main id="main" tabIndex={-1} className="public__main">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function LedgerLayout({ children, nav }: { children: ReactNode; nav: "portal" | "studio" }) {
  const { user, setUser } = useSession();
  const { path, hash } = useLocation();
  const signOut = async () => {
    await api("/api/session", { method: "DELETE" }).catch(() => undefined);
    setUser(null);
    navigate("/sign-in");
  };
  const owner = user?.role === "client_owner";
  const links =
    nav === "studio"
      ? [
          { href: "/studio#orders", label: "Orders" },
          { href: "/studio#prices", label: "Peso prices" },
          { href: "/studio#entries", label: "Entries" },
          { href: "/portal", label: "Projects" },
        ]
      : [
          { href: "/portal", label: "Overview" },
          { href: "/portal#projects", label: "Projects" },
          ...(owner ? [{ href: "/portal/plan", label: "Plan" }, { href: "/portal/invoices", label: "Invoices" }] : []),
        ];
  const current = (href: string) => {
    const [p, h] = href.split("#");
    return p === path && (h ? hash === `#${h}` : !hash) ? "page" : undefined;
  };
  return (
    <div className="ledger">
      <SkipLink />
      <header className="ledger-header">
        <Link href="/" className="brand brand--small">
          <span className="brand__mark" aria-hidden="true" />
          Pampero Build Co.
        </Link>
        <span className="ledger-header__who">{user ? `${user.name}` : null}</span>
        <button type="button" className="button button--ghost button--small" onClick={signOut}>
          <LogOut aria-hidden="true" size={18} />
          Sign out
        </button>
      </header>
      <div className="ledger__panes">
        <nav aria-label={nav === "studio" ? "Studio" : "Portal"} className="ledger-nav">
          <p className="ledger-nav__title">{nav === "studio" ? "Studio console" : "Client portal"}</p>
          <ul>
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} aria-current={current(link.href)}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="ledger__main">
          {children}
        </main>
      </div>
      <Footer />
    </div>
  );
}

export function App() {
  const location = useLocation();
  const { user } = useSession();
  const parts = location.path.split("/").filter(Boolean);
  // The server already decided the first page's status; later navigations decide in the page.
  const serverState = location.key === 0 ? boot.page : "ok";

  if (serverState === "not_found") return <PublicLayout stage="contact"><NotFound /></PublicLayout>;
  if (serverState === "access_ended") return <PublicLayout stage="contact"><AccessEnded /></PublicLayout>;

  if (location.path === "/") return <PublicLayout stage={null}><Home /></PublicLayout>;
  if (parts[0] === "work" && parts.length === 2) return <PublicLayout stage="work"><CaseStudy slug={parts[1]!} /></PublicLayout>;
  if (location.path === "/journal") return <PublicLayout stage="contact"><Journal /></PublicLayout>;
  if (parts[0] === "journal" && parts.length === 2) return <PublicLayout stage="contact"><JournalPost slug={parts[1]!} /></PublicLayout>;
  if (location.path === "/sign-in") return <PublicLayout stage="contact"><SignIn /></PublicLayout>;
  if (parts[0] === "checkout" && parts.length === 2) return <PublicLayout stage="pricing"><Checkout orderId={parts[1]!} /></PublicLayout>;
  if (parts[0] === "orders" && parts[2] === "receipt" && parts.length === 3) return <PublicLayout stage="pricing"><Receipt orderId={parts[1]!} /></PublicLayout>;
  if (parts[0] === "invite" && parts.length === 2) return <PublicLayout stage="contact"><Invite token={parts[1]!} /></PublicLayout>;

  if (parts[0] === "portal" || parts[0] === "studio") {
    if (!user) return <Redirect to={`/sign-in?next=${encodeURIComponent(location.path)}`} />;
    if (location.path === "/studio") {
      return user.role === "studio_owner" ? <LedgerLayout nav="studio"><Studio /></LedgerLayout> : <PublicLayout stage="contact"><NotFound /></PublicLayout>;
    }
    if (location.path === "/portal") return <LedgerLayout nav="portal"><Overview /></LedgerLayout>;
    if (location.path === "/portal/plan" && user.role === "client_owner") return <LedgerLayout nav="portal"><PlanPage /></LedgerLayout>;
    if (location.path === "/portal/invoices" && user.role === "client_owner") return <LedgerLayout nav="portal"><Invoices /></LedgerLayout>;
    if (parts[1] === "projects" && parts.length === 3) return <LedgerLayout nav="portal"><ProjectPage projectId={parts[2]!} /></LedgerLayout>;
  }
  return <PublicLayout stage="contact"><NotFound /></PublicLayout>;
}
