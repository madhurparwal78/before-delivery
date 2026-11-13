/** The cart: one coloured panel per parcel, a live bill and the rolling payable total. */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import {
  mergeCopy,
  useCart,
  useSession,
  writeGuestCart,
  readGuestCart,
  type GuestLine,
} from '../state.tsx';
import {
  Amount,
  CountedField,
  PendingButton,
  Reel,
  StatusRegion,
  Timer,
  useCountdown,
  useDesktop,
} from '../components/ui.tsx';
import { ShareDialog } from '../components/ShareDialog.tsx';
import { formatAmount, formatPromiseDate } from '../../shared/format.js';
import { COPY, pincodeNotServiceable, sellerCannotReach } from '../../shared/messages.js';
import type { CartLine, CartQuote } from '../../shared/types.js';

function DealTimer({ line, quote }: { line: CartLine; quote: CartQuote }): ReactNode {
  const left = useCountdown(line.deal?.ends_at ?? null, quote.server_time);
  if (line.deal === null) return null;
  return <Timer name="Deal ends in" seconds={left} />;
}

function GuestCart(): ReactNode {
  const [lines, setLines] = useState<GuestLine[]>(() => readGuestCart());
  const total = lines.reduce((sum, line) => sum + line.price_paise * line.quantity, 0);

  const change = (next: GuestLine[]): void => {
    writeGuestCart(next);
    setLines(next);
  };

  if (lines.length === 0) {
    return (
      <div className="panel panel-pink">
        <p className="shout">{COPY.emptyCart}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="plain">
        {lines.map((line) => (
          <li key={line.listing_id} className="panel">
            <h4>{line.title}</h4>
            <p className="price">
              <Amount paise={line.price_paise * line.quantity} />
            </p>
            <label htmlFor={`guest-quantity-${line.listing_id}`}>{`Quantity for ${line.title}`}</label>
            <input
              id={`guest-quantity-${line.listing_id}`}
              type="number"
              role="spinbutton"
              aria-label={`Quantity for ${line.title}`}
              min={1}
              max={10}
              value={line.quantity}
              onChange={(event) =>
                change(
                  lines.map((entry) =>
                    entry.listing_id === line.listing_id
                      ? { ...entry, quantity: Math.max(1, Math.min(10, Number(event.target.value))) }
                      : entry,
                  ),
                )
              }
            />
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => change(lines.filter((entry) => entry.listing_id !== line.listing_id))}
            >
              {`Remove ${line.title}`}
            </button>
          </li>
        ))}
      </ul>
      <div className="panel panel-black">
        <div role="group" aria-label="Payable total">
          <Reel paise={total} />
        </div>
        <p className="muted">sign in to see delivery promises and pay</p>
        <Link
          to={`/signin?next=${encodeURIComponent('/cart')}`}
          className="btn"
          ariaLabel="Checkout"
        >
          Checkout
        </Link>
      </div>
    </>
  );
}

