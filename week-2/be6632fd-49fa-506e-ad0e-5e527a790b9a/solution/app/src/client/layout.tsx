// The shared headers: the public header (light type over night sections) and the staff header with the workspace
// name, the role's navigation and Sign out.
import { LogOut } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "./api";
import { Link, useRouter } from "./router";
import { type Role, useSession } from "./session";

const NAV: Record<Role, Array<[string, string]>> = {
  launch_producer: [["/studio/drops", "Drops"], ["/studio/stockists", "Stockists"], ["/studio/members", "Members"]],
  merchandiser: [["/studio/drops", "Drops"], ["/studio/stockists", "Stockists"], ["/studio/price-lists", "Price lists"]],
  finance_lead: [["/studio/invoicing", "Invoicing"], ["/studio/price-lists", "Price lists"], ["/studio/stockists", "Stockists"]],
  press_lead: [["/studio/press", "Press"]],
  stockist_buyer: [["/studio/my-store", "My store"]],
};

function SkipLink(): JSX.Element {
  return (
    <a className="skip-link" href="#main">
      Skip to content
    </a>
  );
}

function Wordmark(): JSX.Element {
  return (
    <span className="wordmark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 12 L12 4" stroke="var(--vermilion)" strokeWidth="2" strokeLinecap="round" />
        <path d="M3.5 7 A10 10 0 0 1 7 3.4" fill="none" stroke="currentColor" strokeWidth="3" />
      </svg>
    </span>
  );
}

/** Watches the night sections under the header and flips its tone while it sits over one. */
function useNightTone(): boolean {
  const [over, setOver] = useState(false);
  const { path } = useRouter();
  useEffect(() => {
    const check = (): void => {
      const sections = document.querySelectorAll<HTMLElement>(".night-section");
      const y = 32;
      setOver([...sections].some((s) => {
        const r = s.getBoundingClientRect();
        return r.top <= y && r.bottom >= y;
      }));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [path]);
  return over;
}

export function PublicShell({ children }: { children: ReactNode }): JSX.Element {
  const night = useNightTone();
  return (
    <>
      <SkipLink />
      <header className={`site-header public-header${night ? " is-over-night" : ""}`}>
        <Link to="/" className="brand">
          <Wordmark />
          <span>Hourline</span>
        </Link>
        <nav aria-label="Site" className="site-nav">
          <Link to="/">Drop calendar</Link>
          <Link to="/sign-in">Studio</Link>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}

export function StaffShell({ children }: { children: ReactNode }): JSX.Element {
  const { member, workspace, clear } = useSession();
  const { navigate, path } = useRouter();
  const [open, setOpen] = useState(false);
  const signOut = async (): Promise<void> => {
    await api("POST", "/api/auth/sign-out");
    clear();
    navigate("/sign-in");
  };
  useEffect(() => setOpen(false), [path]);
  const links = member ? NAV[member.role] : [];
  return (
    <>
      <SkipLink />
      <header className="site-header staff-header">
        <Link to={links[0]?.[0] ?? "/"} className="brand">
          <Wordmark />
          <span className="workspace">{workspace?.name}</span>
        </Link>
        <button type="button" className="btn btn-quiet nav-toggle" aria-expanded={open} aria-controls="studio-nav" onClick={() => setOpen((o) => !o)}>
          Menu
        </button>
        <nav aria-label="Studio" id="studio-nav" className={`studio-nav${open ? " is-open" : ""}`}>
            {links.map(([to, label]) => (
              <Link key={to} to={to} aria-current={path === to || path.startsWith(`${to}/`) ? "page" : undefined}>
                {label}
              </Link>
            ))}
        </nav>
        <button type="button" className="btn btn-quiet sign-out" onClick={() => void signOut()}>
          <LogOut size={16} aria-hidden="true" focusable="false" />
          Sign out
        </button>
      </header>
      <main id="main" tabIndex={-1} className="staff-main">
        {children}
      </main>
    </>
  );
}
