import { useEffect, useRef, useState, type FormEvent } from "react";
import { ADMIN_ACTIONS, marketStatusText, money, parseDollars, transitionAllowed, type MarketAction, type Outcome } from "../../shared/rules";
import { api, ApiError, type Deposit, type Market } from "../api";
import { Dialog } from "../components/Dialog";
import { Shell } from "../components/Shell";
import { Banner, Empty, Skeleton, Status, TableScroll } from "../components/ui";
import { COPY } from "../copy";
import { formatInZone } from "../format";
import { useMe } from "../session";

const ACTION_LABEL: Record<MarketAction, string> = { open: "Open trading", halt: "Halt", resume: "Resume", resolve: "Resolve", settle: "Settle" };

type AdminDeposit = Deposit & { member: { id: string; display_name: string; email: string } };

interface AdminDocument {
  id: string;
  member: { id: string; display_name: string };
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export function AdminPage() {
  const me = useMe();
  const zone = me.venue?.time_zone ?? "UTC";
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [deposits, setDeposits] = useState<AdminDeposit[] | null>(null);
  const [documents, setDocuments] = useState<AdminDocument[] | null>(null);
  const [status, setStatus] = useState("");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [resolving, setResolving] = useState<Market | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("yes");
  const [refunding, setRefunding] = useState<AdminDeposit | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundError, setRefundError] = useState("");
  const [form, setForm] = useState({ kind: "event", symbol: "", title: "", closes: "" });
  const [listError, setListError] = useState("");
  const symbolInput = useRef<HTMLSelectElement>(null);
  const refundInput = useRef<HTMLInputElement>(null);

  const loadMarkets = () => api<{ markets: Market[] }>("/api/markets").then((r) => setMarkets(r.markets)).catch(() => setMarkets([]));
  const loadDeposits = () => api<{ deposits: AdminDeposit[] }>("/api/admin/deposits").then((r) => setDeposits(r.deposits)).catch(() => setDeposits([]));
  useEffect(() => {
    void loadMarkets();
    void loadDeposits();
    api<{ documents: AdminDocument[] }>("/api/admin/documents").then((r) => setDocuments(r.documents)).catch(() => setDocuments([]));
  }, []);

