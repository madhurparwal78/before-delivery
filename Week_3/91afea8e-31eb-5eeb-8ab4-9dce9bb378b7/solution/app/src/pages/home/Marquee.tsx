import type { ReactNode } from "react";

const PROMISES = [
  "one cart, one parcel per seller",
  "arrives by a date we promise before you pay",
  "one-day delivery on parcels that can make it",
  "cash on delivery up to ₹50,000.00",
  "every refund shown to the paisa",
];

const COPIES = 4;

/** Delivery promises running along the band's upper edge: CSS keyframes, paused while hovered or focused, still under reduced motion. */
export function Marquee(): ReactNode {
  return (
    <section className="marquee" aria-label="Delivery promises" tabIndex={0}>
      <div className="marquee__track">
        {Array.from({ length: COPIES }, (_, copy) => (
          <ul key={copy} className="marquee__group" aria-hidden={copy === 0 ? undefined : true}>
            {PROMISES.map((promise) => (
              <li key={promise} className="marquee__item">
                {promise}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}
