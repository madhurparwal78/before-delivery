import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { cardNumberValid, checkExpiry, cvcValid, postcodeValid } from "../../shared/checkout";
import { dollars } from "../../shared/money";
import type { Order, Product } from "../../shared/types";
import { EmptyDrawing } from "../components/Drawings";
import { Totals } from "../components/Totals";
import { newRequestKey, request } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useSession } from "../lib/session";

type Method = "card" | "account";
type FieldName = "name" | "address" | "city" | "postcode" | "number" | "expiry" | "cvc" | "cardName" | "purchaseOrder";

const LABELS: Record<FieldName, string> = {
  name: "Full name",
  address: "Address",
  city: "City",
  postcode: "Postcode",
  number: "Card number",
  expiry: "Expiry (MM/YY)",
  cvc: "Security code",
  cardName: "Name on card",
  purchaseOrder: "Purchase order (optional)",
};

const AUTOCOMPLETE: Partial<Record<FieldName, string>> = {
  name: "name",
  address: "street-address",
  city: "address-level2",
  postcode: "postal-code",
  number: "cc-number",
  expiry: "cc-exp",
  cvc: "cc-csc",
  cardName: "cc-name",
};

const REQUIRED = "This field is required.";

interface Problem {
  heading: string;
  body: string;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function validate(values: Record<FieldName, string>, method: Method): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  for (const field of ["name", "address", "city", "postcode"] as const) if (!values[field].trim()) errors[field] = REQUIRED;
  if (values.postcode.trim() && !postcodeValid(values.postcode)) errors.postcode = "Enter a 4-digit postcode.";
  if (method === "card") {
    if (!values.number.trim()) errors.number = REQUIRED;
    else if (!cardNumberValid(values.number)) errors.number = "Enter a valid card number.";
    if (!values.expiry.trim()) errors.expiry = REQUIRED;
    else if (checkExpiry(values.expiry, today()) !== "valid") errors.expiry = "Enter an expiry date in the future.";
    if (!values.cvc.trim()) errors.cvc = REQUIRED;
    else if (!cvcValid(values.cvc)) errors.cvc = "Enter the 3-digit security code.";
    if (!values.cardName.trim()) errors.cardName = REQUIRED;
  }
  return errors;
}

/** Server field codes → the brief's field error copy. */
function serverErrors(errors: Record<string, string>): Partial<Record<FieldName, string>> {
  const mapped: Partial<Record<FieldName, string>> = {};
  const message = (field: FieldName, code: string) =>
    code === "required"
      ? REQUIRED
      : ({
          number: "Enter a valid card number.",
          expiry: "Enter an expiry date in the future.",
          cvc: "Enter the 3-digit security code.",
          postcode: "Enter a 4-digit postcode.",
        } as Partial<Record<FieldName, string>>)[field] ?? REQUIRED;
  for (const [key, code] of Object.entries(errors)) {
    const field: FieldName | undefined =
      key === "name" ? "name" : key === "purchase_order" ? "purchaseOrder" : (Object.keys(LABELS) as FieldName[]).find((f) => f === key);
    if (field) mapped[field] = message(field, code);
  }
  return mapped;
}

