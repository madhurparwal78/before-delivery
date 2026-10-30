import { Download, Link2, RotateCcw, Ban, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiFailure, serverNow } from "../api.js";
import { Live, Select, useApp, type Message } from "../app.js";
import { clock, hours, localDate, money, shiftDate } from "../format.js";
import type { BinderLink, Dashboard, PolicyVersion, Renter, Site, Utilisation } from "../types.js";

function SitePicker({ label, value, sites, onChange }: { label: string; value: string; sites: Site[]; onChange: (id: string) => void }) {
  return (
    <Select label={label} value={value} onChange={onChange}>
      {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
    </Select>
  );
}

function Totals() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  useEffect(() => { void api<Dashboard>("GET", "/api/dashboard").then(setDashboard); }, []);
  return (
    <section className="panel slip" aria-label="Site totals">
      <h2>Site totals</h2>
      <div className="table-frame" role="region" aria-label="Totals by site" tabIndex={0}>
        <table className="totals">
          <thead><tr><th scope="col">Site</th><th scope="col">Bookings today</th><th scope="col">Booked hours today</th><th scope="col">Unpaid balances</th><th scope="col">Documents expiring in 14 days</th></tr></thead>
          <tbody>
            {!dashboard ? <tr><td colSpan={5} className="loading-row">Loading…</td></tr> : dashboard.sites.map((site) => (
              <tr key={site.site_id}>
                <th scope="row">{site.name} <span className="mono muted">{site.local_date}</span></th>
                <td className="mono num">{site.bookings_today}</td>
                <td className="mono num">{hours(site.booked_minutes_today)}</td>
                <td className="mono num">{money(site.unpaid_balance_cents)}</td>
                <td className="mono num">{site.expiring_documents}</td>
              </tr>
            ))}
          </tbody>
          {dashboard ? (
            <tfoot>
              <tr>
                <th scope="row">All sites</th>
                <td className="mono num">{dashboard.totals.bookings_today}</td>
                <td className="mono num">{hours(dashboard.totals.booked_minutes_today)}</td>
                <td className="mono num">{money(dashboard.totals.unpaid_balance_cents)}</td>
                <td className="mono num">{dashboard.totals.expiring_documents}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}

const SHOWN = 8;

function RenterSearch({ sites }: { sites: Site[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Renter[] | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api<{ renters: Renter[] }>("GET", `/api/renters?q=${encodeURIComponent(query)}`).then((result) => setResults(result.renters));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  return (
    <section className="panel slip" aria-labelledby="search-heading">
      <h2 id="search-heading">Renter search</h2>
      <label className="field field-search">
        <span>Search renters</span>
        <span className="search-box"><Search aria-hidden="true" size={18} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Business, name or email" /></span>
      </label>
      <ul aria-label="Renter results" className="results">
        {results === null ? <li className="loading-row">Loading…</li> : results.length === 0 ? <li className="empty-row">No renters match.</li> : results.slice(0, SHOWN).map((renter) => (
          <li key={renter.id}>
            <strong>{renter.business}</strong>
            <span>{renter.name}</span>
            <span className="mono">{renter.email}</span>
            <span className="muted">{sites.find((site) => site.id === renter.home_site_id)?.name ?? ""}</span>
          </li>
        ))}
      </ul>
      {results && results.length > SHOWN ? <p className="muted">Showing {SHOWN} of {results.length} renters. Type to narrow the list.</p> : null}
    </section>
  );
}

function UtilisationReport({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const zone = sites.find((site) => site.id === siteId)?.time_zone ?? "UTC";
  const [day, setDay] = useState(() => localDate(zone, serverNow()));
  const [dayText, setDayText] = useState(day);
  const [report, setReport] = useState<Utilisation | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setReport(null);
    api<Utilisation>("GET", `/api/sites/${siteId}/utilisation?date=${day}`).then((result) => { setReport(result); setError(""); },
      (failure: unknown) => setError(failure instanceof ApiFailure ? failure.detail : "The report didn't load."));
  }, [siteId, day]);
  const apply = (): void => { if (dayText !== day) setDay(dayText.trim()); };
  return (
    <section className="panel slip" aria-labelledby="util-heading">
      <h2 id="util-heading">Station utilisation</h2>
      <div className="form-row">
        <SitePicker label="Report site" value={siteId} sites={sites} onChange={setSiteId} />
        <label className="field">
          <span>Report day</span>
          <input type="text" inputMode="numeric" className="mono" value={dayText} onChange={(event) => setDayText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") apply(); }} onBlur={apply} />
        </label>
        <a className="button" href={`/api/sites/${siteId}/utilisation.csv?date=${day}`} download><Download aria-hidden="true" size={18} /><span>Download CSV</span></a>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <div className="table-frame" role="region" aria-label="Utilisation table" tabIndex={0}>
        <table aria-label="Station utilisation">
          <thead><tr><th scope="col">Station</th><th scope="col">Booked hours</th><th scope="col">Day hours</th><th scope="col">Utilisation</th></tr></thead>
          <tbody>
            {!report ? <tr><td colSpan={4} className="loading-row">{error ? "—" : "Loading…"}</td></tr> : report.stations.map((row) => (
              <tr key={row.station_id}>
                <th scope="row">{row.name}</th>
                <td className="mono num">{hours(row.booked_minutes)}</td>
                <td className="mono num">{hours(report.day_minutes)}</td>
                <td className="mono num"><span className="bar" aria-hidden="true"><span style={{ width: `${Math.min(100, row.utilisation_percent)}%` }} /></span>{row.utilisation_percent.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PolicyForm({ sites, report }: { sites: Site[]; report: (message: Message) => void }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [notice, setNotice] = useState("24");
  const [from, setFrom] = useState("");
  const [versions, setVersions] = useState<PolicyVersion[] | null>(null);
  const [fieldError, setFieldError] = useState("");
  const load = useCallback(async () => setVersions((await api<{ versions: PolicyVersion[] }>("GET", `/api/sites/${siteId}/policies`)).versions), [siteId]);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    report({ text: "Scheduling…", tone: "pending" });
    setFieldError("");
    try {
      const { version } = await api<{ version: PolicyVersion }>("POST", `/api/sites/${siteId}/policies`, { notice_hours: Number(notice), effective_from: from.trim() });
      report({ text: `${version.notice_hours}-hour policy scheduled from ${version.effective_from}.`, tone: "success" });
      await load();
    } catch (error) {
      const text = error instanceof ApiFailure && error.code === "policy_date_taken" ? "A policy already starts on that date." : error instanceof ApiFailure ? error.detail : "Scheduling failed.";
      setFieldError(text);
      report({ text, tone: "error" });
    }
  };
  const zone = sites.find((site) => site.id === siteId)?.time_zone ?? "UTC";
  return (
    <section className="panel slip" aria-labelledby="policy-heading">
      <h2 id="policy-heading">Cancellation policy</h2>
      <form className="form-row" onSubmit={(event) => void submit(event)} noValidate>
        <SitePicker label="Policy site" value={siteId} sites={sites} onChange={setSiteId} />
        <label className="field field-narrow">
          <span>Notice hours</span>
          <input type="number" min={1} max={168} className="mono" value={notice} onChange={(event) => setNotice(event.target.value)} />
        </label>
        <label className="field">
          <span>Effective from</span>
          <input type="text" inputMode="numeric" className="mono" placeholder={shiftDate(localDate(zone, serverNow()), 1)} value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <button type="submit" className="button button-primary">Schedule policy</button>
      </form>
      {fieldError ? <p className="field-error">{fieldError}</p> : null}
      <div className="table-frame" role="region" aria-label="Policy versions list" tabIndex={0}>
        <table aria-label="Policy versions">
          <thead><tr><th scope="col">Notice</th><th scope="col">Effective from</th><th scope="col">Scheduled by</th></tr></thead>
          <tbody>
            {!versions ? <tr><td colSpan={3} className="loading-row">Loading…</td></tr> : versions.length === 0 ? <tr><td colSpan={3} className="empty-row">No policy versions yet.</td></tr> : versions.map((version) => (
              <tr key={version.id}><td className="mono">{version.notice_hours} h</td><td className="mono">{version.effective_from}</td><td>{version.created_by_name}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BinderLinks({ sites, report }: { sites: Site[]; report: (message: Message) => void }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const zone = sites.find((site) => site.id === siteId)?.time_zone ?? "UTC";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [links, setLinks] = useState<BinderLink[] | null>(null);
  const [fieldError, setFieldError] = useState("");
  const load = useCallback(async () => setLinks((await api<{ links: BinderLink[] }>("GET", `/api/sites/${siteId}/binder-links`)).links), [siteId]);
  useEffect(() => { void load(); }, [load]);
  const run = async (pending: string, done: string, call: () => Promise<unknown>): Promise<void> => {
    report({ text: pending, tone: "pending" });
    setFieldError("");
    try {
      await call();
      report({ text: done, tone: "success" });
      await load();
    } catch (error) {
      const text = error instanceof ApiFailure ? error.detail : "That didn't save.";
      setFieldError(text);
      report({ text, tone: "error" });
    }
  };
  const state = (link: BinderLink): string => link.revoked ? "Revoked" : Date.parse(link.expires_at) <= serverNow() ? "Expired" : "Active";
  return (
    <section className="panel slip" aria-labelledby="binder-heading">
      <h2 id="binder-heading">Binder links</h2>
      <form className="form-row" noValidate onSubmit={(event) => { event.preventDefault(); void run("Saving…", "Binder link ready.", () => api("POST", `/api/sites/${siteId}/binder-links`, { from: from.trim(), to: to.trim() })); }}>
        <SitePicker label="Binder site" value={siteId} sites={sites} onChange={setSiteId} />
        <label className="field"><span>Binder from</span><input type="text" inputMode="numeric" className="mono" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field"><span>Binder to</span><input type="text" inputMode="numeric" className="mono" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="submit" className="button button-primary"><Link2 aria-hidden="true" size={18} /><span>Create binder link</span></button>
      </form>
      {fieldError ? <p className="field-error">{fieldError}</p> : null}
      <div className="table-frame" role="region" aria-label="Binder links list" tabIndex={0}>
        <table aria-label="Binder links">
          <thead><tr><th scope="col">Link</th><th scope="col">Range</th><th scope="col">Expires</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {!links ? <tr><td colSpan={5} className="loading-row">Loading…</td></tr> : links.length === 0 ? <tr><td colSpan={5} className="empty-row">No binder links for this site yet.</td></tr> : links.map((link) => (
              <tr key={link.id}>
                <td className="link-cell">{link.revoked ? <span className="mono">{link.url}</span> : <a className="mono" href={link.url} target="_blank" rel="noopener">{link.url}</a>}</td>
                <td className="mono">{link.from} – {link.to}</td>
                <td className="mono">{localDate(zone, link.expires_at)} {clock(zone, link.expires_at)}</td>
                <td><span className={`stamp stamp-link-${state(link).toLowerCase()}`}>{state(link)}</span></td>
                <td>
                  {link.revoked ? null : (
                    <div className="row-actions">
                      <button type="button" className="button" onClick={() => void run("Saving…", "New link ready. The old link no longer works.", () => api("POST", `/api/binder-links/${link.id}/regenerate`, {}))}><RotateCcw aria-hidden="true" size={16} /><span>Regenerate</span></button>
                      <button type="button" className="button" onClick={() => void run("Saving…", "Link revoked.", () => api("DELETE", `/api/binder-links/${link.id}`))}><Ban aria-hidden="true" size={16} /><span>Revoke</span></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Manage() {
  const { sites } = useApp();
  const [message, setMessage] = useState<Message | null>(null);
  return (
    <main className="page manage-page">
      <header className="page-head">
        <h1>Manage</h1>
        <p className="lede">Today across your sites, renters, utilisation, cancellation terms and inspector binders.</p>
      </header>
      <Live label="Manager status" message={message} className="manage-status" />
      <div className="manage-grid">
        <div className="manage-column">
          <Totals />
          <UtilisationReport sites={sites} />
        </div>
        <div className="manage-column">
          <RenterSearch sites={sites} />
          <PolicyForm sites={sites} report={setMessage} />
        </div>
        <BinderLinks sites={sites} report={setMessage} />
      </div>
    </main>
  );
}
