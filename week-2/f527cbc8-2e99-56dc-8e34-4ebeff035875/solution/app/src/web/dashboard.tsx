// The farrier's Dashboard: the month's figures from the ledger, the billed-and-collected bar chart, the daily
// figures and the CSV ledger export (brief: Screens and layout, Dashboard; Feedback states, Export CSV).
import { useEffect, useRef, useState } from "react";
import { type DashboardData, type Job, get, request } from "./api";
import { failure } from "./days";
import { dollars } from "./format";
import { Count, useReducedMotion } from "./motion";
import { useSession } from "./session";
import { Button, Skeleton, useNotify, useRefresh } from "./ui";

const EXPORT_POLL_MS = 1000;

/** The current practice month and the eleven before it, newest first. */
function monthsUpTo(today: string): string[] {
  const [year = 0, month = 1] = today.split("-").map(Number);
  return Array.from({ length: 12 }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

export function DashboardScreen() {
  const { practice } = useSession();
  const { tick } = useRefresh();
  const notify = useNotify();
  const months = monthsUpTo(practice.today);
  const [month, setMonth] = useState(months[0] ?? practice.today.slice(0, 7));
  const [data, setData] = useState<DashboardData | null>(null);
  const [exporting, setExporting] = useState(false);
  const [download, setDownload] = useState<string | null>(null);
  const exportRun = useRef(0);

  useEffect(() => {
    let live = true;
    void get<DashboardData>(`/api/dashboard?month=${encodeURIComponent(month)}`).then((result) => {
      if (live && result.ok) setData(result.data);
    });
    return () => {
      live = false;
    };
  }, [month, tick]);

  /** Queues the export job and follows it until it has finished. */
  async function exportCsv(): Promise<void> {
    if (exporting) return;
    exportRun.current += 1;
    const run = exportRun.current;
    setExporting(true);
    setDownload(null);
    notify("Preparing export…", "pending");
    const queued = await request<{ job_id: string }>("POST", "/api/dashboard/exports", { body: { month } });
    if (!queued.ok) {
      setExporting(false);
      notify(failure(queued.error), "error");
      return;
    }
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, EXPORT_POLL_MS));
      if (run !== exportRun.current) return;
      const job = await get<Job>(`/api/jobs/${encodeURIComponent(queued.data.job_id)}`);
      if (!job.ok) continue;
      if (job.data.status === "succeeded" && job.data.result?.url) {
        setDownload(job.data.result.url);
        setExporting(false);
        notify("Export ready.", "success");
        return;
      }
      if (job.data.status === "dead") {
        setExporting(false);
        notify("The export failed. It can be retried from the job list.", "error");
        return;
      }
    }
  }

  return (
    <section className="sheet dashboard" aria-labelledby="dashboard-title">
      <h1 id="dashboard-title" className="page-title">
        Dashboard
      </h1>
      <div className="dash-pickers">
        <div className="field">
          <label htmlFor="dash-month">Month</label>
          <select id="dash-month" value={month} onChange={(event) => setMonth(event.target.value)}>
            {months.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <Button variant="primary" className="dash-export" busy={exporting} onClick={() => void exportCsv()}>
          Export CSV
        </Button>
        {download ? (
          <a className="download-link" href={download} download>
            Download export
          </a>
        ) : null}
      </div>
      {data === null ? (
        <Skeleton rows={6} />
      ) : (
        <div className="dash-grid">
          <BarChart data={data} />
          <div className="dash-totals table-scroll">
            <table className="ledger" aria-label="Month totals">
              <thead>
                <tr>
                  <th scope="col">Figure</th>
                  <th scope="col" className="right">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Billed", data.billed_cents],
                    ["Collected", data.collected_cents],
                    ["Refunded", data.refunded_cents],
                    ["Outstanding", data.outstanding_cents],
                  ] as const
                ).map(([label, cents]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td data-label={label} className="right">
                      <Count value={cents} format={dollars} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Overdue horses</th>
                  <td data-label="Overdue horses" className="right">
                    <Count value={data.overdue_horses} format={String} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="dash-daily table-scroll">
            <table className="ledger" aria-label="Daily figures" tabIndex={0}>
              <thead>
                <tr>
                  {["Date", "Billed", "Collected", "Refunded"].map((column) => (
                    <th key={column} scope="col" className={column === "Date" ? undefined : "right"}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No ledger entries in {data.month}.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.date}>
                      <td data-label="Date" className="num">
                        {row.date}
                      </td>
                      <td data-label="Billed" className="num right">
                        {dollars(row.billed_cents)}
                      </td>
                      <td data-label="Collected" className="num right">
                        {dollars(row.collected_cents)}
                      </td>
                      <td data-label="Refunded" className="num right">
                        {dollars(row.refunded_cents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/** Billed in steel blue beside collected in forge orange; the bars move to new values over 440 ms. */
function BarChart({ data }: { data: DashboardData }) {
  const reduced = useReducedMotion();
  const top = Math.max(data.billed_cents, data.collected_cents, 1);
  const bars = [
    { key: "billed", label: "Billed", cents: data.billed_cents },
    { key: "collected", label: "Collected", cents: data.collected_cents },
  ];
  return (
    <figure className="dash-chart" aria-label="Billed and collected">
      <div className="chart-plot" aria-hidden="true" data-reduced={reduced ? "true" : "false"}>
        {bars.map((bar) => (
          <div key={bar.key} className="chart-column">
            <div className="chart-track">
              <div className={`chart-bar chart-${bar.key}`} style={{ transform: `scaleY(${bar.cents / top})` }} />
            </div>
            <span className="chart-label">{bar.label}</span>
            <span className="chart-value num">{dollars(bar.cents)}</span>
          </div>
        ))}
      </div>
      <figcaption id="chart-caption">
        Billed {dollars(data.billed_cents)}, collected {dollars(data.collected_cents)} in {data.month}.
      </figcaption>
    </figure>
  );
}
