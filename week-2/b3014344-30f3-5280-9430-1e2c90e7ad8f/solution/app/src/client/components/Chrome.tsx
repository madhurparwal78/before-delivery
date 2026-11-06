import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { boot } from "../lib/api";
import { Link } from "../lib/router";
import { useSession } from "../session";
import { Dialog } from "./Dialog";

export const STUDIO_EMAIL = "studio@pampero.test";

function MainLinks({ onPick }: { onPick?: () => void }) {
  const { user } = useSession();
  const home = user?.role === "studio_owner" ? "/studio" : "/portal";
  return (
    <ul className="nav-links">
      <li><Link href="/#work" onClick={onPick}>Work</Link></li>
      <li><Link href="/#process" onClick={onPick}>Process</Link></li>
      <li><Link href="/#pricing" onClick={onPick}>Pricing</Link></li>
      <li><Link href="/journal" onClick={onPick}>Journal</Link></li>
      <li>{user ? <Link href={home} onClick={onPick}>Portal</Link> : <Link href="/sign-in" onClick={onPick}>Sign in</Link>}</li>
    </ul>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="brand">
          <span className="brand__mark" aria-hidden="true" />
          Pampero Build Co.
        </Link>
        <nav aria-label="Main" className="nav-inline">
          <MainLinks />
        </nav>
        <button type="button" className="button button--ghost menu-button" onClick={() => setOpen(true)}>
          <Menu aria-hidden="true" size={20} />
          Menu
        </button>
      </div>
      <Dialog open={open} label="Menu" variant="drawer" onClose={() => setOpen(false)}>
        <div className="drawer__top">
          <span className="brand brand--small">Pampero Build Co.</span>
          <button type="button" className="button button--ghost icon-button" aria-label="Close menu" onClick={() => setOpen(false)}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <nav aria-label="Main" className="nav-drawer">
          <MainLinks onPick={() => setOpen(false)} />
        </nav>
      </Dialog>
    </header>
  );
}

const SERVER_EPOCH = Date.parse(boot.now);
const BOOTED_AT = Date.now();

function studioTime(): string {
  const at = new Date(SERVER_EPOCH + (Date.now() - BOOTED_AT) - 3 * 3600_000);
  return at.toISOString().slice(11, 19);
}

/** The studio's Buenos Aires time: the server's reading at page load, advanced every second here. */
function StudioClock() {
  const [time, setTime] = useState(studioTime);
  useEffect(() => {
    const timer = setInterval(() => setTime(studioTime()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p role="timer" aria-label="Studio time" className="clock">
      Studio time <span className="mono">{time}</span>
    </p>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <StudioClock />
        <p className="site-footer__line">
          Pampero Build Co. · Buenos Aires · <a href={`mailto:${STUDIO_EMAIL}`}>{STUDIO_EMAIL}</a>
        </p>
      </div>
    </footer>
  );
}

export function SkipLink() {
  return (
    <a className="skip-link" href="#main">
      Skip to content
    </a>
  );
}
