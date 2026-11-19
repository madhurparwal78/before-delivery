import { useEffect, useRef, useState } from 'react';
import { useBreakpoint } from '../lib/hooks.js';
import { Link, signInTo, useRouter } from '../lib/router.js';
import { useSession } from '../lib/session.js';
import { Icon } from './Icon.js';

/**
 * The studio header: transparent over the hero, a dark translucent glass bar
 * after scrolling, and one menu button below 768 px.
 */
export function StudioHeader(): JSX.Element {
  const { isCreator, isCollector, isFounder, user, signOut } = useSession();
  const { path } = useRouter();
  const breakpoint = useBreakpoint();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const accountButtonRef = useRef<HTMLButtonElement | null>(null);

  // The glass fill appears after scrolling past the hero.
  useEffect(() => {
    const onScroll = (): void => {
      const hero = document.querySelector('[data-hero]');
      const threshold = hero ? hero.getBoundingClientRect().height * 0.6 : 80;
      setScrolled(window.scrollY > Math.max(48, threshold));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [path]);

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [path]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setAccountOpen(false);
      accountButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [accountOpen]);

  const isPhone = breakpoint === 'phone';

  const navigation = (
    <nav aria-label="Main" className="studio-header__nav">
      <Link to="/gallery">Gallery</Link>
      {isCreator && <Link to="/studio">Studio</Link>}
      {isCollector && <Link to="/library">Library</Link>}
      {isFounder && <Link to="/console">Console</Link>}
    </nav>
  );

  const account = user ? (
    <div className="studio-header__account">
      <button
        type="button"
        ref={accountButtonRef}
        aria-expanded={accountOpen}
        aria-haspopup="menu"
        onClick={() => setAccountOpen((open) => !open)}
      >
        Account
      </button>
      {accountOpen && (
        <div role="menu" className="studio-header__menu">
          <button type="button" role="menuitem" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  ) : (
    <button
      type="button"
      className="studio-header__signin"
      onClick={() => signInTo(`${window.location.pathname}${window.location.search}`)}
    >
      Sign in
    </button>
  );

  return (
    <header className={`studio-header${scrolled ? ' studio-header--glass' : ''}`}>
      <div className="studio-header__bar shell">
        <Link to="/" className="studio-header__wordmark display">
          Phosphene Yard
        </Link>

        {isPhone ? (
          <div className="studio-header__phone">
            <button
              type="button"
              ref={menuButtonRef}
              className="studio-header__menu-button"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              Menu
            </button>
          </div>
        ) : (
          <div className="studio-header__links">
            {navigation}
            {account}
            <Link to="/studio" className="next-action">
              Start a piece
              <Icon name="arrow-right" className="next-action__arrow" />
            </Link>
          </div>
        )}
      </div>

      {isPhone && menuOpen && (
        <div className="studio-header__panel shell">
          {navigation}
          {account}
          <Link to="/studio" className="next-action">
            Start a piece
            <Icon name="arrow-right" className="next-action__arrow" />
          </Link>
        </div>
      )}
    </header>
  );
}
