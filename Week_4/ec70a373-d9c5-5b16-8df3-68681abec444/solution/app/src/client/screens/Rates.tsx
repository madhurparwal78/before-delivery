// Rates: pick a site, read its effective-dated schedule, and schedule a new hourly and sales tax rate.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Rate, Site } from "../../shared/api.ts";
import { money } from "../../shared/format.ts";
import { addDays } from "../../shared/time.ts";
import { api, errorCopy } from "../api.ts";
import { useSites } from "../useSites.ts";
import { Status, useFieldErrors, useLatestRequest, useStatusRegion } from "../ui.tsx";

const RATE_STATES = { current: "Current", upcoming: "Upcoming", past: "Past" } as const;

const COPY = {
  effective_from: "The effective date must be after today in site time.",
  hourly_rate_cents: "Enter an hourly rate between $0.01 and $1,000.00.",
  tax_rate_percent: "Enter a tax rate between 0 and 25 percent with up to three decimals.",
} as const;

/** "1,234.50" or "45" → integer cents, read as text so no float touches money; null when it is not a dollar amount. */
function dollarsToCents(text: string): number | null {
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number((match[1] ?? "0").replace(/,/g, "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function Rates(): ReactNode {
  const sites = useSites();
  const [siteId, setSiteId] = useState("");
  const [rates, setRates] = useState<Rate[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [hourly, setHourly] = useState("");
  const [tax, setTax] = useState("");
  const [status, say] = useStatusRegion();
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();
  const chosen = useRef("");
  const beginLoad = useLatestRequest();

  /** Each change of site requests its schedule and makes every earlier request stale; no rows show while it is pending. */
  const chooseSite = useCallback((id: string, list: Site[]) => {
    chosen.current = id;
    setSiteId(id);
    setRates([]);
    const site = list.find((s) => s.id === id);
    if (site) setEffectiveFrom(addDays(site.local_date, 1));
    const isLatest = beginLoad();
    void api<{ rates: Rate[] }>(`/api/sites/${id}/rates`).then((result) => {
      if (isLatest() && result.ok) setRates(result.data.rates);
    });
  }, [beginLoad]);

  useEffect(() => {
    const first = sites[0];
    if (first && chosen.current === "") chooseSite(first.id, sites);
  }, [sites, chooseSite]);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const cents = dollarsToCents(hourly);
    errors.clearAll();
    if (cents === null) {
      errors.set("hourly_rate_cents", COPY.hourly_rate_cents);
      say(COPY.hourly_rate_cents, "error");
      return;
    }
    const scheduledFor = chosen.current;
    setBusy(true);
    say("Saving…");
    const result = await api<{ rate: Rate; rates: Rate[] }>(`/api/sites/${scheduledFor}/rates`, {
      method: "POST",
      body: { effective_from: effectiveFrom, hourly_rate_cents: cents, tax_rate_percent: tax.trim() },
    });
    setBusy(false);
    if (result.ok) {
      if (scheduledFor === chosen.current) {
        beginLoad();
        setRates(result.data.rates);
      }
      say(`Rate scheduled from ${result.data.rate.effective_from}.`);
      return;
    }
    if (result.error?.code === "validation") {
      const fields = (Object.keys(COPY) as (keyof typeof COPY)[]).filter((f) => result.error && f in (result.error.fields ?? {}));
      for (const f of fields) errors.set(f, COPY[f]);
      const first = fields[0];
      say(first ? COPY[first] : errorCopy(result, {}), "error");
      return;
    }
    if (result.error?.code === "rate_exists") {
      const copy = `A rate already starts on ${effectiveFrom}.`;
      errors.set("effective_from", copy);
      say(copy, "error");
      return;
    }
    say(errorCopy(result, {}), "error");
  };

  return (
    <div className="screen rates">
      <h1 className="screen-title">Rates</h1>
      {sites.length > 0 && (
      <div className="field field-inline">
        <label htmlFor="rates-site">Site</label>
        <select id="rates-site" value={siteId} onChange={(e) => chooseSite(e.target.value, sites)}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      )}
      <Status name="Rates status" message={status} />
      <div className="split">
        <section className="split-main" aria-labelledby="schedule-title">
          <h2 id="schedule-title">Rate schedule</h2>
          <table role="table" aria-label="Rate schedule" className="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Effective from</th>
                <th role="columnheader" scope="col">Hourly rate</th>
                <th role="columnheader" scope="col">Sales tax</th>
                <th role="columnheader" scope="col">State</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rates.map((r) => (
                <tr role="row" key={r.id} className={`rate-${r.state}`}>
                  <td role="cell" data-label="Effective from" className="mono">{r.effective_from}</td>
                  <td role="cell" data-label="Hourly rate" className="mono">${money(r.hourly_rate_cents)}</td>
                  <td role="cell" data-label="Sales tax" className="mono">{r.tax_rate_percent}%</td>
                  <td role="cell" data-label="State">
                    <span className={`stamp-word state-${r.state}`}>{RATE_STATES[r.state]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="split-side" aria-labelledby="schedule-form-title">
          <h2 id="schedule-form-title">Schedule a rate</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="field">
              <label htmlFor="rate-from">Effective from</label>
              <input
                id="rate-from"
                type="date"
                value={effectiveFrom}
                {...errors.attrs("effective_from")}
                onChange={(e) => {
                  setEffectiveFrom(e.target.value);
                  errors.clear("effective_from");
                }}
              />
              {errors.node("effective_from")}
            </div>
            <div className="field">
              <label htmlFor="rate-hourly">Hourly rate (USD)</label>
              <input
                id="rate-hourly"
                type="text"
                inputMode="decimal"
                value={hourly}
                {...errors.attrs("hourly_rate_cents")}
                onChange={(e) => {
                  setHourly(e.target.value);
                  errors.clear("hourly_rate_cents");
                }}
              />
              {errors.node("hourly_rate_cents")}
            </div>
            <div className="field">
              <label htmlFor="rate-tax">Sales tax (%)</label>
              <input
                id="rate-tax"
                type="text"
                inputMode="decimal"
                value={tax}
                {...errors.attrs("tax_rate_percent")}
                onChange={(e) => {
                  setTax(e.target.value);
                  errors.clear("tax_rate_percent");
                }}
              />
              {errors.node("tax_rate_percent")}
            </div>
            <button type="submit" className="button button-primary" aria-disabled={busy}>
              Schedule rate
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
