import { Lock, MapPin, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { HoldTimer } from "../components/HoldTimer";
import { PriceTable } from "../crate/PriceTable";
import { PROVINCE_CODES, SubscribeChoice } from "../crate/Totals";
import { api, ApiFailure } from "../lib/api";
import { Link, navigate } from "../lib/router";
import type { Address, Order } from "../lib/types";
import { money, PROVINCE_NAMES } from "../../shared/format";
import { HOLD_ENDED, useShop } from "../state/shop";

type Step = 1 | 2 | 3;
type Errors = Record<string, string>;

const SLOW_MS = 20_000;

/** A fresh checkout key (works on any origin, unlike crypto.randomUUID). */
function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `checkout-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
const PAY_COPY: Record<string, string> = {
  card_declined: "Your card was declined. No money was taken.",
  billing_unavailable: "Payments are paused for a moment. Your crate is still held, so try again shortly.",
  files_unavailable: "Receipts can't be saved right now, so we haven't charged you. Try again shortly.",
  store_unavailable: "The shop can't take orders right now. You haven't been charged.",
  crate_not_full: "Your crate needs all 12 cans before you can pay.",
  not_subscribable: "Subscriptions come as 12 of one flavour or 4 of each.",
};

/** Field ids for the error summary links, keyed by the API's field names. */
const FIELD_IDS: Record<string, string> = {
  name: "address-name",
  line1: "address-line1",
  city: "address-city",
  postal_code: "address-postal",
  province: "address-province",
  address_id: "ship-to",
  "card.number": "card-number",
  "card.expiry": "card-expiry",
  "card.cvc": "card-cvc",
};

function ErrorSummary({ errors, summary }: { errors: Errors; summary: React.RefObject<HTMLDivElement | null> }) {
  const entries = Object.entries(errors).filter(([field]) => FIELD_IDS[field]);
  if (entries.length === 0) return null;
  return (
    <div className="error-summary" role="alert" aria-labelledby="fix-title" tabIndex={-1} ref={summary}>
      <h2 id="fix-title">Fix these fields</h2>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${FIELD_IDS[field]}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(FIELD_IDS[field])?.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

const fieldProps = (id: string, error?: string) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : undefined,
});

function AddressForm({ onSaved, errors, setErrors }: { onSaved: (address: Address) => void; errors: Errors; setErrors: (e: Errors) => void }) {
  const [fields, setFields] = useState({ name: "", line1: "", line2: "", city: "", postal_code: "", province: "QC", is_default: false });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof fields) => (value: string | boolean) => setFields((f) => ({ ...f, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      const { address } = await api<{ address: Address }>("POST", "/api/addresses", fields);
      setErrors({});
      onSaved(address);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "validation") setErrors(error.body.fields ?? {});
      else setErrors({ address_id: error instanceof ApiFailure && error.code === "accounts_unavailable" ? "Addresses can't be saved right now. Try again in a moment." : "Pick a saved address." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="address-form">
      <Field id="address-name" label="Full name" error={errors.name}>
        <input type="text" autoComplete="name" value={fields.name} onChange={(e) => set("name")(e.target.value)} {...fieldProps("address-name", errors.name)} />
      </Field>
      <Field id="address-line1" label="Street address" error={errors.line1}>
        <input type="text" autoComplete="address-line1" value={fields.line1} onChange={(e) => set("line1")(e.target.value)} {...fieldProps("address-line1", errors.line1)} />
      </Field>
      <Field id="address-line2" label="Apartment or unit (optional)">
        <input type="text" id="address-line2" autoComplete="address-line2" value={fields.line2} onChange={(e) => set("line2")(e.target.value)} />
      </Field>
      <div className="field-pair">
        <Field id="address-city" label="City" error={errors.city}>
          <input type="text" autoComplete="address-level2" value={fields.city} onChange={(e) => set("city")(e.target.value)} {...fieldProps("address-city", errors.city)} />
        </Field>
        <Field id="address-postal" label="Postal code" error={errors.postal_code}>
          <input type="text" autoComplete="postal-code" value={fields.postal_code} onChange={(e) => set("postal_code")(e.target.value)} {...fieldProps("address-postal", errors.postal_code)} />
        </Field>
      </div>
      <Field id="address-province" label="Province" error={errors.province}>
        <select value={fields.province} onChange={(e) => set("province")(e.target.value)} {...fieldProps("address-province", errors.province)}>
          {PROVINCE_CODES.map((code) => (
            <option key={code} value={code}>
              {PROVINCE_NAMES[code]}
            </option>
          ))}
        </select>
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={fields.is_default} onChange={(e) => set("is_default")(e.target.checked)} />
        Make this my default address
      </label>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save()}>
        Save address
      </button>
    </div>
  );
}

function formatAddress(a: Pick<Address, "line1" | "line2" | "city" | "province" | "postal_code">): string {
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city} ${a.province} ${a.postal_code}`;
}

