import { useEffect, useRef, useState, type ReactElement } from 'react';
import { X } from 'lucide-react';
import { flavourName } from '../../../shared/catalogue.js';
import { crateCopy } from '../../../shared/copy.js';
import { formatDollars } from '../../../shared/money.js';
import { Link, useRouter } from '../router.js';
import { cansOf, useShop } from '../state/shop.js';
import { useReducedMotion } from '../state/useReducedMotion.js';
import { useViewport } from '../state/useViewport.js';
import { HoldTimer } from './HoldTimer.js';
import { TotalsPanel } from './TotalsPanel.js';

const CLOSE_MS = 200;

export function CartDrawer(): ReactElement {
  const { cartOpen, closeCart, cart, quote, holdExpired, user } = useShop();
  const reduced = useReducedMotion();
  const viewport = useViewport();
  const { path } = useRouter();
  const [visible, setVisible] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (cartOpen) {
      opener.current = document.activeElement;
      setVisible(true);
      return;
    }
    if (!visible) return;
    // Pressing the cart button during the closing animation keeps it open.
    const timer = window.setTimeout(() => setVisible(false), reduced ? 0 : CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [cartOpen, reduced, visible]);

  useEffect(() => {
    if (!cartOpen || !visible) return;
    heading.current?.focus();
  }, [cartOpen, visible]);

  // Leaving the page closes the drawer; a countdown tick never does.
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    closeCart();
  }, [closeCart, path]);

  useEffect(() => {
    if (!cartOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCart();
        (opener.current as HTMLElement | null)?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = panel.current;
      if (container === null) return;
      const focusable = [
        ...container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null || element === heading.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
        event.preventDefault();
        last.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cartOpen, closeCart]);

  const lines = cansOf(cart);

  return (
    <div className="drawer-root" hidden={!visible}>
      <div
        className="drawer__scrim"
        data-open={cartOpen}
        onClick={() => {
          closeCart();
          (opener.current as HTMLElement | null)?.focus();
        }}
      />
      <div
        className="drawer"
        data-open={cartOpen}
        data-reduced={reduced}
        role="dialog"
        aria-modal="true"
        aria-label="Cart"
        ref={panel}
      >
        <div className="drawer__head">
          <h2 tabIndex={-1} ref={heading}>
            Your cart
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close cart"
            onClick={() => {
              closeCart();
              (opener.current as HTMLElement | null)?.focus();
            }}
          >
            <X aria-hidden="true" size={20} />
            <span className="visually-hidden">Close</span>
          </button>
        </div>

        <HoldTimer />

        {holdExpired ? <p className="notice notice--warn">{crateCopy.holdExpired}</p> : null}

        {lines.length === 0 ? (
          <p className="drawer__empty">Your crate is empty. Add 12 cans to check out.</p>
        ) : (
          <ul className="drawer__lines">
            {lines.map((line) => (
              <li key={line.flavour}>
                <span>{flavourName(line.flavour)}</span>
                <span className="mono">x{line.quantity}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="drawer__total mono">
          <span>Total</span>
          <span>{formatDollars(quote?.total_cents ?? 0)}</span>
        </p>

        {viewport === 'phone' ? (
          <div className="drawer__totals-slot">
            <TotalsPanel />
          </div>
        ) : null}

        {holdExpired ? (
          <Link to="/box" className="button button--primary drawer__checkout">
            Back to your crate
          </Link>
        ) : (
          <Link
            to={user === null ? '/sign-in?next=/checkout' : '/checkout'}
            className="button button--primary drawer__checkout"
          >
            Checkout
          </Link>
        )}
      </div>
    </div>
  );
}
