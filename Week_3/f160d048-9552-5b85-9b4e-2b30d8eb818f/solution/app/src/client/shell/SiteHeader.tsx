import { Menu, X } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog } from "../components/dialog";
import { useIsPhone } from "../hooks";
import { Link, useLocation } from "../router";
import { useSession } from "../session";

type NavItem = { to: string; label: string };

function navItems(role: string | undefined): NavItem[] {
  const common = [
    { to: "/jobs", label: "Lab jobs" },
    { to: "/companies", label: "Companies" },
    // Channels and Share are member pages; other roles would land on Not found.
    ...(role === undefined || role === "member"
      ? [{ to: "/channels", label: "Channels" }, { to: "/contribute", label: "Share" }]
      : []),
  ];
  const own =
    role === "member"
      ? [
          { to: "/me/contributions", label: "My contributions" },
          { to: "/saved", label: "Saved jobs" },
          { to: "/applications", label: "My applications" },
          { to: "/alerts", label: "Alerts" },
        ]
      : role === "moderator"
        ? [{ to: "/moderation", label: "Moderation" }]
        : role === "founder"
          ? [{ to: "/moderation", label: "Moderation" }, { to: "/founder", label: "Founder" }]
          : role === "employer_admin" || role === "recruiter"
            ? [{ to: "/employer", label: "Employer" }]
            : [];
  return [...common, ...own];
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { me, signOut } = useSession();
  const { path } = useLocation();
  return (
    <>
      {navItems(me?.role).map((item) => {
        const current = path === item.to || (item.to !== "/" && path.startsWith(`${item.to}/`));
        return (
          <Link key={item.to} to={item.to} aria-current={current ? "page" : undefined} onNavigate={onNavigate}>
            {item.label}
          </Link>
        );
      })}
      {me ? (
        <button type="button" onClick={() => { onNavigate?.(); void signOut(); }}>Sign out</button>
      ) : (
        <Link to="/sign-in" onNavigate={onNavigate}>Sign in</Link>
      )}
    </>
  );
}

export function SiteHeader() {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <header className="site-header">
      <Link to="/" className="wordmark">Candour Bench</Link>
      {phone ? (
        <>
          <button type="button" ref={opener} className="btn-quiet menu-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <Menu size={20} aria-hidden="true" />
            Menu
          </button>
          <Dialog title="Menu" open={open} onClose={() => setOpen(false)} opener={opener}>
            <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>
              <X size={20} aria-hidden="true" />
              Close
            </button>
            <nav className="dialog-nav" aria-label="Main">
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
          </Dialog>
        </>
      ) : (
        <nav className="nav" aria-label="Main">
          <NavLinks />
        </nav>
      )}
    </header>
  );
}
