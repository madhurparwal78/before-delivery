// Page chrome: the account links, the storage banner and the route accent on <body>.
import { useEffect, type ReactNode } from "react";
import { api } from "./api";
import { Icon } from "./icons";
import { navigate, useLocation } from "./router";
import { useSession } from "./session";

const STORAGE_BANNER = "Part storage is unreachable. Viewing and discussion still work.";

/** A room state as a person reads it: `Open`, `Approved`, `Closed`. */
export const stateLabel = (state: string): string => state.charAt(0).toUpperCase() + state.slice(1);

function accentOf(pathname: string): "cyan" | "band" {
  return pathname === "/dashboard" || pathname.startsWith("/rooms/") ? "band" : "cyan";
}

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a
      href={to}
      className={className}
      {...rest}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function AccountLinks() {
  const { me, refresh } = useSession();
  if (!me) return <Link to="/signin" className="nav-link">Sign in</Link>;
  return (
    <>
      <Link to="/dashboard" className="nav-link">Dashboard</Link>
      <button
        type="button"
        className="nav-button"
        onClick={async () => {
          await api("POST", "/api/auth/signout");
          await refresh();
          navigate("/");
        }}
      >
        Sign out
      </button>
    </>
  );
}

function StorageStatus() {
  const { storageDown } = useSession();
  if (!storageDown) return null;
  return (
    <div className="storage-banner" role="status" aria-label="Storage">
      <Icon name="info" />
      {STORAGE_BANNER}
    </div>
  );
}

export function Shell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const { pathname } = useLocation();
  useEffect(() => {
    document.body.setAttribute("data-accent", accentOf(pathname));
  }, [pathname]);
  return (
    <div className="shell">
      {bare ? null : (
        <header className="topbar">
          <Link to="/" className="brand">
            <Icon name="mark" size={20} />
            <span>Gimbrel Works</span>
          </Link>
          <nav className="account" aria-label="Account">
            <AccountLinks />
          </nav>
        </header>
      )}
      <StorageStatus />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <section className="notice-page">
      <h1>Not found</h1>
      <p>That page does not exist, or you cannot read it.</p>
      <Link to="/" className="button">Back to the gallery</Link>
    </section>
  );
}
