import { useState } from "react";
import { del } from "./lib/api";
import { Menu } from "./lib/Menu";
import { Brand, IconClose, IconMenu } from "./lib/icons";
import { Link, navigate } from "./lib/router";
import { setMe, useMe } from "./lib/session";
import { bulletLabel } from "../shared/text";

export function TopBar({ marketing }: { marketing: boolean }) {
  const me = useMe();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await del("/api/session");
    setMe(null);
    setOpen(false);
    navigate("/");
  };

  const shared = me?.shared ?? [];
  const links = marketing ? (
    <>
      <a className="textlink" href="#views">Outlining</a>
      <a className="textlink" href="#roles">Sharing</a>
      <a className="textlink" href="#downloads">Downloads</a>
    </>
  ) : null;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Twigline home"><Brand /><span>Twigline</span></Link>
        <nav className="topnav" aria-label="Main">
          {me === null ? (
            marketing && (
              <>
                <div className="topnav-links">{links}</div>
                <Link to="/signup" className="pill pill-sky topbar-pill">Start your outline</Link>
              </>
            )
          ) : (
            <div className="topnav-links">
              {shared.length > 0 && (
                <Menu label="Shared with you" buttonClassName="nav-button" buttonContent="Shared with you">
                  {(close) => (
                    <>
                      <Link to="/" role="menuitem" className="menu-item" onClick={close}>My outline</Link>
                      {shared.map((entry) => (
                        <Link key={entry.bulletId} to={`/b/${entry.bulletId}`} role="menuitem" className="menu-item" onClick={close}>
                          {bulletLabel(entry.text)}
                        </Link>
                      ))}
                    </>
                  )}
                </Menu>
              )}
              <button type="button" className="nav-button" onClick={signOut}>Sign out</button>
            </div>
          )}
          {(marketing || me !== null) && (
            <button
              type="button" className="menu-button" aria-label="Menu" aria-expanded={open} aria-controls="nav-sheet"
              onClick={() => setOpen(!open)}
            >
              {open ? <IconClose /> : <IconMenu />}
            </button>
          )}
        </nav>
      </div>
      {open && (
        <div className="nav-sheet" id="nav-sheet">
          {me === null ? (
            <>
              {links}
              <Link to="/signup" className="pill pill-sky pill-block" onClick={() => setOpen(false)}>Start your outline</Link>
            </>
          ) : (
            <>
              <Link to="/" className="textlink" onClick={() => setOpen(false)}>My outline</Link>
              {shared.map((entry) => (
                <Link key={entry.bulletId} to={`/b/${entry.bulletId}`} className="textlink" onClick={() => setOpen(false)}>
                  {bulletLabel(entry.text)}
                </Link>
              ))}
              <button type="button" className="nav-button" onClick={signOut}>Sign out</button>
            </>
          )}
        </div>
      )}
    </header>
  );
}