export function CheckoutPage() {
  const { cart, cartOutage, quote, quoteStale, user, updateCart, refreshCart } = useShop();
  const id = useId();
  const [step, setStep] = useState<Step>(1);
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressesSettled, setAddressesSettled] = useState(false);
  const [shipTo, setShipTo] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [card, setCard] = useState({ number: "", expiry: "", cvc: "" });
  const [paying, setPaying] = useState(false);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const [summaryShown, setSummaryShown] = useState(0);
  const headings = useRef<Record<Step, HTMLHeadingElement | null>>({ 1: null, 2: null, 3: null });
  const summary = useRef<HTMLDivElement>(null);
  const key = useRef("");
  const slow = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const moved = useRef(false);

  useEffect(() => {
    api<{ addresses: Address[] }>("GET", "/api/addresses")
      .then(({ addresses: list }) => {
        setAddresses(list);
        setShipTo((current) => current || list.find((a) => a.is_default)?.id || "");
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof ApiFailure && error.status === 503 ? "Your saved addresses can't load right now. Try again in a moment." : ""),
      )
      .finally(() => setAddressesSettled(true));
    void refreshCart();
  }, [refreshCart]);

  useEffect(() => {
    if (moved.current) headings.current[step]?.focus();
    moved.current = true;
    if (step === 3) key.current = newKey();
  }, [step]);

  useEffect(() => {
    if (summaryShown > 0) summary.current?.focus();
  }, [summaryShown]);

  useEffect(() => () => clearTimeout(slow.current), []);

  useEffect(() => {
    if (user === null) navigate("/sign-in?next=/checkout", true);
  }, [user]);

  const chosen = addresses?.find((a) => a.id === shipTo);
  // The page body appears once the crate, its quote and the saved addresses have each answered (or failed), so no
  // banner, total or address list arriving late pushes the rest of the page down.
  const settled = addressesSettled && (cartOutage || (cart !== null && (quote !== null || quoteStale)));
  const expired = cart?.hold.status === "expired";
  const total = quote ? money(quote.total_cents) : "";

  const showErrors = (next: Errors) => {
    setErrors(next);
    setSummaryShown((n) => n + 1);
  };

  const continueFrom = async (from: Step) => {
    if (from === 1) {
      if (!chosen) {
        showErrors({ address_id: "Choose where to ship your crate." });
        return;
      }
      setErrors({});
      await updateCart({ province: chosen.province });
    }
    setStep((from + 1) as Step);
  };

  const setCardField = (field: keyof typeof card) => (value: string) => {
    setCard((c) => ({ ...c, [field]: value }));
    key.current = newKey();
  };

  const pay = async () => {
    const expiry = /^\s*(\d{1,2})\s*\/\s*(\d{2})\s*$/.exec(card.expiry);
    const body = {
      address_id: shipTo,
      subscribe: cart?.subscribe ?? false,
      cadence: cart?.subscribe ? cart.cadence : null,
      card: {
        number: card.number,
        expiry_month: expiry ? Number(expiry[1]) : 0,
        expiry_year: expiry ? 2000 + Number(expiry[2]) : 0,
        cvc: card.cvc,
      },
    };
    setPaying(true);
    setStatus("Processing payment. Keep this page open.");
    clearTimeout(slow.current);
    slow.current = setTimeout(() => {
      setPaying(false);
      setStatus("This is taking longer than usual. Press Pay again; you won't be charged twice.");
    }, SLOW_MS);
    try {
      const result = await api<{ order: Order }>("POST", "/api/checkout", body, { "Idempotency-Key": key.current });
      clearTimeout(slow.current);
      await refreshCart();
      navigate(result.order.thank_you_url);
    } catch (error) {
      clearTimeout(slow.current);
      setPaying(false);
      if (!(error instanceof ApiFailure)) return;
      if (error.code === "validation") {
        setStatus("");
        showErrors(error.body.fields ?? {});
      } else if (error.code === "hold_expired") {
        setStatus("");
        await refreshCart();
      } else {
        setStatus(PAY_COPY[error.code] ?? error.message);
      }
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 3) {
      if (!paying && !expired) void pay();
    } else void continueFrom(step);
  };

  if (user && user.role !== "customer") {
    return (
      <div className="page page-narrow">
        <div className="panel">
          <h1>Checkout is for customer accounts</h1>
          <p>Staff accounts can't place orders. Sign in with a customer account to check out.</p>
        </div>
      </div>
    );
  }

  const stepHeading = (n: Step, text: string) => (
    <h2
      className="step-title"
      tabIndex={-1}
      ref={(el) => {
        headings.current[n] = el;
      }}
    >
      {text}
    </h2>
  );

  const summaryRegion = (
    <section className="order-summary panel" aria-labelledby={`${id}-summary`}>
      <h2 id={`${id}-summary`} className="summary-title">
        Order summary
      </h2>
      {chosen && step > 1 && <p className="muted">Shipping to {PROVINCE_NAMES[chosen.province]}</p>}
      {quote ? <PriceTable figures={quote} subscribed={quote.subscribe} hasCans={(cart?.count ?? 0) > 0} /> : <div className="skeleton totals-skeleton" aria-hidden="true" />}
    </section>
  );

  return (
    <div className="page checkout">
      <div className="checkout-top">
        <h1>Checkout</h1>
        <HoldTimer className="checkout-hold" />
      </div>
      {!settled && <div className="skeleton totals-skeleton" aria-hidden="true" />}
      {settled && loadError && <p className="banner">{loadError}</p>}
      {settled && cart && cart.count < 12 && !expired && (
        <p className="banner">
          Your crate needs all 12 cans before you can pay. <Link href="/box">Back to your crate</Link>
        </p>
      )}
      {settled && (
        <div className="checkout-grid">
          {summaryRegion}
          <form className="checkout-steps panel" onSubmit={submit} noValidate>
            <ErrorSummary errors={errors} summary={summary} />
            <ol className="step-list" aria-label="Checkout steps">
              {(["Address", "Review", "Payment"] as const).map((label, i) => (
                <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "is-done" : ""}>
                  <span className="num">{i + 1}</span> {label}
                </li>
              ))}
            </ol>
            {step === 1 && (
              <div className="step">
                {stepHeading(1, "Step 1 of 3: Address")}
                {addresses === null && !loadError && <div className="skeleton" style={{ height: 120 }} aria-hidden="true" />}
                {addresses && addresses.length > 0 && (
                  <div role="radiogroup" aria-label="Ship to" id="ship-to" tabIndex={-1} className="address-choices">
                    {addresses.map((a) => (
                      <label key={a.id} className={`address-choice ${shipTo === a.id ? "is-chosen" : ""}`}>
                        <input type="radio" name="ship-to" value={a.id} checked={shipTo === a.id} onChange={() => setShipTo(a.id)} />
                        <span>
                          <strong>{a.name}</strong>
                          <span className="muted">{formatAddress(a)}</span>
                          {a.is_default && <span className="badge badge-applied">Default</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {errors.address_id && <p className="field-error">{errors.address_id}</p>}
                {adding ? (
                  <AddressForm
                    errors={errors}
                    setErrors={showErrors}
                    onSaved={(address) => {
                      setAddresses((list) => [...(list ?? []).map((a) => (address.is_default ? { ...a, is_default: false } : a)), address]);
                      setShipTo(address.id);
                      setAdding(false);
                    }}
                  />
                ) : (
                  <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}>
                    <Plus size={18} aria-hidden="true" />
                    Add a new address
                  </button>
                )}
                <div className="step-actions">
                  <button type="submit" className="btn btn-primary">
                    Continue
                  </button>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="step">
                {stepHeading(2, "Step 2 of 3: Review")}
                {chosen && (
                  <p className="ship-to-line">
                    <MapPin size={18} aria-hidden="true" />
                    <span>
                      {chosen.name}, {formatAddress(chosen)}
                    </span>
                  </p>
                )}
                <SubscribeChoice />
                <div className="step-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Continue
                  </button>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="step">
                {stepHeading(3, "Step 3 of 3: Payment")}
                <p className="muted test-cards">
                  <Lock size={16} aria-hidden="true" /> Card details are used for this payment only; we keep just the brand and last four digits.
                </p>
                <Field id="card-number" label="Card number" error={errors["card.number"]}>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    value={card.number}
                    onChange={(e) => setCardField("number")(e.target.value)}
                    {...fieldProps("card-number", errors["card.number"])}
                  />
                </Field>
                <div className="field-pair">
                  <Field id="card-expiry" label="Expiry (MM/YY)" error={errors["card.expiry"]}>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      value={card.expiry}
                      onChange={(e) => setCardField("expiry")(e.target.value)}
                      {...fieldProps("card-expiry", errors["card.expiry"])}
                    />
                  </Field>
                  <Field id="card-cvc" label="Security code" error={errors["card.cvc"]}>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      value={card.cvc}
                      onChange={(e) => setCardField("cvc")(e.target.value)}
                      {...fieldProps("card-cvc", errors["card.cvc"])}
                    />
                  </Field>
                </div>
                {expired ? (
                  <div className="expired">
                    <p className="banner">{HOLD_ENDED}</p>
                    <Link href="/box" className="btn btn-primary">
                      Back to your crate
                    </Link>
                  </div>
                ) : (
                  <div className="step-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setStep(2)}>
                      Back
                    </button>
                    <button type="submit" className="btn btn-primary pay-button" aria-disabled={paying || undefined}>
                      {paying ? "Paying..." : `Pay ${total}`}
                    </button>
                  </div>
                )}
              </div>
            )}
            {expired && step !== 3 && (
              <div className="expired">
                <p className="banner">{HOLD_ENDED}</p>
                <Link href="/box" className="btn btn-primary">
                  Back to your crate
                </Link>
              </div>
            )}
            <p className="status-line" role="status" aria-label="Checkout status">
              {status}
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
