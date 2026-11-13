// Support (brief: Screens and layout › Support; Interactions › Donating). The three tiers with
// their prices and scheduled changes, and the Donate form, which keeps one Idempotency-Key for
// one set of field values so a resubmit after a lost reply makes one donation.

import { useRef, useState, type FormEvent } from "react";
import { api, ApiFailure, LostReply, type Catalog, type Order } from "../api.js";
import { useApi, useStableKey } from "../hooks.js";
import { useApp } from "../state.js";
import { ChoiceGroup, ScheduledChanges } from "../components/PlanDialog.js";
import { ErrorSummary, Field, MuseumCard, TextArea, type FieldErrors } from "../components/ui.js";
import { COPY, TIERS, copyFor } from "../../shared/copy.js";
import { CURRENCIES, formatPrice, parseAmount, type Currency } from "../../shared/money.js";

const TIER_TEXT = {
  reader: "For regular visitors: a monthly hand in keeping the rooms open.",
  fellow: "For close readers: sustains a new plate or narration each season.",
  patron: "For the reading room's steadiest friends: funds a whole guided session.",
} as const;

function DonateForm({ catalog }: { catalog: Catalog | null }) {
  const app = useApp();
  const [values, setValues] = useState({ amount: "", currency: "EUR" as Currency, card: "", note: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Order | null>(null);
  const sending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const keyFor = useStableKey(JSON.stringify(values));

  const set = <K extends keyof typeof values>(name: K, value: (typeof values)[K]) => setValues((v) => ({ ...v, [name]: value }));

  const donate = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    if (!app.user) return app.openSignIn(document.activeElement as HTMLElement);
    setErrors({});
    setMessage("");
    const amount = parseAmount(values.amount, values.currency);
    if (amount === null) {
      setErrors({ amount_minor: COPY.amountFormat });
      setMessage(COPY.validation);
      return;
    }
    sending.current = true;
    setBusy(true);
    app.announce(COPY.processing);
    try {
      const { order, receipt_email } = await api<{ order: Order; receipt_email: string }>("/api/donations", {
        body: { amount_minor: amount, currency: values.currency, card_number: values.card, note: values.note },
        key: keyFor(),
      });
      setDone(order);
      app.announce(copyFor.donationReceived(formatPrice(order.amount_minor, order.currency)));
      if (receipt_email === "delayed") app.setServiceNotice(COPY.receiptDelayed);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.error.fields ?? {});
        setMessage(error.error.fields ? COPY.validation : error.error.message);
        app.announce(error.error.message);
      } else if (error instanceof LostReply) setMessage(COPY.lostReply);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const ids = { amount_minor: "donate-amount", currency: "donate-currency", card_number: "donate-card", note: "donate-note" };
  const bounds = catalog
    ? `From ${formatPrice(catalog.donation.min_minor[values.currency], values.currency)} to ${formatPrice(catalog.donation.max_minor[values.currency], values.currency)}.`
    : null;

  return (
    <form aria-label="Donate" className="donate-form museum-card" noValidate onSubmit={(e) => void donate(e)}>
      <p className="catalogue">HRR-GIFT</p>
      {done ? (
        <div className="confirmation">
          <h2 ref={heading} tabIndex={-1}>
            {COPY.thanks}
          </h2>
          <p className="confirmation-line">
            {formatPrice(done.amount_minor, done.currency)} · receipt {done.receipt_number}. Your receipt is on its way by email and in your account.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setDone(null);
                setValues((v) => ({ ...v, amount: "", note: "" }));
              }}
            >
              Make another donation
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="card-title">Make a donation</h2>
          <p className="card-text">Any amount, once, in your own currency. Nothing is converted: you are charged exactly what you enter.</p>
          <ErrorSummary errors={errors} message={message} ids={ids} />
          <div className="form-grid">
            <Field
              id={ids.amount_minor}
              label="Amount"
              inputMode="decimal"
              autoComplete="off"
              hint={values.currency === "JPY" ? "A whole number of yen, such as 2000." : "Such as 25 or 25.00."}
              value={values.amount}
              onChange={(e) => set("amount", e.currentTarget.value)}
              error={errors.amount_minor}
            />
            <ChoiceGroup label="Currency" name="donate-currency" value={values.currency} onChange={(c) => set("currency", c)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </div>
          {bounds && <p className="hint">{bounds}</p>}
          <Field id={ids.card_number} label="Card number" inputMode="numeric" autoComplete="cc-number" value={values.card} onChange={(e) => set("card", e.currentTarget.value)} error={errors.card_number} />
          <TextArea id={ids.note} label="Note to the curators" rows={3} maxLength={500} value={values.note} onChange={(e) => set("note", e.currentTarget.value)} error={errors.note} />
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              Donate
            </button>
            {!app.user && <span className="hint">You'll be asked to sign in first.</span>}
          </div>
        </>
      )}
    </form>
  );
}

export function SupportPage() {
  const app = useApp();
  const catalog = useApi<Catalog>("/api/catalog");
  return (
    <div className="page support-page">
      <header className="page-intro">
        <p className="eyebrow">Keep the rooms open</p>
        <h1>Support the reading room</h1>
        <p className="lede">Join as a supporter on a monthly plan in euros, pounds, dollars or yen, or give once. Plans start today at today's price; change or cancel whenever you like.</p>
        <button type="button" className="button button-primary" onClick={(e) => app.openPlan(e.currentTarget)}>
          Choose a plan
        </button>
      </header>
      {catalog.failure ? (
        <p className="banner-inline">{COPY.pricesDown}</p>
      ) : catalog.data ? (
        <ol className="tier-grid">
          {catalog.data.tiers.map((t) => (
            <li key={t.tier}>
              <MuseumCard catalogue={`HRR-${t.name.toUpperCase()}`} title={t.name} className="tier-card">
                <p className="card-text">{TIER_TEXT[t.tier]}</p>
                <ul className="tier-prices" aria-label={`${t.name} prices`}>
                  {CURRENCIES.map((c) => (
                    <li key={c}>
                      <span className="figure">{c}</span> {copyFor.planPrice(formatPrice(t.prices[c], c))}
                    </li>
                  ))}
                </ul>
                <ScheduledChanges changes={t.scheduled_changes} />
              </MuseumCard>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="tier-grid" aria-hidden="true">
          {TIERS.map((t) => (
            <li key={t}>
              <div className="museum-card tier-card skeleton-card" />
            </li>
          ))}
        </ol>
      )}
      <DonateForm catalog={catalog.data} />
    </div>
  );
}
