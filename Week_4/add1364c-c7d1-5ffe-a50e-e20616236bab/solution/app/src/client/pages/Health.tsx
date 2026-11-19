import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, get, post } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { instantStamp, officeDate } from "../lib/office";
import { useEvent, useStore } from "../lib/store";
import type { HealthReport, Vault } from "../lib/types";
import { OutageBand } from "./Billing";
import { HealthTag, vendorText } from "./Slip";

const COUNTS: { key: keyof HealthReport["counts"]; label: string }[] = [
  { key: "exposed", label: "Exposed" },
  { key: "vendor_breached", label: "Vendor breached" },
  { key: "out_of_policy", label: "Out of policy" },
  { key: "turns_due", label: "Turns due" },
  { key: "turns_overdue", label: "Turns overdue" },
];

export function Health() {
  useTitle("Health report");
  const { office, say, bumpAudit } = useStore();
  const [day, setDay] = useState<string>("");
  const [report, setReport] = useState<HealthReport | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [checking, setChecking] = useState(false);
  const chosen = useRef("");
  const checkingRef = useRef(false);

  const load = useCallback(async (d: string) => {
    chosen.current = d;
    try {
      const body = await get<HealthReport>(d ? `/api/health-report?day=${d}` : "/api/health-report");
      if (chosen.current !== d) return;
      setReport(body);
      setDay(body.office_date);
      chosen.current = body.office_date;
    } catch { /* the last good report stays */ }
  }, []);

  useEffect(() => {
    void load("");
    get<{ vaults: Vault[] }>("/api/vaults").then((b) => setVaults(b.vaults)).catch(() => undefined);
  }, [load]);

  useEvent("check-finished", () => {
    if (checkingRef.current) return;
    const current = chosen.current;
    void load(current === office?.date ? "" : current);
  });

  const pick = (value: string) => {
    setDay(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) void load(value);
  };

  const check = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const body = await post<HealthReport>("/api/health-report/checks", {});
      chosen.current = body.office_date;
      setReport(body);
      setDay(body.office_date);
      say(`Breach check finished at ${body.last_good_check_at ? instantStamp(body.last_good_check_at) : ""}.`);
      bumpAudit();
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "breach_feed_unreachable") return;
      await load("");
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  };

  const vaultName = (id: string) => vaults.find((v) => v.id === id)?.name ?? "";
  const down = report?.feed === "unreachable";
  const bandText = report
    ? report.last_good_check_at
      ? `The breach feed can't be reached. Showing the last good check from ${instantStamp(report.last_good_check_at)}.`
      : "The breach feed can't be reached. No check has succeeded yet."
    : "";

  return (
    <div className="folder-page">
      <OutageBand show={down} text={bandText} />
      <section className="folder band-0">
        <header className="folder-title">
          <h1>Health report</h1>
          <div className="health-tools">
            <label className="inline-field">Office day <input type="date" value={day} max={office?.date} onChange={(e) => pick(e.target.value)} /></label>
            <button type="button" className="btn btn-solid btn-cut" aria-disabled={checking || undefined} onClick={() => void check()}>{checking ? "Checking the breach feed" : "Check now"}</button>
          </div>
        </header>
        {report ? (
          <>
            <p className="report-line fig">Report for {officeDate(report.office_date)} (America/Chicago)</p>
            <p className="last-check">Last good check: <span className="fig">{report.last_good_check_at ? instantStamp(report.last_good_check_at) : "none yet"}</span></p>
            <dl className="counts">
              {COUNTS.map((c) => (
                <div className="count-cell" key={c.key}><dt>{c.label}</dt><dd className="fig">{report.counts[c.key]}</dd></div>
              ))}
            </dl>
            <h2 className="list-title">Logins that need attention</h2>
            {report.credentials.length === 0 ? <p className="muted pad">Every login on this report is sound, or no check ran that day.</p> : (
              <ul className="slips" aria-label="Logins that need attention">
                {report.credentials.map((c) => (
                  <li className="slip health-slip" key={c.id}>
                    <strong>{c.label}</strong>
                    <span>{vendorText(c.vendor)}</span>
                    <span>{vaultName(c.vault_id)}</span>
                    <HealthTag health={c.health} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
