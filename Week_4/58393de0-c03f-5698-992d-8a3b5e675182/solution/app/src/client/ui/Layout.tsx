import { useRef, useState, type ReactNode } from "react";
import { Menu as MenuIcon, UserRound, X } from "lucide-react";
import { api } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { homePath, useSession } from "../lib/session";
import { NoticeBand } from "../lib/notices";
import { SettlingProvider } from "../lib/settling";
import { Dialog } from "./Dialog";
import { Mark } from "./Mark";
import "./layout.css";

const NAV_LINKS = [
  { label: "Editors", to: "/#editors" },
  { label: "For classrooms", to: "/#classrooms" },
  { label: "Starter projects", to: "/#starter-projects" },
  { label: "Join a class", to: "/join" },
] as const;

function MainNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="main-nav">
      <ul>
        {NAV_LINKS.map((link) => (
          <li key={link.to}><Link to={link.to} onClick={onNavigate}>{link.label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}

function Header() {
  const { account, setAccount } = useSession();
  const { navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const signOut = async () => {
    await api.post("/api/auth/signout");
    setAccount(null);
    setMenuOpen(false);
    navigate("/");
  };
  const accountName = account ? (account.nickname ?? account.displayName) : null;

  return (
    <header className="site-header">
      <button type="button" className="header-menu" ref={menuButton} onClick={() => setMenuOpen(true)}>
        <MenuIcon size={22} aria-hidden="true" />
        <span>Menu</span>
      </button>
      <Link to="/" className="brand" aria-label="Quarkyard home">
        <Mark />
        <span className="brand-word" aria-hidden="true">Quarkyard</span>
      </Link>
      <MainNav />
      <div className="header-account">
        {account && accountName ? (
          <>
            <Link to={homePath(account)} className="header-name">{accountName}</Link>
            <button type="button" className="pill pill--on-blue pill--small" onClick={() => void signOut()}>Sign out</button>
          </>
        ) : (
          <>
            <Link to="/signin" className="pill pill--on-blue pill--small">Sign in</Link>
            <Link to="/signup" className="pill pill--white pill--small">Sign up</Link>
          </>
        )}
      </div>
      <Link to={account ? homePath(account) : "/signin"} className="header-account-link">
        <UserRound size={22} aria-hidden="true" />
        <span>Account</span>
      </Link>
      <Dialog open={menuOpen} title="Menu" onClose={() => setMenuOpen(false)} className="menu-dialog">
        <MainNav onNavigate={() => setMenuOpen(false)} />
        {account ? (
          <button type="button" className="pill stretch-narrow" onClick={() => void signOut()}>Sign out</button>
        ) : (
          <div className="pill-row">
            <Link to="/signin" className="pill pill--outline" onClick={() => setMenuOpen(false)}>Sign in</Link>
            <Link to="/signup" className="pill" onClick={() => setMenuOpen(false)}>Sign up</Link>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="pill pill--outline" onClick={() => setMenuOpen(false)}>
            <X size={18} aria-hidden="true" />Close
          </button>
        </div>
      </Dialog>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="column footer-inner">
        <div className="footer-brand"><Mark size={28} /><strong>Quarkyard</strong></div>
        <p className="hint">Hollowbrook Maker Co. Make, wire and code in the browser.</p>
        <ul className="footer-links">
          <li><Link to="/privacy">Privacy</Link></li>
          <li><Link to="/terms">Terms</Link></li>
          <li><Link to="/student-data">Student data</Link></li>
        </ul>
        <p className="hint">&copy; Hollowbrook Maker Co.</p>
      </div>
    </footer>
  );
}

/** The frame of every page: fixed workshop header, the Notice band, the page, and (outside editors) the footer. */
export function Layout({ children, footer = true }: { children: ReactNode; footer?: boolean }) {
  return (
    <SettlingProvider>
      {(settling) => (
        <div className="page" data-settling={settling ? "" : undefined}>
          <Header />
          <NoticeBand />
          <main id="main" tabIndex={-1}>{children}</main>
          {footer ? <Footer /> : null}
        </div>
      )}
    </SettlingProvider>
  );
}
