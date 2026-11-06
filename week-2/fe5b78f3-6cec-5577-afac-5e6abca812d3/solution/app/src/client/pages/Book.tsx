// Booking (`/book?...`): passengers, party options, the coach plan preference picker, live fare and Confirm and pay.
// The unsent draft lives in this tab's sessionStorage until a 201 or sign-out, so an ended session loses nothing.
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { type FocusEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Accept, BerthPreference, Booking, BookingRequest, ClassCode, ClassEntry, CoachPlanBody, FareQuote, Gender, Quota, TrainResult } from "../../shared/api";
import { formatInr, istTime, longDate } from "../../shared/format";
import { CoachPlan } from "../components/CoachPlan";
import { Modal } from "../components/Modal";
import { useRibbon } from "../components/Shell";
import { ApiFailure, api, newIdempotencyKey } from "../lib/api";
import { type DraftPassenger, clearDraft, loadDraft, saveDraft } from "../lib/draft";
import { useLayout } from "../lib/media";
import { Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { useStationNames } from "../lib/stations";
import { QUOTA_LABEL } from "./Search";

const GENDERS: [Gender, string][] = [["M", "Male"], ["F", "Female"], ["T", "Transgender"]];
const PREFERENCES: [BerthPreference, string][] = [
  ["NONE", "No preference"], ["LB", "Lower"], ["MB", "Middle"], ["UB", "Upper"], ["SL", "Side lower"], ["SU", "Side upper"],
];
const MAX_GROUPS = 8;

const blank = (): DraftPassenger => ({ name: "", age: "", gender: "", preference: "NONE", preferredBerth: null });
const validAge = (age: string): boolean => /^\d{1,3}$/.test(age) && Number(age) <= 125;

function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
}

/** The best status the fare panel's label offers the whole party (brief: Accepted status on Pay). */
function acceptFor(entry: ClassEntry | null, quota: Quota, adults: number): Accept {
  if (quota === "LD" || quota === "SS" || !entry) return "CNF";
  if (entry.avl >= adults) return "CNF";
  if (quota === "GN" && entry.avl + (entry.rac ?? 0) >= adults) return "RAC";
  return "WL";
}

function problemCopy(error: ApiFailure, quota: Quota): string {
  const body = error.body;
  switch (error.code) {
    case "availability_changed":
      return `Availability changed before you paid. Nothing was charged. Now available: ${body?.offer?.label ?? ""}.`;
    case "waitlist_full":
      return "The waiting list for this train is full. Nothing was booked or charged.";
    case "party_split":
      return "Party could not be kept in one coach. Nothing was booked or charged.";
    case "no_lower_berth":
      return "No lower berth could be allotted. Nothing was booked or charged.";
    case "quota_full":
      return `Not enough ${QUOTA_LABEL[quota]} quota berths are left. Nothing was booked or charged.`;
    case "booking_not_open":
      return `Bookings for this train open on ${longDate(body?.opens_at ?? "")}.`;
    case "tatkal_not_open":
      return `Tatkal opens at ${istTime(body?.opens_at ?? "")} IST on ${longDate(body?.opens_at ?? "")}.`;
    case "chart_prepared":
      return "The chart for this train is prepared. Bookings are closed.";
    case "payment_unavailable":
      return "Payments are down right now. Nothing was charged and no berth is held. Try again in a few minutes.";
    case "ticket_storage_unavailable":
      return "E-tickets can't be saved right now. Nothing was charged and no berth is held. Try again in a few minutes.";
    default:
      return error.status === 0 ? "Can't reach Pakka right now. Check My bookings before you pay again." : (body?.message ?? "Something went wrong.");
  }
}

function fieldId(key: string): string {
  const m = /^passengers\[(\d+)\]\.(\w+)$/.exec(key);
  if (m) return `p${m[1]}-${m[2] === "berth_preference" ? "pref" : m[2]}`;
  return key === "passengers" ? "add-passenger" : key === "contact_phone" ? "contact-phone" : "form-problems";
}

