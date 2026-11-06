// Search (`/`): From, To, journey date and quota.
import { Search as SearchIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { Quota, Station } from "../../shared/api";
import { useRibbon } from "../components/Shell";
import { api } from "../lib/api";
import { istTimestamp, readClock } from "../lib/clock";
import { navigate } from "../lib/router";

export const QUOTA_LABEL: Record<Quota, string> = { GN: "General", TQ: "Tatkal", LD: "Ladies", SS: "Senior" };
export const QUOTAS: Quota[] = ["GN", "TQ", "LD", "SS"];

export function QuotaRadios({ value, onChange, name }: { value: Quota; onChange(q: Quota): void; name: string }) {
  return (
    <div className="stack">
      <span className="legend" id={`${name}-label`}>
        Quota
      </span>
      <div className="choices" role="radiogroup" aria-labelledby={`${name}-label`}>
        {QUOTAS.map((q) => (
          <label key={q} className="choice">
            <input type="radio" name={name} value={q} checked={value === q} onChange={() => onChange(q)} />
            {QUOTA_LABEL[q]}
          </label>
        ))}
      </div>
    </div>
  );
}

export function Search() {
  const [stations, setStations] = useState<Station[]>([]);
  const [from, setFrom] = useState("MMCT");
  const [to, setTo] = useState("NDLS");
  const [date, setDate] = useState("");
  const [quota, setQuota] = useState<Quota>("GN");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api<{ stations: Station[] }>("/api/stations").then((b) => setStations(b.stations), () => setStations([]));
    readClock().then((clock) => setDate((d) => d || istTimestamp(clock.now() + 86_400_000).slice(0, 10)), () => undefined);
  }, []);

  const name = (code: string): string => stations.find((s) => s.code === code)?.name ?? code;
  useRibbon([
    { code: from, name: name(from), end: true },
    { code: to, name: name(to), end: true },
  ]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (from === to) found.to = "Choose a different station from From";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) found.date = "Enter a date as YYYY-MM-DD";
    setErrors(found);
    if (Object.keys(found).length) return;
    navigate(`/trains?from=${from}&to=${to}&date=${date}&quota=${quota}&class=SL`);
  };

  return (
    <section className="panel stack" aria-labelledby="search-title">
      <div className="panel-title">
        <h1 id="search-title">Search trains</h1>
        <span className="kicker">Sleeper · AC 3 Tier</span>
      </div>
      <p className="muted">Pick a route and a date. Results show every train that calls at both stops, with chart time and availability.</p>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="row" style={{ alignItems: "end" }}>
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label htmlFor="from">From</label>
            <select id="from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {stations.map((s) => (
                <option key={s.code} value={s.code}>{`${s.code} ${s.name}`}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label htmlFor="to">To</label>
            <select id="to" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={errors.to ? true : undefined} aria-describedby={errors.to ? "to-error" : undefined}>
              {stations.map((s) => (
                <option key={s.code} value={s.code}>{`${s.code} ${s.name}`}</option>
              ))}
            </select>
            {errors.to ? <span className="field-error" id="to-error">{errors.to}</span> : null}
          </div>
          <div className="field" style={{ flex: "1 1 160px" }}>
            <label htmlFor="date">Journey date</label>
            <input
              id="date"
              type="text"
              inputMode="numeric"
              placeholder="YYYY-MM-DD"
              value={date}
              onChange={(e) => setDate(e.target.value.trim())}
              aria-invalid={errors.date ? true : undefined}
              aria-describedby={errors.date ? "date-error" : undefined}
            />
            {errors.date ? <span className="field-error" id="date-error">{errors.date}</span> : null}
          </div>
        </div>
        <QuotaRadios value={quota} onChange={setQuota} name="search-quota" />
        <div>
          <button type="submit" className="button primary">
            <SearchIcon size={16} strokeWidth={1.75} aria-hidden="true" />
            Search trains
          </button>
        </div>
      </form>
    </section>
  );
}
