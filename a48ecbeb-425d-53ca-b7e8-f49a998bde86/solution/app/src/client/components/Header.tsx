import { Menu, ShoppingBasket, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "../lib/router";
import { PHONE, useMedia } from "../lib/media";
import { useDrawer } from "../state/drawer";
import { useShop } from "../state/shop";

const NAV = [
  { href: "/box", label: "Shop" },
  { href: "/flavours/guava-lime", label: "Flavours" },
  { href: "/box#subscribe", label: "Subscribe" },
  { href: "/stockists", label: "Stockists" },
  { href: "/account", label: "Account" },
];

export function Wordmark() {
  return (
    <svg className="wordmark-art" viewBox="0 0 132 36" aria-hidden="true" focusable="false">
      <path d="M14 3c7 6 10 13 10 20a10 10 0 0 1-20 0c0-7 3-14 10-20z" fill="#8cc47a" />
      <path d="M14 9v24" stroke="#0f1d14" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="27" r="5" fill="#ec5a6e" />
      <text x="36" y="27" fontFamily="Fraunces, Georgia, serif" fontWeight="700" fontSize="24" fill="currentColor" letterSpacing="1">
        CEIBO
      </text>
    </svg>
  );
}

export function CartButton({ className = "" }: { className?: string }) {
  const { cart } = useShop();
  const drawer = useDrawer();
  const count = cart?.count ?? 0;
  return (
    <button
      type="button"
      className={`btn cart-button ${className}`}
      aria-label={`Cart (${count})`}
      onClick={(event) => drawer.show(event.currentTarget)}
    >
      <ShoppingBasket size={20} aria-hidden="true" />
      <span>Cart</span> <span className="cart-count num">({count})</span>
    </button>
  );
}

export function Header() {
  const phone = useMedia(PHONE);
  const { path } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => setMenuOpen(false), [path, phone]);
  useEffect(() => {
    if (menuOpen) firstLink.current?.focus();
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    menuButton.current?.focus();
  };
  const onMenuKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && menuOpen) {
      event.preventDefault();
      closeMenu();
    }
  };
  const links = NAV.map((item, i) => (
    <li key={item.href}>
      <Link
        href={item.href}
        ref={i === 0 ? firstLink : undefined}
        aria-current={path === item.href.split("#")[0] && !item.href.includes("#") ? "page" : undefined}
      >
        {item.label}
      </Link>
    </li>
  ));

  return (
    <header className="site-header" onKeyDown={onMenuKey}>
      <div className="site-header-inner">
        <Link href="/" className="wordmark" aria-label="Ceibo home">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="main-nav">
          {phone ? (
            <>
              <button
                type="button"
                ref={menuButton}
                className="btn btn-quiet menu-button"
                aria-expanded={menuOpen}
                aria-controls="main-menu"
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
              >
                {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
                Menu
              </button>
              {menuOpen && (
                <ul id="main-menu" className="menu-panel">
                  {links}
                </ul>
              )}
            </>
          ) : (
            <ul className="nav-links">{links}</ul>
          )}
        </nav>
        <CartButton />
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Wordmark />
        <p>Organic sparkling yerba mate from a small Canadian brand. Cans carry a deposit where your province charges one.</p>
        <p className="muted-on-dark">Prices in Canadian dollars. Shipping to Alberta, British Columbia, Nova Scotia, Ontario and Quebec.</p>
      </div>
    </footer>
  );
}
