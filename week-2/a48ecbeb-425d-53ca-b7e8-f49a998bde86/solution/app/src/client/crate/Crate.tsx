import { X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { PHONE, useMedia } from "../lib/media";
import { CartButton } from "../components/Header";
import { useCrateDrop } from "../state/crate";
import { flavourName, shippingPhrase, useShop } from "../state/shop";
import { Totals } from "./Totals";

/** Two digits that roll like an odometer; screen readers get the plain `NN/12` text. */
function Counter({ count }: { count: number }) {
  const digits = String(count).padStart(2, "0");
  return (
    <div className="counter num" role="group" aria-label="Cans in crate">
      <span className="sr-only">{`${digits}/12`}</span>
      <span className="counter-digits num" aria-hidden="true">
        {[...digits].map((d, i) => (
          <span className="digit" key={i}>
            <span className="digit-strip" style={{ transform: `translateY(-${Number(d) * 10}%)` }}>
              {"0123456789".split("").map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        ))}
        <span className="counter-of">/12</span>
      </span>
    </div>
  );
}

function Meter() {
  const { quote } = useShop();
  const percent = quote?.free_shipping.progress_percent ?? 0;
  const phrase = quote ? shippingPhrase(quote) : "";
  return (
    <div className="meter-wrap">
      <div
        className="meter"
        role="meter"
        aria-label="Free shipping"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={phrase}
      >
        <span className="meter-fill" style={{ transform: `scaleX(${percent / 100})` }} />
        <span className="meter-tip" style={{ left: `${percent}%` }} />
      </div>
      <p className="meter-phrase" aria-hidden="true">
        {phrase || " "}
      </p>
    </div>
  );
}

function Slots() {
  const { cart, flavours } = useShop();
  const { overlays, remove, registerSlot } = useCrateDrop();
  const onKey = (slot: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(slot);
    }
  };
  return (
    <ul className="slots" aria-label="Crate slots">
      {Array.from({ length: 12 }, (_, i) => {
        const overlay = overlays.get(i);
        const held = cart?.slots[i]?.flavour;
        const state = overlay ? (overlay.phase === "pending" ? "pending" : "empty") : held ? "filled" : "empty";
        const flavour = state === "pending" ? overlay?.flavour : held;
        const name = flavour ? flavourName(flavours, flavour) : "";
        const label = state === "filled" ? `Slot ${i + 1}: ${name}` : state === "pending" ? `Slot ${i + 1}: ${name}, pending` : `Slot ${i + 1}: empty`;
        return (
          <li
            key={i}
            ref={(el) => registerSlot(i, el)}
            aria-label={label}
            className={`slot slot-${state} ${state !== "empty" && flavour ? `flavour-${flavour}` : ""}`}
          >
            {state === "filled" && flavour ? (
              <button type="button" className="slot-button" aria-label={`Remove ${name} from slot ${i + 1}`} onClick={() => remove(i)} onKeyDown={onKey(i)}>
                <span className="slot-can" aria-hidden="true" />
                <X className="slot-x" size={14} aria-hidden="true" />
              </button>
            ) : (
              <span className="slot-can" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The crate: a rail on desktop, a side panel on tablets and a bottom sheet on phones. */
export function Crate() {
  const { cart, crateMessage, cartOutage } = useShop();
  const phone = useMedia(PHONE);
  return (
    <section className="crate" aria-label="Crate">
      <div className="crate-head">
        <h2 className="crate-title">Your crate</h2>
        <Counter count={cart?.count ?? 0} />
      </div>
      <Slots />
      <Meter />
      <p className={`status-line crate-status ${phone ? "sr-only" : ""}`} role="status" aria-label="Crate updates">
        {crateMessage}
      </p>
      {cartOutage && !crateMessage && <p className="banner crate-outage">The shop can't update your crate right now. Try again in a moment.</p>}
      {!phone && <Totals />}
      {!phone && <CartButton className="btn-primary crate-cart" />}
    </section>
  );
}
