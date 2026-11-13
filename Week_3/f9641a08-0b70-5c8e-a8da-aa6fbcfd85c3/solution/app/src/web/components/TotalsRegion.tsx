import { useEffect, useRef } from "react";
import type { Totals } from "../../shared/api";
import { inr } from "../../shared/format";
import { EASE, MOTION, reducedNow, useMotionMs } from "../lib/motion";

function Amount({ text }: { text: string }) {
  const element = useRef<HTMLDataElement>(null);
  const previous = useRef(text);
  useEffect(() => {
    if (previous.current !== text && !reducedNow()) {
      element.current?.animate(
        [
          { opacity: 0.2, transform: "translateY(6px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: MOTION.totals, easing: EASE },
      );
    }
    previous.current = text;
  }, [text]);
  return <data ref={element} value={text}>{text}</data>;
}

interface Props {
  totals: Totals;
  giftCard?: { last4: string; balance: number } | null;
  label?: string;
}

/** `region "Bag totals"`: the six figures the server computed, in the published order. */
export function TotalsRegion({ totals, giftCard, label = "Bag totals" }: Props) {
  const motionMs = useMotionMs(MOTION.totals);
  const rows: [string, string][] = [
    ["Subtotal", inr(totals.subtotal)],
    ["Discount", totals.discount > 0 ? `-${inr(totals.discount)}` : inr(0)],
    ["Shipping", totals.shipping === 0 ? "Free" : inr(totals.shipping)],
    ["Tax", inr(totals.tax)],
    ["Gift card", totals.gift_card > 0 ? `-${inr(totals.gift_card)}` : inr(0)],
    ["Total", inr(totals.total)],
  ];
  return (
    <section className="totals" aria-label={label} data-motion-ms={motionMs}>
      <dl>
        {rows.map(([term, amount]) => (
          <div key={term} className={term === "Total" ? "totals-row is-total" : "totals-row"}>
            <dt>{term}</dt>
            <dd>
              <Amount text={amount} />
            </dd>
          </div>
        ))}
      </dl>
      {giftCard && <p className="muted">Gift card balance after this order: {inr(giftCard.balance - totals.gift_card)}</p>}
    </section>
  );
}
