import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "../lib/router";
import { PHONE, prefersReduced, useMedia } from "../lib/media";
import { money } from "../../shared/format";
import { useDrawer } from "../state/drawer";
import { cansOf, flavourName, HOLD_ENDED, useShop } from "../state/shop";
import { HoldTimer } from "./HoldTimer";
import { Totals } from "../crate/Totals";
import { trapKeys } from "./trap";

interface Slide {
  /** Stops the slide where it is and returns its current offset (percent). */
  stop: () => number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;

/** How far (px) the drawer travels as it slides; short, so it is usable from its first frame. */
const TRAVEL = 56;

/** Slides the drawer in from the right on animation frames (so the page clock drives it). */
function slide(el: HTMLElement, from: number, to: number, duration: number, ease: (t: number) => number, done?: () => void): Slide {
  const start = performance.now();
  let offset = from;
  let frame = 0;
  const paint = () => {
    el.style.transform = offset === 0 ? "" : `translateX(${(offset / 100) * TRAVEL}px)`;
    el.style.opacity = offset === 0 ? "" : String(1 - (offset / 100) * 0.6);
  };
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / duration);
    offset = from + (to - from) * ease(t);
    paint();
    if (t < 1) frame = requestAnimationFrame(step);
    else done?.();
  };
  paint();
  frame = requestAnimationFrame(step);
  return {
    stop: () => {
      cancelAnimationFrame(frame);
      return offset;
    },
  };
}

/** The cart drawer: mounted only while open (or sliding shut), so a closed drawer is absent. */
export function CartDrawer() {
  const drawer = useDrawer();
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const motion = useRef<Slide | null>(null);
  const { path } = useLocation();
  const shownOn = useRef(path);

  useLayoutEffect(() => {
    if (drawer.open) setMounted(true);
  }, [drawer.open]);

  useEffect(() => {
    const el = panel.current;
    if (!mounted || !el) return;
    const reduced = prefersReduced();
    const from = motion.current?.stop() ?? (drawer.open ? 100 : 0);
    if (drawer.open) {
      heading.current?.focus();
      if (reduced) {
        el.style.transform = "";
        el.style.opacity = "";
      }
      else motion.current = slide(el, from, 0, 250, easeOut);
      return;
    }
    const finish = () => {
      motion.current = null;
      setMounted(false);
      drawer.opener.current?.focus();
    };
    if (reduced) finish();
    else motion.current = slide(el, from, 100, 200, easeIn, finish);
  }, [drawer.open, drawer.opener, mounted]);

  // Following a link out of the drawer closes it at once: the next page must be usable now.
  // (Declared after the slide effect so it also cancels a slide-out that effect just began.)
  useEffect(() => {
    if (shownOn.current === path) return;
    shownOn.current = path;
    motion.current?.stop();
    motion.current = null;
    drawer.hide();
    setMounted(false);
  }, [path, drawer]);

  // The page behind is inert only while the drawer is open, so the cart button works again
  // as soon as the drawer starts to close.
  useEffect(() => {
    const page = document.getElementById("page");
    if (!page) return;
    page.inert = drawer.open;
    document.body.classList.toggle("drawer-open", drawer.open);
  }, [drawer.open]);

  if (!mounted) return null;
  return (
    <div className="drawer-layer" data-closing={drawer.open ? undefined : "true"}>
      <div className="drawer-scrim" onClick={drawer.hide} aria-hidden="true" />
      <div
        ref={panel}
        className="drawer panel-paper"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        onKeyDown={(event) => trapKeys(event, drawer.hide)}
      >
        <DrawerBody heading={heading} />
      </div>
    </div>
  );
}

function DrawerBody({ heading }: { heading: React.RefObject<HTMLHeadingElement | null> }) {
  const { cart, flavours, quote } = useShop();
  const drawer = useDrawer();
  const phone = useMedia(PHONE);
  const groups = cart ? cansOf(cart) : [];
  const count = cart?.count ?? 0;
  const expired = cart?.hold.status === "expired";
  return (
    <>
      <div className="drawer-head">
        <h2 id="cart-title" ref={heading} tabIndex={-1} data-dialog-heading>
          Your cart
        </h2>
        <button type="button" className="btn btn-quiet icon-btn" aria-label="Close cart" onClick={drawer.hide}>
          <X size={22} aria-hidden="true" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <HoldTimer />
      {expired && <p className="banner drawer-note">{HOLD_ENDED}</p>}
      {groups.length === 0 ? (
        <div className="empty">
          <EmptyCrate />
          <p>Your crate is empty. Add cans from any flavour card.</p>
        </div>
      ) : (
        <ul className="drawer-lines">
          {groups.map((g) => (
            <li key={g.flavour} className={`flavour-${g.flavour}`}>
              <span className="swatch" aria-hidden="true" />
              <span className="drawer-line-name">{flavourName(flavours, g.flavour)}</span>
              <span className="num">× {g.quantity}</span>
            </li>
          ))}
        </ul>
      )}
      {phone && <Totals />}
      <div className="drawer-foot">
        <p className="drawer-total">
          <span>Total</span>
          <span className="num">{quote ? money(quote.total_cents) : "—"}</span>
        </p>
        {count === 12 ? (
          <Link href="/checkout" className="btn btn-primary drawer-checkout" onClick={drawer.hide}>
            Checkout
          </Link>
        ) : (
          <p className="muted">
            {count === 0 ? "Fill all 12 slots to check out." : `Add ${12 - count} more ${12 - count === 1 ? "can" : "cans"} to check out.`}
          </p>
        )}
      </div>
    </>
  );
}

function EmptyCrate() {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true" focusable="false">
      <rect x="8" y="22" width="104" height="50" rx="8" fill="none" stroke="#5a5040" strokeWidth="3" />
      <path d="M8 40h104M43 22v50M78 22v50" stroke="#5a5040" strokeWidth="2" opacity=".5" />
      <path d="M60 4c8 6 11 12 11 18a11 11 0 0 1-22 0c0-6 3-12 11-18z" fill="#8cc47a" />
      <circle cx="74" cy="20" r="5" fill="#ec5a6e" />
    </svg>
  );
}
