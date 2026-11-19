import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Link, signInHref, useLocation } from "../router";
import { useSession } from "../session";
import { Icon } from "./ui";

/** The studio header: transparent over the first screen, dark glass once scrolled past it. */
export function Header() {
  const { me, loaded, has } = useSession();
  const location = useLocation();
  const [glass, setGlass] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const landing = location.path === "/";

  useEffect(() => {
    const update = () => setGlass(window.scrollY > (landing ? window.innerHeight - 72 : 8));
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [landing]);

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.path]);

  useEffect(() => {
    if (!menuOpen && !accountOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
      if (accountOpen) {
        setAccountOpen(false);
        accountButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, accountOpen]);

  const here = location.path + (location.search.toString() ? `?${location.search}` : "");
  const signOut = async () => {
    await api("POST", "/auth/logout");
    window.location.assign("/");
  };

  return (
    <header className={`site-header ${glass ? "is-glass" : ""}`}>
      <div className="header-inner">
        <Link to="/" className="wordmark">
          <span className="wordmark-mark" aria-hidden="true" />
          Phosphene Yard
        </Link>
        <button
          ref={menuButton}
          type="button"
          className="icon-button menu-button"
          aria-expanded={menuOpen}
          aria-controls="main-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? "x" : "menu"} />
          <span className="visually-hidden">Menu</span>
        </button>
        <div className={`header-links ${menuOpen ? "is-open" : ""}`}>
          <nav id="main-nav" aria-label="Main">
            <ul>
              <li><Link to="/gallery" aria-current={location.path === "/gallery" ? "page" : undefined}>Gallery</Link></li>
              {has("creator") ? <li><Link to="/studio" aria-current={location.path.startsWith("/studio") ? "page" : undefined}>Studio</Link></li> : null}
              {has("collector") ? <li><Link to="/library" aria-current={location.path === "/library" ? "page" : undefined}>Library</Link></li> : null}
              {has("founder-operator") ? <li><Link to="/console" aria-current={location.path === "/console" ? "page" : undefined}>Console</Link></li> : null}
            </ul>
          </nav>
          {loaded && !me ? (
            <a className="header-signin" href={signInHref(here)}>
              Sign in
            </a>
          ) : null}
          {me ? (
            <div className="account">
              <button
                ref={accountButton}
                type="button"
                className="account-button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
              >
                <Icon name="user" />
                <span>Account</span>
              </button>
              {accountOpen ? (
                <div role="menu" className="account-menu" aria-label={me.display_name}>
                  <p className="account-name">{me.display_name}</p>
                  <button type="button" role="menuitem" onClick={() => void signOut()}>
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <Link to="/#describe" className="button button-accent next-action">
          Start a piece
          <Icon name="arrowRight" size={16} />
        </Link>
      </div>
    </header>
  );
}
