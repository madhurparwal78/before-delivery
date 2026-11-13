import { Download, FileText } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DistrictTotals, Page } from "../components/Shell.tsx";
import { api, navigate, useLocation, usePoll } from "../lib.ts";
import type { Channel, Pack, Totals } from "../types.ts";
import { WindowLabel } from "../components/WindowLabel.tsx";

/** The Review address for a period: `/review?from=YYYY-MM-DD&to=YYYY-MM-DD`, or `/review` for all time. */
const reviewHref = (from: string, to: string) => (from || to ? `/review?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : "/review");
const periodQuery = (from: string, to: string) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

export function Review() {
  // The period shown is the one in the address; the inputs follow it on load, back, forward and reload.
  const { query } = useLocation();
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  const shownPeriod = from || to ? `?${periodQuery(from, to)}` : "";
  const [fromText, setFromText] = useState(from);
  const [toText, setToText] = useState(to);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setFromText(from);
    setToText(to);
    setErrors({});
  }, [from, to]);
  const totals = usePoll(async () => {
    const reply = await api<Totals>(`/api/totals${shownPeriod}`);
    return reply.ok ? { ...reply, data: { ...reply.data, period: shownPeriod } } : reply;
  }, [shownPeriod]);
  const rows = totals.data?.period === shownPeriod ? totals.data.channels : [];

  // Show totals checks the period with the server first: a 422 leaves the address, history and table as they were.
  const show = async (event: FormEvent) => {
    event.preventDefault();
    if (fromText || toText) {
      const reply = await api<Totals>(`/api/totals?${periodQuery(fromText, toText)}`);
      if (!reply.ok) {
        setErrors(reply.error.errors ?? {});
        return;
      }
    }
    setErrors({});
    navigate(reviewHref(fromText, toText), false, true);
  };
  const channels = usePoll(() => api<{ channels: Channel[] }>("/api/channels"), [], 30_000);
  const packs = usePoll(() => api<{ packs: Pack[] }>("/api/packs"), []);
  const names = new Map((channels.data?.channels ?? []).map((c) => [c.id, c.name]));
  const [status, setStatus] = useState("");
  const seen = useRef<Set<string> | null>(null);

  // Announces each pack that newly appears in Mailed packs while the page is open.
  useEffect(() => {
    if (!packs.data) return;
    const numbers = packs.data.packs.map((p) => p.number);
    const arrived = seen.current === null ? [] : numbers.filter((n) => !seen.current!.has(n));
    seen.current = new Set(numbers);
    if (arrived.length) setStatus(arrived.map((n) => `Pack ${n} received from the district.`).join(" "));
  }, [packs.data]);

  return (
    <Page title="Review" lead={<DistrictTotals />} wide>
      <form className="period-form" aria-label="Review period" onSubmit={show} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="review-from">From</label>
          <input id="review-from" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={fromText}
            onChange={(e) => setFromText(e.target.value)} aria-invalid={Boolean(errors.from)} aria-describedby={errors.from ? "review-from-error" : undefined} />
          {errors.from && <p className="field-error" id="review-from-error">{errors.from}</p>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="review-to">To</label>
          <input id="review-to" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={toText}
            onChange={(e) => setToText(e.target.value)} aria-invalid={Boolean(errors.to)} aria-describedby={errors.to ? "review-to-error" : undefined} />
          {errors.to && <p className="field-error" id="review-to-error">{errors.to}</p>}
        </div>
        <button type="submit" className="btn btn-ink">Show totals</button>
      </form>
      <div className="review-layout">
      <section aria-labelledby="totals-heading" className="panel table-host">
        <h2 id="totals-heading" className="panel-title">{from || to ? `Channel totals ${from} to ${to}` : "Channel totals, all windows"}</h2>
        <table className="table totals-table" aria-label="Channel totals" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Channel</th>
              <th scope="col" role="columnheader">Window</th>
              <th scope="col" role="columnheader" className="n">Cap volume (ML)</th>
              <th scope="col" role="columnheader" className="n">Committed (ML)</th>
              <th scope="col" role="columnheader" className="n">Delivered (ML)</th>
              <th scope="col" role="columnheader" className="n">Remaining (ML)</th>
            </tr>
          </thead>
          {/* One row per covered window, by channel in rail order and then by opening, as the server lists them. */}
          <tbody role="rowgroup">
            {rows.flatMap((c) =>
              c.windows.map((w) => (
                <tr role="row" key={w.window_id}>
                  <td role="cell" data-label="Channel" className="strong">{names.get(c.channel_id) ?? c.channel_id}</td>
                  <td role="cell" data-label="Window"><span><WindowLabel label={w.label} /></span></td>
                  <td role="cell" data-label="Cap volume" className="n num">{w.cap_volume_ml}</td>
                  <td role="cell" data-label="Committed" className="n num">{w.committed_ml}</td>
                  <td role="cell" data-label="Delivered" className="n num">{w.delivered_ml}</td>
                  <td role="cell" data-label="Remaining" className="n num">{w.remaining_ml}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="packs-heading" className="panel">
        <h2 id="packs-heading" className="panel-title">Mailed packs</h2>
        {packs.data?.packs.length === 0 && <p className="empty"><FileText size={18} aria-hidden="true" /> No packs have been mailed yet.</p>}
        <p role="status" aria-label="Review status" className="status-line">{status}</p>
        <ul className="rows" aria-label="Mailed packs">
          {(packs.data?.packs ?? []).map((p) => (
            <li key={p.id} className="row-item">
              <div>
                <p className="row-title">{p.number}</p>
                <p className="muted num">{p.from} to {p.to} · signed by {p.signatory}</p>
              </div>
              <a className="btn btn-ink btn-small" href={`/api/packs/${encodeURIComponent(p.id)}/document`} download={`${p.number}.txt`} aria-label={`Download ${p.number}`}>
                <Download size={16} aria-hidden="true" />
                Download
              </a>
            </li>
          ))}
        </ul>
      </section>
      </div>
    </Page>
  );
}
