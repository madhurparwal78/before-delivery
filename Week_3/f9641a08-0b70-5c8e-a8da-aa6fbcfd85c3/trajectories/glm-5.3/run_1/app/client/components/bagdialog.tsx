import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '../lib/router.js';
import { store } from '../lib/store.js';
import { Dialog } from './dialog.js';
import { BagLines } from './baglines.js';

/** The bag drawer: slides from the right on tablet and desktop, the bottom on phone. */
export function BagDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState<'bag' | 'menu' | null>(null);

  useEffect(() => {
    const onOpen = (e: Event): void => {
      const detail = (e as CustomEvent).detail as 'bag' | 'menu';
      setWhich(detail);
      setOpen(true);
    };
    window.addEventListener('rh:open-dialog', onOpen);
    return () => window.removeEventListener('rh:open-dialog', onOpen);
  }, []);

  return open && which === 'bag' ? (
    <Dialog label="Your bag" open={open} onClose={() => { setOpen(false); setWhich(null); }} className="bag-drawer">
      <div class="dialog-head">
        <h2>Your bag</h2>
        <button class="icon-button" aria-label="Close" onClick={() => { setOpen(false); setWhich(null); }}>Close</button>
      </div>
      <BagLines inDrawer />
      <p class="drawer-actions">
        <a href="/bag" onClick={(e) => { e.preventDefault(); setOpen(false); navigate('/bag'); }}>View bag page</a>
        <button class="primary" onClick={() => { setOpen(false); navigate(store.user === null ? '/sign-in?next=/checkout' : '/bag'); }}>
          Check out
        </button>
      </p>
    </Dialog>
  ) : open && which === 'menu' ? (
    <Dialog label="Menu" open={open} onClose={() => { setOpen(false); setWhich(null); }} className="menu-drawer">
      <nav aria-label="Menu">
        <a href="/collections/all" onClick={(e) => { e.preventDefault(); setOpen(false); navigate('/collections/all'); }}>Collections</a>
        <a href="/compare" onClick={(e) => { e.preventDefault(); setOpen(false); navigate('/compare'); }}>Compare</a>
        <a href="/care" onClick={(e) => { e.preventDefault(); setOpen(false); navigate('/care'); }}>Care</a>
        <a href="/wishlist" onClick={(e) => { e.preventDefault(); setOpen(false); navigate('/wishlist'); }}>Wishlist</a>
        <a href="/account" onClick={(e) => { e.preventDefault(); setOpen(false); navigate(store.user === null ? '/sign-in' : '/account'); }}>Account</a>
        <button class="icon-button" aria-label="Close menu" onClick={() => { setOpen(false); setWhich(null); }}>Close</button>
      </nav>
    </Dialog>
  ) : <></>;
}

/** The bag lines and totals, shared by the drawer and the /bag page. */
export function BagBody(): JSX.Element {
  const cart = store.cart;
  if (cart === null || cart.lines.length === 0) {
    return (
      <section class="panel empty-panel">
        <p>Your bag is empty.</p>
        <a href="/collections/all" onClick={(e) => { e.preventDefault(); navigate('/collections/all'); }}>Browse collections</a>
      </section>
    );
  }
  return <BagLines />;
}
