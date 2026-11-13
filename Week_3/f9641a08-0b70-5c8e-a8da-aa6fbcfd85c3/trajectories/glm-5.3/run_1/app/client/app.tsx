import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { store, useStore } from './lib/store.js';
import { usePath, navigate, matchRoute } from './lib/router.js';
import { Home } from './pages/home.js';
import { Collection } from './pages/collection.js';
import { Product } from './pages/product.js';
import { Compare } from './pages/compare.js';
import { Wishlist, Bag } from './pages/wishlist.js';
import { Care, SignIn, Register } from './pages/care.js';
import { Checkout } from './pages/checkout.js';
import { Order } from './pages/order.js';
import { Account } from './pages/account.js';
import { Admin } from './pages/admin.js';
import { BagDialog } from './components/bagdialog.js';
import { Toast } from './components/toast.js';
import { api } from './lib/api.js';

export function App(): JSX.Element {
  useStore();
  const path = usePath();
  useEffect(() => {
    document.documentElement.dataset.motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
  }, []);

  const page = renderPage(path);
  return (
    <div id="app">
      <a class="skip-link" href="#main">Skip to content</a>
      <Header />
      <Toast />
      <main id="main">{page}</main>
      <Footer />
      <BagDialog />
      <LiveRegions />
    </div>
  );
}

function renderPage(path: string): JSX.Element {
  const url = new URL(path, location.origin);
  const pathname = url.pathname;
  if (pathname === '/' || pathname === '') return <Home />;
  if (pathname === '/compare') return <Compare />;
  if (pathname === '/wishlist') return <Wishlist />;
  if (pathname === '/care') return <Care />;
  if (pathname === '/sign-in') return <SignIn />;
  if (pathname === '/register') return <Register />;
  if (pathname === '/bag') return <Bag />;
  if (pathname === '/account') return <Account />;
  if (matchRoute('/collections/:slug', pathname) !== null) {
    return <Collection slug={matchRoute('/collections/:slug', pathname)![0]} />;
  }
  const productMatch = matchRoute('/products/:slug', pathname);
  if (productMatch !== null) return <Product slug={productMatch[0]} />;
  const checkoutMatch = matchRoute('/checkout/:id', pathname);
  if (checkoutMatch !== null) return <Checkout id={Number(checkoutMatch[0])} />;
  const orderMatch = matchRoute('/orders/:number', pathname);
  if (orderMatch !== null) return <Order number={orderMatch[0]} />;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return <Admin path={pathname} search={url.search} />;
  return <NotFound />;
}

export function NotFound(): JSX.Element {
  return (
    <section class="panel error-panel">
      <h1>We couldn't find that page.</h1>
    </section>
  );
}

export function LoadingPanel(): JSX.Element {
  return (
    <section class="panel loading-panel" aria-busy="true">
      <p>Loading</p>
    </section>
  );
}

export function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <section class="panel error-panel">
      <p>{message}</p>
    </section>
  );
}

// --- header -----------------------------------------------------------------