  const act = async (market: Market, action: MarketAction, body?: unknown) => {
    setBusy(`${market.id}:${action}`);
    try {
      const updated = await api<Market>(`/api/markets/${market.id}/${action}`, { method: "POST", body });
      setStatus(`${updated.symbol} is now ${marketStatusText(updated.status, updated.outcome).toLowerCase()}.`);
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === "invalid_transition" ? `${market.symbol} can't do that from ${marketStatusText(market.status, market.outcome).toLowerCase()}.` : `${market.symbol} didn't change.`);
    } finally {
      setBusy(null);
      void loadMarkets();
    }
  };

  const liquidations = async (market: Market) => {
    setBusy(`${market.id}:liquidations`);
    try {
      const result = await api<{ checked: number; liquidated: unknown[] }>(`/api/markets/${market.id}/liquidations`, { method: "POST" });
      setStatus(`${market.symbol}: checked ${result.checked} positions, liquidated ${result.liquidated.length}.`);
    } finally {
      setBusy(null);
    }
  };

  const listMarket = async (event: FormEvent) => {
    event.preventDefault();
    const body: Record<string, string> = { kind: form.kind, symbol: form.symbol.trim().toUpperCase(), title: form.title.trim() };
    if (form.kind === "event") body.closes_at = form.closes ? new Date(form.closes).toISOString() : "";
    try {
      const created = await api<Market>("/api/markets", { body });
      setListing(false);
      setForm({ kind: "event", symbol: "", title: "", closes: "" });
      setStatus(`${created.symbol} is listed.`);
      void loadMarkets();
    } catch (error) {
      if (error instanceof ApiError && error.code === "symbol_taken") setListError("That symbol is already listed in this venue.");
      else if (error instanceof ApiError && error.errors.closes_at) setListError("Choose a close time in the future.");
      else setListError("Use 2 to 12 capital letters or digits for the symbol and a title of 1 to 120 characters.");
    }
  };

  const remaining = (d: AdminDeposit) => d.amount_cents - d.refunded_cents;
  const refund = async (event: FormEvent) => {
    event.preventDefault();
    if (!refunding) return;
    const cents = parseDollars(refundAmount);
    if (cents === null || cents < 1 || cents > remaining(refunding)) {
      setRefundError(COPY.refund.cap(remaining(refunding)));
      return;
    }
    setStatus(COPY.refund.pending);
    try {
      await api(`/api/deposits/${refunding.id}/refunds`, { body: { amount_cents: cents } });
      setPaused(false);
      setRefunding(null);
      setStatus(COPY.refund.issued(cents));
      void loadDeposits();
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setPaused(true);
        setRefunding(null);
        setStatus("");
      } else {
        setRefundError(COPY.refund.cap(remaining(refunding)));
        setStatus(COPY.refund.cap(remaining(refunding)));
      }
    }
  };

  const viewDocument = async (doc: AdminDocument) => {
    try {
      const link = await api<{ url: string }>(`/api/admin/documents/${doc.id}/link`);
      window.open(link.url, "_blank", "noopener");
    } catch {
      setStatus(COPY.profile.documentsDown);
    }
  };

  return (
    <Shell field="sage">
      <div className="page-head">
        <h1>Market admin</h1>
        <button type="button" className="pill" onClick={() => setListing(true)}>List market</button>
      </div>
      {paused && <Banner>{COPY.deposit.paused}</Banner>}
      <Status label="Admin updates" message={status} className="page-status" />
      {markets === null || deposits === null || documents === null ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <section className="card">
            <h2 className="card-title" id="admin-markets">Markets</h2>
            <TableScroll labelledBy="admin-markets">
              <table className="table" aria-labelledby="admin-markets">
                <thead>
                  <tr><th scope="col">Symbol</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Closes</th><th scope="col">Actions</th></tr>
                </thead>
                <tbody>
                  {markets.map((market) => (
                    <tr key={market.id}>
                      <td className="symbol">{market.symbol}</td>
                      <td className="wrap">{market.title}</td>
                      <td>{marketStatusText(market.status, market.outcome)}</td>
                      <td>{market.closes_at ? formatInZone(market.closes_at, zone) : "—"}</td>
                      <td>
                        <div className="row-actions">
                          {ADMIN_ACTIONS.filter((action) => transitionAllowed(market.kind, market.status, action, false)).map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="pill pill-small"
                              disabled={busy === `${market.id}:${action}`}
                              onClick={() => {
                                if (action === "resolve") {
                                  setOutcome("yes");
                                  setResolving(market);
                                } else void act(market, action);
                              }}
                            >
                              {ACTION_LABEL[action]}
                            </button>
                          ))}
                          {market.kind === "pair" && (
                            <button type="button" className="pill pill-small" disabled={busy === `${market.id}:liquidations`} onClick={() => void liquidations(market)}>
                              Run liquidations
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>
          <section className="card">
            <h2 className="card-title" id="admin-deposits">Deposits</h2>
            {deposits.length === 0 ? (
              <Empty text="No deposits in this venue yet." sticker="coin" />
            ) : (
              <TableScroll labelledBy="admin-deposits">
                <table className="table" aria-labelledby="admin-deposits">
                  <thead>
                    <tr><th scope="col">Member</th><th scope="col">When</th><th scope="col">Amount</th><th scope="col">Refunded</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Action</span></th></tr>
                  </thead>
                  <tbody>
                    {deposits.map((d) => (
                      <tr key={d.id}>
                        <td>{d.member.display_name}<br /><span className="muted small">{d.member.email}</span></td>
                        <td>{formatInZone(d.created_at, zone)}</td>
                        <td className="numeric">{money(d.amount_cents)}</td>
                        <td className="numeric">{money(d.refunded_cents)}</td>
                        <td>{d.status === "succeeded" ? "Confirmed" : "Declined"}</td>
                        <td>
                          {d.status === "succeeded" && remaining(d) > 0 && (
                            <button type="button" className="pill pill-small" onClick={() => { setRefundAmount(""); setRefundError(""); setRefunding(d); }}>
                              Refund
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </section>
          <section className="card">
            <h2 className="card-title" id="admin-documents">ID documents</h2>
            {documents.length === 0 ? (
              <Empty text="No ID documents uploaded yet." sticker="envelope" />
            ) : (
              <TableScroll labelledBy="admin-documents">
                <table className="table" aria-labelledby="admin-documents">
                  <thead>
                    <tr><th scope="col">Member</th><th scope="col">File</th><th scope="col">Uploaded</th><th scope="col"><span className="visually-hidden">Action</span></th></tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id}>
                        <td>{doc.member.display_name}</td>
                        <td className="wrap">{doc.filename} <span className="muted small">{doc.size_bytes.toLocaleString("en-US")} bytes</span></td>
                        <td>{formatInZone(doc.uploaded_at, zone)}</td>
                        <td>
                          <a href={`/admin#${doc.id}`} onClick={(e) => { e.preventDefault(); void viewDocument(doc); }}>View document</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </section>
        </>
      )}

      <Dialog title="List market" open={listing} onClose={() => setListing(false)} initialFocus={symbolInput}>
        <form className="form" onSubmit={(e) => void listMarket(e)} noValidate>
          <div className="field-row">
            <label htmlFor="list-kind">Kind</label>
            <select ref={symbolInput} id="list-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="event">Event</option>
              <option value="pair">Spot and margin</option>
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="list-symbol">Symbol</label>
            <input id="list-symbol" type="text" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
          </div>
          <div className="field-row">
            <label htmlFor="list-title">Title</label>
            <input id="list-title" type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          {form.kind === "event" && (
            <div className="field-row">
              <label htmlFor="list-closes">Closes at</label>
              <input id="list-closes" type="datetime-local" value={form.closes} onChange={(e) => setForm({ ...form, closes: e.target.value })} />
            </div>
          )}
          <p className="field-error" role="status" aria-live="polite">{listError}</p>
          <div className="dialog-actions">
            <button type="submit" className="pill">List market</button>
          </div>
        </form>
      </Dialog>

      <Dialog title={`Resolve ${resolving?.symbol ?? ""}`} open={resolving !== null} onClose={() => setResolving(null)}>
        <p>{resolving?.title}</p>
        <div role="radiogroup" aria-label="Outcome" className="segments">
          {(["yes", "no"] as const).map((value) => (
            <label key={value} className={`segment${outcome === value ? " is-checked" : ""}`}>
              <input type="radio" name="resolve-outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} />
              <span>{value === "yes" ? "Yes" : "No"}</span>
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="pill"
            onClick={() => {
              const market = resolving;
              setResolving(null);
              if (market) void act(market, "resolve", { outcome });
            }}
          >
            Confirm resolution
          </button>
        </div>
      </Dialog>

      <Dialog title="Refund deposit" open={refunding !== null} onClose={() => setRefunding(null)} initialFocus={refundInput}>
        {refunding && (
          <form className="form" onSubmit={(e) => void refund(e)} noValidate>
            <p>{refunding.member.display_name} · {money(refunding.amount_cents)} deposit, {money(remaining(refunding))} not yet refunded.</p>
            <div className="field-row">
              <label htmlFor="refund-amount">Refund amount (USD)</label>
              <input ref={refundInput} id="refund-amount" type="text" inputMode="decimal" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} aria-describedby="refund-error" />
              <p id="refund-error" className="field-error">{refundError}</p>
            </div>
            <div className="dialog-actions">
              <button type="submit" className="pill">Issue refund</button>
            </div>
          </form>
        )}
      </Dialog>
    </Shell>
  );
}
