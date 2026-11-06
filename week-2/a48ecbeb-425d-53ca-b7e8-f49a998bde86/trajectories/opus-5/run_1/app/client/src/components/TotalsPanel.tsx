import type { ReactElement } from 'react';
import { PROVINCES, provinceName } from '../../../shared/catalogue.js';
import { SUBSCRIBE_SWITCH_HINT } from '../../../shared/copy.js';
import { formatDollars } from '../../../shared/money.js';
import { isSubscribable, taxLineLabel } from '../../../shared/quote.js';
import { useShop, cansOf } from '../state/shop.js';

export function TotalsTable(): ReactElement {
  const { quote, quoteStale, cart } = useShop();
  const hasCans = (cart?.count ?? 0) > 0;

  return (
    <table className="breakdown mono" aria-label="Price breakdown" data-stale={quoteStale}>
      <tbody>
        <tr>
          <th scope="row">Subtotal</th>
          <td>{formatDollars(quote?.goods_cents ?? 0)}</td>
        </tr>
        {quote !== null && quote.subscribe ? (
          <tr>
            <th scope="row">Subscribe &amp; save (10%)</th>
            <td>{formatDollars(-quote.discount_cents)}</td>
          </tr>
        ) : null}
        <tr>
          <th scope="row">Deposit</th>
          <td>{formatDollars(quote?.deposit_cents ?? 0)}</td>
        </tr>
        <tr>
          <th scope="row">Shipping</th>
          <td>
            {(quote?.shipping_cents ?? 0) === 0 && hasCans
              ? 'Free'
              : formatDollars(quote?.shipping_cents ?? 0)}
          </td>
        </tr>
        {(quote?.taxes ?? []).map((tax) => (
          <tr key={tax.name}>
            <th scope="row">{taxLineLabel(tax.name, tax.rate)}</th>
            <td>{formatDollars(tax.cents)}</td>
          </tr>
        ))}
        <tr className="breakdown__total">
          <th scope="row">Total</th>
          <td>{formatDollars(quote?.total_cents ?? 0)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function TotalsPanel(): ReactElement {
  const { cart, quote, setProvince, setSubscribe, setCadence, totalMessage, quoteStale } = useShop();
  const eligible = isSubscribable(cansOf(cart));
  const subscribe = cart?.subscribe === true;

  return (
    <section className="totals" aria-label="Order total">
      <h3 className="totals__heading">Order total</h3>

      <div className="field">
        <label htmlFor="totals-province">Province</label>
        <select
          id="totals-province"
          value={cart?.province ?? 'ON'}
          onChange={(event) => void setProvince(event.target.value as typeof PROVINCES[number]['code'])}
        >
          {PROVINCES.map((province) => (
            <option key={province.code} value={province.code}>
              {province.name}
            </option>
          ))}
        </select>
      </div>

      <div className="switch-row">
        <button
          type="button"
          role="switch"
          aria-checked={subscribe}
          aria-label="Subscribe and save 10%"
          disabled={!eligible}
          className="switch"
          onClick={() => void setSubscribe(!subscribe)}
        >
          <span className="switch__track" aria-hidden="true">
            <span className="switch__knob" />
          </span>
          <span className="switch__text">Subscribe and save 10%</span>
        </button>
        {!eligible ? <p className="switch-row__hint">{SUBSCRIBE_SWITCH_HINT}</p> : null}
      </div>

      {subscribe ? (
        <fieldset className="radiogroup">
          <legend>Deliver every</legend>
          <label>
            <input
              type="radio"
              name="cadence"
              value="monthly"
              checked={cart?.cadence === 'monthly'}
              onChange={() => void setCadence('monthly')}
            />
            Month
          </label>
          <label>
            <input
              type="radio"
              name="cadence"
              value="bimonthly"
              checked={cart?.cadence === 'bimonthly'}
              onChange={() => void setCadence('bimonthly')}
            />
            Two months
          </label>
        </fieldset>
      ) : null}

      <TotalsTable />

      {quoteStale ? <p className="totals__stale">These figures are out of date.</p> : null}

      <p role="status" aria-live="polite" aria-label="Total updates" className="live-region">
        {totalMessage}
      </p>
      <p className="visually-hidden">
        {quote === null ? '' : `Shipping to ${provinceName(quote.province)}.`}
      </p>
    </section>
  );
}
