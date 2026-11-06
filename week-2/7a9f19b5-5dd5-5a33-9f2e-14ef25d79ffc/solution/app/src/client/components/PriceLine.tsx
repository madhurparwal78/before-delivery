import { dollars } from "../../shared/money";
import type { Variant } from "../../shared/types";
import { plusGst, stockBadge } from "../lib/format";

/** `$<price> + GST`; trade buyers see `Trade $… + GST` over `RRP $… + GST`; clearance shows the regular price struck. */
export function PriceLine({ variant, seesTrade }: { variant: Variant; seesTrade: boolean }) {
  const badge = stockBadge(variant);
  const trade = seesTrade && variant.trade_price_cents !== undefined && !variant.clearance;
  return (
    <div className="price-line">
      {trade ? (
        <>
          <p className="price-line__main mono">Trade {plusGst(variant.trade_price_cents!)}</p>
          <p className="price-line__sub mono">RRP {plusGst(variant.retail_price_cents)}</p>
        </>
      ) : (
        <p className="price-line__main mono">
          {plusGst(variant.retail_price_cents)}
          {variant.was_price_cents !== null && (
            <>
              {" "}
              <s className="price-line__was">
                <span className="visually-hidden">was </span>
                {dollars(variant.was_price_cents)}
              </s>
            </>
          )}
        </p>
      )}
      {badge && <p className={`badge ${badge === "Sold out" ? "badge--out" : "badge--low"}`}>{badge}</p>}
    </div>
  );
}