export function Book() {
  const { search, path } = useLocation();
  const { account } = useSession();
  const layout = useLayout();
  const train = search.get("train") ?? "";
  const runDate = search.get("run_date") ?? "";
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const cls: ClassCode = search.get("class") === "3A" ? "3A" : "SL";
  const quota = (["GN", "TQ", "LD", "SS"].find((q) => q === search.get("quota")) ?? "GN") as Quota;

  const restored = useRef(loadDraft(path));
  const [passengers, setPassengers] = useState<DraftPassenger[]>(restored.current?.passengers ?? [blank()]);
  const [keep, setKeep] = useState(restored.current?.keepInOneCoach ?? false);
  const [lower, setLower] = useState(restored.current?.lowerBerthOnly ?? false);
  const [phone, setPhone] = useState(restored.current?.phone ?? "");
  const [choosing, setChoosing] = useState(0);
  const [coach, setCoach] = useState("");
  const [plan, setPlan] = useState<CoachPlanBody | null>(null);
  const [trainInfo, setTrainInfo] = useState<TrainResult | null>(null);
  const [entry, setEntry] = useState<ClassEntry | null>(null);
  const [quote, setQuote] = useState<FareQuote | null>(null);
  const [flash, setFlash] = useState(false);
  const [problem, setProblem] = useState("");
  const [offer, setOffer] = useState<{ accept: Accept; label: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const payButton = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const quoteSeq = useRef(0);

  useEffect(() => {
    if (account === null) navigate(`/signin?next=${encodeURIComponent(path)}`, { replace: true });
  }, [account, path]);

  useEffect(() => {
    if (account && !restored.current) setPhone((p) => p || account.phone);
  }, [account]);

  useEffect(() => {
    if (Object.keys(errors).length) summaryRef.current?.focus();
  }, [errors]);

  const restoreFocused = useRef(false);
  useEffect(() => {
    if (!restored.current || !account || restoreFocused.current) return;
    restoreFocused.current = true;
    reviewButton.current?.focus();
  }, [account]);

  useEffect(() => {
    saveDraft(path, { passengers, keepInOneCoach: keep, lowerBerthOnly: lower, phone });
  }, [path, passengers, keep, lower, phone]);

  const refreshAvailability = useCallback(async (): Promise<void> => {
    for (const date of [runDate, nextDate(runDate)]) {
      const body = await api<{ trains: TrainResult[] }>(`/api/trains?from=${from}&to=${to}&date=${date}&quota=${quota}&class=${cls}`).catch(() => null);
      const found = body?.trains.find((t) => t.number === train && t.run_date === runDate);
      if (found) {
        setTrainInfo(found);
        setEntry(found.classes[0] ?? null);
        return;
      }
    }
  }, [train, runDate, from, to, quota, cls]);

  const refreshPlan = useCallback(async (): Promise<void> => {
    const body = await api<CoachPlanBody>(`/api/trains/${train}/runs/${runDate}/coaches?class=${cls}&from=${from}&to=${to}`).catch(() => null);
    if (!body) return;
    setPlan(body);
    setCoach((c) => c || (body.coaches[0]?.coach ?? ""));
  }, [train, runDate, cls, from, to]);

  useEffect(() => {
    void refreshAvailability();
    void refreshPlan();
  }, [refreshAvailability, refreshPlan]);

  const ages = passengers.map((p) => p.age).join(",");
  useEffect(() => {
    const list = ages.split(",");
    if (!list.every(validAge)) {
      quoteSeq.current++;
      setQuote(null);
      return;
    }
    const mine = ++quoteSeq.current;
    api<FareQuote>("/api/fare-quote", {
      method: "POST",
      body: { train, run_date: runDate, from, to, class: cls, quota, passengers: list.map((a) => ({ age: Number(a) })) },
    }).then(
      (q) => {
        if (mine !== quoteSeq.current) return;
        setQuote((old) => {
          if (old && old.total_paise !== q.total_paise) setFlash(true);
          return q;
        });
      },
      () => undefined,
    );
  }, [ages, train, runDate, from, to, cls, quota]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(false), 60);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const stationName = useStationNames();
  const ribbonStops = trainInfo
    ? trainInfo.stops.map((s) => ({ code: s.code, name: s.name, at: s.departure_at, end: s.code === from || s.code === to }))
    : [{ code: from, name: stationName(from), end: true }, { code: to, name: stationName(to), end: true }];
  useRibbon(ribbonStops);

  /** Any change to a passenger, an option or the mobile number clears a standing booking problem. */
  const acted = (): void => {
    setProblem("");
    setOffer(null);
  };
  const update = (index: number, patch: Partial<DraftPassenger>): void => {
    acted();
    setPassengers((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const adults = passengers.filter((p) => validAge(p.age) && Number(p.age) >= 5).length;

  const request = (accept: Accept): BookingRequest => ({
    train,
    run_date: runDate,
    from,
    to,
    class: cls,
    quota,
    passengers: passengers.map((p) => ({ name: p.name, age: validAge(p.age) ? Number(p.age) : -1, gender: p.gender, berth_preference: p.preference })),
    keep_in_one_coach: keep,
    lower_berth_only: lower,
    accept,
    contact_phone: phone,
  });

  const pay = async (accept: Accept): Promise<void> => {
    if (payingRef.current) return;
    payingRef.current = true;
    setPaying(true);
    const key = newIdempotencyKey();
    const body = request(accept);
    try {
      let booking: Booking;
      try {
        booking = await api<Booking>("/api/bookings", { method: "POST", body, idempotencyKey: key });
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.status !== 0) throw error;
        booking = await api<Booking>("/api/bookings", { method: "POST", body, idempotencyKey: key });
      }
      clearDraft(path);
      navigate(`/bookings/${booking.pnr}`, { state: { booked: booking.pnr } });
    } catch (error) {
      setDialogOpen(false);
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 401) {
        navigate(`/signin?next=${encodeURIComponent(path)}`, { state: { sessionEnded: true } });
      } else if (error.status === 422) {
        setErrors(error.body?.errors ?? {});
      } else {
        setProblem(problemCopy(error, quota));
        setOffer(error.code === "availability_changed" ? (error.body?.offer ?? null) : null);
        void refreshAvailability();
        void refreshPlan();
      }
    } finally {
      payingRef.current = false;
      setPaying(false);
    }
  };

  const keepAboveBar = (event: FocusEvent<HTMLElement>): void => {
    if (layout !== "phone" || !barRef.current) return;
    const box = event.target.getBoundingClientRect();
    const barTop = barRef.current.getBoundingClientRect().top;
    if (box.bottom > barTop - 8) window.scrollBy({ top: box.bottom - barTop + 16, behavior: "instant" });
    else if (box.top < 0) window.scrollBy({ top: box.top - 16, behavior: "instant" });
  };

  if (!account) return <p className="muted">Checking your session</p>;
  const total = quote?.total_paise;
  const shownCoach = coach || plan?.coaches[0]?.coach || "";

  const form = (
    <div className="stack" onFocus={keepAboveBar}>
      {Object.keys(errors).length ? (
        <div className="problems" role="alert" aria-label="Form problems" tabIndex={-1} ref={summaryRef} id="form-problems">
          <h2>Check these fields</h2>
          <ul>
            {Object.entries(errors).map(([key, message]) => (
              <li key={key}>
                <a
                  href={`#${fieldId(key)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(fieldId(key))?.focus();
                  }}
                >
                  {key.startsWith("passengers[") ? `Passenger ${Number(/\[(\d+)\]/.exec(key)?.[1] ?? 0) + 1}: ${message}` : message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {passengers.map((p, i) => {
        const err = (field: string): string | undefined => errors[`passengers[${i}].${field}`];
        const describedBy = (field: string): string | undefined => (err(field) ? `p${i}-${field}-error` : undefined);
        return (
          <fieldset key={i} className="passenger-group">
            <legend>{`Passenger ${i + 1}`}</legend>
            <div className="field">
              <label htmlFor={`p${i}-name`}>Name</label>
              <input id={`p${i}-name`} value={p.name} autoComplete="off" onChange={(e) => update(i, { name: e.target.value })} aria-invalid={err("name") ? true : undefined} aria-describedby={describedBy("name")} />
              {err("name") ? <span className="field-error" id={`p${i}-name-error`}>{err("name")}</span> : null}
            </div>
            <div className="field">
              <label htmlFor={`p${i}-age`}>Age</label>
              <input id={`p${i}-age`} type="number" inputMode="numeric" min={0} max={125} value={p.age} onChange={(e) => update(i, { age: e.target.value })} aria-invalid={err("age") ? true : undefined} aria-describedby={describedBy("age")} />
              {err("age") ? <span className="field-error" id={`p${i}-age-error`}>{err("age")}</span> : null}
            </div>
            <div className="field">
              <label htmlFor={`p${i}-gender`}>Gender</label>
              <select id={`p${i}-gender`} value={p.gender} onChange={(e) => update(i, { gender: e.target.value as Gender })} aria-invalid={err("gender") ? true : undefined} aria-describedby={describedBy("gender")}>
                <option value="" disabled>
                  Choose
                </option>
                {GENDERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {err("gender") ? <span className="field-error" id={`p${i}-gender-error`}>{err("gender")}</span> : null}
            </div>
            <div className="field">
              <label htmlFor={`p${i}-pref`}>Berth preference</label>
              <select id={`p${i}-pref`} value={p.preference} onChange={(e) => update(i, { preference: e.target.value as BerthPreference, preferredBerth: null })}>
                {PREFERENCES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="button ghost remove"
              disabled={passengers.length === 1}
              onClick={() => {
                acted();
                setPassengers((list) => list.filter((_, j) => j !== i));
                setChoosing((c) => (c >= passengers.length - 1 ? Math.max(0, c - 1) : c));
              }}
            >
              <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              {`Remove passenger ${i + 1}`}
            </button>
            {validAge(p.age) && Number(p.age) < 5 ? <p className="small muted">Under five: travels without a berth, no fare.</p> : null}
          </fieldset>
        );
      })}
      <div>
        <button
          type="button"
          id="add-passenger"
          className="button"
          disabled={passengers.length >= MAX_GROUPS}
          onClick={() => {
            acted();
            setPassengers((list) => [...list, blank()]);
          }}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Add passenger
        </button>
        {errors.passengers ? <p className="field-error">{errors.passengers}</p> : null}
      </div>
      <div className="panel stack">
        <label className="check">
          <input type="checkbox" checked={keep} onChange={(e) => { acted(); setKeep(e.target.checked); }} />
          Keep party in one coach
        </label>
        <label className="check">
          <input type="checkbox" checked={lower} onChange={(e) => { acted(); setLower(e.target.checked); }} />
          Book only if a lower berth is allotted
        </label>
        <div className="field">
          <label htmlFor="contact-phone">Mobile number</label>
          <input id="contact-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => { acted(); setPhone(e.target.value.trim()); }} aria-invalid={errors.contact_phone ? true : undefined} aria-describedby={errors.contact_phone ? "contact-phone-error" : undefined} />
          {errors.contact_phone ? <span className="field-error" id="contact-phone-error">{errors.contact_phone}</span> : null}
        </div>
      </div>
    </div>
  );

  const picker = (
    <section className="panel stack" aria-labelledby="picker-title">
      <h2 id="picker-title">Coach plan</h2>
      <div className="stack">
        <span className="legend" id="choosing-label">Choosing for</span>
        <div className="choices" role="radiogroup" aria-labelledby="choosing-label">
          {passengers.map((_, i) => (
            <label key={i} className="choice">
              <input type="radio" name="choosing-for" checked={choosing === i} onChange={() => setChoosing(i)} />
              {`Passenger ${i + 1}`}
            </label>
          ))}
        </div>
      </div>
      {plan ? (
        <CoachPlan
          coaches={plan.coaches}
          vertical={layout === "phone"}
          selected={shownCoach}
          onSelect={setCoach}
          mark={(c, berth) => {
            const by = passengers.flatMap((p, i) => (p.preferredBerth?.coach === c && p.preferredBerth.berth === berth ? [i + 1] : []));
            return { preferredBy: by, tags: by.map((n) => `preferred by passenger ${n}`) };
          }}
          onActivate={(c, berth, type) => update(Math.min(choosing, passengers.length - 1), { preference: type, preferredBerth: { coach: c, berth } })}
        />
      ) : (
        <p className="small muted">Coach plan loading</p>
      )}
      <p className="note small">Preferences guide allotment. The exact berth is allotted when you pay.</p>
    </section>
  );

  const fare = (
    <section className="panel stack" aria-labelledby="fare-title">
      <div className="panel-title">
        <h2 id="fare-title">Fare</h2>
        <span className="availability" role="status" aria-label="Fare availability">
          {entry?.label ?? ""}
        </span>
      </div>
      <ul className="plain fare-lines" aria-label="Fare lines">
        {(quote?.lines ?? []).map((line) => (
          <li key={line.label}>
            <span>{line.label}</span>
            <span className="money">{formatInr(line.amount_paise)}</span>
          </li>
        ))}
      </ul>
      {quote ? null : <p className="small muted">Enter each passenger's age to see the fare.</p>}
      <p className={`fare-total${flash ? " changed" : ""}`} role="status" aria-label="Fare total">
        {total === undefined ? "" : `Total ${formatInr(total)}`}
      </p>
      <div role="alert" aria-label="Booking problem" className="alert-region">
        {problem}
      </div>
      {problem ? (
        <div className="row">
          {offer ? (
            <button type="button" className="button primary" onClick={() => { acted(); void pay(offer.accept); }}>
              {`Book at ${offer.label}`}
            </button>
          ) : null}
          <Link href={`/trains?from=${from}&to=${to}&date=${trainInfo ? trainInfo.from.departure_at.slice(0, 10) : runDate}&quota=${quota}&class=${cls}`}>Change search</Link>
        </div>
      ) : null}
      <p className="status-line" role="status" aria-label="Booking result">
        {paying ? "Processing payment" : ""}
      </p>
      <div className="pay-bar" ref={barRef}>
        <span className="money" aria-hidden="true">{total === undefined ? "" : formatInr(total)}</span>
        <button
          ref={reviewButton}
          type="button"
          className="button primary"
          aria-disabled={quote === null || paying}
          onClick={() => {
            if (quote === null || paying) return;
            acted();
            setErrors({});
            setDialogOpen(true);
          }}
        >
          Review and pay
        </button>
      </div>
    </section>
  );

  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="book-title">
        <div className="panel-title">
          <h1 id="book-title">{trainInfo ? `Book ${trainInfo.number} ${trainInfo.name}` : `Book ${train}`}</h1>
          <span className="kicker">{`${cls} · ${QUOTA_LABEL[quota]}`}</span>
        </div>
        <p className="small">
          <span className="mono">{`${from} → ${to}`}</span> · run of {runDate ? longDate(runDate) : ""}
          {trainInfo ? ` · departs ${istTime(trainInfo.from.departure_at)} IST · chart at ${istTime(trainInfo.chart_at)} IST, ${longDate(trainInfo.chart_at)}` : ""}
        </p>
      </section>
      <div className={`book ${layout}`}>
        {layout === "tablet" ? (
          <>
            {form}
            <div className="col-plan">
              {picker}
              {fare}
            </div>
          </>
        ) : (
          <>
            {form}
            {picker}
            {fare}
          </>
        )}
      </div>
      <Modal open={dialogOpen} label="Confirm and pay" onClose={() => setDialogOpen(false)} initialFocus={payButton} opener={reviewButton}>
        <h2>Confirm and pay</h2>
        <p className="small">
          {`${train}${trainInfo ? ` ${trainInfo.name}` : ""} · ${from} → ${to} · ${cls} · ${QUOTA_LABEL[quota]}`}
        </p>
        <ul className="plain fare-lines">
          {(quote?.lines ?? []).map((line) => (
            <li key={line.label}>
              <span>{line.label}</span>
              <span className="money">{formatInr(line.amount_paise)}</span>
            </li>
          ))}
        </ul>
        <p className="small">
          <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" /> {`Availability now: ${entry?.label ?? "checking"}. You accept ${acceptFor(entry, quota, adults)} or better for every passenger.`}
        </p>
        <div className="actions">
          <button type="button" className="button" onClick={() => setDialogOpen(false)}>
            Back
          </button>
          <button ref={payButton} type="button" className="button primary" disabled={paying} onClick={() => void pay(acceptFor(entry, quota, adults))}>
            {`Pay ${total === undefined ? "" : formatInr(total)}`}
          </button>
        </div>
      </Modal>
    </div>
  );
}