export function CartPage(): ReactNode {
  const { account } = useSession();
  const { quote, run, refresh, announcement, lineMessages, merge, announce } = useCart();
  const [coupon, setCoupon] = useState('');
  const [giftDrafts, setGiftDrafts] = useState<Record<string, string>>({});
  const [shareOpen, setShareOpen] = useState(false);
  const desktop = useDesktop();
  const lineRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (quote === null) return;
    setCoupon(quote.coupon?.code ?? '');
    setGiftDrafts((previous) => {
      const next = { ...previous };
      for (const line of quote.lines) {
        if (next[line.line_id] === undefined) next[line.line_id] = line.gift_message;
      }
      return next;
    });
  }, [quote]);

  if (account === null || account.role !== 'shopper') return <GuestCart />;
  if (quote === null) return <p className="muted">loading</p>;

  const selected = quote.lines.filter((line) => line.selected);

  if (quote.lines.length === 0 && quote.saved_for_later.length === 0) {
    return (
      <>
        <h1>cart</h1>
        <div className="panel panel-pink">
          <p className="shout">{COPY.emptyCart}</p>
        </div>
        <StatusRegion name="Cart updates" message={announcement} />
      </>
    );
  }

  const patch = (lineId: string, body: Record<string, unknown>): Promise<CartQuote | null> =>
    run(() => api<CartQuote>(`/api/cart/lines/${lineId}`, { method: 'PATCH', body }), {
      lineId,
    });

  const parcelColour = ['panel', 'panel panel-black', 'panel panel-yellow', 'panel panel-pink'];

  return (
    <>
      <h1>cart</h1>
      {merge.length === 0 ? null : (
        <section className="panel" role="region" aria-label="Cart merge">
          <h3>cart merge</h3>
          <ul className="plain">
            {merge.map((result) => (
              <li key={result.listing_id}>{mergeCopy(result)}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid cart-layout">
        <div>
          {quote.parcels.map((parcel, index) => (
            <section
              key={parcel.seller_id}
              className={parcelColour[index % parcelColour.length]}
              role="region"
              aria-label={`${parcel.seller_name} parcel`}
            >
              <h3>{parcel.seller_name}</h3>
              <div className="parcel-strip">
                <span className="parcel-strip-inner" key={`${parcel.promise_date}-${parcel.delivery_fee_paise}`}>
                  {parcel.serviceable && parcel.promise_date !== null
                    ? `arrives by ${formatPromiseDate(parcel.promise_date)} · delivery ${formatAmount(parcel.delivery_fee_paise)}`
                    : sellerCannotReach(parcel.seller_name, quote.destination.pincode ?? '')}
                </span>
              </div>
              {quote.destination.pincode !== null && !parcel.serviceable ? (
                <p className="panel panel-pink">
                  {pincodeNotServiceable(quote.destination.pincode)}
                </p>
              ) : null}
              <fieldset
                role="radiogroup"
                aria-label={`Delivery speed for ${parcel.seller_name}`}
                style={{ border: 0, padding: 0 }}
              >
                <div className="radio-row">
                  <input
                    id={`speed-standard-${parcel.seller_id}`}
                    type="radio"
                    name={`speed-${parcel.seller_id}`}
                    aria-label="Standard"
                    checked={parcel.speed === 'standard'}
                    onChange={() =>
                      void run(() =>
                        api<CartQuote>('/api/cart/delivery-speed', {
                          method: 'PUT',
                          body: { seller_id: parcel.seller_id, speed: 'standard' },
                        }),
                      )
                    }
                  />
                  <label htmlFor={`speed-standard-${parcel.seller_id}`}>Standard</label>
                </div>
                <div className="radio-row">
                  <input
                    id={`speed-oneday-${parcel.seller_id}`}
                    type="radio"
                    name={`speed-${parcel.seller_id}`}
                    aria-label="One day"
                    checked={parcel.speed === 'one_day'}
                    onChange={() =>
                      void run(() =>
                        api<CartQuote>('/api/cart/delivery-speed', {
                          method: 'PUT',
                          body: { seller_id: parcel.seller_id, speed: 'one_day' },
                        }),
                      )
                    }
                  />
                  <label htmlFor={`speed-oneday-${parcel.seller_id}`}>One day</label>
                </div>
              </fieldset>
              <ul className="plain">
                {parcel.line_ids.map((lineId) => {
                  const line = quote.lines.find((entry) => entry.line_id === lineId);
                  if (line === undefined) return null;
                  return (
                    <li key={lineId} className="panel">
                      <h4>{line.title}</h4>
                      <div className="check-row">
                        <input
                          id={`select-${lineId}`}
                          type="checkbox"
                          aria-label={`Select ${line.title}`}
                          checked={line.selected}
                          onChange={() => void patch(lineId, { selected: !line.selected })}
                        />
                        <label htmlFor={`select-${lineId}`}>selected</label>
                      </div>
                      <label htmlFor={`quantity-${lineId}`}>{`Quantity for ${line.title}`}</label>
                      <input
                        id={`quantity-${lineId}`}
                        ref={(element) => {
                          lineRefs.current[lineId] = element;
                        }}
                        type="number"
                        role="spinbutton"
                        aria-label={`Quantity for ${line.title}`}
                        min={1}
                        max={10}
                        value={line.quantity}
                        onChange={(event) =>
                          void patch(lineId, { quantity: Number(event.target.value) })
                        }
                      />
                      <p className="price">
                        <Amount paise={line.line_total_paise} />
                      </p>
                      <div className="bill-line">
                        <span>taxable value</span>
                        <span>
                          <Amount paise={line.taxable_value_paise} />
                        </span>
                      </div>
                      {line.igst_paise > 0 ? (
                        <div className="bill-line">
                          <span>{`igst ${line.gst_rate}%`}</span>
                          <span>
                            <Amount paise={line.igst_paise} />
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="bill-line">
                            <span>{`cgst ${line.gst_rate / 2}%`}</span>
                            <span>
                              <Amount paise={line.cgst_paise} />
                            </span>
                          </div>
                          <div className="bill-line">
                            <span>{`sgst ${line.gst_rate / 2}%`}</span>
                            <span>
                              <Amount paise={line.sgst_paise} />
                            </span>
                          </div>
                        </>
                      )}
                      {line.deal === null ? null : <DealTimer line={line} quote={quote} />}
                      {line.in_stock ? null : (
                        <p className="panel panel-pink">{COPY.soldOutLine}</p>
                      )}
                      {lineMessages[lineId] === undefined ? null : (
                        <p className="panel panel-pink">{lineMessages[lineId]}</p>
                      )}
                      <div className="check-row">
                        <input
                          id={`wrap-${lineId}`}
                          type="checkbox"
                          aria-label={`Gift wrap ${line.title}`}
                          checked={line.gift_wrap}
                          onChange={() => void patch(lineId, { gift_wrap: !line.gift_wrap })}
                        />
                        <label htmlFor={`wrap-${lineId}`}>gift wrap</label>
                      </div>
                      <CountedField
                        label={`Gift message for ${line.title}`}
                        value={giftDrafts[lineId] ?? ''}
                        max={240}
                        multiline
                        onChange={(value) =>
                          setGiftDrafts((previous) => ({ ...previous, [lineId]: value }))
                        }
                        onBlur={() => {
                          if ((giftDrafts[lineId] ?? '') !== line.gift_message) {
                            void patch(lineId, { gift_message: giftDrafts[lineId] ?? '' });
                          }
                        }}
                      />
                      <div className="row">
                        <PendingButton
                          label={`Save ${line.title} for later`}
                          className="btn btn-quiet"
                          onPress={async () => {
                            const index = quote.lines.findIndex((entry) => entry.line_id === lineId);
                            await run(() =>
                              api<CartQuote>(`/api/cart/lines/${lineId}/save-for-later`, {
                                method: 'POST',
                                body: {},
                              }),
                            );
                            const next = quote.lines[index + 1];
                            if (next !== undefined) {
                              setTimeout(() => lineRefs.current[next.line_id]?.focus(), 0);
                            }
                          }}
                        />
                        <PendingButton
                          label={`Move ${line.title} to wishlist`}
                          className="btn btn-quiet"
                          onPress={() =>
                            run(() =>
                              api<CartQuote>(`/api/cart/lines/${lineId}/move-to-wishlist`, {
                                method: 'POST',
                                body: {},
                              }),
                            )
                          }
                        />
                        <PendingButton
                          label={`Remove ${line.title}`}
                          className="btn btn-pink"
                          onPress={() =>
                            run(() => api<CartQuote>(`/api/cart/lines/${lineId}`, { method: 'DELETE' }))
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {quote.lines.filter((line) => !line.selected).length === 0 ? null : (
            <section className="panel">
              <h3>not selected</h3>
              <ul className="plain">
                {quote.lines
                  .filter((line) => !line.selected)
                  .map((line) => (
                    <li key={line.line_id}>
                      <div className="check-row">
                        <input
                          id={`select-${line.line_id}`}
                          type="checkbox"
                          aria-label={`Select ${line.title}`}
                          checked={false}
                          onChange={() => void patch(line.line_id, { selected: true })}
                        />
                        <label htmlFor={`select-${line.line_id}`}>{line.title}</label>
                      </div>
                      <PendingButton
                        label={`Remove ${line.title}`}
                        className="btn btn-pink"
                        onPress={() =>
                          run(() =>
                            api<CartQuote>(`/api/cart/lines/${line.line_id}`, { method: 'DELETE' }),
                          )
                        }
                      />
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section className="panel panel-black" role="region" aria-label="Saved for later">
            <h3>saved for later</h3>
            {quote.saved_for_later.length === 0 ? (
              <p className="muted">nothing saved yet</p>
            ) : (
              <ul className="plain">
                {quote.saved_for_later.map((line) => (
                  <li key={line.line_id}>
                    {line.title}
                    <PendingButton
                      label={`Move ${line.title} to cart`}
                      className="btn btn-quiet"
                      onPress={() =>
                        run(() =>
                          api<CartQuote>(`/api/cart/saved/${line.line_id}/move-to-cart`, {
                            method: 'POST',
                            body: {},
                          }),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <h3>bill</h3>
            <label htmlFor="coupon-code">Coupon code</label>
            <input
              id="coupon-code"
              type="text"
              aria-label="Coupon code"
              value={coupon}
              onChange={(event) => setCoupon(event.target.value)}
            />
            <div className="row">
              <PendingButton
                label="Apply coupon"
                onPress={() =>
                  run(() =>
                    api<CartQuote>('/api/cart/coupon', { method: 'POST', body: { code: coupon } }),
                  )
                }
              />
              <PendingButton
                label="Remove coupon"
                className="btn btn-quiet"
                onPress={() =>
                  run(() => api<CartQuote>('/api/cart/coupon', { method: 'DELETE' }))
                }
              />
            </div>
            <div className="bill-line">
              <span>subtotal</span>
              <span>
                <Amount paise={quote.subtotal_paise} />
              </span>
            </div>
            <div className="bill-line">
              <span>coupon</span>
              <span>
                <Amount paise={-quote.discount_paise} />
              </span>
            </div>
            <div className="bill-line">
              <span>gift wrap</span>
              <span>
                <Amount paise={quote.gift_wrap_paise} />
              </span>
            </div>
            <div className="bill-line">
              <span>delivery</span>
              <span>
                <Amount paise={quote.delivery_paise} />
              </span>
            </div>
            <div className="bill-line">
              <span>cash on delivery fee</span>
              <span>
                <Amount paise={quote.cod_fee_paise} />
              </span>
            </div>
            {quote.emi_discount_paise === 0 ? null : (
              <div className="bill-line">
                <span>no-cost emi discount</span>
                <span>
                  <Amount paise={-quote.emi_discount_paise} />
                </span>
              </div>
            )}
            <div className="bill-line">
              <span>payable</span>
              <span>
                <Amount paise={quote.payable_paise} />
              </span>
            </div>
            {quote.balance_applied_paise === 0 ? null : (
              <div className="bill-line">
                <span>chauraha balance</span>
                <span>
                  <Amount paise={-quote.balance_applied_paise} />
                </span>
              </div>
            )}
            <label htmlFor="cod-progress">
              {quote.cod.eligible ? 'cash on delivery limit' : 'cash on delivery unavailable'}
            </label>
            <progress
              id="cod-progress"
              role="progressbar"
              aria-label="Cash on delivery limit"
              max={quote.cod.cap_paise}
              value={quote.cod.eligible ? Math.min(quote.cod.cash_paise, quote.cod.cap_paise) : 0}
              aria-valuetext={formatAmount(quote.cod.eligible ? quote.cod.cash_paise : 0)}
            />
            {quote.cod.eligible ? null : <p className="muted">{quote.cod.message}</p>}
            <div className="row">
              {desktop ? (
                <>
                  <span role="group" aria-label="Payable total" className="price">
                    <Reel paise={quote.payable_paise} />
                  </span>
                  <Link
                    to="/checkout/address"
                    className={selected.length === 0 ? 'btn btn-quiet' : 'btn'}
                    ariaLabel="Checkout"
                    disabled={selected.length === 0}
                    onNavigate={() => {
                      if (selected.length === 0) announce(COPY.emptyCart);
                    }}
                  >
                    Checkout
                  </Link>
                </>
              ) : null}
              <button type="button" className="btn btn-quiet" onClick={() => setShareOpen(true)}>
                Share cart
              </button>
            </div>
            <StatusRegion name="Cart updates" message={announcement} />
          </section>
        </div>
      </div>

      {desktop ? null : (
        <div className="cart-strip">
          <span role="group" aria-label="Payable total" className="price">
            <Reel paise={quote.payable_paise} />
          </span>
          <Link
            to="/checkout/address"
            className={selected.length === 0 ? 'btn btn-quiet' : 'btn'}
            ariaLabel="Checkout"
            disabled={selected.length === 0}
            onNavigate={() => {
              if (selected.length === 0) announce(COPY.emptyCart);
            }}
          >
            Checkout
          </Link>
        </div>
      )}
      <ShareDialog kind="cart" open={shareOpen} onClose={() => setShareOpen(false)} />
    </>
  );
}
