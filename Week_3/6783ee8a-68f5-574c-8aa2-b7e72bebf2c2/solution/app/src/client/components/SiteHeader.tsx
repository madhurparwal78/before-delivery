import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Menu as MenuIcon } from "lucide-react";
import { useNarrow } from "../useNarrow";
import { Brand } from "./Brand";
import { Link } from "./Link";
import { MenuButton } from "./Menu";
import { navigate } from "../router";
import { useSession } from "../session";

const RESOURCES = [
  { label: "Keyboard shortcuts", run: () => undefined, href: "#features" },
  { label: "Published limits", run: () => undefined, href: "#plans" },
  { label: "Open format", run: () => undefined, href: "#plans" },
];

/** The workspace header for every screen except the notebook: signed-out form on the landing page, signed-in form elsewhere. */
export function SiteHeader({ landing = false, signOutButton = false }: { landing?: boolean; signOutButton?: boolean }): ReactNode {
  const { user, signOut } = useSession();
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!narrow) setOpen(false);
  }, [narrow]);

  const items = (
    <>
      {landing && <MenuButton label="Resources" caret items={RESOURCES} />}
      {landing && (
        <>
          <a className="nav-link" href="#features">Features</a>
          <a className="nav-link" href="#plans">Open format</a>
          <a className="nav-link" href="#plans">Limits</a>
        </>
      )}
      {user ? (
        <>
          {landing && <Link className="nav-link" to="/notebooks">Your notebooks</Link>}
          {signOutButton && <button type="button" className="nav-link" onClick={() => void signOut().then(() => navigate("/"))}>Sign out</button>}
        </>
      ) : (
        <Link className="nav-link" to="/signin">Sign in</Link>
      )}
    </>
  );

  return (
    <header className="site-header">
      <div className="header-row">
        <Brand markOnly={narrow} />
        <span className="header-spacer" />
        {narrow ? (
          <button
            ref={toggle}
            type="button"
            className="menu-button hamburger"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
          >
            <MenuIcon size={24} aria-hidden="true" />
          </button>
        ) : (
          <nav className="header-nav" aria-label="Main">{items}</nav>
        )}
      </div>
      {narrow && open && (
        <nav className="phone-menu" aria-label="Main" onKeyDown={(event) => event.key === "Escape" && (setOpen(false), toggle.current?.focus())}>
          {items}
        </nav>
      )}
    </header>
  );
}
