import { type FormEvent, useCallback, useEffect, useState } from "react";
import { call } from "../api";
import { centsFromInput, dollars } from "../format";
import { useSession } from "../session";
import type { Kitchen, RateCard } from "../types";
import { type FormState, FormStatus, Page, Table } from "./common";

const AMOUNT_ERROR = "Enter an amount in dollars and cents.";

function Field({
  id,
  label,
  value,
  error,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: "text" | "date" | "number";
}) {
  return (
    <div className={error ? "field invalid" : "field"}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        inputMode={type === "text" ? "decimal" : undefined}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export function RatesScreen() {
  const { kitchen } = useSession();
  const [cards, setCards] = useState<RateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [cutoff, setCutoff] = useState(kitchen.same_day_cutoff);
  const [cutoffError, setCutoffError] = useState<string | undefined>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<FormState | null>(null);
  const [pending, setPending] = useState<"cutoff" | "card" | null>(null);

  const load = useCallback(async () => {
    const [list, k] = await Promise.all([
      call<{ rate_cards: RateCard[] }>("GET", `/api/kitchens/${kitchen.id}/rate-cards`),
      call<{ kitchen: Kitchen }>("GET", `/api/kitchens/${kitchen.id}`),
    ]);
    setLoading(false);
    if (list.ok) setCards(list.data.rate_cards);
    if (k.ok) setCutoff(k.data.kitchen.same_day_cutoff);
  }, [kitchen.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: string) => (value: string) => setValues((v) => ({ ...v, [key]: value }));

  const saveCutoff = (event: FormEvent): void => {
    event.preventDefault();
    if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(cutoff)) {
      setCutoffError("Enter a time on a quarter hour.");
      setForm({ text: "Enter a time on a quarter hour.", tone: "error" });
      return;
    }
    setCutoffError(undefined);
    setPending("cutoff");
    setForm({ text: "Saving…", tone: "info" });
    void (async () => {
      const result = await call<{ kitchen: Kitchen }>("PATCH", `/api/kitchens/${kitchen.id}/settings`, { same_day_cutoff: cutoff });
      setPending(null);
      if (result.ok) setForm({ text: `Same-day cutoff set to ${result.data.kitchen.same_day_cutoff}.`, tone: "success" });
      else {
        setCutoffError("Enter a time on a quarter hour.");
        setForm({ text: "Enter a time on a quarter hour.", tone: "error" });
      }
    })();
  };

  const addCard = (event: FormEvent): void => {
    event.preventDefault();
    const found: Record<string, string> = {};
    const cents = (key: string): number => {
      const value = centsFromInput(values[key] ?? "");
      if (value === null) found[key] = AMOUNT_ERROR;
      return value ?? 0;
    };
    const effective = values.effective ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || effective < kitchen.today) found.effective = "Choose today or a later date.";
    const tiers = [1, 2, 3, 4].map((t) => cents(`tier${t}`));
    tiers.forEach((t, i) => {
      if (t === 0 && !found[`tier${i + 1}`]) found[`tier${i + 1}`] = AMOUNT_ERROR;
    });
    const surcharges = Object.fromEntries(kitchen.stations.map((s) => [s.id, cents(`st-${s.id}`)]));
    const window = Number(values.window ?? "");
    if (!Number.isInteger(window) || window < 0 || window > 336 || (values.window ?? "").trim() === "") found.window = "Enter 0 to 336 hours.";
    const packPrice = cents("pack");
    if (packPrice === 0 && !found.pack) found.pack = AMOUNT_ERROR;
    setErrors(found);
    const first = Object.values(found)[0];
    if (first) {
      setForm({ text: first, tone: "error" });
      return;
    }
    setPending("card");
    setForm({ text: "Saving rate card…", tone: "info" });
    void (async () => {
      const result = await call<{ rate_card: RateCard }>("POST", `/api/kitchens/${kitchen.id}/rate-cards`, {
        effective_from: effective,
        tier_rates_cents: tiers,
        station_surcharges_cents: surcharges,
        cancellation_window_hours: window,
        pack_price_cents: packPrice,
      });
      setPending(null);
      if (result.ok) {
        setForm({ text: `Rate card added. It applies from ${result.data.rate_card.effective_from}.`, tone: "success" });
        setValues({});
        void load();
        return;
      }
      if (result.error.error === "rate_card_exists") {
        setErrors({ effective: `A rate card already starts on ${effective}.` });
        setForm({ text: `A rate card already starts on ${effective}.`, tone: "error" });
      } else if (result.error.errors?.effective_from) {
        setErrors({ effective: "Choose today or a later date." });
        setForm({ text: "Choose today or a later date.", tone: "error" });
      } else {
        setForm({ text: AMOUNT_ERROR, tone: "error" });
      }
    })();
  };

  return (
    <Page title="Rates">
      <FormStatus state={form} />
      <form className="inline-form" onSubmit={saveCutoff}>
        <div className={cutoffError ? "field invalid" : "field"}>
          <label htmlFor="cutoff">Same-day cutoff</label>
          <input
            id="cutoff"
            type="time"
            step={900}
            value={cutoff}
            aria-invalid={cutoffError ? true : undefined}
            aria-describedby={cutoffError ? "cutoff-error" : undefined}
            onChange={(e) => setCutoff(e.target.value)}
          />
          {cutoffError && (
            <span id="cutoff-error" className="field-error">
              {cutoffError}
            </span>
          )}
        </div>
        <button type="submit" className="ghost" disabled={pending === "cutoff"}>
          Save cutoff
        </button>
      </form>

      <h2 className="section-title">Rate cards</h2>
      <Table
        label="Rate cards"
        loading={loading}
        rows={cards}
        rowKey={(c) => c.id}
        empty="No rate cards."
        columns={[
          { label: "Effective from", cell: (c: RateCard) => <span className="num">{c.effective_from}</span> },
          ...[0, 1, 2, 3].map((i) => ({ label: `Tier ${i + 1}`, numeric: true, cell: (c: RateCard) => dollars(c.tier_rates_cents[i] ?? 0) })),
          { label: "Cancellation window", numeric: true, cell: (c) => `${c.cancellation_window_hours} h` },
          { label: "Pack price", numeric: true, cell: (c) => dollars(c.pack_price_cents) },
          { label: "In force", cell: (c) => (c.in_force ? <span className="badge s-in-force">in force</span> : "") },
        ]}
      />

      {/* The form appears once the cards have loaded, so their rows never push it down. */}
      {!loading && (
        <>
          <h2 className="section-title">New rate card</h2>
          <form className="card-form" aria-label="New rate card" onSubmit={addCard} noValidate>
            <Field id="effective" type="date" label="Effective from" value={values.effective ?? ""} error={errors.effective} onChange={set("effective")} />
            <fieldset>
              <legend>Hourly tier rates</legend>
              {[1, 2, 3, 4].map((t) => (
                <Field key={t} id={`tier${t}`} label={`Tier ${t} hourly rate`} value={values[`tier${t}`] ?? ""} error={errors[`tier${t}`]} onChange={set(`tier${t}`)} />
              ))}
            </fieldset>
            <fieldset>
              <legend>Hourly station surcharges</legend>
              {kitchen.stations.map((s) => (
                <Field
                  key={s.id}
                  id={`st-${s.id}`}
                  label={`${s.name} surcharge`}
                  value={values[`st-${s.id}`] ?? ""}
                  error={errors[`st-${s.id}`]}
                  onChange={set(`st-${s.id}`)}
                />
              ))}
            </fieldset>
            <Field id="window" type="number" label="Cancellation window (hours)" value={values.window ?? ""} error={errors.window} onChange={set("window")} />
            <Field id="pack" label="Pack price" value={values.pack ?? ""} error={errors.pack} onChange={set("pack")} />
            <button type="submit" className="primary" disabled={pending === "card"}>
              Add rate card
            </button>
          </form>
        </>
      )}
    </Page>
  );
}
