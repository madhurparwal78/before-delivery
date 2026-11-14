import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, call, messageOf } from "../api";
import { serverNow } from "../clock";
import { ErrorBand, FieldBand } from "../components/Feedback";
import { clubToday } from "../format";
import { addDays, clubDateTime, validDay } from "../format";
import { navigate, useLocation } from "../router";

/** Who saved a settings version, from their token, and when; `saved_by` is null for a seed version. */
interface Attribution {
  saved_by: { username: string; name: string } | null;
  saved_at: string;
}

/** `Seed`, or the saver's name. */
function savedBy(entry: Attribution): string {
  return entry.saved_by?.name ?? "Seed";
}

interface PricingVersion extends Attribution {
  version: number;
  effective_from: string;
  offpeak_cents_per_minute: number;
  peak_cents_per_minute: number;
  peak_start: string;
  peak_end: string;
  peak_days: string[];
}

interface Pricing extends PricingVersion {
  schedule: PricingVersion[];
}

interface Rule extends Attribution {
  version: number;
  late_fee_percent: number;
  description: string;
}

interface UtilisationRow {
  court: number;
  booked_minutes: number;
  open_minutes: number;
  percent: number;
}

interface Utilisation {
  date: string;
  courts: UtilisationRow[];
  total: { booked_minutes: number; open_minutes: number; percent: number };
}

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dateMessage = "Use a date like 2027-03-28.";

/** What a save sends and what a form shows; `version` is the one the form was loaded with. */
interface PricesDraft {
  offpeak: string;
  peak: string;
  start: string;
  end: string;
  days: string[];
  effective: string;
  version: number;
}

function draftFrom(pricing: Pricing): PricesDraft {
  return {
    offpeak: String(pricing.offpeak_cents_per_minute),
    peak: String(pricing.peak_cents_per_minute),
    start: pricing.peak_start,
    end: pricing.peak_end,
    days: pricing.peak_days,
    effective: addDays(clubToday(serverNow()), 1),
    version: pricing.version,
  };
}

/** Called once a section's first answer (or failure) is in, so the page can show every card at its full size. */
type Settled = (part: string) => void;

