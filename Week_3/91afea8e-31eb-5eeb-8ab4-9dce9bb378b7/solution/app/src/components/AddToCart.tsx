import { ArrowRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { failureMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import type { ListingSnapshot } from "../lib/types";
import { useMagnet } from "../effects/cursor";
import { CartMorphIcon } from "../effects/morph";
import { Button } from "./Button";

interface ActionProps {
  /** The featured offer for the current pincode, as the cart stores it. */
  listing: ListingSnapshot | null;
  disabled?: boolean;
}

/** `Add to cart`: the icon morphs into a check mark and back; the button is enabled again as soon as the reply is in. */
export function AddToCart({ listing, disabled }: ActionProps): ReactNode {
  const cart = useCart();
  const waiting = useAuth().status === "loading";
  const host = useRef<HTMLSpanElement>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(0);
  const [message, setMessage] = useState("");
  useMagnet(host);

  const add = async (): Promise<void> => {
    if (!listing) return;
    setBusy(true);
    setMessage("");
    try {
      await cart.add(listing);
      setRun((count) => count + 1);
    } catch (error) {
      setMessage(failureMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span ref={host} className="magnet">
        <Button variant="primary" busy={busy} disabled={disabled || !listing || waiting} onClick={() => void add()}>
          <CartMorphIcon run={run} />
          Add to cart
        </Button>
      </span>
      {message !== "" && (
        <p className="status status--wide" role="status">
          {message}
        </p>
      )}
    </>
  );
}

/** `Buy now`: adds the offer and goes straight to the address step. */
export function BuyNow({ listing, disabled }: ActionProps): ReactNode {
  const cart = useCart();
  const waiting = useAuth().status === "loading";
  const navigate = useNavigate();
  const host = useRef<HTMLSpanElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useMagnet(host);

  const buy = async (): Promise<void> => {
    if (!listing) return;
    setBusy(true);
    setMessage("");
    try {
      await cart.add(listing);
      navigate("/checkout/address");
    } catch (error) {
      setMessage(failureMessage(error));
      setBusy(false);
    }
  };

  return (
    <>
      <span ref={host} className="magnet">
        <Button variant="dark" busy={busy} disabled={disabled || !listing || waiting} onClick={() => void buy()}>
          Buy now
          <ArrowRight size={20} aria-hidden="true" />
        </Button>
      </span>
      {message !== "" && (
        <p className="status status--wide" role="status">
          {message}
        </p>
      )}
    </>
  );
}
