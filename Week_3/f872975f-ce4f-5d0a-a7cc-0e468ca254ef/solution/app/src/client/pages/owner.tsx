// The owner's bench: grading queue, grade rates with scheduled versions, and stock on hand.
import { useCallback, useEffect, useState } from "react";
import type { Board, BoardSummary, Rate, StockFigures, StockRow } from "../../shared/api";
import { BOARD_LABELS, formatWhen, GRADES, SPECIES } from "../../shared/domain";
import { api } from "../api";

const STOCK_POLL_MS = 8000;

function useStock() {
  const [stock, setStock] = useState<{ species: StockRow[]; totals: StockFigures } | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ species: StockRow[]; totals: StockFigures }>("GET", "/api/stock");
    if (r.ok) setStock(r.data);
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), STOCK_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  return [stock, load] as const;
}

/** `YYYY-MM-DD HH:MM` in UTC to an ISO instant; null when it is not that shape or not a real time. */
function effectiveFrom(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`;
}

function StockTable({ stock }: { stock: { species: StockRow[]; totals: StockFigures } | null }) {
  const row = (name: string, f: StockFigures, total = false) => (
    <tr key={name} className={total ? "total" : undefined}>
      <th scope="row">{name}</th>
      <td className="mono" data-label="Open boards">{f.open_boards}</td>
      <td className="mono" data-label="On rack">{f.on_rack}</td>
      <td className="mono" data-label="Held">{f.held}</td>
      <td className="mono measure" data-label="Volume (mm³)">{f.volume_mm3}</td>
      <td className="mono measure" data-label="Board feet">{f.board_feet}</td>
    </tr>
  );
  return (
    <div className="table-wrap">
      <table aria-label="Stock on hand" className="data stock">
        <thead>
          <tr><th scope="col">Species</th><th scope="col">Open boards</th><th scope="col">On rack</th><th scope="col">Held</th><th scope="col">Volume (mm³)</th><th scope="col">Board feet</th></tr>
        </thead>
        <tbody>
          {stock === null ? <tr><td colSpan={6} className="muted">Loading…</td></tr> : (
            <>
              {stock.species.map((s) => row(s.species, s))}
              {row("All species", stock.totals, true)}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function OwnerPage() {
  const [queue, setQueue] = useState<Board[] | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [rates, setRates] = useState<{ rates: Rate[]; scheduled: Rate[] } | null>(null);
  const [rateFields, setRateFields] = useState<Record<string, string>>({});
  const [fromFields, setFromFields] = useState<Record<string, string>>({});
  const [stock, loadStock] = useStock();

  const loadQueue = useCallback(async () => {
    const r = await api<{ boards: BoardSummary[] }>("GET", "/api/boards?status=tagged&status=graded");
    if (!r.ok) return;
    const details = await Promise.all(r.data.boards.map((b) => api<{ board: Board }>("GET", `/api/boards/${b.tag}`)));
    setQueue(details.flatMap((d) => (d.ok ? [d.data.board] : [])));
  }, []);

  const loadRates = useCallback(async () => {
    const r = await api<{ rates: Rate[]; scheduled: Rate[] }>("GET", "/api/rates");
    if (!r.ok) return;
    setRates(r.data);
    setRateFields(Object.fromEntries(r.data.rates.map((x) => [`${x.species}|${x.grade}`, String(x.rate_cents)])));
  }, []);

  useEffect(() => {
    void loadQueue();
    void loadRates();
  }, [loadQueue, loadRates]);

  const saveGrade = async (b: Board): Promise<void> => {
    const grade = choices[b.tag] ?? b.grade ?? "";
    setBusy(b.tag);
    const r = await api<{ board: Board }>("POST", `/api/boards/${b.tag}/grade`, { grade });
    setBusy(null);
    setStatus(r.ok ? "Saved." : "Not saved.");
    if (r.ok) {
      setQueue((q) => q?.map((x) => (x.tag === b.tag ? r.data.board : x)) ?? null);
      void loadStock();
    }
  };

  const list = async (b: Board): Promise<void> => {
    setBusy(b.tag);
    const r = await api<{ board: Board }>("POST", `/api/boards/${b.tag}/list`, {});
    setBusy(null);
    setStatus(r.ok ? "Saved." : "Not saved.");
    if (r.ok) {
      setQueue((q) => q?.filter((x) => x.tag !== b.tag) ?? null);
      void loadStock();
    }
  };

  const saveRate = async (species: string, grade: string): Promise<void> => {
    const key = `${species}|${grade}`;
    const cents = rateFields[key] ?? "";
    const from = (fromFields[key] ?? "").trim();
    const effective = from === "" ? null : effectiveFrom(from);
    if (!/^\d+$/.test(cents.trim()) || (from !== "" && effective === null)) {
      setStatus("Not saved.");
      return;
    }
    const body = { species, grade, rate_cents: Number(cents), ...(effective ? { effective_at: effective } : {}) };
    const r = await api<{ rate: Rate }>("PUT", "/api/rates", body);
    if (!r.ok) {
      setStatus("Not saved.");
      return;
    }
    setStatus("Rate saved");
    setFromFields((f) => ({ ...f, [key]: "" }));
    await loadRates();
    void loadStock();
  };

  // Every section fills in from its own request: show the page once all three landed, so none pushes the next down.
  if (queue === null || rates === null || stock === null) {
    return <div className="owner"><h1 className="page-title">Owner</h1><p className="muted loading">Loading…</p></div>;
  }
  return (
    <div className="owner">
      <h1 className="page-title">Owner</h1>
      <div role="status" aria-label="Rate status" className="status-line sticky-status">{status}</div>
      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading">Grading queue</h2>
        {queue?.length === 0 && <p className="muted">Nothing waiting. Newly tagged boards appear here.</p>}
        <ul className="queue">
          {(queue ?? []).map((b) => {
            const thumb = b.photos[0];
            return (
              <li key={b.tag} className="queue-row">
                {thumb ? <img src={thumb.thumb_url} alt={`Thumbnail of ${b.tag}`} className="thumb" width={64} height={64} />
                  : <div className="thumb empty" aria-hidden="true">No photo</div>}
                <div className="queue-text">
                  <span className="mono">{b.tag}</span> <span className={`badge ${b.status}`}>{BOARD_LABELS[b.status]}</span>
                  <div>{b.species} · {b.lot.name}{b.parent_tag ? ` · cut from ${b.parent_tag}` : ""}</div>
                  <div className="mono measure">{b.length_mm} × {b.width_mm} × {b.thickness_mm} mm</div>
                </div>
                <div className="queue-actions">
                  <select aria-label={`Grade for ${b.tag}`} value={choices[b.tag] ?? b.grade ?? ""} onChange={(e) => setChoices({ ...choices, [b.tag]: e.target.value })}>
                      <option value="" disabled>Choose a grade</option>
                      {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <button type="button" className="quiet" disabled={busy === b.tag} onClick={() => void saveGrade(b)}>Save grade<span className="visually-hidden"> for {b.tag}</span></button>
                  <button type="button" className="quiet" disabled={busy === b.tag || b.status !== "graded"} onClick={() => void list(b)}>List<span className="visually-hidden"> {b.tag}</span> on the rack</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="rates-heading">
        <h2 id="rates-heading">Grade rates</h2>
        <p className="hint">Cents per board foot. Type a rate and press Enter; leave Effective from empty to start now, or give a UTC time as YYYY-MM-DD HH:MM.</p>
        <div className="table-wrap">
          <table className="data rates" aria-label="Grade rates">
            <thead><tr><th scope="col">Species</th>{GRADES.map((g) => <th key={g} scope="col">{g}</th>)}</tr></thead>
            <tbody>
              {SPECIES.map((s) => (
                <tr key={s}>
                  <th scope="row">{s}</th>
                  {GRADES.map((g) => {
                    const key = `${s}|${g}`;
                    return (
                      <td key={g} data-grade={g}>
                        <div className="rate-cell">
                          <input type="text" inputMode="numeric" className="mono" aria-label={`Rate for ${s} ${g}`} value={rateFields[key] ?? ""}
                            onChange={(e) => setRateFields({ ...rateFields, [key]: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveRate(s, g); } }} />
                          <input type="text" className="mono" aria-label={`Effective from for ${s} ${g}`} placeholder="now" value={fromFields[key] ?? ""}
                            onChange={(e) => setFromFields({ ...fromFields, [key]: e.target.value })} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Scheduled rates</h3>
        <ul aria-label="Scheduled rates" className="rows">
          {(rates?.scheduled ?? []).map((r, i) => (
            <li key={i} className="row-line mono">{`${r.species} ${r.grade} ${r.rate_cents} ¢/bd ft from ${formatWhen(r.effective_at)}`}</li>
          ))}
        </ul>
        {rates?.scheduled.length === 0 && <p className="muted">No rate changes scheduled.</p>}
      </section>
      <section aria-labelledby="stock-heading">
        <h2 id="stock-heading">Stock on hand</h2>
        <StockTable stock={stock} />
      </section>
    </div>
  );
}

