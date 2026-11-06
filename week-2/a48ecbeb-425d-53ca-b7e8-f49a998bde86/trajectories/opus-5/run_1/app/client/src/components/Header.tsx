import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Menu, ShoppingBasket, X } from 'lucide-react';
import { Link, useRouter } from '../router.js';
import { useShop } from '../state/shop.js';

const NAV_LINKS = [
  { label: 'Shop', to: '/box' },
  { label: 'Flavours', to: '/flavours/guava-lime' },
  { label: 'Subscribe', to: '/account' },
  { label: 'Stockists', to: '/stockists' },
  { label: 'Account', to: '/account' },
] as const;

export function Header(): ReactElement {
  const { cart, openCart } = useShop();
  const { path } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const firstLink = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => setMenuOpen(false), [path]);

  useEffect(() => {
    if (!menuOpen) return;
    firstLink.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const count = cart?.count ?? 0;

  return (
    <header className="site-header">
      <div className="site-header__bar">
        <Link to="/" className="wordmark" aria-label="Ceibo home">
          <span aria-hidden="true" className="wordmark__mark" />
          Ceibo
        </Link>

        <nav aria-label="Main" className="site-nav">
          <ul>
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <Link to={link.to}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-header__actions">
          <button
            type="button"
            className="menu-button"
            ref={menuButton}
            aria-expanded={menuOpen}
            aria-label="Menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
            <span>Menu</span>
          </button>

          <button
            type="button"
            className="cart-button"
            aria-label={`Cart (${count})`}
            onClick={openCart}
          >
            <ShoppingBasket aria-hidden="true" size={20} />
            <span>Cart</span>
            <span className="mono cart-button__count">{count}</span>
          </button>
        </div>
      </div>

      <div className="mobile-menu" hidden={!menuOpen}>
        <ul>
          {NAV_LINKS.map((link, index) => (
            <li key={link.label}>
              <Link to={link.to} ref={index === 0 ? firstLink : undefined}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
