// Usage page (brief: Screens and layout, Usage page; Feedback states, Billing sync, Usage figures, Usage export).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatCount, formatTime } from "../shared/format";
import { type Usage, type UsageRow, api, query } from "./api";
import type { Scope } from "./console";
import { STORAGE_OUTAGE } from "./copy";
import { useCursorPages } from "./cursorPages";
import { Status } from "./dialog";
import { Icon } from "./icons";

const REFRESH_MS = 15_000;

function billingLine(billing: Usage["billing"]): string {
  const through = billing.confirmed_through ? formatTime(billing.confirmed_through) : "nothing yet this month";
  if (billing.state === "in_sync") return `Billing in sync. Confirmed through ${through}.`;
  if (billing.state === "pending") return "Billing sync pending. Closed hours post within a minute.";
  return `Billing sync delayed. Metered totals here are complete; billing has confirmed usage through ${through}.`;
}

function Meter({ label, used, included, percent }: { label: string; used: number; included: number; percent: number }): JSX.Element {
  const value = Math.min(100, percent);
  const text = `${formatCount(used)} of ${formatCount(included)} bytes (${percent.toFixed(1)}%)`;
  return (
    <div class="meter">
      <span class="meter__label">{label}</span>
      <div class="meter__bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
        aria-valuetext={text}>
        <span class="meter__fill" style={{ width: `${value}%` }} />
      </div>
      <span class="meter__text mono">{text}</span>
    </div>
  );
}

export function UsagePage({ scope }: { scope: Scope }): JSX.Element {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [billing, setBilling] = useState("");
  const [preparing, setPreparing] = useState(false);
  const base = `/api/w/${scope.ws}/usage`;
  const rows = useCursorPages<UsageRow>(
    async (cursor) => {
      const page = await api<{ rows: UsageRow[]; next_cursor: string | null }>("GET", `${base}/rows${query({ cursor: cursor ?? undefined })}`);
      return { rows: page.rows, next: page.next_cursor };
    },
    (error) => setBilling(scope.report(error)),
  );

  // The figures and the billing line are read on open and every 15 seconds while the page stays open.
  useEffect(() => {
    let live = true;
    let timer = 0;
    const read = async (): Promise<void> => {
      try {
        const next = await api<Usage>("GET", base);
        if (!live) return;
        setUsage(next);
        setBilling(billingLine(next.billing));
      } catch (error) {
        if (live) setBilling(scope.report(error));
      }
      if (live) timer = window.setTimeout(() => void read(), REFRESH_MS);
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [scope.ws]);

  const downloadCsv = async (): Promise<void> => {
    setPreparing(true);
    try {
      const response = await fetch(`${base}/export.csv`);
      if (!response.ok) throw new Error(String(response.status));
      const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "farshore-usage.csv";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setBilling(STORAGE_OUTAGE);
    }
    setPreparing(false);
  };

  return (
    <section class="page" aria-labelledby="usage-title">
      <div class="page__head">
        <h1 id="usage-title" class="page__title">
          Usage
        </h1>
        <button type="button" class="button" disabled={preparing} onClick={() => void downloadCsv()}>
          <Icon name="download" />
          {preparing ? "Preparing CSV…" : "Download CSV"}
        </button>
      </div>
      {usage ? (
        <div class="usage">
          <p class="usage__plan">
            {usage.plan.name} plan, this month so far
          </p>
          <Meter label="Stored" used={usage.stored_bytes} included={usage.plan.included_storage_bytes} percent={usage.percent.storage} />
          <Meter label="Egress this month" used={usage.egress_bytes} included={usage.plan.included_egress_bytes} percent={usage.percent.egress} />
          <p class="usage__figure">
            Reserved for open uploads <span class="mono">{formatCount(usage.reserved_bytes)}</span> bytes
          </p>
          <p class="usage__figure">
            Request units <span class="mono">{formatCount(usage.request_units)}</span>
          </p>
        </div>
      ) : (
        <div class="usage usage--loading" aria-hidden="true" />
      )}
      <Status label="Billing sync" text={billing} />
      <h2 class="page__subtitle">Usage rows</h2>
      <div class="table-frame">
        <table class="table table--cards" aria-label="Usage rows">
          <thead>
            <tr>
              <th scope="col">Window start (UTC)</th>
              <th scope="col">Window end (UTC)</th>
              <th scope="col">Bucket</th>
              <th scope="col">Unit</th>
              <th scope="col" class="num">Amount</th>
              <th scope="col">Billing</th>
            </tr>
          </thead>
          <tbody>
            {rows.rows.map((row) => (
              <tr key={row.tracking_id}>
                <td data-label="Window start (UTC)" class="mono">{formatTime(row.window_start)}</td>
                <td data-label="Window end (UTC)" class="mono">{formatTime(row.window_end)}</td>
                <td data-label="Bucket">{row.bucket}</td>
                <td data-label="Unit" class="mono">{row.unit}</td>
                <td data-label="Amount" class="num">{row.amount}</td>
                <td data-label="Billing">
                  <span class={`state state--${row.billing_state}`}>{row.billing_state}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.controls}
    </section>
  );
}