function PricesForm({ onSettled }: { onSettled: Settled }) {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [draft, setDraft] = useState<PricesDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const body = await call<Pricing>("/api/manager/pricing");
      setPricing(body);
      setDraft(draftFrom(body));
      setStale(null);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
    onSettled("prices");
  }, [onSettled]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setPending(true);
    setSaved(false);
    setError(null);
    setStale(null);
    setFields({});
    const toCents = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : text);
    try {
      const body = await call<Pricing>("/api/manager/pricing", {
        method: "PUT",
        body: {
          offpeak_cents_per_minute: toCents(draft.offpeak),
          peak_cents_per_minute: toCents(draft.peak),
          peak_start: draft.start,
          peak_end: draft.end,
          peak_days: draft.days,
          effective_from: draft.effective,
          version: draft.version,
        },
      });
      setPricing(body);
      setDraft({ ...draft, version: body.version });
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_STALE") setStale(e.message);
      else if (e instanceof ApiError && e.status === 422 && Object.keys(e.fields).length > 0) {
        setFields(e.fields);
        const first = Object.keys(e.fields)[0];
        const labels: Record<string, string> = {
          offpeak_cents_per_minute: "Off-peak cents per minute",
          peak_cents_per_minute: "Peak cents per minute",
          peak_start: "Peak starts",
          peak_end: "Peak ends",
          effective_from: "Effective from",
        };
        window.setTimeout(() => document.querySelector<HTMLElement>(`[aria-label="${labels[first] ?? "Effective from"}"]`)?.focus(), 0);
      } else setError(messageOf(e));
    } finally {
      setPending(false);
    }
  };

  const set = <K extends keyof PricesDraft>(key: K, value: PricesDraft[K]) => draft && setDraft({ ...draft, [key]: value });

  return (
    <section className="card manager-card">
      <h2>Prices</h2>
      {draft ? (
        <form aria-label="Prices" onSubmit={(e) => void submit(e)} noValidate>
          <div className="form-grid">
            <div className="field">
              <label className="field__label">
                <span>Off-peak cents per minute</span>
                <input type="number" value={draft.offpeak} aria-label="Off-peak cents per minute" onChange={(e) => set("offpeak", e.target.value)} />
              </label>
              {fields.offpeak_cents_per_minute && <FieldBand id="p-off">{fields.offpeak_cents_per_minute}</FieldBand>}
            </div>
            <div className="field">
              <label className="field__label">
                <span>Peak cents per minute</span>
                <input type="number" value={draft.peak} aria-label="Peak cents per minute" onChange={(e) => set("peak", e.target.value)} />
              </label>
              {fields.peak_cents_per_minute && <FieldBand id="p-peak">{fields.peak_cents_per_minute}</FieldBand>}
            </div>
            <div className="field">
              <label className="field__label">
                <span>Peak starts</span>
                <input type="text" value={draft.start} aria-label="Peak starts" onChange={(e) => set("start", e.target.value)} />
              </label>
              {fields.peak_start && <FieldBand id="p-start">{fields.peak_start}</FieldBand>}
            </div>
            <div className="field">
              <label className="field__label">
                <span>Peak ends</span>
                <input type="text" value={draft.end} aria-label="Peak ends" onChange={(e) => set("end", e.target.value)} />
              </label>
            </div>
          </div>
          <div className="field">
            <div className="chips" role="group" aria-label="Peak days">
              {days.map((day, i) => (
                <label key={day} className="chip">
                  <input
                    type="checkbox"
                    checked={draft.days.includes(day)}
                    onChange={(e) => set("days", e.target.checked ? days.filter((d) => d === day || draft.days.includes(d)) : draft.days.filter((d) => d !== day))}
                  />
                  <span>{dayLabels[i]}</span>
                </label>
              ))}
            </div>
            {fields.peak_days && <FieldBand id="p-days">{fields.peak_days}</FieldBand>}
          </div>
          <div className="field">
            <label className="field__label">
              <span>Effective from</span>
              <input type="text" inputMode="numeric" value={draft.effective} aria-label="Effective from" onChange={(e) => set("effective", e.target.value)} />
            </label>
            {fields.effective_from && <FieldBand id="p-eff">{fields.effective_from}</FieldBand>}
          </div>
          {stale && (
            <div className="stale">
              <ErrorBand>{stale}</ErrorBand>
              <button type="button" className="pill pill--outline" onClick={() => void load()}>
                Reload
              </button>
            </div>
          )}
          {error && <ErrorBand>{error}</ErrorBand>}
          <div className="form-actions">
            <button type="submit" className="pill pill--cobalt" disabled={pending}>
              {pending ? "Saving..." : "Save prices"}
            </button>
            {saved && <span className="saved">Saved.</span>}
          </div>
        </form>
      ) : (
        error && <ErrorBand>{error}</ErrorBand>
      )}
      {pricing && (
        <div className="table-card table-card--inner" tabIndex={0}>
          <table role="table" aria-label="Price schedule" className="data-table data-table--schedule">
            <thead>
              <tr role="row">
                <th role="columnheader">Version</th>
                <th role="columnheader">From</th>
                <th role="columnheader">Off-peak</th>
                <th role="columnheader">Peak</th>
                <th role="columnheader">Saved by</th>
                <th role="columnheader">Saved at</th>
              </tr>
            </thead>
            <tbody>
              {pricing.schedule.map((v) => (
                <tr role="row" key={v.version}>
                  <td role="cell" data-label="Version">{v.version}</td>
                  <td role="cell" data-label="From">{v.effective_from}</td>
                  <td role="cell" data-label="Off-peak">{v.offpeak_cents_per_minute}</td>
                  <td role="cell" data-label="Peak">{v.peak_cents_per_minute}</td>
                  <td role="cell" data-label="Saved by">{savedBy(v)}</td>
                  <td role="cell" data-label="Saved at">{clubDateTime(v.saved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RuleForm({ onSettled }: { onSettled: Settled }) {
  const [rule, setRule] = useState<Rule | null>(null);
  const [percent, setPercent] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const body = await call<Rule>("/api/manager/cancellation-rule");
      setRule(body);
      setPercent(String(body.late_fee_percent));
      setDescription(body.description);
      setStale(null);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
    onSettled("rule");
  }, [onSettled]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!rule) return;
    setPending(true);
    setSaved(false);
    setError(null);
    setStale(null);
    setFields({});
    try {
      const body = await call<Rule>("/api/manager/cancellation-rule", {
        method: "PUT",
        body: { late_fee_percent: /^\d+$/.test(percent.trim()) ? Number(percent) : percent, description, version: rule.version },
      });
      setRule(body);
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_STALE") setStale(e.message);
      else if (e instanceof ApiError && e.status === 422 && Object.keys(e.fields).length > 0) setFields(e.fields);
      else setError(messageOf(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card manager-card">
      <h2>Cancellation rule</h2>
      {rule ? (
        <form aria-label="Cancellation rule" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label className="field__label">
              <span>Late fee percent</span>
              <input type="number" value={percent} aria-label="Late fee percent" onChange={(e) => setPercent(e.target.value)} />
            </label>
            {fields.late_fee_percent && <FieldBand id="r-pct">{fields.late_fee_percent}</FieldBand>}
          </div>
          <div className="field">
            <label className="field__label">
              <span>Rule description</span>
              <textarea rows={4} value={description} aria-label="Rule description" onChange={(e) => setDescription(e.target.value)} />
              <span className="field__counter">{[...description].length}/280</span>
            </label>
            {fields.description && <FieldBand id="r-desc">{fields.description}</FieldBand>}
          </div>
          <p className="muted saved-line">
            Last saved by {savedBy(rule)}, {clubDateTime(rule.saved_at)}.
          </p>
          {stale && (
            <div className="stale">
              <ErrorBand>{stale}</ErrorBand>
              <button type="button" className="pill pill--outline" onClick={() => void load()}>
                Reload
              </button>
            </div>
          )}
          {error && <ErrorBand>{error}</ErrorBand>}
          <div className="form-actions">
            <button type="submit" className="pill pill--cobalt" disabled={pending}>
              {pending ? "Saving..." : "Save rule"}
            </button>
            {saved && <span className="saved">Saved.</span>}
          </div>
        </form>
      ) : (
        error && <ErrorBand>{error}</ErrorBand>
      )}
    </section>
  );
}

function UtilisationSection({ onSettled }: { onSettled: Settled }) {
  const { search } = useLocation();
  const asked = search.get("date");
  const valid = asked !== null && validDay(asked);
  const [text, setText] = useState(valid ? (asked as string) : "");
  const [figures, setFigures] = useState<Utilisation | null>(null);
  const [dateError, setDateError] = useState(asked !== null && !valid ? dateMessage : "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const query = valid ? `?date=${asked}` : "";
    setDateError(asked !== null && !valid ? dateMessage : "");
    call<Utilisation>(`/api/manager/utilisation${query}`)
      .then((body) => {
        if (!live) return;
        setFigures(body);
        setText(valid ? (asked as string) : body.date);
        setError(null);
      })
      .catch((e: unknown) => live && setError(messageOf(e)))
      .finally(() => onSettled("utilisation"));
    return () => {
      live = false;
    };
  }, [asked, valid, onSettled]);

  const commit = () => {
    if (validDay(text)) {
      setDateError("");
      navigate(`/manager?date=${text}`);
    } else setDateError(dateMessage);
  };

  return (
    <section className="card manager-card manager-card--wide">
      <h2>Utilisation</h2>
      <div className="field field--inline">
        <label className="field__label">
          <span>Utilisation date</span>
          <input
            type="text"
            inputMode="numeric"
            value={text}
            aria-label="Utilisation date"
            aria-invalid={dateError ? true : undefined}
            maxLength={10}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
        </label>
        {dateError && <FieldBand id="u-date">{dateError}</FieldBand>}
      </div>
      {error && <ErrorBand>{error}</ErrorBand>}
      {figures && (
        <div className="table-card table-card--inner" tabIndex={0}>
          <table role="table" aria-label="Utilisation" className="data-table">
            <thead>
              <tr role="row">
                <th role="columnheader">Court</th>
                <th role="columnheader">Booked minutes</th>
                <th role="columnheader">Open minutes</th>
                <th role="columnheader">Used</th>
              </tr>
            </thead>
            <tbody>
              {figures.courts.map((row) => (
                <tr role="row" key={row.court}>
                  <td role="cell">{row.court}</td>
                  <td role="cell">{row.booked_minutes}</td>
                  <td role="cell">{row.open_minutes}</td>
                  <td role="cell">{row.percent}%</td>
                </tr>
              ))}
              <tr role="row">
                <td role="cell">All courts</td>
                <td role="cell">{figures.total.booked_minutes}</td>
                <td role="cell">{figures.total.open_minutes}</td>
                <td role="cell">{figures.total.percent}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const sections = 3;

export function Manager() {
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const onSettled = useCallback(
    (part: string) => setSettled((done) => (done.has(part) ? done : new Set(done).add(part))),
    [],
  );
  const ready = settled.size === sections;
  return (
    <div className="page">
      <div className="column">
        <h1 className="page__title">Club settings</h1>
        {!ready && <p className="visually-hidden">Loading…</p>}
        {/* The cards stay out of the layout until all three have their first answer, so none grows under the reader. */}
        <div hidden={!ready}>
          <div className="manager-grid">
            <PricesForm onSettled={onSettled} />
            <RuleForm onSettled={onSettled} />
          </div>
          <UtilisationSection onSettled={onSettled} />
        </div>
      </div>
    </div>
  );
}
