import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Booking, Hold, Quote, ScreeningDetail } from "../../shared/api.ts";
import { compareSeats, FARE_LABELS, formatMoney, UPLIFT_PRESETS, type Fare } from "../../shared/domain.ts";
import { defaultFares, offeredFares } from "../../shared/fares.ts";
import { api, newIdempotencyKey } from "../api.ts";
import { billingDown, useApp } from "../context.tsx";
import { dollarsToCents, localDate, localTime } from "../i18n.ts";
import { StepUp } from "../stepup.tsx";
import { Field, Num, withNum, OptionMenu, PriceSummary, RadioCards } from "../ui.tsx";

type Payer = { name: string; seats: string };
type UpliftChoice = "200" | "500" | "1000" | "other";

export const CONFIRMED_KEY = "halide-confirmed";

function countdown(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CheckoutPage({ holdId }: { holdId: string }) {
  const ctx = useApp();
  const { locale, t, me, navigate } = ctx;
  const [hold, setHold] = useState<Hold | null | undefined>(undefined);
  const [screening, setScreening] = useState<ScreeningDetail | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const [fares, setFares] = useState<Record<string, Fare>>({});
  const [upliftOn, setUpliftOn] = useState(false);
  const [upliftChoice, setUpliftChoice] = useState<UpliftChoice>("500");
  const [otherText, setOtherText] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [note, setNote] = useState("");
  const [cardholder, setCardholder] = useState("");
  const [stepupOpen, setStepupOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const key = useRef(newIdempotencyKey()).current;
  const payRef = useRef<HTMLButtonElement>(null);
  const offset = useRef(0);

  const seats = hold ? [...hold.seats].sort(compareSeats) : [];
  const memberTier = me?.membership ? me.membership.tier : null;
  const signedIn = Boolean(me);

  const upliftCents = (): number | null => {
    if (!upliftOn) return 0;
    if (upliftChoice !== "other") return Number(upliftChoice);
    if (!otherText.trim()) return null;
    return dollarsToCents(otherText) ?? -1;
  };

  const requestQuote = async (nextFares: Record<string, Fare>, uplift: number | null): Promise<Quote | null> => {
    if (uplift === null) return null;
    const r = await api<{ quote: Quote }>("POST", `/api/holds/${encodeURIComponent(holdId)}/quote`, { fares: nextFares, uplift_cents: uplift });
    if (r.ok) {
      setQuote(r.data.quote);
      setFields({});
      setError("");
      return r.data.quote;
    }
    setFields(r.error.fields ?? {});
    setError(r.error.message);
    if (r.error.code === "hold_expired") setExpired(true);
    return null;
  };

  useLayoutEffect(() => {
    void api<{ hold: Hold }>("GET", `/api/holds/${encodeURIComponent(holdId)}`).then((r) => {
      if (!r.ok) {
        setHold(null);
        return;
      }
      const loaded = r.data.hold;
      offset.current = Date.parse(loaded.server_time) - Date.now();
      setHold(loaded);
      if (loaded.state === "expired") setExpired(true);
      if (loaded.group) {
        const half = Math.floor(loaded.seats.length / 2);
        setPayers([{ name: "", seats: String(loaded.seats.length - half) }, { name: "", seats: String(half) }]);
      }
      void api<{ screening: ScreeningDetail }>("GET", `/api/screenings/${encodeURIComponent(loaded.screening_id)}`).then((s) => {
        if (s.ok) setScreening(s.data.screening);
      });
    });
  }, []);

  /** Countdown (brief: Seat holds): expires_at minus browser time plus the offset learned once from server_time. */
  useLayoutEffect(() => {
    if (!hold) return;
    const tick = () => {
      const left = Math.floor((Date.parse(hold.expires_at) - (Date.now() + offset.current)) / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0) setExpired(true);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [hold]);

  /** Default fares once the hold and the session are known, then the first quote. */
  useLayoutEffect(() => {
    if (!hold || me === undefined || hold.state !== "held") return;
    const initial = defaultFares(hold.seats, memberTier, hold.group);
    setFares(initial);
    void requestQuote(initial, 0);
  }, [hold, me === undefined]);

  if (hold === undefined) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.checkout}</h1><p class="muted">{t.loading}</p></section>;
  if (hold === null) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.notFound}</h1></section>;

  const changeFare = (seat: string, fare: Fare) => {
    const next = { ...fares, [seat]: fare };
    setFares(next);
    void requestQuote(next, upliftCents());
  };
  const toggleUplift = () => {
    const on = !upliftOn;
    setUpliftOn(on);
    setUpliftChoice("500");
    void requestQuote(fares, on ? 500 : 0);
  };
  const chooseUplift = (choice: UpliftChoice) => {
    setUpliftChoice(choice);
    if (choice !== "other") void requestQuote(fares, Number(choice));
    else if (otherText.trim()) void requestQuote(fares, dollarsToCents(otherText) ?? -1);
  };

  const payerTotal = payers.reduce((sum, p) => sum + (Number.parseInt(p.seats, 10) || 0), 0);
  const splitMismatch = hold.group && payerTotal !== hold.seats.length;
  const payNow = quote?.pay_now_cents ?? 0;
  const payDisabled =
    paying || !quote || expired || quote.stepup_required || (payNow > 0 && !cardholder.trim()) ||
    (!signedIn && (!guestName.trim() || !guestEmail.trim())) || billingDown(ctx) || splitMismatch;
  const payLabel = paying ? t.payPending : payNow > 0 ? withNum(t.pay(formatMoney(payNow, locale)), [formatMoney(payNow, locale)]) : t.confirmBooking;

  const pay = async () => {
    setPaying(true);
    setStatus(t.payPending);
    setError("");
    setFields({});
    const body: Record<string, unknown> = { hold_id: hold.id, fares, uplift_cents: upliftCents() ?? 0, cardholder_name: cardholder, note };
    if (!signedIn) body["guest"] = { name: guestName, email: guestEmail, ...(guestPhone.trim() ? { phone: guestPhone } : {}) };
    if (hold.group) body["split"] = payers.map((p) => ({ name: p.name, seats: Number.parseInt(p.seats, 10) || 0 }));
    const r = await api<{ booking: Booking; guest_link: string | null }>("POST", "/api/checkout", body, { "Idempotency-Key": key });
    if (r.ok) {
      sessionStorage.setItem(CONFIRMED_KEY, JSON.stringify({ ref: r.data.booking.ref, email: signedIn ? me?.email ?? "" : guestEmail }));
      navigate(r.data.guest_link ?? `/${locale}/account/bookings/${encodeURIComponent(r.data.booking.ref)}`);
      return;
    }
    setPaying(false);
    setStatus("");
    setError(r.error.message);
    setFields(r.error.fields ?? {});
    if (r.error.code === "hold_expired") setExpired(true);
    if (r.error.code === "stepup_required") void requestQuote(fares, upliftCents());
  };

  const release = async () => {
    setStatus(t.working);
    const r = await api<{ hold: Hold }>("DELETE", `/api/holds/${encodeURIComponent(hold.id)}`);
    if (r.ok) {
      setStatus(t.released);
      navigate(`/${locale}/screenings/${encodeURIComponent(hold.screening_id)}`);
      return;
    }
    setStatus("");
    setError(r.error.message);
    if (r.error.code === "hold_expired") setExpired(true);
  };

  return (
    <section class="page checkout-page">
      <h1 tabIndex={-1} class="page-title">{t.checkout}</h1>
      <div class="checkout-layout">
        <form class="checkout-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!payDisabled) void pay(); }}>
          <div class="hold-bar">
            <p class="hold-film">
              {screening ? <>{screening.film_title} · <Num>{localDate(screening.starts_at)} {localTime(screening.starts_at)}</Num> · <Num>{screening.auditorium.code}</Num></> : null}
            </p>
            <p class="hold-timer">
              <span role="timer" aria-label={t.holdTime} class="num timer">{remaining === null ? "" : countdown(remaining)}</span>
            </p>
          </div>

          {!hold.group ? (
            <fieldset class="form-group">
              <legend>{t.fareList}</legend>
              {seats.map((seat) => {
                const fare = fares[seat] ?? "regular";
                return (
                  <div class="fare-line" key={seat}>
                    <span class="fare-seat"><Num>{seat}</Num></span>
                    <OptionMenu openerLabel={t.fareFor(seat, FARE_LABELS[fare][locale])} listLabel={t.fareList} value={fare}
                      options={offeredFares(memberTier).map((f) => ({ value: f, label: FARE_LABELS[f][locale] }))} onChange={(f) => changeFare(seat, f)} />
                    {fields[`fares.${seat}`] ? <p class="field-error" id={`fare-error-${seat}`}>{fields[`fares.${seat}`]}</p> : null}
                  </div>
                );
              })}
            </fieldset>
          ) : (
            <p class="muted"><Num>{seats.length}</Num> × {FARE_LABELS.group[locale]} · <Num>{seats.join(", ")}</Num></p>
          )}

          <fieldset class="form-group uplift">
            <legend>{t.uplift}</legend>
            <div class="switch-row">
              <button type="button" role="switch" aria-checked={upliftOn ? "true" : "false"} class="switch" onClick={toggleUplift}>
                <span class="switch-track" aria-hidden="true"><span class="switch-thumb" /></span>
                <span class="switch-label">{t.upliftSwitch}</span>
              </button>
            </div>
            <p class="muted small">{t.upliftHint}</p>
            {upliftOn ? (
              <div class="uplift-choices">
                <RadioCards name="uplift" legend={t.upliftAmount} value={upliftChoice} onChange={chooseUplift}
                  options={[...UPLIFT_PRESETS.map((cents) => ({ value: String(cents) as UpliftChoice, label: formatMoney(cents, locale) })), { value: "other" as const, label: t.otherAmount }]} />
                {upliftChoice === "other" ? (
                  <Field label={t.otherAmountDollars} value={otherText} inputMode="decimal" onInput={setOtherText} error={fields["uplift_cents"]}
                    onBlur={() => { if (otherText.trim()) void requestQuote(fares, dollarsToCents(otherText) ?? -1); }} />
                ) : fields["uplift_cents"] ? <p class="field-error">{fields["uplift_cents"]}</p> : null}
              </div>
            ) : null}
          </fieldset>

          {hold.group ? (
            <fieldset class="form-group">
              <legend>{t.payers}</legend>
              <p class="muted small">{t.seatsToSplit(hold.seats.length)}</p>
              {payers.map((payer, i) => (
                <div class="payer-row" key={i}>
                  <Field label={t.payerName(i + 1)} value={payer.name} error={fields[`split.${i}.name`]}
                    onInput={(v) => setPayers(payers.map((p, j) => (j === i ? { ...p, name: v } : p)))} />
                  <Field label={t.payerSeats(i + 1)} type="number" min={1} max={40} value={payer.seats} error={fields[`split.${i}.seats`]}
                    onInput={(v) => setPayers(payers.map((p, j) => (j === i ? { ...p, seats: v } : p)))} />
                  {payers.length > 2 ? (
                    <button type="button" class="button ghost" onClick={() => setPayers(payers.filter((_, j) => j !== i))}>{t.removePayer(i + 1)}</button>
                  ) : null}
                </div>
              ))}
              {fields["split"] ? <p class="field-error">{fields["split"]}</p> : null}
              {payers.length < 6 ? (
                <button type="button" class="button ghost" onClick={() => setPayers([...payers, { name: "", seats: "1" }])}>{t.addPayer}</button>
              ) : null}
            </fieldset>
          ) : null}

          {!signedIn && me !== undefined ? (
            <fieldset class="form-group">
              <legend>{t.yourDetails}</legend>
              <Field label={t.fullName} value={guestName} onInput={setGuestName} autocomplete="name" error={fields["guest.name"]} />
              <Field label={t.email} type="email" value={guestEmail} onInput={setGuestEmail} autocomplete="email" error={fields["guest.email"]} />
              <Field label={t.phone} type="tel" value={guestPhone} onInput={setGuestPhone} autocomplete="tel" error={fields["guest.phone"]} />
            </fieldset>
          ) : null}

          <fieldset class="form-group">
            <legend>{t.payment}</legend>
            <Field label={t.note} value={note} onInput={setNote} error={fields["note"]} />
            <Field label={t.cardholder} value={cardholder} onInput={setCardholder} autocomplete="cc-name" error={fields["cardholder_name"]} />
          </fieldset>

          <div class="pay-actions">
            {quote?.stepup_required ? (
              <button type="button" class="button ghost" onClick={() => setStepupOpen(true)}>{t.verify}</button>
            ) : null}
            <button ref={payRef} type="submit" class="button primary pay" disabled={payDisabled}>{payLabel}</button>
            <button type="button" class="button ghost" onClick={() => void release()}>{t.release}</button>
          </div>
          <div class="feedback">
            <div role="status" aria-live="polite" aria-label={t.checkoutStatus} class="status-line">{status}</div>
            <div role="alert" aria-label={t.checkoutError} class={error || expired ? "alert-line is-shown" : "alert-line"}>
              {error ? <p>{error}</p> : expired ? <p>{t.holdExpired}</p> : null}
              {expired ? (
                <p><a href={`/${locale}/screenings/${encodeURIComponent(hold.screening_id)}`}>{t.chooseAgain}</a></p>
              ) : null}
            </div>
          </div>
        </form>

        <aside class="checkout-summary">
          <h2 class="panel-title">{t.priceSummary}</h2>
          {quote ? (
            <PriceSummary label={t.priceSummary} rows={[
              [t.admission, quote.admission_cents],
              [t.gst, quote.gst_cents],
              [t.qst, quote.qst_cents],
              [t.uplift, quote.uplift_cents ? quote.uplift_cents : null],
              [t.creditApplied, quote.credit_applied_cents ? quote.credit_applied_cents : null],
              [t.total, quote.total_cents, true],
              [t.payNow, quote.pay_now_cents, true],
            ]} />
          ) : <div class="skeleton-rows" aria-hidden="true"><span /><span /><span /><span /></div>}
        </aside>
      </div>
      <StepUp purpose="checkout" open={stepupOpen} onClose={() => setStepupOpen(false)} unlocked={payRef}
        onVerified={async () => { await requestQuote(fares, upliftCents()); }} />
    </section>
  );
}