function Header(): JSX.Element {
  const user = store.user;
  const cartCount = store.cart?.count ?? 0;
  const wishCount = store.wishlist.count;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select') !== null) return;
      if (e.key === '/') {
        const box = document.querySelector<HTMLInputElement>('input[role="combobox"][aria-label="Search products"]');
        if (box !== null) {
          e.preventDefault();
          box.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header class="site-header">
      <a class="wordmark" href="/" aria-label="Roam House home" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Roam House</a>
      <nav class="teal-tab" aria-label="Main">
        <a href="/collections/all" onClick={(e) => { e.preventDefault(); navigate('/collections/all'); }}>Collections</a>
        <a href="/compare" onClick={(e) => { e.preventDefault(); navigate('/compare'); }}>Compare</a>
        <a href="/care" onClick={(e) => { e.preventDefault(); navigate('/care'); }}>Care</a>
      </nav>
      <button class="menu-button" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new CustomEvent('rh:open-dialog', { detail: 'menu' }))}>Menu</button>
      <div class="header-search"><SearchBox /></div>
      <div class="header-links">
        <a href="/wishlist" onClick={(e) => { e.preventDefault(); navigate('/wishlist'); }} aria-label={`Wishlist, ${wishCount} ${wishCount === 1 ? 'item' : 'items'}`}>Wishlist{wishCount > 0 ? ` (${wishCount})` : ''}</a>
        {user === null
          ? <a href="/sign-in" onClick={(e) => { e.preventDefault(); navigate('/sign-in'); }}>Sign in</a>
          : <a href="/account" onClick={(e) => { e.preventDefault(); navigate('/account'); }}>Account</a>}
        <button class="bag-button" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new CustomEvent('rh:open-dialog', { detail: 'bag' }))} aria-label={`Bag, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}>Bag{cartCount > 0 ? ` (${cartCount})` : ''}</button>
      </div>
    </header>
  );
}

// --- search -------------------------------------------------------------------

type Suggestion = { name: string; slug: string };

export function SearchBox(): JSX.Element {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (text === '') { setSuggestions([]); setOpen(false); return; }
    // Every keystroke asks the server; only the reply to the latest text shows.
    const current = text;
    typed.current = text;
    const controller = new AbortController();
    void fetch(`/api/search/suggest?q=${encodeURIComponent(current)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d: { mode: string; suggestions: Suggestion[] }) => {
        if (typed.current !== current) return;
        setSuggestions(d.suggestions);
        setOpen(true);
        setActive(-1);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [text]);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && suggestions[active] !== undefined) {
        navigate(`/products/${suggestions[active].slug}`);
      } else {
        navigate(`/collections/all?q=${encodeURIComponent(text)}`);
      }
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setText(typed.current);
      inputRef.current?.blur();
    }
  };

  return (
    <div class="search-box">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        aria-label="Search products"
        placeholder="Search products"
        value={text}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={onKeyDown}
      />
      {open && suggestions.length > 0 ? (
        <ul role="listbox" id="search-suggestions" class="suggestions">
          {suggestions.map((s, i) => (
            <li key={s.slug} role="option" aria-selected={i === active} class={i === active ? 'active' : ''}>
              <a href={`/products/${s.slug}`} onClick={(e) => { e.preventDefault(); setOpen(false); navigate(`/products/${s.slug}`); }}>{s.name}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// --- footer -------------------------------------------------------------------

function Footer(): JSX.Element {
  return (
    <footer class="site-footer">
      <p class="muted">Roam House — cases, packs and small goods.</p>
    </footer>
  );
}

// --- live regions ----------------------------------------------------------------

function LiveRegions(): JSX.Element {
  const connected = store.connected;
  return (
    <>
      <div role="status" aria-live="polite" class="visually-hidden" id="cart-updates"></div>
      <div role="status" aria-live="polite" class="visually-hidden" id="product-updates"></div>
      <div role="status" aria-live="polite" class="visually-hidden" id="compare-updates"></div>
      <div role="status" aria-live="polite" class="visually-hidden" id="checkout-updates"></div>
      <div role="status" aria-live="polite" class="visually-hidden" id="staff-updates"></div>
      <div role="status" aria-live="polite" class="visually-hidden" id="result-count"></div>
      <div role="status" aria-live="polite" class="visually-hidden" id="fit-verdict"></div>
      <div role="status" aria-live="polite" class="visually-hidden" id="search-notice"></div>
      <div role="status" aria-live="polite" class="visually-hidden" id="upload-progress"></div>
      <div role="status" aria-live="polite" class="connection" id="connection">{connected ? '' : 'Reconnecting to live updates.'}</div>
      <div role="status" aria-live="polite" class="visually-hidden" id="selected-variant"></div>
    </>
  );
}

/** Announces copy in the named live region. */
export function announce(region: string, text: string): void {
  const el = document.getElementById(region);
  if (el !== null) {
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = text; });
  }
}

export async function signOut(): Promise<void> {
  await api.delete('/api/session');
  store.user = null;
  store.emit();
  location.assign('/');
}
