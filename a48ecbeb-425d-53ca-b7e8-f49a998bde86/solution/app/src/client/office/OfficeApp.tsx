import { LogOut, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "../components/Header";
import { api } from "../lib/api";
import { Link, match, navigate, useLocation } from "../lib/router";
import type { Role, ServiceName, Services, User } from "../lib/types";
import { Applications } from "./Applications";
import { Dashboard } from "./Dashboard";
import { OrderDetail } from "./OrderDetail";
import { Queue } from "./Queue";
import { Reviews } from "./Reviews";
import { Search } from "./Search";
import { Settings } from "./Settings";
import { Stock } from "./Stock";
import { failureOf, Loading, RoleDenied } from "./shared";
import "./office.css";

const STATUS_POLL_MS = 5000;

const OUTAGE_COPY: [ServiceName, string][] = [
  ["killbill", "Billing is unreachable. Refunds and subscription changes are paused; packing continues."],
  ["minio", "File storage is unreachable. Packing slips and invoices can't be opened until it returns."],
  ["postgres", "The orders database is unreachable. The queue can't load until it returns."],
  ["pocketbase", "Accounts are unreachable. Staff already signed in can keep working."],
  ["mailpit", "Email is delayed. Messages are queued and will send when it returns."],
];

const ROLE_LABELS: Record<Role, string> = { customer: "Customer", fulfilment: "Fulfilment", support: "Support", owner: "Owner" };

const STAFF: readonly Role[] = ["fulfilment", "support", "owner"];
const OWNER: readonly Role[] = ["owner"];

const PAGES: { href: string; label: string; roles: readonly Role[]; view: (user: User) => ReactNode }[] = [
  { href: "/office/queue", label: "Queue", roles: STAFF, view: (user) => <Queue user={user} /> },
  { href: "/office/stock", label: "Stock", roles: STAFF, view: () => <Stock /> },
  { href: "/office/search", label: "Search", roles: STAFF, view: () => <Search /> },
  { href: "/office/dashboard", label: "Dashboard", roles: OWNER, view: () => <Dashboard /> },
  { href: "/office/settings", label: "Settings", roles: OWNER, view: () => <Settings /> },
  { href: "/office/applications", label: "Applications", roles: OWNER, view: () => <Applications /> },
  { href: "/office/reviews", label: "Reviews", roles: OWNER, view: () => <Reviews /> },
];

/** Who opened the back office; `unavailable` is a store outage, when no session can be checked. */
type Visitor = { kind: "loading" } | { kind: "staff"; user: User } | { kind: "customer" } | { kind: "unavailable" };

function officePage(path: string, user: User): ReactNode {
  if (path === "/office") return <Loading />;
  const order = match(/^\/office\/orders\/([^/]+)$/, path);
  if (order) return <OrderDetail key={path} number={decodeURIComponent(order[0])} user={user} />;
  const page = PAGES.find((p) => p.href === path);
  if (!page) return <h1>We couldn't find that page.</h1>;
  return page.roles.includes(user.role) ? page.view(user) : <RoleDenied />;
}

export function OfficeApp() {
  const { path: rawPath } = useLocation();
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
  const [visitor, setVisitor] = useState<Visitor>({ kind: "loading" });
  const [services, setServices] = useState<Services | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    document.body.classList.add("paper");
    return () => document.body.classList.remove("paper");
  }, []);

  const loadVisitor = useCallback(async () => {
    try {
      const { user } = await api<{ user: User }>("GET", "/api/me");
      setVisitor(user.role === "customer" ? { kind: "customer" } : { kind: "staff", user });
    } catch (error) {
      if (failureOf(error).status !== 401) setVisitor({ kind: "unavailable" });
    }
  }, []);

  useEffect(() => {
    void loadVisitor();
  }, [loadVisitor]);

  // While sessions can't be checked, keep asking so the office returns with the store.
  useEffect(() => {
    if (visitor.kind !== "unavailable") return;
    const timer = setInterval(() => void loadVisitor(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [visitor.kind, loadVisitor]);

  useEffect(() => {
    const read = () =>
      api<{ services: Services }>("GET", "/api/staff/status").then(
        (body) => setServices(body.services),
        // A failed status read keeps the last banners; the page's own calls report their errors.
        () => undefined,
      );
    void read();
    const timer = setInterval(() => void read(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (visitor.kind === "staff" && path === "/office") navigate("/office/queue", true);
  }, [visitor.kind, path]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api<undefined>("POST", "/api/auth/sign-out");
      navigate("/sign-in");
    } catch (error) {
      failureOf(error);
      setSigningOut(false);
    }
  };

  // Until the visitor is known, show only the loading state: the header (name, role, nav, sign-out) then appears with
  // the page instead of growing above it.
  if (visitor.kind === "loading") {
    return (
      <div className="office">
        <main className="office-main">
          <Loading />
        </main>
      </div>
    );
  }

  if (visitor.kind === "customer") {
    return (
      <main className="office office-main">
        <h1>You don't have access to the back office.</h1>
      </main>
    );
  }

  const user = visitor.kind === "staff" ? visitor.user : null;
  const links = user ? PAGES.filter((p) => p.roles.includes(user.role)) : [];
  const down = services ? OUTAGE_COPY.filter(([name]) => services[name] === "down") : [];

  return (
    <div className="office">
      <header className="office-top">
        <div className="office-top-inner">
          <Link href="/" className="office-wordmark" aria-label="Ceibo home">
            <Wordmark />
          </Link>
          {user && (
            <p className="office-who">
              <span className="office-name">{user.name}</span>
              <span className="badge office-role">{ROLE_LABELS[user.role]}</span>
            </p>
          )}
          <nav aria-label="Back office" className="office-nav">
            {links.length > 0 && (
              <ul>
                {links.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} aria-current={path === p.href ? "page" : undefined}>
                      {p.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          {user && (
            <button type="button" className="btn btn-quiet office-sign-out" onClick={() => void signOut()} disabled={signingOut} aria-busy={signingOut}>
              <LogOut size={18} aria-hidden="true" />
              Sign out
            </button>
          )}
        </div>
      </header>
      {down.length > 0 && (
        <div className="office-banners">
          {down.map(([name, copy]) => (
            <div key={name} role="alert" className="banner">
              <TriangleAlert size={20} aria-hidden="true" />
              <span>{copy}</span>
            </div>
          ))}
        </div>
      )}
      <main className="office-main">{user && officePage(path, user)}</main>
    </div>
  );
}
