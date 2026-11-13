import { useEffect, useRef, useState } from "react";
import { rupees } from "../../../shared/format";
import type { Quote } from "../../lib/types";

/** `Total <amount>, <n> parcels.`, then the cash-on-delivery sentence when that flipped. */
function announcement(before: Quote | null, quote: Quote): string | null {
  const parcels = quote.parcels.length;
  const changed = before === null || before.payable_paise !== quote.payable_paise || before.parcels.length !== parcels;
  const flipped = before !== null && before.cod.eligible !== quote.cod.eligible;
  if (!changed && !flipped) return null;
  const total = `Total ${rupees(quote.payable_paise)}, ${parcels === 1 ? "1 parcel" : `${parcels} parcels`}.`;
  if (!flipped) return total;
  const cod = quote.cod.eligible ? "Cash on delivery available." : (quote.cod.message ?? "");
  return `${total} ${cod}`.trim();
}

/** The text of `status "Cart updates"`: set the moment a new quote is painted, never behind a timer. */
export function useCartAnnouncement(quote: Quote): string {
  const [text, setText] = useState("");
  const painted = useRef<Quote | null>(null);

  useEffect(() => {
    if (painted.current === quote) return;
    const next = announcement(painted.current, quote);
    painted.current = quote;
    if (next !== null) setText(next);
  }, [quote]);

  return text;
}
