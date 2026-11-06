/**
 * Checkout and the order page. "Pay $<total>" is disabled from the first press
 * until the reply arrives, so a double-click sends one request. The same checkout
 * keeps one request key for all repeats of the same submission; changing any card
 * or delivery field starts a new key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api.js";
import { CHECKOUT } from "../../shared/copy.js";
import { formatMoney } from "../../shared/money.js";
import type { Order } from "../../shared/types.js";
import { useCart, useRouter, useSession } from "../state/app.js";
import { AppLink } from "../components/Shell.js";
import { OrderTotals } from "./Simple.js";

type PaymentMethod = "card" | "account";

interface Problem {
  heading: string;
  body: string;
}

const EMPTY_FIELDS: Record<string, string> = {};

export function CheckoutPage() {
  const { user } = useSession();
  const cart = useCart();
  const { navigate } = useRouter();

  const [method, setMethod] = useState<PaymentMethod>("card");
  const [fields, setFields] = useState({
    name: "",
    address: "",
    city: "",
    postcode: "",
    number: "",
    expiry: "",
    cvc: "",
    cardName: "",
    purchaseOrder: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(EMPTY_FIELDS);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const isApprovedTrade = user?.role === "trade" && user.trade_status === "approved";
  const order = cart.order;

  /**
   * One request key per submission. It is regenerated whenever a card or delivery
   * field changes, so a retry with new details is a new submission.
   */
  const keyRef = useRef<string>(crypto.randomUUID());
  const setField = useCallback((key: keyof typeof fields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    keyRef.current = crypto.randomUUID();
  }, []);

  useEffect(() => {
    void cart.refresh();
    // The cart is read once when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Names the fitting whose last units went while the buyer was checking out: the
   * clearance line in the cart that no longer has enough stock on hand.
   */
  const soldOutProductName = async (currentOrder: Order): Promise<string> => {
    const { products } = await api.catalogue({ clearance: true });
    for (const line of currentOrder.lines) {
      for (const product of products) {
        const variant = product.variants.find((candidate) => candidate.code === line.variant_code);
        if (variant?.clearance && (variant.stock_on_hand ?? 0) < line.quantity) return product.name;
      }
    }
    return currentOrder.lines[0]?.product_name ?? "";
  };

  const problemFor = async (error: ApiError, currentOrder: Order): Promise<Problem | null> => {
    switch (error.failure.code) {
      case "card_declined":
        return { heading: CHECKOUT.cardDeclinedHeading, body: CHECKOUT.cardDeclinedBody };
      case "payment_unavailable":
        return { heading: CHECKOUT.paymentUnavailableHeading, body: CHECKOUT.paymentUnavailableBody };
      case "insufficient_stock":
        return {
          heading: CHECKOUT.soldOutHeading,
          body: CHECKOUT.soldOutBody(await soldOutProductName(currentOrder)),
        };
      default:
        return null;
    }
  };

  const mapFieldErrors = (error: ApiError): Record<string, string> => {
    const mapped: Record<string, string> = {};
    for (const field of Object.keys(error.failure.fields)) {
      if (field === "number") mapped.number = CHECKOUT.fieldCardNumber;
      else if (field === "expiry") mapped.expiry = CHECKOUT.fieldExpiry;
      else if (field === "cvc") mapped.cvc = CHECKOUT.fieldCvc;
      else mapped[field] = CHECKOUT.fieldRequired;
    }
    return mapped;
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!order || busy) return;
    setBusy(true);
    setProblem(null);
    setFieldErrors(EMPTY_FIELDS);
    setStatus(method === "card" ? CHECKOUT.authorising : CHECKOUT.placingOrder);

    const delivery = {
      name: fields.name,
      address: fields.address,
      city: fields.city,
      postcode: fields.postcode,
    };

    try {
      if (method === "card") {
        const { order: paid } = await api.authorise(
          order.order_key,
          {
            card: {
              number: fields.number,
              expiry: fields.expiry,
              cvc: fields.cvc,
              name: fields.cardName,
            },
            delivery,
          },
          keyRef.current,
        );
        await cart.refresh();
        navigate(`/orders/${paid.order_key}`);
      } else {
        const { order: placed } = await api.placeOnAccount(
          order.order_key,
          {
            delivery,
            ...(fields.purchaseOrder.trim() === "" ? {} : { purchase_order: fields.purchaseOrder.trim() }),
          },
          keyRef.current,
        );
        await cart.refresh();
        navigate(`/orders/${placed.order_key}`);
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus("");
      if (error.failure.status === 422) {
        setFieldErrors(mapFieldErrors(error));
      } else {
        setProblem(await problemFor(error, order));
        // A declined card or a retry leaves the order recoverable, so refresh it.
        await cart.refresh();
      }
      // A failed submission keeps its key, so an unchanged repeat is not a new charge.
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="wrap section">
        <h1>Checkout</h1>
        <AppLink to="/signin" className="button">
          Sign in
        </AppLink>
      </div>
    );
  }

  if (!order || order.lines.length === 0) {
    return (
      <div className="wrap section">
        <h1>Checkout</h1>
        <p className="muted">Your cart is empty.</p>
        <AppLink to="/catalogue" className="button">
          Browse the catalogue
        </AppLink>
      </div>
    );
  }

  return (
    <div className="wrap section">
      <h1>Checkout</h1>

      <div className="checkout-layout">
        <div className="checkout-form">
          <form aria-label="Checkout" className="stack" onSubmit={(event) => void submit(event)} noValidate>
            {/* Tab order: payment method, then delivery, card fields and the pay button. */}
            {isApprovedTrade && (
              <fieldset className="radio-set" role="radiogroup" aria-label="Payment method">
                <legend>Payment method</legend>
                <label className="chip">
                  <input
                    type="radio"
                    name="payment_method"
                    checked={method === "card"}
                    onChange={() => setMethod("card")}
                  />
                  <span>Card</span>
                </label>
                <label className="chip">
                  <input
                    type="radio"
                    name="payment_method"
                    checked={method === "account"}
                    onChange={() => setMethod("account")}
                  />
                  <span>Monthly account</span>
                </label>
              </fieldset>
            )}

            <h2>Delivery</h2>
            <TextField
              id="co-name"
              label="Full name"
              value={fields.name}
              error={fieldErrors.name}
              onChange={(value) => setField("name", value)}
            />
            <TextField
              id="co-address"
              label="Address"
              value={fields.address}
              error={fieldErrors.address}
              onChange={(value) => setField("address", value)}
            />
            <TextField
              id="co-city"
              label="City"
              value={fields.city}
              error={fieldErrors.city}
              onChange={(value) => setField("city", value)}
            />
            <TextField
              id="co-postcode"
              label="Postcode"
              value={fields.postcode}
              error={fieldErrors.postcode}
              onChange={(value) => setField("postcode", value)}
            />

            {method === "card" ? (
              <>
                <h2>Card</h2>
                <TextField
                  id="co-number"
                  label="Card number"
                  value={fields.number}
                  error={fieldErrors.number}
                  onChange={(value) => setField("number", value)}
                />
                <TextField
                  id="co-expiry"
                  label="Expiry (MM/YY)"
                  value={fields.expiry}
                  error={fieldErrors.expiry}
                  onChange={(value) => setField("expiry", value)}
                />
                <TextField
                  id="co-cvc"
                  label="Security code"
                  value={fields.cvc}
                  error={fieldErrors.cvc}
                  onChange={(value) => setField("cvc", value)}
                />
                <TextField
                  id="co-cardname"
                  label="Name on card"
                  value={fields.cardName}
                  error={fieldErrors.card_name}
                  onChange={(value) => setField("cardName", value)}
                />
              </>
            ) : (
              <TextField
                id="co-po"
                label="Purchase order (optional)"
                value={fields.purchaseOrder}
                onChange={(value) => setField("purchaseOrder", value)}
              />
            )}

            {problem && (
              <div className="alert" role="alert">
                <h2>{problem.heading}</h2>
                <p>{problem.body}</p>
              </div>
            )}

            <p role="status" aria-label="Checkout status" className="small muted">
              {status}
            </p>

            <button type="submit" className="button button-primary" disabled={busy}>
              {method === "card"
                ? busy
                  ? CHECKOUT.authorising
                  : CHECKOUT.payButton(order.total_cents)
                : busy
                  ? CHECKOUT.placingOrder
                  : "Place order on account"}
            </button>
          </form>
        </div>

        <div className="checkout-summary">
          <section className="framed">
            <h2>Order summary</h2>
            <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0 }} className="stack">
              {order.lines.map((line) => (
                <li key={line.variant_code} className="spread">
                  <span className="small">
                    <span className="numeric">{line.variant_code}</span>
                    {` \u00d7 ${line.quantity}`}
                  </span>
                  <span className="numeric small">{formatMoney(line.line_total_cents)}</span>
                </li>
              ))}
            </ul>
            <OrderTotals order={order} />
          </section>
        </div>
      </div>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

/* ---------- order page ---------- */

export function OrderPage({ orderKey }: { orderKey: string }) {
  const { user } = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api
      .order(orderKey)
      .then(({ order: loaded }) => setOrder(loaded))
      .catch(() => setMissing(true));
  }, [orderKey]);

  const heading = useMemo(() => {
    if (!order) return "";
    return order.payment_method === "account" ? CHECKOUT.orderPlacedHeading : CHECKOUT.orderConfirmedHeading;
  }, [order]);

  if (missing) {
    return (
      <div className="wrap section">
        <h1>Order not found</h1>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="wrap section">
        <h1 />
      </div>
    );
  }

  const body =
    order.payment_method === "account"
      ? CHECKOUT.orderPlacedBody(order.order_key, user?.email ?? "")
      : CHECKOUT.orderConfirmedBody(order.order_key, user?.email ?? "");

  return (
    <div className="wrap section">
      <h1>{heading}</h1>
      <p>{body}</p>

      <div className="grid" style={{ marginTop: 20 }}>
        <div style={{ gridColumn: "span 7" }}>
          <div className="table-frame">
            <table aria-label="Order lines">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Fitting</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Line total</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.variant_code}>
                    <td className="numeric">{line.variant_code}</td>
                    <td>{line.product_name}</td>
                    <td className="numeric">{line.quantity}</td>
                    <td className="numeric">{formatMoney(line.line_total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ gridColumn: "span 5" }}>
          <section className="framed stack">
            <div className="spread">
              <span className="muted small">Status</span>
              <strong>{order.display_status}</strong>
            </div>
            <OrderTotals order={order} />
            {order.invoice && (
              <>
                <hr className="hairline" />
                <div className="spread">
                  <span className="muted small">Invoice</span>
                  <span className="numeric">{order.invoice.invoice_number}</span>
                </div>
                <div className="spread">
                  <span className="muted small">Due date</span>
                  <span className="numeric">{order.invoice.due_date}</span>
                </div>
              </>
            )}
            {order.purchase_order && (
              <div className="spread">
                <span className="muted small">Purchase order</span>
                <span className="numeric">{order.purchase_order}</span>
              </div>
            )}
            {order.refunded_cents > 0 && (
              <div className="spread">
                <span className="muted small">Refunded</span>
                <span className="numeric">{formatMoney(order.refunded_cents)}</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
