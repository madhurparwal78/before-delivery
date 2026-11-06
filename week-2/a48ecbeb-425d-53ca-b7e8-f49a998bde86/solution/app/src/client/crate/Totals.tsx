import { useId } from "react";
import { PROVINCE_NAMES } from "../../shared/format";
import { useShop } from "../state/shop";
import { PriceTable } from "./PriceTable";

export const PROVINCE_CODES = ["AB", "BC", "NS", "ON", "QC"];

/** The subscribe-and-save switch and, while it is on, the delivery rhythm. */
export function SubscribeChoice() {
  const { cart, updateCart } = useShop();
  const id = useId();
  const eligible = cart?.subscribe_eligible ?? false;
  const subscribed = cart?.subscribe ?? false;
  return (
    <>
      <div className="switch-row">
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={subscribed}
          disabled={!eligible}
          aria-describedby={eligible ? undefined : `${id}-hint`}
          onClick={() => void updateCart({ subscribe: !subscribed })}
        >
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
          <span>Subscribe and save 10%</span>
        </button>
        {!eligible && (
          <p className="hint" id={`${id}-hint`}>
            Subscriptions come as 12 of one flavour or 4 of each.
          </p>
        )}
      </div>
      {subscribed && (
        <div className="cadence" role="radiogroup" aria-labelledby={`${id}-cadence`}>
          <span className="label" id={`${id}-cadence`}>
            Deliver every
          </span>
          {(["monthly", "bimonthly"] as const).map((cadence) => (
            <label key={cadence} className="radio-row">
              <input
                type="radio"
                name={`${id}-cadence-choice`}
                checked={cart?.cadence === cadence}
                onChange={() => void updateCart({ cadence })}
              />
              {cadence === "monthly" ? "Month" : "Two months"}
            </label>
          ))}
        </div>
      )}
    </>
  );
}

/** The order total region: province, subscribe-and-save, rhythm and the server's breakdown. */
export function Totals() {
  const { cart, quote, quoteStale, updateCart, totalMessage } = useShop();
  const id = useId();
  const province = cart?.province ?? "ON";
  return (
    <section className="totals" aria-labelledby={`${id}-title`} id="subscribe">
      <h3 id={`${id}-title`}>Order total</h3>
      <div className="field">
        <label htmlFor={`${id}-province`}>Province</label>
        <select id={`${id}-province`} value={province} onChange={(event) => void updateCart({ province: event.target.value })}>
          {PROVINCE_CODES.map((code) => (
            <option key={code} value={code}>
              {PROVINCE_NAMES[code]}
            </option>
          ))}
        </select>
      </div>
      <SubscribeChoice />
      {quote ? (
        <PriceTable figures={quote} subscribed={quote.subscribe} hasCans={(cart?.count ?? 0) > 0} stale={quoteStale} />
      ) : (
        <div className="skeleton totals-skeleton" aria-hidden="true" />
      )}
      {quoteStale && quote && <p className="stale-note">These figures are out of date.</p>}
      <p className="status-line totals-status" role="status" aria-label="Total updates">
        {totalMessage}
      </p>
    </section>
  );
}