export function Checkout() {
  const { user, ready, approvedTrade, refreshCart } = useSession();
  const id = useId();
  const [order, setOrder] = useState<Order | null>(null);
  const [method, setMethod] = useState<Method>("card");
  const [values, setValues] = useState<Record<FieldName, string>>({
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
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  // One request key per submission: repeats of the same submission reuse it; any field change starts a new one.
  const requestKey = useRef<string | null>(null);

  useEffect(() => {
    document.title = "Checkout · Lightfall";
    if (!user) return;
    void request<{ order: Order }>("/api/cart").then((reply) => reply.ok && setOrder(reply.data.order));
  }, [user]);

  const change = (field: FieldName, value: string) => {
    requestKey.current = null;
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors(({ [field]: _, ...rest }) => rest);
  };

  const soldOutName = async (): Promise<string> => {
    const reply = await request<{ products: Product[] }>("/api/catalogue?clearance=true");
    const short = order?.lines.find((line) =>
      reply.ok
        ? reply.data.products.some((p) => p.variants.some((v) => v.code === line.variant_code && (v.stock_on_hand ?? 0) < line.quantity))
        : false,
    );
    return short?.product_name ?? order?.lines[0]?.product_name ?? "";
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!order || submitting.current) return;
    const found = validate(values, method);
    setErrors(found);
    if (Object.keys(found).length) return;
    submitting.current = true;
    setBusy(true);
    setProblem(null);
    requestKey.current ??= newRequestKey();
    const delivery = { name: values.name.trim(), address: values.address.trim(), city: values.city.trim(), postcode: values.postcode.trim() };
    const reply =
      method === "card"
        ? await request<{ order: Order }>(`/api/orders/${order.order_key}/authorise`, {
            method: "POST",
            headers: { "Idempotency-Key": requestKey.current },
            body: {
              card: { number: values.number, expiry: values.expiry.trim(), cvc: values.cvc.trim(), name: values.cardName.trim() },
              delivery,
            },
          })
        : await request<{ order: Order }>(`/api/orders/${order.order_key}/place-on-account`, {
            method: "POST",
            headers: { "Idempotency-Key": requestKey.current },
            body: { delivery, ...(values.purchaseOrder.trim() ? { purchase_order: values.purchaseOrder.trim() } : {}) },
          });
    submitting.current = false;
    setBusy(false);
    if (reply.ok) {
      refreshCart();
      navigate(`/orders/${reply.data.order.order_key}`);
      return;
    }
    const { error } = reply;
    if (error.error === "card_declined") {
      setProblem({
        heading: "Card declined",
        body: "Your bank declined this card. No money has been taken. Try another card or contact your bank.",
      });
    } else if (error.error === "insufficient_stock") {
      const name = await soldOutName();
      setProblem({
        heading: "Sold out while you were checking out",
        body: `Someone else bought the last units of ${name}. Your card has not been charged.`,
      });
    } else if (error.error === "invalid_state" && (error.status === "authorised" || error.status === "placed")) {
      navigate(`/orders/${order.order_key}`);
    } else if (error.errors) {
      setErrors(serverErrors(error.errors));
    } else {
      setProblem({
        heading: "Payment service unavailable",
        body: "We couldn't reach our payment service. Your order is saved and you will only be charged once. Try again in a few minutes.",
      });
    }
  };

  const field = (name: FieldName, options: { inputMode?: "numeric"; maxLength?: number; optional?: boolean } = {}) => (
    <div className={`field ${errors[name] ? "field--error" : ""}`}>
      <label htmlFor={`${id}-${name}`}>{LABELS[name]}</label>
      <input
        id={`${id}-${name}`}
        type="text"
        autoComplete={AUTOCOMPLETE[name]}
        inputMode={options.inputMode}
        maxLength={options.maxLength}
        value={values[name]}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
        onChange={(event) => change(name, event.target.value)}
      />
      {errors[name] && (
        <p id={`${id}-${name}-error`} className="field__error">
          {errors[name]}
        </p>
      )}
    </div>
  );

  if (ready && !user) {
    return (
      <div className="checkout">
        <header className="page-head">
          <h1>Checkout</h1>
        </header>
        <div className="empty-state">
          <EmptyDrawing />
          <p>Sign in to check out.</p>
          <Link href="/signin?next=/checkout" className="button button--primary">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const total = order ? dollars(order.total_cents) : "";
  const pending = method === "card" ? "Authorising payment" : "Placing order";

  return (
    <div className="checkout">
      <header className="page-head">
        <p className="eyebrow">Your order</p>
        <h1>Checkout</h1>
      </header>
      {order && order.lines.length === 0 && (
        <div className="empty-state">
          <EmptyDrawing />
          <p>Your cart is empty.</p>
          <Link href="/catalogue" className="button button--primary">
            Browse the catalogue
          </Link>
        </div>
      )}
      {order && order.lines.length > 0 && (
        <div className="checkout__layout">
          <aside className="checkout__summary" aria-labelledby={`${id}-summary`}>
            <h2 id={`${id}-summary`} className="section-title">
              Order summary
            </h2>
            <ul className="summary-lines">
              {order.lines.map((line) => (
                <li key={line.variant_code}>
                  <span>
                    {line.product_name}
                    <span className="summary-lines__code mono">
                      {line.variant_code} × {line.quantity}
                    </span>
                  </span>
                  <span className="mono">{dollars(line.line_total_cents)}</span>
                </li>
              ))}
            </ul>
            <Totals order={order} />
          </aside>
          <form aria-label="Checkout" className="checkout__form" onSubmit={(event) => void submit(event)} noValidate>
            {problem && (
              <div role="alert" className="alert">
                <h2>{problem.heading}</h2>
                <p>{problem.body}</p>
              </div>
            )}
            {approvedTrade && (
              <fieldset role="radiogroup" aria-label="Payment method" className="choice-group">
                <legend>Payment method</legend>
                {(["card", "account"] as const).map((option) => (
                  <label key={option} className="choice">
                    <input
                      type="radio"
                      name={`${id}-method`}
                      checked={method === option}
                      onChange={() => {
                        requestKey.current = null;
                        setMethod(option);
                        setProblem(null);
                      }}
                    />
                    <span>{option === "card" ? "Card" : "Monthly account"}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <fieldset className="form-section">
              <legend className="section-title">Delivery</legend>
              {field("name")}
              {field("address")}
              <div className="field-row">
                {field("city")}
                {field("postcode", { inputMode: "numeric", maxLength: 4 })}
              </div>
            </fieldset>
            {method === "card" ? (
              <fieldset className="form-section">
                <legend className="section-title">Card</legend>
                {field("number", { inputMode: "numeric", maxLength: 23 })}
                <div className="field-row">
                  {field("expiry", { maxLength: 5 })}
                  {field("cvc", { inputMode: "numeric", maxLength: 3 })}
                </div>
                {field("cardName")}
                <p className="form-note">Use the published test cards; only the last four digits are stored.</p>
              </fieldset>
            ) : (
              <fieldset className="form-section">
                <legend className="section-title">Monthly account</legend>
                {field("purchaseOrder", { maxLength: 40 })}
                <p className="form-note">Invoiced at trade prices when we dispatch; due on the 20th of the following month.</p>
              </fieldset>
            )}
            <button type="submit" className="button button--primary button--block" disabled={busy}>
              {busy ? pending : method === "card" ? `Pay ${total}` : "Place order on account"}
            </button>
            <p role="status" aria-label="Checkout status" className="form-status">
              {busy ? pending : ""}
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
