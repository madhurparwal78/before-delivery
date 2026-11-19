// Reports: the monthly utilisation table and CSV; the month and member filter live in the address.
import { useEffect, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import type { Report } from "../../shared/api.ts";
import { hoursText, money } from "../../shared/format.ts";
import { isReportMonth } from "../../shared/rules.ts";
import { api, errorCopy } from "../api.ts";
import { navigate } from "../nav.ts";
import { MemberSearch } from "../MemberSearch.tsx";
import { EmptyState, Status, useFieldErrors, useLatestRequest, useStatusRegion } from "../ui.tsx";

const BAD_MONTH = "Enter a month as YYYY-MM.";
const NOT_OURS = "That member isn't in your incubator.";

function csvHref(month: string, memberId: string | null): string {
  return `/api/reports/utilisation.csv?month=${encodeURIComponent(month)}${memberId ? `&member_id=${encodeURIComponent(memberId)}` : ""}`;
}

export function Reports({ search, stamp }: { search: string; stamp: number }): ReactNode {
  const params = new URLSearchParams(search);
  const urlMonth = params.get("month");
  const urlMember = params.get("member");
  const [month, setMonth] = useState(urlMonth ?? "");
  const [memberText, setMemberText] = useState("");
  const [memberId, setMemberId] = useState<string | null>(urlMember);
  const [report, setReport] = useState<Report | null>(null);
  const [status, say] = useStatusRegion();
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();
  const beginLoad = useLatestRequest();

  // The screen is restored from the address on open, reload, Back and Forward; the latest load wins.
  useEffect(() => {
    const isLatest = beginLoad();
    setMonth(urlMonth ?? "");
    setMemberId(urlMember);
    errors.clearAll();
    if (urlMonth === null) {
      setReport(null);
      setBusy(false);
      setMemberText("");
      say("");
      return;
    }
    if (!isReportMonth(urlMonth)) {
      setReport(null);
      setBusy(false);
      errors.set("month", BAD_MONTH);
      say(BAD_MONTH, "error");
      return;
    }
    if (urlMember === null) setMemberText("");
    void (async () => {
      setBusy(true);
      say("Loading report…");
      const path = (member: string | null): string =>
        `/api/reports/utilisation?month=${encodeURIComponent(urlMonth)}${member ? `&member_id=${encodeURIComponent(member)}` : ""}`;
      let result = await api<Report>(path(urlMember));
      if (!isLatest()) return;
      let notOurs = false;
      if (!result.ok && result.error?.code === "not_found" && urlMember) {
        notOurs = true;
        say(NOT_OURS, "error");
        setMemberText("");
        setMemberId(null);
        result = await api<Report>(path(null));
        if (!isLatest()) return;
      }
      setBusy(false);
      if (!result.ok) {
        setReport(null);
        if (result.error?.code === "validation") errors.set("month", BAD_MONTH);
        say(result.error?.code === "validation" ? BAD_MONTH : errorCopy(result, {}), "error");
        return;
      }
      setReport(result.data);
      setMemberText(result.data.member?.business_name ?? "");
      if (!notOurs) say(`Showing ${result.data.month}.`);
    })();
  }, [stamp, urlMonth, urlMember, say, beginLoad]);

  const show = (): void => {
    const member = memberId;
    navigate(`/reports?month=${encodeURIComponent(month.trim())}${member ? `&member=${encodeURIComponent(member)}` : ""}`);
  };

  return (
    <div className="screen reports">
      <h1 className="screen-title">Reports</h1>
      <form
        className="report-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) show();
        }}
      >
        <div className="field">
          <label htmlFor="report-month">Month</label>
          <input
            id="report-month"
            className="mono"
            type="text"
            inputMode="numeric"
            placeholder="YYYY-MM"
            value={month}
            {...errors.attrs("month")}
            onChange={(e) => {
              setMonth(e.target.value);
              errors.clear("month");
            }}
          />
          {errors.node("month")}
        </div>
        <MemberSearch
          label="Member"
          value={memberText}
          onText={(text) => {
            setMemberText(text);
            setMemberId(null);
          }}
          onPick={(member) => {
            setMemberText(member.business_name);
            setMemberId(member.id);
          }}
        />
        <button type="submit" className="button button-primary" aria-disabled={busy}>
          Show report
        </button>
      </form>
      <Status name="Report status" message={status} />
      {!report && urlMonth === null && <EmptyState drawing="clipboard">Choose a month to see utilisation by site.</EmptyState>}
      {report && (
        <>
          <table role="table" aria-label="Utilisation by site" className="table table-report">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Site</th>
                <th role="columnheader" scope="col" className="num">Scheduled hours</th>
                <th role="columnheader" scope="col" className="num">Used hours</th>
                <th role="columnheader" scope="col" className="num">Forfeited hours</th>
                <th role="columnheader" scope="col" className="num">Overage</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {report.sites.map((s) => (
                <tr role="row" key={s.site_id}>
                  <td role="cell" data-label="Site">{s.site_name}</td>
                  <td role="cell" data-label="Scheduled hours" className="mono num">{hoursText(s.scheduled_hours)}</td>
                  <td role="cell" data-label="Used hours" className="mono num">{hoursText(s.used_hours)}</td>
                  <td role="cell" data-label="Forfeited hours" className="mono num">{hoursText(s.forfeited_hours)}</td>
                  <td role="cell" data-label="Overage" className="mono num">${money(s.overage_cents)}</td>
                </tr>
              ))}
              <tr role="row" className="row-total">
                <td role="cell" data-label="Site">Total</td>
                <td role="cell" data-label="Scheduled hours" className="mono num">{hoursText(report.totals.scheduled_hours)}</td>
                <td role="cell" data-label="Used hours" className="mono num">{hoursText(report.totals.used_hours)}</td>
                <td role="cell" data-label="Forfeited hours" className="mono num">{hoursText(report.totals.forfeited_hours)}</td>
                <td role="cell" data-label="Overage" className="mono num">${money(report.totals.overage_cents)}</td>
              </tr>
            </tbody>
          </table>
          <a className="text-link download" href={csvHref(report.month, report.member?.id ?? null)} download>
            <FileText aria-hidden="true" size={16} /> Download CSV
          </a>
        </>
      )}
    </div>
  );
}
