import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Empty } from "../components/Empty";
import { NotFound } from "../components/NotFound";
import { ShareDialog } from "../components/ShareDialog";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { takeMergeResults, useCart } from "../lib/cart";
import { useTitle } from "../lib/hooks";
import type { Quote } from "../lib/types";
import { useCartAnnouncement } from "./cart/announce";
import { groupLines, neighbourOf } from "./cart/groups";
import { GuestCart } from "./cart/GuestCart";
import { quantityId } from "./cart/LineCard";
import { CartMerge } from "./cart/Merge";
import { ParcelPanel } from "./cart/ParcelPanel";
import { SavedForLater } from "./cart/Saved";
import { Bill, CartStrip, CodBar, Coupon, ShareButton } from "./cart/Summary";
import "../styles/cart.css";

/** Whether a pincode is served at all, looked up only while some parcel cannot be delivered. */
function usePincodeServed(quote: Quote): boolean | null {
  const pincode = quote.destination.pincode;
  const blocked = quote.parcels.some((parcel) => parcel.serviceable === false);
  const [served, setServed] = useState<{ pincode: string; served: boolean } | null>(null);

  useEffect(() => {
    if (!blocked || !pincode) return;
    void get<{ serviceable: boolean }>(`/api/pincodes/${pincode}`).then(
      (found) => setServed({ pincode, served: found.serviceable }),
      () => undefined,
    );
  }, [blocked, pincode]);

  return served && served.pincode === pincode ? served.served : null;
}

/** After a line leaves the cart, focus goes to the next line's quantity control once the new quote is painted. */
function useFocusNeighbour(quote: Quote): { leave: (lineId: string) => void; cancel: () => void } {
  const target = useRef<string | null>(null);
  const waiting = useRef(false);
  const groups = useMemo(() => groupLines(quote), [quote]);
  const latest = useRef(groups);
  latest.current = groups;

  useEffect(() => {
    if (!waiting.current) return;
    waiting.current = false;
    const next = target.current;
    target.current = null;
    const control = next ? document.getElementById(quantityId(next)) : document.querySelector<HTMLElement>("#main h1");
    if (control instanceof HTMLElement) {
      if (!next) control.tabIndex = -1;
      control.focus();
    }
  }, [quote]);

  const leave = useCallback((lineId: string): void => {
    target.current = neighbourOf(latest.current, lineId);
    waiting.current = true;
  }, []);
  const cancel = useCallback((): void => {
    waiting.current = false;
    target.current = null;
  }, []);
  return { leave, cancel };
}

function Skeleton(): ReactNode {
  return (
    <section className="panel panel--ground" aria-busy="true">
      <h1>your cart.</h1>
      <div className="skeleton" style={{ minHeight: 280 }} />
    </section>
  );
}

function SignedInCart({ quote }: { quote: Quote }): ReactNode {
  const announcement = useCartAnnouncement(quote);
  const [sharing, setSharing] = useState(false);
  const [merged] = useState(takeMergeResults);
  const groups = useMemo(() => groupLines(quote), [quote]);
  const served = usePincodeServed(quote);
  const focus = useFocusNeighbour(quote);
  const canCheckout = quote.lines.some((line) => line.selected);

  return (
    <div className="cart-page">
      {merged && merged.length > 0 && <CartMerge results={merged} />}
      {quote.lines.length === 0 ? (
        <Empty tone="pink" sign="basket" as="h1" actions={<Link className="btn" to="/">back to the bazaar</Link>}>
          your cart is empty. the bazaar isn't.
        </Empty>
      ) : (
        <section className="panel panel--ground cart-head">
          <h1>your cart.</h1>
        </section>
      )}
      <div className="cart-grid">
        <div className="cart-main">
          {groups.map((group, index) => (
            <ParcelPanel
              key={group.sellerId}
              group={group}
              index={index}
              serverTime={quote.server_time}
              pincode={quote.destination.pincode}
              pincodeServed={served}
              onLeave={focus.leave}
              onLeaveFailed={focus.cancel}
            />
          ))}
          {quote.saved_for_later.length > 0 && <SavedForLater lines={quote.saved_for_later} />}
        </div>
        <aside className="cart-aside panel panel--ground">
          <p className="status cart-status" role="status" aria-label="Cart updates">
            {announcement}
          </p>
          <Coupon quote={quote} />
          <Bill quote={quote} />
          <CodBar quote={quote} />
          <ShareButton onOpen={() => setSharing(true)} />
          <CartStrip quote={quote} checkoutHref="/checkout/address" canCheckout={canCheckout} />
        </aside>
      </div>
      {sharing && <ShareDialog kind="cart" onClose={() => setSharing(false)} />}
    </div>
  );
}

export default function Cart(): ReactNode {
  useTitle("your cart");
  const auth = useAuth();
  const { quote, reload } = useCart();
  const shopper = auth.status === "signedIn" && auth.account?.role === "shopper";

  useEffect(() => {
    if (shopper) void reload();
  }, [shopper, reload]);

  if (auth.status === "loading") return <Skeleton />;
  if (auth.account && auth.account.role !== "shopper") return <NotFound />;
  if (auth.status === "signedOut") return <GuestCart />;
  if (!quote) return <Skeleton />;
  return <SignedInCart quote={quote} />;
}
