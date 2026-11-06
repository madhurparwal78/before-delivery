import { ChevronDown, Menu as MenuIcon, ShoppingBag } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { navigate, Link, useLocation } from "../lib/router";
import { usePhone } from "../lib/hooks";
import { usePresence } from "../lib/presence";
import { useSession } from "../lib/session";
import { Dialog } from "./Dialog";

const FAMILIES = [
  { label: "Downlights", family: "downlights", note: "Recessed and gimbal" },
  { label: "Track spots", family: "track-spots", note: "Three-circuit heads" },
  { label: "Pendants", family: "pendants", note: "Spun, diffused" },
  { label: "Surface mounted", family: "surface", note: "For exposed ceilings" },
  { label: "Clearance", family: "clearance", note: "Final units" },
];

function CartLink() {
  const { cartCount } = useSession();
  return (
    <Link href="/cart" className="header__cart">
      <ShoppingBag aria-hidden="true" size={18} strokeWidth={1.5} />
      Cart
      <span className="count-badge" aria-hidden="true">
        {cartCount}
      </span>
      <span className="visually-hidden">, {cartCount === 1 ? "1 item" : `${cartCount} items`}</span>
    </Link>
  );
}

function AccountLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { user, approvedTrade, signOut } = useSession();
  if (!user) {
    return (
      <Link href="/signin" onClick={onNavigate}>
        Sign in
      </Link>
    );
  }
  return (
    <>
      {approvedTrade && (
        <Link href="/projects" onClick={onNavigate}>
          Projects
        </Link>
      )}
      {user.role === "admin" && (
        <Link href="/admin" onClick={onNavigate}>
          Admin
        </Link>
      )}
      <Link href="/favourites" onClick={onNavigate}>
        Favourites
      </Link>
      <Link href="/account" onClick={onNavigate}>
        Account
      </Link>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          onNavigate?.();
          void signOut().then(() => navigate("/"));
        }}
      >
        Sign out
      </button>
    </>
  );
}

function MegaMenu({ open, close }: { open: boolean; close: () => void }) {
  const { ref, mounted, closing } = usePresence<HTMLElement>(open);
  if (!mounted) return null;
  return (
    <section
      ref={ref}
      id="catalogue-menu"
      aria-label="Catalogue menu"
      className="mega-menu"
      inert={closing}
      aria-hidden={closing || undefined}
    >
      <ul className="mega-menu__list">
        {FAMILIES.map((item) => (
          <li key={item.family}>
            <Link href={`/catalogue?family=${item.family}`} onClick={close} className="mega-menu__link">
              <span className="mega-menu__label">{item.label}</span>
              <span className="mega-menu__note" aria-hidden="true">{item.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Header() {
  const phone = usePhone();
  const { path } = useLocation();
  const [megaOpen, setMegaOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const focusFirst = useRef(false);
  const navLabel = useId();

  useEffect(() => {
    setMegaOpen(false);
    setMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (!megaOpen) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      document.querySelector<HTMLAnchorElement>("#catalogue-menu a")?.focus();
    }
    const onPointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMegaOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMegaOpen(false);
        opener.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [megaOpen]);

  const onOpenerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusFirst.current = true;
      if (megaOpen) document.querySelector<HTMLAnchorElement>("#catalogue-menu a")?.focus();
      setMegaOpen(true);
    }
  };

  return (
    <header className="site-header" ref={headerRef}>
      <div className="site-header__bar">
        <Link href="/" className="wordmark">
          Lightfall
        </Link>
        <nav aria-label="Main" className="main-nav" id={navLabel}>
          {!phone && (
            <button
              ref={opener}
              type="button"
              className="main-nav__catalogue"
              aria-expanded={megaOpen}
              aria-controls="catalogue-menu"
              onClick={() => setMegaOpen((value) => !value)}
              onKeyDown={onOpenerKey}
            >
              Catalogue
              <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} />
            </button>
          )}
          <CartLink />
          {!phone && <AccountLinks />}
          {phone && (
            <button type="button" className="main-nav__menu" onClick={() => setMenuOpen(true)}>
              <MenuIcon aria-hidden="true" size={20} strokeWidth={1.5} />
              Menu
            </button>
          )}
        </nav>
      </div>
      {!phone && <MegaMenu open={megaOpen} close={() => setMegaOpen(false)} />}
      {phone && (
        <Dialog title="Menu" open={menuOpen} onClose={() => setMenuOpen(false)} variant="menu">
          <ul className="menu-dialog__families">
            {FAMILIES.map((item) => (
              <li key={item.family}>
                <Link href={`/catalogue?family=${item.family}`} onClick={() => setMenuOpen(false)}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="menu-dialog__account">
            <AccountLinks onNavigate={() => setMenuOpen(false)} />
          </div>
        </Dialog>
      )}
    </header>
  );
}
