import { useEffect, useRef, useState, type FormEvent } from "react";
import { money, parseDollars } from "../../shared/rules";
import { api, ApiError, type Balance, type Deposit, type Market, type Positions } from "../api";
import { Dialog } from "../components/Dialog";
import { Shell } from "../components/Shell";
import { Banner, Empty, Skeleton, Status, TableScroll } from "../components/ui";
import { COPY } from "../copy";
import { formatInZone } from "../format";
import { hasRole, useMe } from "../session";

export function BalancePage() {
  const me = useMe();
  const canDeposit = hasRole(me, "trader") || hasRole(me, "builder");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [positions, setPositions] = useState<Positions | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [card, setCard] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; card?: string }>({});
  const [status, setStatus] = useState("");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const amountInput = useRef<HTMLInputElement>(null);

  const load = () => {
    api<Balance>("/api/balance").then(setBalance).catch(() => undefined);
    api<{ deposits: Deposit[] }>("/api/deposits").then((r) => setDeposits(r.deposits)).catch(() => setDeposits([]));
    api<Positions>("/api/positions").then(setPositions).catch(() => undefined);
  };
  useEffect(() => {
    load();
    api<{ markets: Market[] }>("/api/markets").then((r) => setMarkets(r.markets)).catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseDollars(amount);
    if (cents === null) {
      setErrors({ amount: COPY.deposit.amountRange });
      setStatus(COPY.deposit.amountRange);
      return;
    }
    setErrors({});
    setBusy(true);
    setStatus(COPY.deposit.pending);
    try {
      const deposit = await api<Deposit>("/api/deposits", { body: { amount_cents: cents, card_number: card } });
      setPaused(false);
      setStatus(COPY.deposit.confirmed(deposit.amount_cents));
      setOpen(false);
      setAmount("");
      setCard("");
      load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const next = { amount: error.errors.amount_cents ? COPY.deposit.amountRange : undefined, card: error.errors.card_number ? COPY.deposit.card : undefined };
        setErrors(next);
        setStatus(next.amount ?? next.card ?? "");
      } else if (error instanceof ApiError && error.status === 503) {
        setPaused(true);
        setStatus("");
      } else {
        setStatus(COPY.deposit.declined);
        load();
      }
    } finally {
      setBusy(false);
    }
  };

  const symbol = (id: string) => markets.find((m) => m.id === id)?.symbol ?? "—";
  const rows = positions
    ? [
        ...positions.spot.map((p) => ({ key: `s-${p.market_id}`, market: symbol(p.market_id), type: "Spot units", detail: `${p.quantity} held, ${p.reserved} reserved` })),
        ...positions.margin.map((p) => ({
          key: p.id,
          market: symbol(p.market_id),
          type: `Margin ${p.side}`,
          detail: p.status === "open" ? `${p.quantity} · cost ${money(p.cost_cents)} · collateral ${money(p.collateral_cents)} · equity ${money(p.equity_cents)}` : p.status === "liquidated" ? "Liquidated" : "Closed",
        })),
        ...positions.event.map((p) => ({ key: `e-${p.market_id}-${p.outcome}`, market: symbol(p.market_id), type: `Event ${p.outcome.toUpperCase()}`, detail: `${p.quantity} contracts` })),
      ]
    : [];

  return (
    <Shell field="slate">
      <div className="page-head">
        <h1>Balance</h1>
        {canDeposit && (
          <button type="button" className="pill" onClick={() => setOpen(true)}>
            Deposit by card
          </button>
        )}
      </div>
      {paused && <Banner>{COPY.deposit.paused}</Banner>}
      <Status label="Deposit status" message={status} className="page-status" />
      <div className="card-grid two balance-figures">
        {(["available", "held", "collateral"] as const).map((part) => (
          <div className="card stat-card" key={part}>
            <span className="figure-label">{part === "available" ? "Available" : part === "held" ? "Held" : "Collateral"}</span>
            <span className="numeric stat-value">{balance ? money(balance[`${part}_cents`]) : "—"}</span>
          </div>
        ))}
      </div>
      <section className="card">
        <h2 className="card-title" id="deposits-title">Deposits</h2>
        {deposits === null ? (
          <Skeleton />
        ) : deposits.length === 0 ? (
          <Empty text="No deposits yet." sticker="coin" />
        ) : (
          <TableScroll labelledBy="deposits-title">
            <table className="table" aria-labelledby="deposits-title">
              <thead>
                <tr><th scope="col">When</th><th scope="col">Amount</th><th scope="col">Refunded</th><th scope="col">Card</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id}>
                    <td>{me.venue ? formatInZone(d.created_at, me.venue.time_zone) : d.created_at}</td>
                    <td className="numeric">{money(d.amount_cents)}</td>
                    <td className="numeric">{money(d.refunded_cents)}</td>
                    <td>•••• {d.card_last4}</td>
                    <td>{d.status === "succeeded" ? "Confirmed" : "Declined"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
      <section className="card">
        <h2 className="card-title" id="positions-title">Positions</h2>
        {positions === null ? (
          <Skeleton />
        ) : rows.length === 0 ? (
          <Empty text="No positions yet." sticker="cube" />
        ) : (
          <TableScroll labelledBy="positions-title">
            <table className="table" aria-labelledby="positions-title">
              <thead>
                <tr><th scope="col">Market</th><th scope="col">Type</th><th scope="col">Position</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.market}</td>
                    <td>{r.type}</td>
                    <td className="numeric">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        {positions && positions.margin.some((p) => p.status === "open") && (
          <p className="muted small">Margin equity is marked at each pair's last trade, {positions.margin.filter((p) => p.status === "open").map((p) => `${symbol(p.market_id)} maintenance ${money(p.maintenance_cents)}`).join(", ")}.</p>
        )}
      </section>
      <Dialog title="Deposit by card" open={open} onClose={() => setOpen(false)} initialFocus={amountInput}>
        <form className="form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field-row">
            <label htmlFor="deposit-amount">Amount (USD)</label>
            <input ref={amountInput} id="deposit-amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby="deposit-amount-error" aria-invalid={Boolean(errors.amount)} />
            <p id="deposit-amount-error" className="field-error">{errors.amount}</p>
          </div>
          <div className="field-row">
            <label htmlFor="deposit-card">Card number</label>
            <input id="deposit-card" type="text" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.target.value)} aria-describedby="deposit-card-error" aria-invalid={Boolean(errors.card)} />
            <p id="deposit-card-error" className="field-error">{errors.card}</p>
          </div>
          <p className="muted small">Between $5.00 and $5,000.00. Only the last four digits reach the processor.</p>
          <div className="dialog-actions">
            <button type="submit" className="pill" aria-busy={busy}>Deposit</button>
          </div>
        </form>
      </Dialog>
    </Shell>
  );
}
